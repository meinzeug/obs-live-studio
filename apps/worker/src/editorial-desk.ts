import { createHash } from 'node:crypto';
import { query } from '@ans/database';
import { createAiStaffTask, recordAiStaffActivity } from '@ans/database/ai-staff';
import {
  claimEditorialDeskCycle,
  completeEditorialDeskCycle,
  failEditorialDeskCycle,
  getEditorialDeskSettings,
} from '@ans/database/editorial-desk';
import { readOpenRouterEnvironment, resolveOpenRouterConfig } from '@ans/ai-provider';
import { upsertOperationalNotification, resolveOperationalNotification } from '@ans/database/notifications';

type Log = (event: string, extra?: Record<string, unknown>) => void;
type ReconcileEditorial = (force?: boolean) => Promise<{ approved: number; prepared: number }>;

function compactError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1500);
}

function evidenceFingerprint(rows: Array<Record<string, unknown>>) {
  return createHash('sha256')
    .update(JSON.stringify(rows.map((row) => [row.id, row.status, row.fetched_at])))
    .digest('hex');
}

async function currentEditorialEvidence(limit: number) {
  return (
    await query<{
      id: string;
      title: string;
      source_name: string;
      category: string | null;
      region: string | null;
      status: string;
      trust_score: number;
      warnings: string[];
      published_at: string | null;
      fetched_at: string;
    }>(
      `select article.id,article.title,coalesce(source.name,'Redaktion') source_name,
              article.category,article.region,article.status,article.trust_score,article.warnings,
              article.published_at,article.fetched_at
       from articles article
       left join sources source on source.id=article.source_id
       where article.deleted_at is null
         and article.fetched_at>now()-interval '24 hours'
       order by
         case article.status when 'new' then 0 when 'review' then 1 when 'approved' then 2 else 3 end,
         coalesce(article.published_at,article.fetched_at) desc
       limit $1`,
      [Math.max(3, Math.min(50, limit))],
    )
  ).rows;
}

function topicDesk(rows: Awaited<ReturnType<typeof currentEditorialEvidence>>) {
  const grouped = new Map<string, { category: string; count: number; sources: Set<string>; examples: string[] }>();
  for (const row of rows) {
    const category = row.category?.trim() || 'Allgemein';
    const group = grouped.get(category) ?? { category, count: 0, sources: new Set<string>(), examples: [] };
    group.count += 1;
    group.sources.add(row.source_name);
    if (group.examples.length < 3) group.examples.push(row.title);
    grouped.set(category, group);
  }
  return [...grouped.values()]
    .sort((left, right) => right.count - left.count || right.sources.size - left.sources.size)
    .slice(0, 8)
    .map((entry) => ({
      category: entry.category,
      storyCount: entry.count,
      distinctSources: entry.sources.size,
      sources: [...entry.sources].slice(0, 6),
      examples: entry.examples,
    }));
}

async function taskRecentlyQueued(staffMemberId: string, title: string) {
  return Boolean(
    (
      await query<{ exists: boolean }>(
        `select exists(
           select 1 from ai_staff_tasks
           where staff_member_id=$1 and title=$2
             and created_at>now()-interval '90 minutes'
             and status in ('queued','running','waiting_review','completed')
         ) exists`,
        [staffMemberId, title],
      )
    ).rows[0]?.exists,
  );
}

export class EditorialDeskProcessor {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly log: Log,
    private readonly reconcileEditorial: ReconcileEditorial,
  ) {}

  async run(trigger: 'scheduled' | 'manual' | 'startup' = 'scheduled') {
    if (this.running) return;
    this.running = true;
    const cycle = await claimEditorialDeskCycle(trigger).catch((error) => {
      this.log('editorial_desk_claim_failed', { error: compactError(error) });
      return null;
    });
    if (!cycle) {
      this.running = false;
      return;
    }
    try {
      const settings = await getEditorialDeskSettings();
      const before = await currentEditorialEvidence(settings.max_stories_per_cycle);
      const reconciliation = await this.reconcileEditorial(true);
      const evidence = await currentEditorialEvidence(settings.max_stories_per_cycle);
      const topics = topicDesk(evidence);
      const distinctSources = new Set(evidence.map((row) => row.source_name)).size;
      const env = await readOpenRouterEnvironment();
      const openRouterConfigured = Boolean(resolveOpenRouterConfig(env).apiKey);
      const assignments: Array<Record<string, unknown>> = [];
      if (settings.create_staff_assignments && evidence.length) {
        const assignmentsToCreate = [
          {
            staffMemberId: 'editor',
            title: 'Redaktionslage der nächsten Sendestunde',
            instructions: [
              `Regionale Leitlinie: ${settings.region_focus}.`,
              'Ordne die folgenden aktuellen Meldungen nach Nachrichtenwert, Aktualität und Quellenvielfalt.',
              'Liefere einen konkreten Beitragsvorschlag; Nachricht und Kommentar strikt trennen.',
              JSON.stringify(evidence.map((row) => ({
                id: row.id,
                title: row.title,
                source: row.source_name,
                category: row.category,
                status: row.status,
              }))),
            ].join('\n'),
          },
          {
            staffMemberId: 'fact-checker',
            title: 'Fakten- und Quellencheck der aktuellen Themenlage',
            instructions: [
              'Prüfe priorisiert Meldungen mit nur einer Quelle, Warnungen oder niedrigerem Vertrauenswert.',
              'Erfinde keine Belege. Benenne konkret, welche Primär- oder Gegenquelle noch erforderlich ist.',
              JSON.stringify(evidence.map((row) => ({
                id: row.id,
                title: row.title,
                source: row.source_name,
                trust: row.trust_score,
                warnings: row.warnings,
              }))),
            ].join('\n'),
          },
          {
            staffMemberId: 'producer',
            title: 'Sendefähige Themen an Planung und Regie übergeben',
            instructions: [
              'Erstelle aus freigegebenen und geprüften Meldungen einen abwechslungsreichen Ablaufvorschlag.',
              'Keine doppelten Themen direkt hintereinander. Fehlende Audio- oder Medienpakete als Blocker markieren.',
              JSON.stringify(evidence.filter((row) => ['approved', 'published'].includes(row.status))),
            ].join('\n'),
          },
        ];
        for (const assignment of assignmentsToCreate) {
          if (await taskRecentlyQueued(assignment.staffMemberId, assignment.title)) {
            assignments.push({ ...assignment, status: 'deduplicated' });
            continue;
          }
          const task = await createAiStaffTask({
            ...assignment,
            kind: 'assignment',
            priority: assignment.staffMemberId === 'fact-checker' ? 'high' : 'normal',
          });
          assignments.push({
            staffMemberId: assignment.staffMemberId,
            title: assignment.title,
            taskId: task?.id ?? null,
            status: task ? 'queued' : 'skipped',
          });
        }
      }
      const fallbackUsed = !openRouterConfigured && reconciliation.prepared > 0;
      const summary = [
        `${evidence.length} aktuelle Meldungen aus ${distinctSources} Quellen beobachtet.`,
        `${reconciliation.prepared} Artikelpakete vorbereitet, ${reconciliation.approved} freigegeben.`,
        `${assignments.filter((assignment) => assignment.status === 'queued').length} konkrete Teamaufträge übergeben.`,
        distinctSources < settings.minimum_distinct_sources
          ? `Quellenvielfalt unter Zielwert ${settings.minimum_distinct_sources}; Gegenrecherche bleibt offen.`
          : 'Quellenvielfalt erreicht den eingestellten Mindestwert.',
      ].join(' ');
      await completeEditorialDeskCycle(cycle.id, {
        status: distinctSources < settings.minimum_distinct_sources ? 'degraded' : 'completed',
        evidenceFingerprint: evidenceFingerprint(evidence),
        newArticles: evidence.filter((row) => row.status === 'new').length,
        reviewedArticles: evidence.filter((row) => row.status === 'review').length,
        approvedArticles: evidence.filter((row) => ['approved', 'published'].includes(row.status)).length,
        distinctSources,
        topics,
        assignments,
        summary,
        fallbackUsed,
      });
      await resolveOperationalNotification('editorial-desk:cycle-failed').catch(() => null);
      await Promise.all(
        ['editor', 'fact-checker', 'producer'].map((staffMemberId) =>
          recordAiStaffActivity({
            staffMemberId,
            eventType: 'editorial_desk_shift_completed',
            title:
              staffMemberId === 'editor'
                ? 'Aktuelle Themenlage gesichtet'
                : staffMemberId === 'fact-checker'
                  ? 'Quellen- und Prüflage aktualisiert'
                  : 'Sendefähige Themen an die Produktion übergeben',
            detail: summary,
            status: distinctSources < settings.minimum_distinct_sources ? 'warning' : 'ready',
            metadata: {
              cycleId: cycle.id,
              trigger,
              topics,
              evidenceCount: evidence.length,
              previousEvidenceCount: before.length,
              openRouterConfigured,
              fallbackUsed,
            },
          }),
        ),
      );
      if (distinctSources < settings.minimum_distinct_sources) {
        await upsertOperationalNotification({
          level: 'warning',
          component: 'editorial-desk',
          dedupeKey: 'editorial-desk:source-diversity',
          message: 'Die autonome Redaktion hat aktuell zu wenig unterschiedliche Quellen.',
          details: {
            distinctSources,
            target: settings.minimum_distinct_sources,
            topics,
            broadcastContinues: true,
          },
        });
      } else {
        await resolveOperationalNotification('editorial-desk:source-diversity');
      }
      this.log('editorial_desk_cycle_completed', {
        cycleId: cycle.id,
        evidence: evidence.length,
        distinctSources,
        prepared: reconciliation.prepared,
        approved: reconciliation.approved,
        assignments: assignments.length,
        fallbackUsed,
      });
    } catch (error) {
      await failEditorialDeskCycle(cycle.id, compactError(error));
      await upsertOperationalNotification({
        level: 'error',
        component: 'editorial-desk',
        dedupeKey: 'editorial-desk:cycle-failed',
        message: 'Eine autonome Redaktionsschicht ist fehlgeschlagen.',
        details: { cycleId: cycle.id, error: compactError(error), broadcastContinues: true },
      }).catch(() => null);
      this.log('editorial_desk_cycle_failed', { cycleId: cycle.id, error: compactError(error) });
    } finally {
      this.running = false;
    }
  }

  async start() {
    if (this.timer) return;
    await this.run('startup');
    this.timer = setInterval(() => void this.run('scheduled'), 30_000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

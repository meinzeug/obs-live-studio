import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { WritePermission } from '@ans/security/auth';
import { auditLog } from '@ans/database/auth';
import {
  autonomousStudioCeoSummary,
  autonomousStudioEvidence,
  createAutonomousStudioDecision,
  getAutonomousStudioDecision,
  getAutonomousStudioDeliverable,
  getAutonomousStudioSettings,
  getStudioOperatingState,
  listAutonomousStudioCouncilMembers,
  listAutonomousStudioDecisions,
  listAutonomousCouncilMessages,
  markAutonomousDecisionRolledBack,
  queueAutonomousStudioCycle,
  recordAutonomousCouncilMessage,
  reviewAutonomousDecisionByCeo,
  restoreStudioOperatingState,
  retryAutonomousDecision,
  updateAutonomousStudioCouncilMember,
  updateAutonomousStudioSettings,
  type StudioOperatingState,
} from '@ans/database/autonomous-studio';
import { archiveBroadcastFormat } from '@ans/database/broadcast-formats';
import {
  deleteOverlayProject,
  getAutopilotConfig,
  getPlaybackSnapshot,
  query,
  setAutopilotConfig,
} from '@ans/database';
import { getOpenRouterBudgetSummary } from '@ans/database/ai-usage';
import { updateAiStaffMember } from '@ans/database/ai-staff';

type RequirePermission = (request: FastifyRequest, reply: FastifyReply, permission: WritePermission) => unknown;

const settingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    automaticApply: z.boolean().optional(),
    cycleIntervalHours: z.number().int().min(1).max(168).optional(),
    planningHorizonDays: z.number().int().min(1).max(365).optional(),
    maxFormatsPerWeek: z.number().int().min(0).max(30).optional(),
    maxProductionsPerDay: z.number().int().min(0).max(50).optional(),
    maxShortsPerDay: z.number().int().min(0).max(50).optional(),
    councilQuorum: z.number().int().min(3).max(5).optional(),
    paidModelStrategy: z.enum(['automatic', 'fixed']).optional(),
    paidModel: z.string().trim().max(300).optional(),
    maxRequestUsd: z.number().min(0.01).max(25).optional(),
    dailyBudgetUsd: z.number().min(0.01).max(1000).optional(),
    reviewerModels: z.array(z.string().trim().min(3).max(300)).min(2).max(5).optional(),
    audienceCouncilEnabled: z.boolean().optional(),
    audienceCouncilCooldownMinutes: z.number().int().min(5).max(1440).optional(),
    audienceCouncilMaxDaily: z.number().int().min(1).max(100).optional(),
    requireCeoApproval: z.boolean().optional(),
    minimumActiveFormats: z.number().int().min(1).max(12).optional(),
    maximumRevisionRounds: z.number().int().min(1).max(8).optional(),
    pausedReason: z.string().trim().max(1000).nullable().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.paidModelStrategy === 'fixed' && !input.paidModel)
      context.addIssue({ code: 'custom', path: ['paidModel'], message: 'Für die feste Strategie fehlt das Modell.' });
    if (input.reviewerModels && new Set(input.reviewerModels).size < 2)
      context.addIssue({
        code: 'custom',
        path: ['reviewerModels'],
        message: 'Die beiden Schlussprüfungen benötigen unterschiedliche Modelle.',
      });
  });

const directiveSchema = z
  .object({ instruction: z.string().trim().min(3).max(12_000), title: z.string().trim().max(180).optional() })
  .strict();
const cycleSchema = z.object({ reason: z.string().trim().max(3000).optional() }).strict();
const councilMessageSchema = z
  .object({ message: z.string().trim().min(2).max(12_000), title: z.string().trim().max(180).optional() })
  .strict();
const ceoReviewSchema = z
  .object({
    action: z.enum(['approve', 'revise', 'reject']),
    feedback: z.string().trim().max(5000).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.action === 'revise' && !input.feedback)
      context.addIssue({
        code: 'custom',
        path: ['feedback'],
        message: 'Für eine Überarbeitung fehlt die Rückmeldung.',
      });
  });
const councilMemberSchema = z
  .object({
    display_name: z.string().trim().min(2).max(120).optional(),
    instructions: z.string().trim().min(10).max(3000).optional(),
    preferred_model: z.string().trim().min(3).max(300).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

function directiveTitle(instruction: string, supplied?: string) {
  if (supplied?.trim()) return supplied.trim();
  const first = instruction.split(/[.!?\n]/, 1)[0]?.trim() || 'Neue CEO-Direktive';
  return first.slice(0, 180);
}

async function rollbackDecision(id: string, actorUserId?: string | null) {
  const decision = await getAutonomousStudioDecision(id);
  if (!decision) throw Object.assign(new Error('Studioentscheidung nicht gefunden.'), { statusCode: 404 });
  if (decision.status !== 'applied')
    throw Object.assign(new Error('Nur eine aktive Entscheidung kann zurückgerollt werden.'), { statusCode: 409 });
  const activeChildren = Number(
    (
      await query<{ count: string }>(
        `select count(*)::text count from autonomous_studio_decisions
         where parent_decision_id=$1 and status in ('approved','applying','applied')`,
        [id],
      )
    ).rows[0]?.count ?? 0,
  );
  if (activeChildren > 0)
    throw Object.assign(
      new Error('Zuerst müssen die bereits freigegebenen oder aktiven Unterentscheidungen zurückgerollt werden.'),
      { statusCode: 409 },
    );

  const snapshot = decision.snapshot_before ?? {};
  const restored: Record<string, unknown> = {};
  const operatingState = snapshot.operatingState as StudioOperatingState | undefined;
  if (operatingState?.id === true) {
    await restoreStudioOperatingState(operatingState);
    restored.operatingState = true;
  }
  if (snapshot.autopilot && typeof snapshot.autopilot === 'object') {
    await setAutopilotConfig(snapshot.autopilot as Awaited<ReturnType<typeof getAutopilotConfig>>);
    restored.autopilot = true;
  }
  if (Array.isArray(snapshot.staff)) {
    for (const item of snapshot.staff) {
      if (!item || typeof item !== 'object') continue;
      const member = item as { id?: unknown; config?: unknown };
      if (typeof member.id !== 'string' || !member.config || typeof member.config !== 'object') continue;
      await updateAiStaffMember(member.id, { config: member.config as Record<string, unknown> });
    }
    restored.staff = snapshot.staff.length;
  }
  const applyResult = decision.apply_result ?? {};
  if (decision.kind === 'format' && applyResult.formatId && applyResult.reused !== true) {
    await archiveBroadcastFormat(String(applyResult.formatId));
    restored.formatArchived = applyResult.formatId;
  }
  if (decision.kind === 'format' && applyResult.overlayCreated === true && applyResult.overlayProjectId) {
    await deleteOverlayProject(String(applyResult.overlayProjectId));
    restored.overlayArchived = applyResult.overlayProjectId;
  }
  if (decision.kind === 'production' && applyResult.producerTaskId) {
    await query(
      `update ai_staff_tasks set status='cancelled',cancelled_at=now(),updated_at=now()
       where id=$1 and status in ('queued','running','waiting_review')`,
      [String(applyResult.producerTaskId)],
    );
    restored.productionTaskCancelled = applyResult.producerTaskId;
  }
  const rolledBack = await markAutonomousDecisionRolledBack(id, { result: { rollback: restored }, actorUserId });
  if (!rolledBack)
    throw Object.assign(new Error('Die Entscheidung wurde zwischenzeitlich verändert.'), { statusCode: 409 });
  return rolledBack;
}

export function registerAutonomousStudioRoutes(app: FastifyInstance, requirePermission: RequirePermission) {
  app.get('/api/autonomous-studio', async () => {
    const [settings, operatingState, council, decisions, evidence, councilMessages] = await Promise.all([
      getAutonomousStudioSettings(),
      getStudioOperatingState(),
      listAutonomousStudioCouncilMembers(),
      listAutonomousStudioDecisions(120),
      autonomousStudioEvidence(),
      listAutonomousCouncilMessages(100),
    ]);
    const budget = await getOpenRouterBudgetSummary(settings.daily_budget_usd, settings.max_request_usd);
    return { settings, operatingState, council, decisions, evidence, councilMessages, budget };
  });

  app.get('/api/autonomous-studio/decisions/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const decision = await getAutonomousStudioDecision(id);
    if (!decision) return reply.code(404).send({ error: 'Studioentscheidung nicht gefunden' });
    return decision;
  });

  app.get('/api/autonomous-studio/ceo', async () => {
    const [summary, playback, autopilot, risks, schedule] = await Promise.all([
      autonomousStudioCeoSummary(),
      getPlaybackSnapshot().catch(() => null),
      getAutopilotConfig(),
      query<{ level: string; count: number }>(
        `select level,count(*)::int count from notifications where resolved_at is null group by level`,
      ),
      query<{ id: string; name: string; scheduled_at: string; status: string }>(
        `select id,name,scheduled_at,status from broadcast_playlists
         where scheduled_at>=now() and status in ('draft','starting','running','paused')
         order by scheduled_at limit 5`,
      ),
    ]);
    const budget = await getOpenRouterBudgetSummary(
      summary.settings.daily_budget_usd,
      summary.settings.max_request_usd,
    );
    const actions = [
      summary.decisions.council_waiting > 0
        ? `${summary.decisions.council_waiting} Entscheidung(en) werden gerade vom KI-Sendergremium beraten.`
        : null,
      summary.decisions.review_waiting > 0
        ? `${summary.decisions.review_waiting} Entscheidung(en) befinden sich in der unabhängigen Schlussprüfung.`
        : null,
      summary.decisions.ceo_waiting > 0
        ? `${summary.decisions.ceo_waiting} fertig geprüfte Entscheidung(en) warten auf deine CEO-Freigabe.`
        : null,
      summary.decisions.failed_decisions > 0
        ? `${summary.decisions.failed_decisions} fehlgeschlagene Entscheidung(en) benötigen Aufmerksamkeit.`
        : null,
      !autopilot.enabled ? 'Der Autopilot ist deaktiviert.' : null,
      budget.remainingUsd <= summary.settings.max_request_usd
        ? 'Das heutige autonome KI-Budget ist nahezu verbraucht.'
        : null,
    ].filter(Boolean);
    return {
      ...summary,
      playback,
      autopilot: {
        enabled: autopilot.enabled,
        contentMode: autopilot.contentMode,
        formats: autopilot.dailyFormats.length,
      },
      budget,
      risks: Object.fromEntries(risks.rows.map((row) => [row.level, Number(row.count)])),
      schedule: schedule.rows,
      nextActions: actions.length ? actions : ['Der Sender arbeitet innerhalb der freigegebenen Leitlinien.'],
    };
  });

  app.patch('/api/autonomous-studio/settings', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    const input = settingsSchema.parse(request.body ?? {});
    const settings = await updateAutonomousStudioSettings(input);
    await auditLog(
      request.user?.id ?? null,
      'autonomous_studio.settings.update',
      'autonomous_studio_settings',
      undefined,
      {
        fields: Object.keys(input),
      },
    );
    return settings;
  });

  app.patch('/api/autonomous-studio/council/:id', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    const { id } = z.object({ id: z.string().trim().min(2).max(80) }).parse(request.params);
    const member = await updateAutonomousStudioCouncilMember(id, councilMemberSchema.parse(request.body ?? {}));
    if (!member) return reply.code(404).send({ error: 'Gremiumsmitglied nicht gefunden' });
    await auditLog(
      request.user?.id ?? null,
      'autonomous_studio.council.update',
      'autonomous_studio_council_member',
      undefined,
      {
        memberId: id,
      },
    );
    return member;
  });

  app.post('/api/autonomous-studio/cycle', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const input = cycleSchema.parse(request.body ?? {});
    const decision = await queueAutonomousStudioCycle({
      force: true,
      requestedBy: request.user?.id,
      reason: input.reason,
    });
    await auditLog(
      request.user?.id ?? null,
      'autonomous_studio.cycle.start',
      'autonomous_studio_decision',
      decision?.id,
      {
        reason: input.reason ?? null,
      },
    );
    return reply
      .code(202)
      .send({ decision, message: decision ? 'Strategiezyklus gestartet.' : 'Ein Strategiezyklus läuft bereits.' });
  });

  app.post('/api/sendegott/directives', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    const input = directiveSchema.parse(request.body ?? {});
    const decision = await createAutonomousStudioDecision({
      kind: 'directive',
      source: 'sendegott',
      title: directiveTitle(input.instruction, input.title),
      instruction: input.instruction,
      requestedBy: request.user?.id,
    });
    await recordAutonomousCouncilMessage({
      decisionId: decision?.id,
      authorKind: 'ceo',
      authorName: 'CEO',
      message: input.instruction,
      actorUserId: request.user?.id,
      metadata: { channel: 'directive' },
    });
    await auditLog(request.user?.id ?? null, 'sendegott.directive.create', 'autonomous_studio_decision', decision?.id, {
      title: decision?.title,
    });
    return reply.code(202).send({
      decision,
      message:
        'Die Direktive wird übersetzt, vom KI-Sendergremium beraten und anschließend zweifach unabhängig geprüft.',
    });
  });

  app.post('/api/autonomous-studio/council/messages', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    const input = councilMessageSchema.parse(request.body ?? {});
    const decision = await createAutonomousStudioDecision({
      kind: 'directive',
      source: 'sendegott',
      title: directiveTitle(input.message, input.title),
      instruction: input.message,
      requestedBy: request.user?.id,
      importance: 'high',
    });
    await recordAutonomousCouncilMessage({
      decisionId: decision?.id,
      authorKind: 'ceo',
      authorName: 'CEO',
      message: input.message,
      actorUserId: request.user?.id,
    });
    await recordAutonomousCouncilMessage({
      decisionId: decision?.id,
      authorKind: 'system',
      authorName: 'Ratssekretariat',
      message:
        'Auftrag angenommen. Das Gremium erstellt jetzt einen Lösungsentwurf mit Arbeitspaketen, Format- und Overlay-Entwürfen, messbarer Abnahme und PDF-Handout.',
      metadata: { stage: 'queued' },
    });
    await auditLog(
      request.user?.id ?? null,
      'autonomous_studio.council.message',
      'autonomous_studio_decision',
      decision?.id,
      {
        title: decision?.title,
      },
    );
    return reply.code(202).send({ decision, message: 'Der Ratsauftrag wurde in die Lösungskette aufgenommen.' });
  });

  app.post('/api/autonomous-studio/decisions/:id/ceo-review', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = ceoReviewSchema.parse(request.body ?? {});
    const decision = await reviewAutonomousDecisionByCeo({
      id,
      action: input.action,
      feedback: input.feedback,
      actorUserId: request.user?.id,
    });
    if (!decision)
      return reply.code(409).send({ error: 'Diese Entscheidung wartet nicht mehr auf eine CEO-Freigabe.' });
    await recordAutonomousCouncilMessage({
      decisionId: id,
      authorKind: 'ceo',
      authorName: 'CEO',
      message:
        input.action === 'approve'
          ? 'Genehmigt. Die kontrollierte Umsetzung kann beginnen.'
          : input.action === 'revise'
            ? `Nochmal überarbeiten: ${input.feedback}`
            : `Verworfen${input.feedback ? `: ${input.feedback}` : '.'}`,
      actorUserId: request.user?.id,
      metadata: { action: input.action },
    });
    await auditLog(
      request.user?.id ?? null,
      'autonomous_studio.decision.ceo_review',
      'autonomous_studio_decision',
      id,
      {
        action: input.action,
      },
    );
    return decision;
  });

  app.get('/api/autonomous-studio/deliverables/:id/download', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const deliverable = await getAutonomousStudioDeliverable(id);
    if (!deliverable?.file_path || deliverable.status !== 'ready')
      return reply.code(404).send({ error: 'Das Handout ist noch nicht als Datei verfügbar.' });
    const allowedRoot = resolve(process.cwd(), 'var/media/autonomous-studio/handouts');
    const path = resolve(deliverable.file_path);
    if (path !== allowedRoot && !path.startsWith(`${allowedRoot}${sep}`))
      return reply.code(403).send({ error: 'Ungültiger Handout-Pfad.' });
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) return reply.code(404).send({ error: 'Die Handout-Datei fehlt.' });
    reply.header('content-type', deliverable.mime_type || 'application/pdf');
    reply.header('content-length', String(info.size));
    reply.header('content-disposition', `attachment; filename="${basename(path).replaceAll('"', '')}"`);
    return reply.send(createReadStream(path));
  });

  app.post('/api/autonomous-studio/decisions/:id/retry', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const decision = await retryAutonomousDecision(id, request.user?.id);
    if (!decision)
      return reply.code(409).send({ error: 'Diese Entscheidung kann derzeit nicht erneut beraten werden.' });
    await auditLog(request.user?.id ?? null, 'autonomous_studio.decision.retry', 'autonomous_studio_decision', id);
    return reply.code(202).send(decision);
  });

  app.post('/api/autonomous-studio/decisions/:id/rollback', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const decision = await rollbackDecision(id, request.user?.id);
    await auditLog(request.user?.id ?? null, 'autonomous_studio.decision.rollback', 'autonomous_studio_decision', id);
    return decision;
  });
}

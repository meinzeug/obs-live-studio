import {
  developAutonomousStudioStrategy,
  reviewAutonomousStudioDecision,
  translateSendegottDirective,
} from '@ans/ai-provider';
import {
  autonomousStudioEvidence,
  claimApprovedAutonomousDecision,
  claimAutonomousCouncilVote,
  claimAutonomousIndependentReview,
  claimAutonomousPlanningDecision,
  completeAutonomousDecision,
  createAutonomousStudioDecision,
  failAutonomousDecision,
  getAutonomousStudioSettings,
  getStudioOperatingState,
  queueAutonomousStudioCycle,
  recordAutonomousCouncilVote,
  recordAutonomousIndependentReview,
  releaseAutonomousDecisionLock,
  saveAutonomousDecisionProposal,
  updateStudioOperatingState,
  type AutonomousStudioDecision,
} from '@ans/database/autonomous-studio';
import { createBroadcastFormat, listBroadcastFormats } from '@ans/database/broadcast-formats';
import {
  getAutopilotConfig,
  getSetting,
  setAutopilotConfig,
  type AutopilotConfig,
  type AutopilotDailyFormat,
} from '@ans/database';
import {
  createAiStaffTask,
  listAiStaffMembers,
  recordAiStaffActivity,
  updateAiStaffMember,
} from '@ans/database/ai-staff';
import { enqueueYoutubeShortForCurrent } from '@ans/database/youtube-shorts';
import { resolveOperationalNotification, upsertOperationalNotification } from '@ans/database/notifications';

type Log = (event: string, extra?: Record<string, unknown>) => void;

const CONTENT_MODES = new Set(['news', 'youtube', 'mixed', 'youtube-news-sidebar', 'youtube-context']);
const FORMAT_COLORS = ['#31c6b1', '#38bdf8', '#a78bfa', '#fb7185', '#fbbf24'];
const COUNCIL_MODEL_FALLBACKS = ['~anthropic/claude-sonnet-latest', '~google/gemini-pro-latest', '~openai/gpt-latest'];

function compactError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' ').slice(0, 1800);
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
        .map((entry) => entry.trim())
    : [];
}

function studioAiEnvironment(settings: Awaited<ReturnType<typeof getAutonomousStudioSettings>>) {
  return {
    ...process.env,
    OPENROUTER_PAID_FALLBACK: 'true',
    OPENROUTER_MAX_REQUEST_USD: String(settings.max_request_usd),
    OPENROUTER_DAILY_BUDGET_USD: String(settings.daily_budget_usd),
  };
}

function preferredPlanningModels(settings: Awaited<ReturnType<typeof getAutonomousStudioSettings>>) {
  return settings.paid_model_strategy === 'fixed' && settings.paid_model.trim()
    ? [settings.paid_model.trim()]
    : undefined;
}

async function channelName() {
  const identity = await getSetting<{ channelName?: string }>('studio.identity').catch(() => null);
  return identity?.channelName?.trim() || process.env.CHANNEL_NAME?.trim() || 'Open TV Studio';
}

function resultUsage(result: { usage: Record<string, unknown>; tier: string }) {
  return { ...result.usage, tier: result.tier };
}

function reviewBudget(settings: Awaited<ReturnType<typeof getAutonomousStudioSettings>>) {
  return { maximumRequestUsd: settings.max_request_usd, dailyBudgetUsd: settings.daily_budget_usd };
}

function reviewModelCandidates(
  preferred: string | null | undefined,
  settings: Awaited<ReturnType<typeof getAutonomousStudioSettings>>,
) {
  return [...new Set([preferred, ...settings.reviewer_models, ...COUNCIL_MODEL_FALLBACKS].filter(Boolean))].slice(
    0,
    3,
  ) as string[];
}

function decisionAnnouncement(decision: AutonomousStudioDecision) {
  const proposal = object(decision.proposal);
  const summary = String(
    proposal.executiveSummary ?? proposal.interpretation ?? proposal.description ?? proposal.brief ?? '',
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 650);
  const type =
    decision.kind === 'directive'
      ? 'eine neue Leitlinie der Senderleitung'
      : decision.kind === 'strategy'
        ? 'die nächste Ausbaustufe unseres Senders'
        : decision.kind === 'format'
          ? 'ein neues Sendeformat'
          : 'eine neue Eigenproduktion';
  if (decision.source === 'audience') {
    return {
      headline: `Euer Chatimpuls wurde entschieden: ${decision.title}`.slice(0, 180),
      text: `Ein Vorschlag oder Einwand aus eurem Chat hat das KI-Sendergremium durchlaufen und wurde nach zwei unabhängigen Schlussprüfungen freigegeben. ${summary || 'Die Redaktion übernimmt den geprüften Impuls kontrolliert in ihre weitere Arbeit.'}`.slice(
        0,
        1100,
      ),
    };
  }
  return {
    headline: `Beschluss des KI-Sendergremiums: ${decision.title}`.slice(0, 180),
    text: `Das KI-Sendergremium hat ${type} nach Beratung und zwei unabhängigen Schlussprüfungen freigegeben. ${summary || 'Die Umsetzung wird kontrolliert in den Studiobetrieb übernommen.'}`.slice(
      0,
      1100,
    ),
  };
}

async function planDecision(decision: AutonomousStudioDecision) {
  const settings = await getAutonomousStudioSettings();
  const [evidence, operatingState, station] = await Promise.all([
    autonomousStudioEvidence(),
    getStudioOperatingState(),
    channelName(),
  ]);
  const options = {
    env: studioAiEnvironment(settings),
    preferredPaidModels: preferredPlanningModels(settings),
  };
  const result =
    decision.kind === 'directive'
      ? await translateSendegottDirective(
          {
            instruction: decision.instruction,
            channelName: station,
            currentPolicy: operatingState.directive,
            currentStrategy: operatingState.strategy,
            studioState: evidence,
          },
          options,
        )
      : await developAutonomousStudioStrategy(
          {
            channelName: station,
            currentDirective: operatingState.directive,
            currentStrategy: operatingState.strategy,
            inventory: evidence,
            performance: { metrics: evidence.metrics, generatedAt: evidence.generatedAt },
            constraints: {
              maximumNewFormats: settings.max_formats_per_week,
              maximumProductionsPerDay: settings.max_productions_per_day,
              maximumShortsPerDay: settings.max_shorts_per_day,
              planningHorizonDays: settings.planning_horizon_days,
            },
          },
          options,
        );
  await saveAutonomousDecisionProposal(decision.id, {
    proposal: result.output,
    model: result.model,
    usage: resultUsage(result),
  });
  await resolveOperationalNotification(`autonomous-studio:${decision.id}`).catch(() => null);
}

async function councilVote(claimed: NonNullable<Awaited<ReturnType<typeof claimAutonomousCouncilVote>>>) {
  const settings = await getAutonomousStudioSettings();
  const evidence = await autonomousStudioEvidence();
  const result = await reviewAutonomousStudioDecision(
    {
      reviewerRole: claimed.member.id,
      reviewerName: `${claimed.member.display_name}, ${claimed.member.role_name}`,
      reviewerPerspective: claimed.member.perspective,
      reviewerInstructions: claimed.member.instructions,
      decisionKind: claimed.decision.kind,
      title: claimed.decision.title,
      instruction: claimed.decision.instruction,
      proposal: claimed.decision.proposal,
      studioEvidence: evidence,
      budget: reviewBudget(settings),
    },
    {
      env: studioAiEnvironment(settings),
      preferredPaidModels: reviewModelCandidates(claimed.member.preferred_model, settings),
    },
  );
  await recordAutonomousCouncilVote({
    decisionId: claimed.decision.id,
    councilMemberId: claimed.member.id,
    model: result.model,
    tier: result.tier,
    vote: result.output.decision,
    score: result.output.score,
    summary: result.output.summary,
    checks: result.output.checks,
    blockers: result.output.blockers,
    requiredChanges: result.output.requiredChanges,
    usage: resultUsage(result),
  });
  await resolveOperationalNotification(`autonomous-studio:${claimed.decision.id}`).catch(() => null);
}

async function independentReview(claimed: NonNullable<Awaited<ReturnType<typeof claimAutonomousIndependentReview>>>) {
  const settings = await getAutonomousStudioSettings();
  const evidence = await autonomousStudioEvidence();
  const role = claimed.slot === 1 ? 'editorial-integrity' : 'operations-and-risk';
  const result = await reviewAutonomousStudioDecision(
    {
      reviewerRole: role,
      decisionKind: claimed.decision.kind,
      title: claimed.decision.title,
      instruction: claimed.decision.instruction,
      proposal: claimed.decision.proposal,
      studioEvidence: evidence,
      budget: reviewBudget(settings),
    },
    {
      env: studioAiEnvironment(settings),
      preferredPaidModels: reviewModelCandidates(claimed.preferredModel, settings),
    },
  );
  if (claimed.usedModels.some((entry) => entry.reviewer_model === result.model))
    throw new Error(
      `Die Schlussprüfung lieferte erneut dasselbe Modell ${result.model}; eine unabhängige Prüfung wird wiederholt.`,
    );
  await recordAutonomousIndependentReview({
    decisionId: claimed.decision.id,
    slot: claimed.slot,
    model: result.model,
    tier: result.tier,
    decision: result.output.decision,
    score: result.output.score,
    summary: result.output.summary,
    checks: result.output.checks,
    blockers: result.output.blockers,
    requiredChanges: result.output.requiredChanges,
    usage: resultUsage(result),
  });
  await resolveOperationalNotification(`autonomous-studio:${claimed.decision.id}`).catch(() => null);
}

function formatMode(value: unknown): AutopilotConfig['contentMode'] {
  const mode = String(value ?? 'mixed');
  return CONTENT_MODES.has(mode) ? (mode as AutopilotConfig['contentMode']) : 'mixed';
}

function formatLayout(mode: AutopilotConfig['contentMode']) {
  if (mode === 'youtube') return 'youtube-video' as const;
  if (mode === 'youtube-news-sidebar') return 'youtube-news-sidebar' as const;
  if (mode === 'youtube-context') return 'youtube-context' as const;
  return 'main-news' as const;
}

async function applyFormatDecision(decision: AutonomousStudioDecision) {
  const proposal = object(decision.proposal);
  const mode = formatMode(proposal.contentMode);
  const name = String(proposal.name ?? decision.title)
    .trim()
    .slice(0, 160);
  const formats = await listBroadcastFormats({ includeInactive: false });
  const existing = formats.find((format) => format.name.toLocaleLowerCase('de-DE') === name.toLocaleLowerCase('de-DE'));
  const systemFormat = formats.find((format) => format.system_key === mode);
  const duration = Math.max(5, Math.min(240, Math.round(Number(proposal.durationMinutes ?? 45))));
  const itemCount = Math.max(1, Math.min(30, Math.round(Number(proposal.itemCount ?? 8))));
  const created =
    existing ??
    (await createBroadcastFormat({
      name,
      description: String(proposal.description ?? proposal.audiencePromise ?? decision.instruction).slice(0, 2000),
      contentMode: mode,
      layout: formatLayout(mode),
      overlayProjectId: systemFormat?.overlay_project_id ?? null,
      defaultDurationMinutes: duration,
      defaultItemCount: itemCount,
      color: FORMAT_COLORS[Math.abs(decision.id.charCodeAt(0)) % FORMAT_COLORS.length]!,
      icon: mode.includes('youtube') ? 'youtube' : 'sparkles',
      settings: {
        transition: 'fade',
        repeatPolicy: 'none',
        pauseSeconds: 4,
        sidebarRotationSeconds: 16,
        autonomousDecisionId: decision.id,
      },
      active: true,
    }));
  const autopilot = await getAutopilotConfig();
  const starts = stringArray(proposal.preferredStartTimes)
    .filter((time) => /^\d{2}:\d{2}$/.test(time))
    .slice(0, 4);
  const additions: AutopilotDailyFormat[] = (starts.length ? starts : ['20:15']).map((startTime, index) => ({
    id: `ai-${decision.id.slice(0, 8)}-${index + 1}`,
    name,
    startTime,
    durationMinutes: duration,
    contentMode: mode,
    youtubeCategoryIds: [],
    sourceIds: [],
    enabled: true,
  }));
  const ids = new Set(additions.map((format) => format.id));
  await setAutopilotConfig({
    ...autopilot,
    dailyFormats: [...autopilot.dailyFormats.filter((format) => !ids.has(format.id)), ...additions],
  });
  return {
    formatId: created?.id ?? null,
    reused: Boolean(existing),
    autopilotFormatIds: additions.map((entry) => entry.id),
    startTimes: additions.map((entry) => entry.startTime),
  };
}

async function applyProductionDecision(decision: AutonomousStudioDecision) {
  const proposal = object(decision.proposal);
  const kind = String(proposal.kind ?? 'long-video');
  const presenter = String(proposal.presenter ?? 'ava-and-mia');
  const task = await createAiStaffTask({
    staffMemberId: 'producer',
    kind: 'assignment',
    title: `Eigenproduktion vorbereiten: ${String(proposal.title ?? decision.title).slice(0, 150)}`,
    instructions: [
      String(proposal.brief ?? decision.instruction),
      `Produktionsart: ${kind}. Präsentation: ${presenter}.`,
      `Quellenregel: ${String(proposal.sourceRule ?? 'Nur belegte und im Studio verfügbare Quellen verwenden.')}`,
      `Plattformen: ${stringArray(proposal.platforms).join(', ') || 'Broadcast'}.`,
      'Erstelle einen konkreten, ausführbaren Ablauf mit Quellenbedarf, Szenen, Moderation, Freigaben und Wiederverwertung. Keine Veröffentlichung ohne vorhandene Rechte und technische Freigabe.',
    ].join('\n'),
    priority: 'high',
  });
  let shortResult: unknown = null;
  if (kind === 'short')
    shortResult = await enqueueYoutubeShortForCurrent().catch((error) => ({ reason: compactError(error) }));
  await recordAiStaffActivity({
    staffMemberId: 'moderator',
    eventType: 'council_production_approved',
    title: `Gremium gibt Eigenproduktion frei: ${decision.title}`,
    detail: String(proposal.brief ?? decision.instruction).slice(0, 1400),
    status: 'queued',
    metadata: { decisionId: decision.id, productionKind: kind, producerTaskId: task?.id ?? null },
  });
  return { producerTaskId: task?.id ?? null, productionKind: kind, shortResult };
}

async function createStrategyChildren(
  decision: AutonomousStudioDecision,
  formats: unknown,
  productions: unknown,
  limits: { formats: number; productions: number },
) {
  const created: string[] = [];
  for (const [index, concept] of (Array.isArray(formats) ? formats : []).slice(0, limits.formats).entries()) {
    const proposal = object(concept);
    const child = await createAutonomousStudioDecision({
      parentDecisionId: decision.id,
      kind: 'format',
      source: decision.source,
      title: String(proposal.name ?? `Neues Format ${index + 1}`),
      instruction: String(proposal.description ?? 'Vom Sendergremium vorgeschlagenes wiederverwendbares Sendeformat.'),
      proposal,
      proposalModel: decision.proposal_model,
      proposalUsage: decision.proposal_usage,
      requestedBy: decision.requested_by,
      requestedBySystem: 'autonomous-studio',
    });
    if (child) created.push(child.id);
  }
  for (const [index, idea] of (Array.isArray(productions) ? productions : []).slice(0, limits.productions).entries()) {
    const proposal = object(idea);
    const child = await createAutonomousStudioDecision({
      parentDecisionId: decision.id,
      kind: 'production',
      source: decision.source,
      title: String(proposal.title ?? `Neue Eigenproduktion ${index + 1}`),
      instruction: String(proposal.brief ?? 'Vom Sendergremium vorgeschlagene Eigenproduktion.'),
      proposal,
      proposalModel: decision.proposal_model,
      proposalUsage: decision.proposal_usage,
      requestedBy: decision.requested_by,
      requestedBySystem: 'autonomous-studio',
    });
    if (child) created.push(child.id);
  }
  return created;
}

async function applyStrategyDecision(decision: AutonomousStudioDecision) {
  const settings = await getAutonomousStudioSettings();
  const previous = await getStudioOperatingState();
  await updateStudioOperatingState({ strategyDecisionId: decision.id, strategy: decision.proposal });
  const children = await createStrategyChildren(
    decision,
    decision.proposal.formatConcepts,
    decision.proposal.productionIdeas,
    { formats: settings.max_formats_per_week, productions: settings.max_productions_per_day },
  );
  return {
    snapshot: { operatingState: previous },
    result: { strategyVersion: previous.version + 1, childDecisions: children },
  };
}

async function applyDirectiveDecision(decision: AutonomousStudioDecision) {
  const settings = await getAutonomousStudioSettings();
  const previous = await getStudioOperatingState();
  const members = await listAiStaffMembers();
  const agentInstructions = object(decision.proposal.agentInstructions);
  const instructionKeys: Record<string, string> = {
    producer: 'producer',
    editor: 'editor',
    'fact-checker': 'factChecker',
    moderator: 'ava',
    'chat-moderator': 'mia',
    'chat-analyst': 'sam',
  };
  for (const member of members) {
    const directiveInstruction = String(agentInstructions[instructionKeys[member.role] ?? ''] ?? '').trim();
    if (!directiveInstruction) continue;
    await updateAiStaffMember(member.id, {
      config: {
        ...member.config,
        activeDirectiveId: decision.id,
        ceoDirective: directiveInstruction,
        ceoDirectiveUpdatedAt: new Date().toISOString(),
      },
    });
    await recordAiStaffActivity({
      staffMemberId: member.id,
      eventType: 'sendegott_directive_activated',
      title: 'Neue freigegebene CEO-Direktive',
      detail: directiveInstruction,
      status: 'ready',
      metadata: { decisionId: decision.id },
      actorUserId: decision.requested_by,
    });
  }
  await updateStudioOperatingState({
    directiveDecisionId: decision.id,
    directive: decision.proposal,
    operatingPolicy: String(decision.proposal.operatingPolicy ?? previous.operating_policy),
  });
  const formatMandates = stringArray(decision.proposal.formatMandate).map((entry) => ({
    name: entry.slice(0, 150),
    description: entry,
    contentMode: 'mixed',
    durationMinutes: 45,
    itemCount: 8,
    preferredStartTimes: ['20:15'],
    cadence: 'weekly',
    hosts: ['ava', 'mia'],
    audiencePromise: entry,
  }));
  const productionMandates = stringArray(decision.proposal.productionMandate).map((entry) => ({
    kind: 'long-video',
    title: entry.slice(0, 170),
    brief: entry,
    presenter: 'ava-and-mia',
    sourceRule: 'Nur im Studio vorhandene oder nachweislich recherchierte Quellen verwenden.',
    cadence: 'nach Gremiumsfreigabe',
    platforms: ['broadcast', 'youtube'],
  }));
  const children = await createStrategyChildren(decision, formatMandates, productionMandates, {
    formats: settings.max_formats_per_week,
    productions: settings.max_productions_per_day,
  });
  return {
    snapshot: { operatingState: previous, staff: members.map((member) => ({ id: member.id, config: member.config })) },
    result: { directiveVersion: previous.version + 1, updatedAgents: members.length, childDecisions: children },
  };
}

async function applyDecision(decision: AutonomousStudioDecision) {
  let snapshot: Record<string, unknown> = {};
  let result: Record<string, unknown> = {};
  if (decision.kind === 'strategy') ({ snapshot, result } = await applyStrategyDecision(decision));
  if (decision.kind === 'directive') ({ snapshot, result } = await applyDirectiveDecision(decision));
  if (decision.kind === 'format') {
    const autopilot = await getAutopilotConfig();
    snapshot = { autopilot };
    result = await applyFormatDecision(decision);
  }
  if (decision.kind === 'production') result = await applyProductionDecision(decision);
  await completeAutonomousDecision({
    id: decision.id,
    snapshotBefore: snapshot,
    applyResult: result,
    announcement: decisionAnnouncement(decision),
  });
}

export class AutonomousStudioProcessor {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private stopped = false;

  constructor(
    private readonly workerId: string,
    private readonly log: Log,
  ) {}

  async start(intervalMs = 15_000) {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.tick(), Math.max(5_000, intervalMs));
    this.timer.unref?.();
    setTimeout(() => void this.tick(), 3_500).unref?.();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    let activeDecision: AutonomousStudioDecision | null = null;
    let stage = 'cycle';
    try {
      await queueAutonomousStudioCycle().catch((error) => {
        this.log('autonomous_studio_cycle_waiting', { error: compactError(error) });
        return null;
      });
      stage = 'planning';
      const planning = await claimAutonomousPlanningDecision(this.workerId);
      if (planning) {
        activeDecision = planning;
        await planDecision(planning);
        this.log('autonomous_studio_planned', { decisionId: planning.id, kind: planning.kind });
        return;
      }
      stage = 'council';
      const council = await claimAutonomousCouncilVote(this.workerId);
      if (council) {
        activeDecision = council.decision;
        await councilVote(council);
        this.log('autonomous_studio_council_vote', {
          decisionId: council.decision.id,
          memberId: council.member.id,
        });
        return;
      }
      stage = 'independent-review';
      const review = await claimAutonomousIndependentReview(this.workerId);
      if (review) {
        activeDecision = review.decision;
        await independentReview(review);
        this.log('autonomous_studio_reviewed', { decisionId: review.decision.id, slot: review.slot });
        return;
      }
      stage = 'apply';
      const approved = await claimApprovedAutonomousDecision(this.workerId);
      if (approved) {
        activeDecision = approved;
        await applyDecision(approved);
        await resolveOperationalNotification(`autonomous-studio:${approved.id}`).catch(() => null);
        this.log('autonomous_studio_applied', { decisionId: approved.id, kind: approved.kind });
      }
    } catch (error) {
      const message = compactError(error);
      if (activeDecision) {
        if (stage === 'council' || stage === 'independent-review')
          await releaseAutonomousDecisionLock(activeDecision.id, message).catch(() => null);
        else await failAutonomousDecision(activeDecision.id, message).catch(() => null);
        await upsertOperationalNotification({
          level: 'error',
          component: 'autonomous-studio',
          dedupeKey: `autonomous-studio:${activeDecision.id}`,
          message: `Die autonome Studioentscheidung „${activeDecision.title}“ konnte in der Phase ${stage} nicht fortgesetzt werden.`,
          details: { decisionId: activeDecision.id, kind: activeDecision.kind, stage, error: message },
        }).catch(() => null);
      }
      this.log('autonomous_studio_failed', { decisionId: activeDecision?.id ?? null, stage, error: message });
    } finally {
      this.busy = false;
    }
  }
}

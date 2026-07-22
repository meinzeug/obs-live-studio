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
  recordAutonomousCouncilMessage,
  recordAutonomousIndependentReview,
  recoverAutonomousDecisionFailure,
  releaseAutonomousDecisionLock,
  saveAutonomousDecisionProposal,
  spawnAutonomousDecisionRevision,
  updateStudioOperatingState,
  type AutonomousStudioDecision,
} from '@ans/database/autonomous-studio';
import { createBroadcastFormat, listBroadcastFormats } from '@ans/database/broadcast-formats';
import {
  createOverlayProject,
  getAutopilotConfig,
  getSetting,
  latestOverlayVersion,
  publishOverlayVersion,
  query,
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
import { autopilotOnce } from './autopilot.js';
import { createAutonomousDecisionDeliverables } from './autonomous-deliverables.js';

type Log = (event: string, extra?: Record<string, unknown>) => void;

const CONTENT_MODES = new Set(['news', 'youtube', 'mixed', 'youtube-news-sidebar', 'youtube-context']);
const FORMAT_COLORS = ['#31c6b1', '#38bdf8', '#a78bfa', '#fb7185', '#fbbf24'];
const COUNCIL_MODEL_FALLBACKS = ['~anthropic/claude-sonnet-latest', '~google/gemini-pro-latest', '~openai/gpt-latest'];
const RESILIENCE_FORMATS: Array<Record<string, unknown>> = [
  {
    name: 'Publikumsforum mit Mia',
    description:
      'Mia bündelt belegte Zuschauerfragen, während Sam neue Chatimpulse nach Themen und offenen Punkten ordnet.',
    contentMode: 'youtube-context',
    durationMinutes: 45,
    itemCount: 4,
    preferredStartTimes: ['20:15'],
    cadence: 'weekly',
    hosts: ['mia', 'ava'],
    audiencePromise:
      'Zuschauerfragen werden sichtbar, recherchiert und mit nachvollziehbarer Antwort in die Primetime übernommen.',
    overlayBrief:
      'Große Video- oder Quellenfläche, eigene Moderatorinnenfläche und laufender, moderierter YouTube-/Twitch-Chat.',
    audienceInteraction:
      'Sam clustert echte neue Beiträge; Mia beantwortet ausgewählte Fragen und nennt den jeweiligen Anzeigenamen.',
  },
  {
    name: 'Faktencheck am Abend',
    description:
      'Die Redaktion prüft zentrale Aussagen des Tages und trennt gesicherte Fakten, offene Fragen und Einordnung.',
    contentMode: 'mixed',
    durationMinutes: 30,
    itemCount: 6,
    preferredStartTimes: ['21:15'],
    cadence: 'weekdays',
    hosts: ['ava'],
    audiencePromise:
      'Das Publikum erhält eine kompakte, quellennahe Prüfung statt einer bloßen Wiederholung von Behauptungen.',
    overlayBrief: 'Dokumenten- und Quellenkarten mit klaren Statusmarken für belegt, offen und widersprüchlich.',
    audienceInteraction:
      'Einwände aus dem Chat werden für die nächste Prüfung vorgemerkt und nach Quellenlage beantwortet.',
  },
  {
    name: 'Newsroom Direkt',
    description:
      'Aktuelle Nachrichten werden mit wechselnden Videoausschnitten, Quellenkarten und kurzen redaktionellen Updates verbunden.',
    contentMode: 'youtube-news-sidebar',
    durationMinutes: 60,
    itemCount: 8,
    preferredStartTimes: ['18:00'],
    cadence: 'daily',
    hosts: ['ava'],
    audiencePromise:
      'Aktuelle Meldungen bleiben sichtbar und werden mit abwechslungsreichen, passenden Videoinhalten verbunden.',
    overlayBrief: 'Große Videofläche plus einzelne, rotierende Nachrichtencard und klar sichtbare Quellenangaben.',
    audienceInteraction:
      'Fragen und Themenvorschläge werden als Hinweis im Overlay erklärt und an die Redaktion übergeben.',
  },
];

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

function minimumFormatBlueprints(input: unknown, activeFormats: number, minimum: number) {
  const configured = Array.isArray(input) ? input.map(object).filter((entry) => Object.keys(entry).length) : [];
  const required = Math.max(0, minimum - activeFormats);
  if (configured.length >= required) return configured;
  const names = new Set(configured.map((entry) => String(entry.name ?? '').toLocaleLowerCase('de-DE')));
  for (const fallback of RESILIENCE_FORMATS) {
    if (configured.length >= required) break;
    const name = String(fallback.name).toLocaleLowerCase('de-DE');
    if (!names.has(name)) configured.push(fallback);
  }
  return configured;
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

function deterministicPlanningFallback(decision: AutonomousStudioDecision) {
  const previous = object(decision.revision_context.previousProposal ?? decision.proposal);
  const revisionResolution = {
    revision: decision.revision_number,
    context: decision.revision_context,
    fallback: 'deterministic-local-plan',
  };
  if (decision.kind === 'format') {
    const normalizedTitle = decision.title.replace(/^Sendeformat aufbauen:\s*/i, '').trim();
    const resilience =
      RESILIENCE_FORMATS.find(
        (entry) => String(entry.name ?? '').toLocaleLowerCase('de-DE') === normalizedTitle.toLocaleLowerCase('de-DE'),
      ) ?? RESILIENCE_FORMATS[0]!;
    return {
      ...resilience,
      ...previous,
      name: String(previous.name ?? (normalizedTitle || resilience.name)),
      description: String(previous.description ?? decision.instruction),
      contentMode: formatMode(previous.contentMode ?? resilience.contentMode),
      durationMinutes: Math.max(5, Math.min(240, Number(previous.durationMinutes ?? resilience.durationMinutes ?? 45))),
      itemCount: Math.max(1, Math.min(30, Number(previous.itemCount ?? resilience.itemCount ?? 6))),
      preferredStartTimes:
        Array.isArray(previous.preferredStartTimes) && previous.preferredStartTimes.length
          ? previous.preferredStartTimes
          : resilience.preferredStartTimes,
      cadence: String(previous.cadence ?? resilience.cadence ?? 'daily'),
      hosts: Array.isArray(previous.hosts) && previous.hosts.length ? previous.hosts : resilience.hosts,
      audiencePromise: String(
        previous.audiencePromise ?? resilience.audiencePromise ?? 'Eine klar strukturierte, verlässliche Sendung.',
      ),
      overlayBrief: String(
        previous.overlayBrief ?? resilience.overlayBrief ?? 'Sendefähiges Studiolayout mit Quellen und Branding.',
      ),
      audienceInteraction: String(
        previous.audienceInteraction ??
          resilience.audienceInteraction ??
          'Sam bündelt echte Chatbeiträge; AVA oder Mia reagieren auf neue, belegbare Impulse.',
      ),
      revisionResolution,
    };
  }
  if (decision.kind === 'production') {
    return {
      ...previous,
      kind: ['short', 'long-video', 'live-special'].includes(String(previous.kind)) ? previous.kind : 'long-video',
      title: String(previous.title ?? decision.title),
      brief: String(previous.brief ?? decision.instruction),
      presenter: ['ava', 'mia', 'ava-and-mia'].includes(String(previous.presenter))
        ? previous.presenter
        : 'ava-and-mia',
      sourceRule: String(
        previous.sourceRule ?? 'Nur freigegebene, sendefähige und nachvollziehbar gekennzeichnete Quellen verwenden.',
      ),
      cadence: String(previous.cadence ?? 'daily'),
      platforms: Array.isArray(previous.platforms) && previous.platforms.length ? previous.platforms : ['broadcast'],
      contentMode: formatMode(previous.contentMode ?? 'youtube-context'),
      durationMinutes: Math.max(5, Math.min(240, Number(previous.durationMinutes ?? 45))),
      revisionResolution,
    };
  }
  if (decision.kind === 'directive') {
    const instruction = decision.instruction.trim();
    const audienceDirective = /chat|publikum|zuschauer|frage|interaktiv/i.test(`${decision.title} ${instruction}`);
    const staffInstruction = `Setze die Senderleitlinie „${decision.title}“ innerhalb der bestehenden Quellen-, Sicherheits- und Budgetregeln um.`;
    return {
      ...previous,
      title: decision.title,
      interpretation: instruction,
      operatingPolicy: instruction,
      priorities: [instruction],
      successMetrics: [
        'Die beschlossene Änderung ist im realen Sendeplan oder Studiobetrieb nachprüfbar.',
        'Jedes erzeugte Format besitzt eine aktive Vorlage, ein Overlay und mindestens einen Autopilot-Sendeplatz.',
      ],
      restrictions: ['Keine Quellen-, Rechte-, Budget- oder Sicherheitsregel umgehen.'],
      agentInstructions: {
        editor: staffInstruction,
        factChecker: staffInstruction,
        producer: staffInstruction,
        ava: staffInstruction,
        mia: staffInstruction,
        sam: staffInstruction,
      },
      strategyChanges: [instruction],
      formatMandate: audienceDirective ? ['Publikumsforum mit Mia als wiederverwendbares Primetime-Format'] : [],
      productionMandate: audienceDirective
        ? ['Eine aktuelle, aus echten Chatimpulsen und geprüften Quellen befüllte Publikumslage produzieren.']
        : [],
      solutionPlan: [
        {
          problem: instruction,
          evidence: 'Direkter Auftrag der Senderleitung.',
          solution:
            'Über vorhandene, auditierte Studiofunktionen umsetzen, daraus reale Kindbeschlüsse erzeugen und Format, Overlay, Sendeplatz sowie befüllte Playlist vor Aktivmeldung verifizieren.',
          owner: 'automation',
          completionDays: 1,
          acceptanceCriteria: ['Umsetzung und Verifikation sind im SENDEGOTT-Protokoll sichtbar.'],
          fallback: 'Bestehenden sicheren Sendebetrieb unverändert fortsetzen.',
        },
      ],
      formatBlueprints: audienceDirective ? [RESILIENCE_FORMATS[0]] : [],
      executionPlan: [
        {
          step: 1,
          owner: 'Master Control',
          action: 'Auftrag innerhalb der vorhandenen Studiofähigkeiten kontrolliert materialisieren.',
          output: 'Verifizierte Studioänderung',
          deadlineHours: 24,
          approvalRequired: true,
        },
      ],
      handout: {
        title: decision.title,
        summary: instruction,
        sections: [
          { heading: 'Auftrag', bullets: [instruction] },
          { heading: 'Sicherheit', bullets: ['Quorum und zwei unabhängige Prüfungen bleiben verpflichtend.'] },
        ],
      },
      urgency: 'normal',
      effectiveDays: 30,
      revisionResolution,
    };
  }
  return {
    ...previous,
    name: String(previous.name ?? 'Resilienter autonomer Senderausbau'),
    executiveSummary: String(
      previous.executiveSummary ??
        'Der Sender stabilisiert den 24-Stunden-Betrieb und erweitert Programm sowie Formate mit vorhandenen Mitteln.',
    ),
    northStar: String(
      previous.northStar ?? 'Ein verlässlicher, abwechslungsreicher und nachvollziehbarer 24/7-Sender.',
    ),
    goals: Array.isArray(previous.goals)
      ? previous.goals
      : ['24 Stunden Programmdeckung sichern.', 'Eigenproduktionen und Formate messbar ausbauen.'],
    editorialPillars: Array.isArray(previous.editorialPillars)
      ? previous.editorialPillars
      : ['Quellennähe', 'Abwechslung', 'Publikumsdialog'],
    formatConcepts: Array.isArray(previous.formatConcepts) ? previous.formatConcepts : RESILIENCE_FORMATS,
    productionIdeas: Array.isArray(previous.productionIdeas)
      ? previous.productionIdeas
      : [
          {
            kind: 'long-video',
            title: 'Autonome Tagesausgabe',
            brief: 'Eine aktuelle, aus sendefähigen Inhalten materialisierte Ausgabe für den 24-Stunden-Sendeplan.',
            presenter: 'ava-and-mia',
            sourceRule: 'Nur freigegebene und nachvollziehbar gekennzeichnete Quellen verwenden.',
            cadence: 'daily',
            platforms: ['broadcast'],
          },
          {
            kind: 'live-special',
            title: 'Publikumslage',
            brief: 'Mia und Sam greifen neue, belegbare Chatimpulse in einer eigenen Ausgabe auf.',
            presenter: 'mia',
            sourceRule: 'Nur tatsächlich empfangene Chats und geprüfte Recherchepakete verwenden.',
            cadence: 'daily',
            platforms: ['broadcast'],
          },
        ],
    growthExperiments: Array.isArray(previous.growthExperiments)
      ? previous.growthExperiments
      : ['Neue Formate anhand von Zuschauerbindung und Wiederholungsquote vergleichen.'],
    riskControls: Array.isArray(previous.riskControls)
      ? previous.riskControls
      : ['Quorum und Doppelprüfung beibehalten.', 'Budgets und Quellenfreigaben nicht überschreiten.'],
    revisionResolution,
  };
}

function operationalAssurance(
  decision: AutonomousStudioDecision,
  evidence: Record<string, unknown>,
  settings: Awaited<ReturnType<typeof getAutonomousStudioSettings>>,
) {
  const metrics = object(evidence.metrics);
  const context = object(decision.revision_context);
  const findings = [context.councilFindings, context.independentReviewFindings]
    .flatMap((entries) => (Array.isArray(entries) ? entries : []))
    .map(object)
    .flatMap((entry) => [...stringArray(entry.blockers), ...stringArray(entry.required_changes)])
    .slice(0, 20);
  const materialization =
    decision.kind === 'format'
      ? ['aktive Formatvorlage', 'veröffentlichtes Overlay', 'Autopilot-Sendeplatz', 'neu berechneter Sendeplan']
      : decision.kind === 'production'
        ? ['Autopilot-Sendeplatz', 'befüllte Playlist', 'zugeordnetes Sendeformat', 'verifizierte Beitragsanzahl']
        : ['versionierte Betriebspolitik', 'einzeln geprüfte Format- und Produktionsbeschlüsse'];
  return {
    proposalStage: true,
    inventorySnapshot: metrics,
    materialization,
    acceptanceGate: [
      'Kein Beschluss wird als aktiv markiert, bevor die vorgesehenen Datenbankartefakte erfolgreich angelegt wurden.',
      'Produktionen benötigen mindestens einen sendefähigen Playlist-Eintrag; andernfalls bricht nur die Umsetzung ab und der laufende Sender bleibt bestehen.',
      'OBS-/Autopilot-Ausfälle verwenden den bestehenden Programm- und Nachrichtenfallback und werden im Störungscenter protokolliert.',
    ],
    rightsAndPrivacy: [
      'Aus dem Inventar wird kein Nutzungsrecht abgeleitet; ungeklärte externe Medien bleiben ein Freigabeblocker.',
      'Fehlt eine sichere externe Mediengrundlage, wird auf freigegebene Nachrichteninhalte zurückgefallen.',
      'Chatbeiträge werden als Publikumsmeinung gekennzeichnet und nicht als Tatsachenquelle behandelt.',
    ],
    budget: {
      maximumRequestUsd: settings.max_request_usd,
      dailyBudgetUsd: settings.daily_budget_usd,
      policy:
        'Paid-Modelle dürfen die zentralen Anfrage- und Tageslimits nicht überschreiten; lokale Fallbacks erhalten den Betrieb.',
    },
    blockerResolution: findings.map((finding) => ({
      finding,
      resolution:
        'Der Punkt ist verbindliches Abnahmekriterium. Ist er bei der Materialisierung nicht nachweisbar, bleibt der Beschluss in Fehlerbehebung statt als aktiv zu erscheinen.',
    })),
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
  let planningOutput: Record<string, unknown>;
  let planningModel: string;
  let planningUsage: Record<string, unknown>;
  const automaticRecovery = object(decision.revision_context.automaticRecovery);
  const previousPlanningError = String(automaticRecovery.previousError ?? '');
  const useLocalRecoveryPlan = /keine gültige strukturierte antwort|invalid structured/i.test(previousPlanningError);
  if (useLocalRecoveryPlan) {
    planningOutput = deterministicPlanningFallback(decision);
    planningModel = 'deterministic-autonomy-fallback';
    planningUsage = { tier: 'local-recovery', previousError: previousPlanningError };
  } else
    try {
      const result =
        decision.kind === 'directive'
          ? await translateSendegottDirective(
              {
                instruction: decision.instruction,
                channelName: station,
                currentPolicy: operatingState.directive,
                currentStrategy: operatingState.strategy,
                studioState: evidence,
                revisionContext: decision.revision_context,
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
                revisionRequest:
                  decision.revision_number > 0
                    ? {
                        decisionKind: decision.kind,
                        title: decision.title,
                        instruction: decision.instruction,
                        proposal: object(decision.revision_context.previousProposal ?? decision.proposal),
                        context: decision.revision_context,
                      }
                    : null,
              },
              options,
            );
      planningOutput = object(result.output);
      planningModel = result.model;
      planningUsage = resultUsage(result);
    } catch (error) {
      const message = compactError(error);
      planningOutput = deterministicPlanningFallback(decision);
      planningModel = 'deterministic-autonomy-fallback';
      planningUsage = { tier: 'local-fallback', error: message };
      await upsertOperationalNotification({
        level: 'warning',
        component: 'autonomous-studio',
        dedupeKey: `autonomous-studio:${decision.id}:planning-fallback`,
        message: `Die KI-Planung für „${decision.title}“ wurde durch den lokalen Autonomie-Fallback ersetzt.`,
        details: { decisionId: decision.id, kind: decision.kind, error: message },
      }).catch(() => null);
    }
  const strategyOutput = planningOutput;
  let proposal: Record<string, unknown> = strategyOutput;
  if (decision.kind === 'format') {
    const previous = object(decision.revision_context.previousProposal ?? decision.proposal);
    const concepts = Array.isArray(strategyOutput.formatConcepts)
      ? strategyOutput.formatConcepts.map(object).filter((entry) => Object.keys(entry).length)
      : [];
    const requestedName = String(previous.name ?? decision.title).toLocaleLowerCase('de-DE');
    const concept =
      concepts.find((entry) => String(entry.name ?? '').toLocaleLowerCase('de-DE') === requestedName) ?? concepts[0];
    proposal = {
      ...previous,
      ...(concept ? object(concept) : strategyOutput),
      revisionResolution: {
        revision: decision.revision_number,
        context: decision.revision_context,
        strategySummary: strategyOutput.executiveSummary,
      },
    };
  }
  if (decision.kind === 'production') {
    const previous = object(decision.revision_context.previousProposal ?? decision.proposal);
    const productions = Array.isArray(strategyOutput.productionIdeas)
      ? strategyOutput.productionIdeas.map(object).filter((entry) => Object.keys(entry).length)
      : [];
    const requestedTitle = String(previous.title ?? decision.title).toLocaleLowerCase('de-DE');
    const production =
      productions.find((entry) => String(entry.title ?? '').toLocaleLowerCase('de-DE') === requestedTitle) ??
      productions[0];
    proposal = {
      ...previous,
      ...(production ? object(production) : strategyOutput),
      revisionResolution: {
        revision: decision.revision_number,
        context: decision.revision_context,
        strategySummary: strategyOutput.executiveSummary,
      },
    };
  }
  proposal = { ...proposal, operationalAssurance: operationalAssurance(decision, evidence, settings) };
  const planned = await saveAutonomousDecisionProposal(decision.id, {
    proposal,
    model: planningModel,
    usage: planningUsage,
  });
  if (planned) {
    await createAutonomousDecisionDeliverables(planned);
    const proposal = object(planned.proposal);
    const summary = String(proposal.interpretation ?? proposal.executiveSummary ?? planned.instruction)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1800);
    await recordAutonomousCouncilMessage({
      decisionId: planned.id,
      authorKind: 'council',
      authorName: 'KI-Sendergremium',
      message: `Der konkrete Lösungsentwurf ist fertig: ${summary}`,
      metadata: {
        stage: 'proposal-ready',
        revision: planned.revision_number,
        deliverables: true,
      },
    });
  }
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

async function createDedicatedFormatOverlay(input: {
  decision: AutonomousStudioDecision;
  name: string;
  templateProjectId?: string | null;
  template: string;
}) {
  if (!input.templateProjectId) return null;
  const source = await latestOverlayVersion(input.templateProjectId);
  if (!source?.snapshot) return null;
  const project = await createOverlayProject({
    name: `${input.name} · Ratsentwurf`.slice(0, 120),
    width: 1920,
    height: 1080,
    template: input.template,
    snapshot: source.snapshot,
    userId: input.decision.requested_by ?? undefined,
  });
  const draft = await latestOverlayVersion(project.id);
  if (!draft) throw new Error('Der autonome Overlay-Entwurf konnte nicht gespeichert werden.');
  await publishOverlayVersion(
    project.id,
    String((draft as { id: unknown }).id),
    input.decision.requested_by ?? undefined,
  );
  return project;
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
  const dedicatedOverlay = existing?.overlay_project_id
    ? null
    : await createDedicatedFormatOverlay({
        decision,
        name,
        templateProjectId: systemFormat?.overlay_project_id,
        template: systemFormat?.overlay_template || formatLayout(mode),
      });
  const created =
    existing ??
    (await createBroadcastFormat({
      name,
      description: String(proposal.description ?? proposal.audiencePromise ?? decision.instruction).slice(0, 2000),
      contentMode: mode,
      layout: formatLayout(mode),
      overlayProjectId: dedicatedOverlay?.id ?? systemFormat?.overlay_project_id ?? null,
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
        overlayBrief: String(proposal.overlayBrief ?? '').slice(0, 800),
        audienceInteraction: String(proposal.audienceInteraction ?? '').slice(0, 800),
      },
      active: true,
    }));
  if (existing && dedicatedOverlay?.id)
    await query(`update broadcast_templates set overlay_project_id=$2,updated_at=now() where id=$1`, [
      existing.id,
      dedicatedOverlay.id,
    ]);
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
  const formatId = created?.id ?? null;
  const overlayProjectId = created?.overlay_project_id ?? dedicatedOverlay?.id ?? null;
  const [verifiedFormat, verifiedAutopilot] = await Promise.all([
    formatId
      ? query<{ active: boolean; overlay_project_id: string | null }>(
          `select active,overlay_project_id from broadcast_templates where id=$1 and deleted_at is null`,
          [formatId],
        )
      : Promise.resolve({ rows: [] as Array<{ active: boolean; overlay_project_id: string | null }> }),
    getAutopilotConfig(),
  ]);
  const persisted = verifiedFormat.rows[0];
  if (
    !formatId ||
    !persisted?.active ||
    !(persisted.overlay_project_id ?? overlayProjectId) ||
    !additions.every((entry) => verifiedAutopilot.dailyFormats.some((saved) => saved.id === entry.id && saved.enabled))
  )
    throw new Error('Format, Overlay und Autopilot-Sendeplatz konnten nicht vollständig verifiziert werden.');
  return {
    formatId,
    reused: Boolean(existing),
    overlayProjectId: persisted.overlay_project_id ?? overlayProjectId,
    overlayCreated: Boolean(dedicatedOverlay),
    autopilotFormatIds: additions.map((entry) => entry.id),
    startTimes: additions.map((entry) => entry.startTime),
    verification: { formatActive: true, overlayPublished: true, autopilotSlots: additions.length },
  };
}

function nextAutonomousProductionStart(config: AutopilotConfig) {
  const occupied = new Set(config.dailyFormats.filter((format) => format.enabled).map((format) => format.startTime));
  const candidate = new Date(Date.now() + 10 * 60_000);
  candidate.setSeconds(0, 0);
  for (let attempt = 0; attempt < 24; attempt++) {
    const startTime = `${String(candidate.getHours()).padStart(2, '0')}:${String(candidate.getMinutes()).padStart(2, '0')}`;
    if (!occupied.has(startTime)) return startTime;
    candidate.setMinutes(candidate.getMinutes() + 5);
  }
  return `${String(candidate.getHours()).padStart(2, '0')}:${String(candidate.getMinutes()).padStart(2, '0')}`;
}

async function materializeAutonomousProduction(
  decision: AutonomousStudioDecision,
  proposal: Record<string, unknown>,
  log: Log,
) {
  const autopilot = await getAutopilotConfig();
  const mode = formatMode(proposal.contentMode ?? autopilot.contentMode);
  const formats = await listBroadcastFormats({ includeInactive: false });
  const requestedFormat = String(proposal.formatName ?? '')
    .trim()
    .toLocaleLowerCase('de-DE');
  const format =
    formats.find((entry) => requestedFormat && entry.name.toLocaleLowerCase('de-DE') === requestedFormat) ??
    formats.find((entry) => entry.content_mode === mode) ??
    null;
  const productionId = `autonomous-production-${decision.id.slice(0, 12)}`;
  const durationMinutes = Math.max(
    5,
    Math.min(240, Math.round(Number(proposal.durationMinutes ?? format?.default_duration_minutes ?? 45))),
  );
  const startTime = nextAutonomousProductionStart(autopilot);
  const productionFormat: AutopilotDailyFormat = {
    id: productionId,
    name: String(proposal.title ?? decision.title)
      .trim()
      .slice(0, 150),
    startTime,
    durationMinutes,
    contentMode: mode,
    youtubeCategoryIds: [],
    sourceIds: [],
    enabled: true,
  };
  const retainedAutonomousFormats = autopilot.dailyFormats
    .filter((entry) => entry.id.startsWith('autonomous-production-') && entry.id !== productionId)
    .slice(-11);
  const regularFormats = autopilot.dailyFormats.filter((entry) => !entry.id.startsWith('autonomous-production-'));
  await setAutopilotConfig({
    ...autopilot,
    enabled: true,
    dailyFormats: [...regularFormats, ...retainedAutonomousFormats, productionFormat],
  });
  let playlist: { id: string; name: string; scheduled_at: string; item_count: number } | undefined;
  for (let attempt = 0; attempt < 3 && !playlist; attempt++) {
    await autopilotOnce(log);
    playlist = (
      await query<{ id: string; name: string; scheduled_at: string; item_count: number }>(
        `select playlist.id,playlist.name,playlist.scheduled_at,count(item.id)::int item_count
         from broadcast_playlists playlist
         left join broadcast_items item on item.playlist_id=playlist.id
         where playlist.settings->>'autopilotFormatId'=$1
           and playlist.scheduled_at between now() and now()+interval '25 hours'
         group by playlist.id
         order by playlist.scheduled_at
         limit 1`,
        [productionId],
      )
    ).rows[0];
    if (!playlist && attempt < 2) await new Promise((resolve) => setTimeout(resolve, 350));
  }
  if (!playlist || Number(playlist.item_count) < 1) {
    throw new Error('Die autonome Eigenproduktion konnte nicht mit sendefähigen Inhalten materialisiert werden.');
  }
  if (format?.id) await query(`update broadcast_playlists set format_id=$2 where id=$1`, [playlist.id, format.id]);
  return {
    playlistId: playlist.id,
    playlistName: playlist.name,
    scheduledAt: playlist.scheduled_at,
    itemCount: Number(playlist.item_count),
    formatId: format?.id ?? null,
    autopilotFormatId: productionId,
    contentMode: mode,
    recurringStartTime: startTime,
  };
}

async function applyProductionDecision(decision: AutonomousStudioDecision, log: Log) {
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
  const broadcastResult = kind === 'short' ? null : await materializeAutonomousProduction(decision, proposal, log);
  await recordAiStaffActivity({
    staffMemberId: 'moderator',
    eventType: 'council_production_approved',
    title: `Gremium gibt Eigenproduktion frei: ${decision.title}`,
    detail: String(proposal.brief ?? decision.instruction).slice(0, 1400),
    status: broadcastResult ? 'ready' : 'queued',
    metadata: {
      decisionId: decision.id,
      productionKind: kind,
      producerTaskId: task?.id ?? null,
      playlistId: broadcastResult?.playlistId ?? null,
    },
  });
  return { producerTaskId: task?.id ?? null, productionKind: kind, shortResult, broadcast: broadcastResult };
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
      importance: decision.source === 'automatic' ? 'normal' : 'high',
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
      importance: 'normal',
    });
    if (child) created.push(child.id);
  }
  return created;
}

async function applyStrategyDecision(decision: AutonomousStudioDecision) {
  const settings = await getAutonomousStudioSettings();
  const [previous, evidence, capacity] = await Promise.all([
    getStudioOperatingState(),
    autonomousStudioEvidence(),
    query<{ formats_used: number; productions_used: number }>(
      `select
       count(*) filter(where kind='format' and created_at>now()-interval '7 days'
         and status not in ('rejected','rolled_back','cancelled'))::int formats_used,
       count(*) filter(where kind='production' and created_at>=date_trunc('day',now())
         and status not in ('rejected','rolled_back','cancelled'))::int productions_used
       from autonomous_studio_decisions
       where source='automatic'`,
    ),
  ]);
  await updateStudioOperatingState({ strategyDecisionId: decision.id, strategy: decision.proposal });
  const used = capacity.rows[0] ?? { formats_used: 0, productions_used: 0 };
  const children = await createStrategyChildren(
    decision,
    minimumFormatBlueprints(
      decision.proposal.formatConcepts,
      Number(evidence.metrics.active_formats ?? 0),
      settings.minimum_active_formats,
    ),
    decision.proposal.productionIdeas,
    {
      formats: Math.max(0, settings.max_formats_per_week - Number(used.formats_used)),
      productions: Math.max(0, settings.max_productions_per_day - Number(used.productions_used)),
    },
  );
  return {
    snapshot: { operatingState: previous },
    result: { strategyVersion: previous.version + 1, childDecisions: children },
  };
}

async function applyDirectiveDecision(decision: AutonomousStudioDecision) {
  const settings = await getAutonomousStudioSettings();
  const [previous, evidence] = await Promise.all([getStudioOperatingState(), autonomousStudioEvidence()]);
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
  const legacyFormatMandates = stringArray(decision.proposal.formatMandate).map((entry) => ({
    name: entry.slice(0, 150),
    description: entry,
    contentMode: 'mixed',
    durationMinutes: 45,
    itemCount: 8,
    preferredStartTimes: ['20:15'],
    cadence: 'weekly',
    hosts: ['ava', 'mia'],
    audiencePromise: entry,
    overlayBrief:
      'Eigenständiger, im Overlay-Editor anpassbarer Ratsentwurf auf Grundlage eines sendefähigen Studiolayouts.',
    audienceInteraction: 'Fragen und Einwände werden über Sam geprüft an Mia oder AVA übergeben.',
  }));
  const formatMandates = minimumFormatBlueprints(
    Array.isArray(decision.proposal.formatBlueprints) && decision.proposal.formatBlueprints.length
      ? decision.proposal.formatBlueprints
      : legacyFormatMandates,
    Number(evidence.metrics.active_formats ?? 0),
    settings.minimum_active_formats,
  );
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

async function applyDecision(decision: AutonomousStudioDecision, log: Log) {
  let snapshot: Record<string, unknown> = {};
  let result: Record<string, unknown> = {};
  if (decision.kind === 'strategy') ({ snapshot, result } = await applyStrategyDecision(decision));
  if (decision.kind === 'directive') ({ snapshot, result } = await applyDirectiveDecision(decision));
  if (decision.kind === 'format') {
    const autopilot = await getAutopilotConfig();
    snapshot = { autopilot };
    result = await applyFormatDecision(decision);
  }
  if (decision.kind === 'production') result = await applyProductionDecision(decision, log);
  await completeAutonomousDecision({
    id: decision.id,
    snapshotBefore: snapshot,
    applyResult: result,
    announcement: decisionAnnouncement(decision),
  });
  if (decision.kind === 'format') await autopilotOnce(log);
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
      stage = 'recovery';
      const recovery = await recoverAutonomousDecisionFailure();
      if (recovery) {
        await resolveOperationalNotification(`autonomous-studio:${recovery.previousDecisionId}`).catch(() => null);
        this.log('autonomous_studio_failure_recovered', {
          decisionId: recovery.decision.id,
          previousDecisionId: recovery.previousDecisionId,
          mode: recovery.mode,
          previousError: recovery.previousError,
        });
        return;
      }
      stage = 'revision';
      const revision = await spawnAutonomousDecisionRevision();
      if (revision) {
        this.log('autonomous_studio_revision_started', {
          decisionId: revision.id,
          previousDecisionId: revision.previous_decision_id,
          revision: revision.revision_number,
        });
        return;
      }
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
        await applyDecision(approved, this.log);
        await resolveOperationalNotification(`autonomous-studio:${approved.id}`).catch(() => null);
        await resolveOperationalNotification(`autonomous-studio:${approved.id}:planning-fallback`).catch(() => null);
        this.log('autonomous_studio_applied', { decisionId: approved.id, kind: approved.kind });
      }
    } catch (error) {
      const message = compactError(error);
      const deferredForBudget =
        Boolean(activeDecision) &&
        (stage === 'council' || stage === 'independent-review') &&
        /tagesbudget|budget.*ausgeschöpft/i.test(message);
      if (activeDecision) {
        if (stage === 'council' || stage === 'independent-review')
          await releaseAutonomousDecisionLock(activeDecision.id, message, {
            defer: deferredForBudget,
          }).catch(() => null);
        else await failAutonomousDecision(activeDecision.id, message).catch(() => null);
        await upsertOperationalNotification({
          level: deferredForBudget ? 'warning' : 'error',
          component: 'autonomous-studio',
          dedupeKey: `autonomous-studio:${activeDecision.id}`,
          message: deferredForBudget
            ? `Die Gremiumsprüfung für „${activeDecision.title}“ wartet auf das nächste verfügbare KI-Budget und wird automatisch fortgesetzt.`
            : `Die autonome Studioentscheidung „${activeDecision.title}“ konnte in der Phase ${stage} nicht fortgesetzt werden.`,
          details: {
            decisionId: activeDecision.id,
            kind: activeDecision.kind,
            stage,
            error: message,
            automaticRetry: deferredForBudget,
          },
        }).catch(() => null);
      }
      this.log(deferredForBudget ? 'autonomous_studio_deferred' : 'autonomous_studio_failed', {
        decisionId: activeDecision?.id ?? null,
        stage,
        error: message,
      });
    } finally {
      this.busy = false;
    }
  }
}

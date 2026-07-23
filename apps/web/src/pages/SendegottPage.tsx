import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Crown,
  Gavel,
  FileDown,
  History,
  ListChecks,
  LoaderCircle,
  MessageCircleMore,
  MessagesSquare,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
  Wrench,
  X,
} from 'lucide-react';
import { api, can, type SessionUser } from '../api/client.js';
import { AgentOrchestratorPanel } from '../components/AgentOrchestratorPanel.js';

type DecisionStatus =
  | 'queued'
  | 'planning'
  | 'awaiting_council'
  | 'awaiting_reviews'
  | 'awaiting_ceo'
  | 'approved'
  | 'revise'
  | 'rejected'
  | 'applying'
  | 'applied'
  | 'failed'
  | 'rolled_back'
  | 'cancelled';

type Decision = {
  id: string;
  kind: 'strategy' | 'format' | 'production' | 'directive';
  source: 'automatic' | 'sendegott' | 'manual' | 'audience';
  title: string;
  instruction: string;
  proposal: Record<string, unknown>;
  proposal_model: string | null;
  status: DecisionStatus;
  error: string | null;
  locked_by: string | null;
  created_at: string;
  updated_at: string;
  applied_at: string | null;
  council_approvals: number;
  council_votes: number;
  review_approvals: number;
  review_count: number;
  importance: 'normal' | 'high' | 'critical';
  ceo_status: 'not_required' | 'pending' | 'approved' | 'revision_requested' | 'rejected';
  ceo_feedback: string | null;
  revision_number: number;
  superseded_by_decision_id: string | null;
};

type CouncilMember = {
  id: string;
  display_name: string;
  role_name: string;
  perspective: string;
  instructions: string;
  preferred_model: string;
  accent_color: string;
  enabled: boolean;
  sort_order: number;
};

type Settings = {
  enabled: boolean;
  automatic_apply: boolean;
  cycle_interval_hours: number;
  planning_horizon_days: number;
  max_formats_per_week: number;
  max_productions_per_day: number;
  max_shorts_per_day: number;
  council_quorum: number;
  paid_model_strategy: 'automatic' | 'fixed';
  paid_model: string;
  max_request_usd: number;
  daily_budget_usd: number;
  reviewer_models: string[];
  audience_council_enabled: boolean;
  audience_council_cooldown_minutes: number;
  audience_council_max_daily: number;
  require_ceo_approval: boolean;
  minimum_active_formats: number;
  maximum_revision_rounds: number;
  operations_enabled: boolean;
  automatic_operational_actions: boolean;
  operations_interval_seconds: number;
  schedule_horizon_hours: number;
  minimum_upcoming_shows: number;
  minimum_schedule_minutes: number;
  last_operations_cycle_at: string | null;
  next_operations_cycle_at: string;
  next_cycle_at: string;
  last_cycle_at: string | null;
  paused_reason: string | null;
};

type OperationsCycle = {
  id: string;
  trigger: 'timer' | 'startup' | 'manual' | 'recovery';
  status: 'running' | 'healthy' | 'repaired' | 'degraded' | 'failed';
  findings: Array<{
    code?: string;
    severity?: 'info' | 'warning' | 'critical';
    title?: string;
    detail?: string;
  }>;
  actions: Array<{
    type?: string;
    status?: 'completed' | 'queued' | 'failed' | 'skipped';
    summary?: string;
    resourceId?: string | null;
    error?: string;
  }>;
  verification: {
    onAir?: boolean;
    streamActive?: boolean;
    queuedCreativeWork?: number;
    remainingFindings?: Array<{
      code?: string;
      severity?: 'info' | 'warning' | 'critical';
      title?: string;
      detail?: string;
    }>;
    schedule?: {
      beforeShows?: number;
      afterShows?: number;
      beforeMinutes?: number;
      afterMinutes?: number;
    };
  };
  error: string | null;
  started_at: string;
  completed_at: string | null;
};

type AudienceInput = {
  id?: string;
  influence_kind: 'topic' | 'suggestion' | 'objection' | 'pro' | 'contra';
  text: string;
  provider: string;
  fingerprint: string;
  created_at: string;
  decision_status?: DecisionStatus | null;
};

type Dashboard = {
  settings: Settings;
  operatingState: {
    version: number;
    operating_policy: string;
    updated_at: string;
  };
  council: CouncilMember[];
  councilMessages: Array<{
    id: string;
    decision_id: string | null;
    author_kind: 'ceo' | 'council' | 'system';
    author_name: string;
    message: string;
    created_at: string;
  }>;
  decisions: Decision[];
  operations: OperationsCycle[];
  evidence: {
    metrics: Record<string, number>;
    audience?: { counts: Record<string, number>; inputs: AudienceInput[] };
    generatedAt: string;
  };
  budget: {
    spentUsd: number;
    remainingUsd: number;
    dailyLimitUsd: number;
    paidRequests: number;
    blockedRequests: number;
  };
};

type CeoSummary = {
  decisions: {
    open_decisions: number;
    council_waiting: number;
    review_waiting: number;
    ceo_waiting: number;
    approved_waiting: number;
    failed_decisions: number;
    applied_last_week: number;
  };
  nextActions: string[];
  autopilot: { enabled: boolean; contentMode: string; formats: number };
  playback: { status?: string; itemTitle?: string | null } | null;
  risks: Record<string, number>;
  masterControl: OperationsCycle | null;
};

type DecisionDetail = Decision & {
  councilVotes: Array<{
    id: string;
    display_name: string;
    role_name: string;
    vote: 'approve' | 'revise' | 'reject';
    score: number;
    summary: string;
    reviewer_model: string;
  }>;
  reviews: Array<{
    id: string;
    review_slot: number;
    reviewer_model: string;
    decision: 'approve' | 'revise' | 'reject';
    score: number;
    summary: string;
  }>;
  events: Array<{ id: string; title: string; detail: string | null; event_type: string; created_at: string }>;
  deliverables: Array<{
    id: string;
    kind: string;
    title: string;
    status: 'preparing' | 'ready' | 'failed';
    markdown: string;
    file_path: string | null;
    error: string | null;
  }>;
  messages: Dashboard['councilMessages'];
};

type DecisionInboxFilter = 'approval' | 'pipeline' | 'attention' | 'all';

type DecisionInboxResponse = {
  decisions: Decision[];
  counts: Record<DecisionInboxFilter, number>;
};

const statusLabels: Record<DecisionStatus, string> = {
  queued: 'Eingang',
  planning: 'Wird ausgearbeitet',
  awaiting_council: 'Im KI-Gremium',
  awaiting_reviews: 'Doppelte Schlussprüfung',
  awaiting_ceo: 'Wartet auf CEO',
  approved: 'Freigegeben',
  revise: 'Überarbeitung nötig',
  rejected: 'Abgelehnt',
  applying: 'Wird umgesetzt',
  applied: 'Aktiv',
  failed: 'Fehlgeschlagen',
  rolled_back: 'Zurückgerollt',
  cancelled: 'Abgebrochen',
};

function decisionStatusLabel(decision: Pick<Decision, 'status' | 'error' | 'locked_by' | 'superseded_by_decision_id'>) {
  if (decision.locked_by === 'automatic-budget-backoff') return 'Wartet automatisch auf KI-Budget';
  if (decision.status !== 'cancelled' && !(decision.status === 'failed' && decision.superseded_by_decision_id))
    return statusLabels[decision.status];
  if (decision.error === 'duplicate-autonomous-master-control-work') return 'Mit laufender Arbeit zusammengeführt';
  if (decision.superseded_by_decision_id) return 'Durch neuen Lösungsstand ersetzt';
  return statusLabels[decision.status];
}

function decisionStatusClass(decision: Pick<Decision, 'status' | 'error' | 'locked_by' | 'superseded_by_decision_id'>) {
  if (
    decision.locked_by === 'automatic-budget-backoff' ||
    decision.superseded_by_decision_id ||
    decision.error === 'duplicate-autonomous-master-control-work'
  )
    return 'warning';
  return statusClass(decision.status);
}

function isBudgetDeferred(decision: Pick<Decision, 'locked_by'> | null | undefined) {
  return decision?.locked_by === 'automatic-budget-backoff';
}

const sourceLabels: Record<Decision['source'], string> = {
  automatic: 'Autonome Strategie',
  sendegott: 'CEO-Direktive',
  manual: 'Manueller Auftrag',
  audience: 'Impuls aus dem Chat',
};

const kindLabels: Record<Decision['kind'], string> = {
  strategy: 'Strategie',
  format: 'Sendeformat',
  production: 'Produktion',
  directive: 'Direktive',
};

const inboxFilterLabels: Record<DecisionInboxFilter, string> = {
  approval: 'Freigabe nötig',
  pipeline: 'In Prüfung',
  attention: 'Aufmerksamkeit',
  all: 'Alle offen',
};

const pipelineDecisionStatuses: DecisionStatus[] = [
  'queued',
  'planning',
  'awaiting_council',
  'awaiting_reviews',
  'approved',
  'applying',
];

function decisionMatchesInboxFilter(decision: Decision, filter: DecisionInboxFilter) {
  if (filter === 'approval') return decision.status === 'awaiting_ceo';
  if (filter === 'pipeline') return pipelineDecisionStatuses.includes(decision.status);
  if (filter === 'attention') return ['failed', 'revise', 'rejected'].includes(decision.status);
  return true;
}

function dateTime(value?: string | null) {
  if (!value) return '–';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '–' : date.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
}

function statusClass(status: DecisionStatus | string) {
  if (['applied', 'approved'].includes(status)) return 'success';
  if (['rejected', 'failed', 'cancelled'].includes(status)) return 'error';
  if (['revise', 'rolled_back'].includes(status)) return 'warning';
  return '';
}

function objectList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    : [];
}

function textList(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

export function SendegottPage({ user }: { user: SessionUser }) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [ceo, setCeo] = useState<CeoSummary | null>(null);
  const [directiveTitle, setDirectiveTitle] = useState('');
  const [directive, setDirective] = useState('');
  const [cycleReason, setCycleReason] = useState('');
  const [councilMessage, setCouncilMessage] = useState('');
  const [councilTitle, setCouncilTitle] = useState('');
  const [ceoFeedback, setCeoFeedback] = useState('');
  const [detail, setDetail] = useState<DecisionDetail | null>(null);
  const [decisionInboxOpen, setDecisionInboxOpen] = useState(false);
  const [decisionInboxFilter, setDecisionInboxFilter] = useState<DecisionInboxFilter>('approval');
  const [decisionInboxSearch, setDecisionInboxSearch] = useState('');
  const [decisionInbox, setDecisionInbox] = useState<DecisionInboxResponse>({
    decisions: [],
    counts: { approval: 0, pipeline: 0, attention: 0, all: 0 },
  });
  const [decisionInboxLoading, setDecisionInboxLoading] = useState(false);
  const [inboxDecisionId, setInboxDecisionId] = useState<string | null>(null);
  const [inboxDetail, setInboxDetail] = useState<DecisionDetail | null>(null);
  const [inboxDetailLoading, setInboxDetailLoading] = useState(false);
  const [inboxFeedback, setInboxFeedback] = useState('');
  const [editingMember, setEditingMember] = useState<CouncilMember | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const allowed = can(user, 'users:write');

  async function load(silent = false) {
    if (!silent) setLoading(true);
    setError('');
    try {
      const [nextDashboard, nextCeo] = await Promise.all([
        api<Dashboard>('/api/autonomous-studio'),
        api<CeoSummary>('/api/autonomous-studio/ceo'),
      ]);
      setDashboard(nextDashboard);
      setCeo(nextCeo);
      if (detail) {
        const refreshed = await api<DecisionDetail>(`/api/autonomous-studio/decisions/${detail.id}`);
        setDetail(refreshed);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function loadDecisionInbox(silent = false) {
    if (!silent) setDecisionInboxLoading(true);
    try {
      const nextInbox = await api<DecisionInboxResponse>('/api/autonomous-studio/decision-inbox');
      setDecisionInbox(nextInbox);
      return nextInbox;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
      return null;
    } finally {
      if (!silent) setDecisionInboxLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!decisionInboxOpen) return;
    void loadDecisionInbox();
    const timer = window.setInterval(() => void loadDecisionInbox(true), 10_000);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDecisionInboxOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [decisionInboxOpen]);

  const activeDecisions = useMemo(
    () =>
      (dashboard?.decisions ?? []).filter((decision) =>
        ['queued', 'planning', 'awaiting_council', 'awaiting_reviews', 'awaiting_ceo', 'approved', 'applying'].includes(
          decision.status,
        ),
      ),
    [dashboard?.decisions],
  );
  const filteredInboxDecisions = useMemo(() => {
    const needle = decisionInboxSearch.trim().toLocaleLowerCase('de-DE');
    return decisionInbox.decisions.filter((decision) => {
      if (!decisionMatchesInboxFilter(decision, decisionInboxFilter)) return false;
      if (!needle) return true;
      return [
        decision.title,
        decision.instruction,
        sourceLabels[decision.source],
        kindLabels[decision.kind],
        decisionStatusLabel(decision),
      ].some((value) => value.toLocaleLowerCase('de-DE').includes(needle));
    });
  }, [decisionInbox.decisions, decisionInboxFilter, decisionInboxSearch]);

  useEffect(() => {
    if (!decisionInboxOpen) return;
    if (!filteredInboxDecisions.length) {
      setInboxDecisionId(null);
      setInboxDetail(null);
      return;
    }
    if (!filteredInboxDecisions.some((decision) => decision.id === inboxDecisionId)) {
      setInboxDecisionId(filteredInboxDecisions[0]!.id);
    }
  }, [decisionInboxOpen, filteredInboxDecisions, inboxDecisionId]);

  useEffect(() => {
    if (!decisionInboxOpen || !inboxDecisionId) return;
    let cancelled = false;
    setInboxDetailLoading(true);
    setInboxFeedback('');
    void api<DecisionDetail>(`/api/autonomous-studio/decisions/${inboxDecisionId}`)
      .then((nextDetail) => {
        if (!cancelled) setInboxDetail(nextDetail);
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : String(requestError));
      })
      .finally(() => {
        if (!cancelled) setInboxDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [decisionInboxOpen, inboxDecisionId]);
  const audienceInputs = dashboard?.evidence.audience?.inputs ?? [];
  const latestOperations = dashboard?.operations?.[0] ?? ceo?.masterControl ?? null;
  const remainingOperationsFindings = latestOperations?.verification?.remainingFindings ?? [];
  const operationsStillWorking = remainingOperationsFindings.length > 0;

  async function submitDirective() {
    if (!directive.trim() || !allowed) return;
    setWorking('directive');
    setMessage('');
    setError('');
    try {
      const result = await api<{ message: string }>('/api/sendegott/directives', {
        method: 'POST',
        body: JSON.stringify({ instruction: directive.trim(), title: directiveTitle.trim() || undefined }),
      });
      setDirective('');
      setDirectiveTitle('');
      setMessage(result.message);
      await load(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function startCycle() {
    setWorking('cycle');
    setMessage('');
    setError('');
    try {
      const result = await api<{ message: string }>('/api/autonomous-studio/cycle', {
        method: 'POST',
        body: JSON.stringify({ reason: cycleReason.trim() || undefined }),
      });
      setCycleReason('');
      setMessage(result.message);
      await load(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function runOperationsCheck() {
    setWorking('operations');
    setMessage('');
    setError('');
    try {
      const result = await api<{ message: string }>('/api/autonomous-studio/operations/run', { method: 'POST' });
      setMessage(result.message);
      window.setTimeout(() => void load(true), 3500);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function sendCouncilMessage() {
    if (councilMessage.trim().length < 2 || !allowed) return;
    setWorking('council-message');
    setError('');
    setMessage('');
    try {
      const result = await api<{ message: string }>('/api/autonomous-studio/council/messages', {
        method: 'POST',
        body: JSON.stringify({ message: councilMessage.trim(), title: councilTitle.trim() || undefined }),
      });
      setCouncilMessage('');
      setCouncilTitle('');
      setMessage(result.message);
      await load(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  function openDecisionInbox(filter: DecisionInboxFilter = 'approval') {
    setDecisionInboxFilter(filter);
    setDecisionInboxSearch('');
    setDecisionInboxOpen(true);
  }

  async function submitCeoReview(
    decisionId: string,
    action: 'approve' | 'revise' | 'reject',
    feedback: string,
    fromInbox = false,
  ) {
    if (!allowed) return;
    setWorking(`ceo:${action}:${decisionId}`);
    setError('');
    try {
      await api(`/api/autonomous-studio/decisions/${decisionId}/ceo-review`, {
        method: 'POST',
        body: JSON.stringify({ action, feedback: feedback.trim() || undefined }),
      });
      setMessage(
        action === 'approve'
          ? 'Beschluss genehmigt und zur kontrollierten Umsetzung freigegeben.'
          : action === 'revise'
            ? 'Das Gremium erstellt auf Basis deiner Rückmeldung eine neue, vollständig geprüfte Fassung.'
            : 'Beschluss verworfen.',
      );
      await load(true);
      if (fromInbox) {
        setInboxFeedback('');
        setInboxDecisionId(null);
        setInboxDetail(null);
        await loadDecisionInbox(true);
      }
      return true;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
      return false;
    } finally {
      setWorking('');
    }
  }

  async function submitBudgetIntervention(
    decisionId: string,
    action: 'wait' | 'raise-daily-budget' | 'raise-request-budget' | 'cancel',
    fromInbox = false,
  ) {
    if (!allowed || !dashboard) return false;
    const amountUsd =
      action === 'raise-daily-budget'
        ? Math.round((Number(dashboard.settings.daily_budget_usd) + 1) * 100) / 100
        : action === 'raise-request-budget'
          ? Math.round((Number(dashboard.settings.max_request_usd) + 0.05) * 1000) / 1000
          : undefined;
    const feedback = fromInbox ? inboxFeedback : ceoFeedback;
    setWorking(`budget:${action}:${decisionId}`);
    setError('');
    try {
      const result = await api<{ message?: string }>(`/api/autonomous-studio/decisions/${decisionId}/budget-intervention`, {
        method: 'POST',
        body: JSON.stringify({ action, amountUsd, feedback: feedback.trim() || undefined }),
      });
      setMessage(result.message ?? 'Budget-Eingriff gespeichert.');
      await load(true);
      if (fromInbox) {
        setInboxFeedback('');
        const refreshed = await api<DecisionDetail>(`/api/autonomous-studio/decisions/${decisionId}`).catch(() => null);
        setInboxDetail(refreshed);
        await loadDecisionInbox(true);
      }
      return true;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
      return false;
    } finally {
      setWorking('');
    }
  }

  async function reviewAsCeo(action: 'approve' | 'revise' | 'reject') {
    if (!detail) return;
    if (await submitCeoReview(detail.id, action, ceoFeedback)) setCeoFeedback('');
  }

  async function reviewInboxAsCeo(action: 'approve' | 'revise' | 'reject') {
    if (!inboxDetail) return;
    await submitCeoReview(inboxDetail.id, action, inboxFeedback, true);
  }

  async function saveSettings() {
    if (!dashboard || !allowed) return;
    setWorking('settings');
    setMessage('');
    setError('');
    try {
      await api('/api/autonomous-studio/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          enabled: dashboard.settings.enabled,
          automaticApply: dashboard.settings.automatic_apply,
          cycleIntervalHours: dashboard.settings.cycle_interval_hours,
          planningHorizonDays: dashboard.settings.planning_horizon_days,
          maxFormatsPerWeek: dashboard.settings.max_formats_per_week,
          maxProductionsPerDay: dashboard.settings.max_productions_per_day,
          maxShortsPerDay: dashboard.settings.max_shorts_per_day,
          councilQuorum: dashboard.settings.council_quorum,
          paidModelStrategy: dashboard.settings.paid_model_strategy,
          paidModel: dashboard.settings.paid_model,
          maxRequestUsd: dashboard.settings.max_request_usd,
          dailyBudgetUsd: dashboard.settings.daily_budget_usd,
          reviewerModels: dashboard.settings.reviewer_models,
          audienceCouncilEnabled: dashboard.settings.audience_council_enabled,
          audienceCouncilCooldownMinutes: dashboard.settings.audience_council_cooldown_minutes,
          audienceCouncilMaxDaily: dashboard.settings.audience_council_max_daily,
          requireCeoApproval: dashboard.settings.require_ceo_approval,
          minimumActiveFormats: dashboard.settings.minimum_active_formats,
          maximumRevisionRounds: dashboard.settings.maximum_revision_rounds,
          operationsEnabled: dashboard.settings.operations_enabled,
          automaticOperationalActions: dashboard.settings.automatic_operational_actions,
          operationsIntervalSeconds: dashboard.settings.operations_interval_seconds,
          scheduleHorizonHours: dashboard.settings.schedule_horizon_hours,
          minimumUpcomingShows: dashboard.settings.minimum_upcoming_shows,
          minimumScheduleMinutes: dashboard.settings.minimum_schedule_minutes,
        }),
      });
      setSettingsOpen(false);
      setMessage('Autonome Sendersteuerung gespeichert.');
      await load(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function saveCouncilMember() {
    if (!editingMember || !allowed) return;
    setWorking('council');
    setError('');
    try {
      await api(`/api/autonomous-studio/council/${encodeURIComponent(editingMember.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          display_name: editingMember.display_name,
          instructions: editingMember.instructions,
          preferred_model: editingMember.preferred_model,
          enabled: editingMember.enabled,
        }),
      });
      setEditingMember(null);
      setMessage('Gremiumsrolle aktualisiert.');
      await load(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function decisionAction(decision: DecisionDetail, action: 'retry' | 'rollback') {
    setWorking(`${action}:${decision.id}`);
    setError('');
    try {
      await api(`/api/autonomous-studio/decisions/${decision.id}/${action}`, { method: 'POST' });
      setMessage(action === 'retry' ? 'Erneute Beratung gestartet.' : 'Entscheidung kontrolliert zurückgerollt.');
      await load(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  if (!allowed)
    return (
      <section className="workspace-hub">
        <div className="hub-empty">
          <Crown size={26} />
          <strong>Nur für die Senderleitung</strong>
          <span>Die CEO-Direktiven und Gremiumsregeln benötigen Administratorrechte.</span>
        </div>
      </section>
    );

  return (
    <section className="workspace-hub sendegott-page">
      <header className="workspace-page-header sendegott-header">
        <div>
          <p className="eyebrow">CEO-Zentrale des autonomen Senders</p>
          <h1>
            <Crown /> SENDEGOTT
          </h1>
          <p>
            Das autonome Senderunternehmen überwacht Programm, Playout, OBS, Quellen und Sendeplan selbstständig. Du
            siehst jede reale Aktion und kannst als CEO Leitplanken setzen, musst den Betrieb aber nicht anstoßen.
          </p>
        </div>
        <div className="workspace-header-actions">
          <button className="decision-inbox-button" onClick={() => openDecisionInbox('approval')}>
            <ListChecks size={17} /> Beschluss-Inbox
            <span>{ceo?.decisions.ceo_waiting ?? 0}</span>
          </button>
          <button onClick={() => setSettingsOpen(true)} disabled={!dashboard}>
            <Settings2 size={17} /> Regeln & Budget
          </button>
          <button onClick={() => void load()} disabled={loading}>
            <RefreshCw size={17} className={loading ? 'spin' : ''} /> Aktualisieren
          </button>
        </div>
      </header>

      {message && (
        <div className="overview-notice">
          <CheckCircle2 size={16} /> {message}
        </div>
      )}
      {error && (
        <div className="overview-notice error">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      <div className="sendegott-kpis">
        <button
          type="button"
          className="sendegott-kpi-card interactive"
          onClick={() => openDecisionInbox((ceo?.decisions.ceo_waiting ?? 0) > 0 ? 'approval' : 'all')}
        >
          <span
            className={
              latestOperations?.status === 'degraded' || latestOperations?.status === 'failed' || operationsStillWorking
                ? 'amber'
                : 'green'
            }
          >
            <Activity />
          </span>
          <div>
            <small>Autonomes Master Control</small>
            <strong>
              {latestOperations?.status === 'healthy'
                ? 'Stabil'
                : latestOperations?.status === 'repaired' && !operationsStillWorking
                  ? 'Repariert'
                  : latestOperations?.status === 'running'
                    ? 'Prüft'
                    : latestOperations
                      ? 'Handelt'
                      : 'Startet'}
            </strong>
            <p>Nächste Prüfung {dateTime(dashboard?.settings.next_operations_cycle_at)}</p>
          </div>
          <ArrowRight className="kpi-open-icon" />
        </button>
        <button type="button" className="sendegott-kpi-card interactive" onClick={() => openDecisionInbox('all')}>
          <span className="cyan">
            <Gavel />
          </span>
          <div>
            <small>Offene Beschlüsse</small>
            <strong>{ceo?.decisions.open_decisions ?? activeDecisions.length}</strong>
            <p>{ceo?.decisions.council_waiting ?? 0} gerade im Gremium</p>
          </div>
          <ArrowRight className="kpi-open-icon" />
        </button>
        <article className="sendegott-kpi-card">
          <span className="violet">
            <ShieldCheck />
          </span>
          <div>
            <small>Schlussprüfung</small>
            <strong>{ceo?.decisions.review_waiting ?? 0}</strong>
            <p>Zwei verschiedene Modelle sind Pflicht</p>
          </div>
        </article>
        <article className="sendegott-kpi-card">
          <span className="green">
            <MessageCircleMore />
          </span>
          <div>
            <small>Chat im Gremium</small>
            <strong>
              {dashboard?.decisions.filter(
                (decision) =>
                  decision.source === 'audience' && !['rejected', 'applied', 'cancelled'].includes(decision.status),
              ).length ?? 0}
            </strong>
            <p>{audienceInputs.length} aktuelle Publikumsimpulse</p>
          </div>
        </article>
        <button
          type="button"
          className="sendegott-kpi-card interactive approval"
          onClick={() => openDecisionInbox('approval')}
        >
          <span className="amber">
            <Crown />
          </span>
          <div>
            <small>Deine Freigaben</small>
            <strong>{ceo?.decisions.ceo_waiting ?? 0}</strong>
            <p>Geprüfte Beschlüsse mit CEO-Vorbehalt</p>
          </div>
          <ArrowRight className="kpi-open-icon" />
        </button>
        <article className="sendegott-kpi-card">
          <span className="amber">
            <CircleDollarSign />
          </span>
          <div>
            <small>KI-Budget heute</small>
            <strong>{(dashboard?.budget.remainingUsd ?? 0).toFixed(2)} USD</strong>
            <p>{(dashboard?.budget.spentUsd ?? 0).toFixed(3)} USD verbraucht</p>
          </div>
        </article>
      </div>

      <section className="hub-panel sendegott-master-control">
        <header>
          <div>
            <p className="eyebrow">24/7 Betrieb · eigenständig statt auftragsabhängig</p>
            <h2>
              <Activity /> Autonomes Master Control
            </h2>
          </div>
          <div className="master-control-actions">
            <span
              className={`state-pill ${
                latestOperations?.status === 'failed' ||
                latestOperations?.status === 'degraded' ||
                operationsStillWorking
                  ? 'warning'
                  : 'success'
              }`}
            >
              {latestOperations?.status === 'healthy'
                ? 'Betrieb gesund'
                : latestOperations?.status === 'repaired' && !operationsStillWorking
                  ? 'Automatisch repariert'
                  : operationsStillWorking
                    ? 'Weitere Arbeit läuft'
                    : latestOperations?.status === 'running'
                      ? 'Prüfung läuft'
                      : latestOperations?.status === 'failed'
                        ? 'Prüfung fehlgeschlagen'
                        : latestOperations?.status === 'degraded'
                          ? 'Weitere Arbeit läuft'
                          : 'Noch kein Zyklus'}
            </span>
            <button className="decision-inbox-button compact" onClick={() => openDecisionInbox('approval')}>
              <ListChecks /> Beschlüsse
              <span>{ceo?.decisions.ceo_waiting ?? 0}</span>
            </button>
            <button disabled={Boolean(working)} onClick={() => void runOperationsCheck()}>
              {working === 'operations' ? <LoaderCircle className="spin" /> : <RefreshCw />} Jetzt prüfen
            </button>
          </div>
        </header>
        <div className="master-control-summary">
          <article>
            <CalendarClock />
            <div>
              <small>Programmdeckung</small>
              <strong>
                {latestOperations?.verification.schedule?.afterShows ?? 0} Sendungen ·{' '}
                {latestOperations?.verification.schedule?.afterMinutes ?? 0} Min.
              </strong>
              <span>
                {dashboard?.settings.schedule_horizon_hours ?? 24} Stunden werden kontinuierlich vorausgeplant.
              </span>
            </div>
          </article>
          <article>
            <Wrench />
            <div>
              <small>Echte Aktionen</small>
              <strong>{latestOperations?.actions?.length ?? 0} im letzten Zyklus</strong>
              <span>Autopilot, Stream, Runner, Sendeplan, Formate und Produktionen werden real verändert.</span>
            </div>
          </article>
          <article>
            <ShieldCheck />
            <div>
              <small>Kontrollmodell</small>
              <strong>Operativ autonom</strong>
              <span>Kreative Änderungen behalten Gremiumsquorum und zwei unabhängige KI-Prüfungen.</span>
            </div>
          </article>
        </div>
        <div className="master-control-worklog">
          <section>
            <h3>
              Erkannte Lage
              {operationsStillWorking && <small>{remainingOperationsFindings.length} weiter in Bearbeitung</small>}
            </h3>
            {(latestOperations?.findings ?? []).map((finding, index) => (
              <article key={`${finding.code ?? 'finding'}-${index}`} className={finding.severity ?? 'info'}>
                <AlertTriangle />
                <div>
                  <strong>{finding.title ?? finding.code ?? 'Betriebshinweis'}</strong>
                  <span>{finding.detail ?? 'Wird vom Master Control verarbeitet.'}</span>
                </div>
              </article>
            ))}
            {!latestOperations?.findings?.length && (
              <p className="empty-copy">Keine offenen Betriebsabweichungen erkannt.</p>
            )}
          </section>
          <section>
            <h3>Ausgeführte Arbeit</h3>
            {(latestOperations?.actions ?? []).map((action, index) => (
              <article key={`${action.type ?? 'action'}-${index}`} className={action.status ?? 'queued'}>
                {action.status === 'failed' ? <AlertTriangle /> : <CheckCircle2 />}
                <div>
                  <strong>{action.summary ?? action.type ?? 'Autonome Aktion'}</strong>
                  {action.error && <span>{action.error}</span>}
                </div>
              </article>
            ))}
            {!latestOperations?.actions?.length && (
              <p className="empty-copy">Kein Eingriff nötig – Überwachung bleibt aktiv.</p>
            )}
          </section>
        </div>
        <footer>
          <span>Letzter Zyklus: {dateTime(latestOperations?.completed_at ?? latestOperations?.started_at)}</span>
          <span>Keine Freigabe für normale Betriebsreparaturen erforderlich.</span>
        </footer>
      </section>

      <AgentOrchestratorPanel user={user} />

      <div className="sendegott-command-grid">
        <section className="hub-panel sendegott-directive-panel">
          <header>
            <div>
              <p className="eyebrow">Dein Auftrag an das Unternehmen</p>
              <h2>CEO-Direktive</h2>
            </div>
            <Crown size={22} />
          </header>
          <label>
            Kurztitel (optional)
            <input
              value={directiveTitle}
              maxLength={180}
              onChange={(event) => setDirectiveTitle(event.target.value)}
              placeholder="Zum Beispiel: Mehr Zuschauerfragen in die Primetime"
            />
          </label>
          <label>
            Was soll sich im Sender ändern?
            <textarea
              rows={7}
              value={directive}
              maxLength={12_000}
              onChange={(event) => setDirective(event.target.value)}
              placeholder="Beschreibe Ziel, Priorität und gewünschtes Ergebnis in normalen Worten …"
            />
          </label>
          <div className="sendegott-safety-chain">
            <span>1 · Übersetzung in Regeln</span>
            <ArrowRight />
            <span>2 · Fünf Gremiumsrollen</span>
            <ArrowRight />
            <span>3 · Zwei Schlussprüfungen</span>
            <ArrowRight />
            <span>4 · Kontrollierte Umsetzung</span>
          </div>
          <button
            className="primary-button"
            disabled={directive.trim().length < 3 || Boolean(working)}
            onClick={() => void submitDirective()}
          >
            {working === 'directive' ? <LoaderCircle className="spin" /> : <Send />} Direktive zur Beratung geben
          </button>
        </section>

        <section className="hub-panel sendegott-cycle-panel">
          <header>
            <div>
              <p className="eyebrow">Eigenständige Weiterentwicklung</p>
              <h2>Strategierat einberufen</h2>
            </div>
            <Sparkles size={22} />
          </header>
          <p>
            Der Rat analysiert Programm, Inhalte, Chat, Formate, Produktionslast und Reichweite. Er entwickelt daraus
            konkrete neue Formate und Eigenproduktionen – niemals ungeprüft.
          </p>
          <label>
            Schwerpunkt (optional)
            <textarea
              rows={4}
              value={cycleReason}
              maxLength={3000}
              onChange={(event) => setCycleReason(event.target.value)}
              placeholder="Zum Beispiel: Entwickelt ein wöchentliches Format für kontroverse Zuschauerfragen."
            />
          </label>
          <dl className="sendegott-cycle-facts">
            <div>
              <dt>Nächster automatischer Zyklus</dt>
              <dd>{dateTime(dashboard?.settings.next_cycle_at)}</dd>
            </div>
            <div>
              <dt>Planungshorizont</dt>
              <dd>{dashboard?.settings.planning_horizon_days ?? 0} Tage</dd>
            </div>
          </dl>
          <button disabled={Boolean(working)} onClick={() => void startCycle()}>
            {working === 'cycle' ? <LoaderCircle className="spin" /> : <Bot />} Strategiezyklus jetzt starten
          </button>
        </section>
      </div>

      <section className="hub-panel sendegott-chat-panel">
        <header>
          <div>
            <p className="eyebrow">Direkter Draht zum KI-Sendergremium</p>
            <h2>
              <MessagesSquare /> Ratsgespräch
            </h2>
          </div>
          <span className="state-pill success">Lösung statt Lagebericht</span>
        </header>
        <div className="council-conversation" aria-live="polite">
          {(dashboard?.councilMessages ?? []).slice(-24).map((entry) => (
            <article className={entry.author_kind} key={entry.id}>
              <div>
                <strong>{entry.author_name}</strong>
                <time>{dateTime(entry.created_at)}</time>
              </div>
              <p>{entry.message}</p>
              {entry.decision_id && (
                <button
                  type="button"
                  onClick={() =>
                    void api<DecisionDetail>(`/api/autonomous-studio/decisions/${entry.decision_id}`)
                      .then(setDetail)
                      .catch((requestError) =>
                        setError(requestError instanceof Error ? requestError.message : String(requestError)),
                      )
                  }
                >
                  Vorgang öffnen <ArrowRight size={13} />
                </button>
              )}
            </article>
          ))}
          {!dashboard?.councilMessages?.length && (
            <p className="empty-copy">Noch kein Ratsgespräch. Gib dem Gremium ein Ziel oder einen konkreten Blocker.</p>
          )}
        </div>
        <div className="council-composer">
          <input
            value={councilTitle}
            maxLength={180}
            onChange={(event) => setCouncilTitle(event.target.value)}
            placeholder="Kurztitel, z. B. Mehr Zuschauerfragen in die Primetime"
          />
          <textarea
            rows={3}
            value={councilMessage}
            maxLength={12_000}
            onChange={(event) => setCouncilMessage(event.target.value)}
            placeholder="Was soll das Gremium lösen, entwerfen oder im Sender umsetzen?"
          />
          <button
            className="primary-button"
            disabled={councilMessage.trim().length < 2 || Boolean(working)}
            onClick={() => void sendCouncilMessage()}
          >
            {working === 'council-message' ? <LoaderCircle className="spin" /> : <Send />} An das Gremium
          </button>
        </div>
      </section>

      <section className="hub-panel sendegott-audience-panel">
        <header>
          <div>
            <p className="eyebrow">Publikumsrat · live aus YouTube und Twitch</p>
            <h2>So beeinflusst der Chat die Sendung</h2>
          </div>
          <span className={`state-pill ${dashboard?.settings.audience_council_enabled ? 'success' : 'warning'}`}>
            {dashboard?.settings.audience_council_enabled ? 'Aktiv' : 'Pausiert'}
          </span>
        </header>
        <div className="audience-command-guide">
          <article>
            <strong>!frage</strong>
            <span>AVA oder Mia beantworten eine konkrete Frage mit Redaktionsrecherche.</span>
          </article>
          <article>
            <strong>!thema / !vorschlag</strong>
            <span>Ein Sendungswunsch wird als Produktionsvorschlag an das Gremium übergeben.</span>
          </article>
          <article>
            <strong>!einwand</strong>
            <span>Ein Widerspruch wird dokumentiert, recherchiert und als mögliche Regeländerung geprüft.</span>
          </article>
          <article>
            <strong>!pro / !contra</strong>
            <span>Sam bildet ein Stimmungsbild, ohne daraus eine erfundene Mehrheit zu machen.</span>
          </article>
        </div>
        <div className="audience-council-flow">
          <span>Chatbeitrag</span>
          <ArrowRight />
          <span>Sam bündelt</span>
          <ArrowRight />
          <span>Fünf KI-Rollen beraten</span>
          <ArrowRight />
          <span>Zwei Modelle prüfen</span>
          <ArrowRight />
          <span>AVA verkündet das Ergebnis live</span>
        </div>
        <div className="audience-input-list">
          {audienceInputs.slice(0, 8).map((input, index) => (
            <article key={input.id ?? `${input.fingerprint}-${index}`}>
              <span className={`audience-kind ${input.influence_kind}`}>{input.influence_kind}</span>
              <div>
                <strong>{input.text}</strong>
                <small>
                  {input.provider.toUpperCase()} · {dateTime(input.created_at)}
                </small>
              </div>
              {input.decision_status && (
                <span className={`state-pill ${statusClass(input.decision_status)}`}>
                  {statusLabels[input.decision_status]}
                </span>
              )}
            </article>
          ))}
          {!audienceInputs.length && (
            <p className="empty-copy">Noch keine steuernden Chatimpulse in den letzten 24 Stunden.</p>
          )}
        </div>
      </section>

      <section className="hub-panel sendegott-council-panel">
        <header>
          <div>
            <p className="eyebrow">Mehrperspektivische Freigabe</p>
            <h2>Das KI-Sendergremium</h2>
          </div>
          <span className="state-pill success">Quorum {dashboard?.settings.council_quorum ?? 3} von 5</span>
        </header>
        <div className="council-member-grid">
          {(dashboard?.council ?? []).map((member) => (
            <button
              key={member.id}
              className={member.enabled ? '' : 'disabled'}
              style={{ '--council-accent': member.accent_color } as React.CSSProperties}
              onClick={() => setEditingMember({ ...member })}
            >
              <span>
                <Users />
              </span>
              <div>
                <small>{member.role_name}</small>
                <strong>{member.display_name}</strong>
                <p>{member.perspective}</p>
                <em>{member.preferred_model}</em>
              </div>
              <Settings2 />
            </button>
          ))}
        </div>
      </section>

      <section className="hub-panel sendegott-decisions-panel">
        <header>
          <div>
            <p className="eyebrow">Vollständig nachvollziehbar</p>
            <h2>Beschlüsse und Beratung</h2>
          </div>
          <div className="panel-actions">
            <span>{dashboard?.decisions.length ?? 0} Vorgänge</span>
            <button onClick={() => openDecisionInbox('approval')}>
              <ListChecks /> Beschluss-Inbox
            </button>
          </div>
        </header>
        <div className="decision-list">
          {(dashboard?.decisions ?? []).slice(0, 40).map((decision) => (
            <button
              key={decision.id}
              onClick={() =>
                void api<DecisionDetail>(`/api/autonomous-studio/decisions/${decision.id}`)
                  .then(setDetail)
                  .catch((requestError) =>
                    setError(requestError instanceof Error ? requestError.message : String(requestError)),
                  )
              }
            >
              <span className={`decision-source ${decision.source}`}>
                {decision.source === 'audience' ? (
                  <MessageCircleMore />
                ) : decision.source === 'sendegott' ? (
                  <Crown />
                ) : (
                  <Bot />
                )}
              </span>
              <div>
                <small>{sourceLabels[decision.source]}</small>
                <strong>{decision.title}</strong>
                <p>{decision.instruction}</p>
              </div>
              <div className="decision-progress">
                <span className={`state-pill ${decisionStatusClass(decision)}`}>{decisionStatusLabel(decision)}</span>
                <small>
                  Rat {decision.council_approvals}/{dashboard?.settings.council_quorum ?? 3} · Prüfung{' '}
                  {decision.review_approvals}/2
                </small>
                <time>{dateTime(decision.created_at)}</time>
              </div>
              <ArrowRight />
            </button>
          ))}
        </div>
      </section>

      <section className="sendegott-ceo-strip">
        <Crown />
        <div>
          <strong>CEO-Lagebild</strong>
          <span>{ceo?.nextActions?.[0] ?? 'Das Studio sammelt aktuelle Betriebsdaten.'}</span>
        </div>
        <span className={`state-pill ${ceo?.autopilot.enabled ? 'success' : 'warning'}`}>
          Autopilot {ceo?.autopilot.enabled ? 'aktiv' : 'aus'}
        </span>
      </section>

      {decisionInboxOpen && (
        <div className="studio-modal-backdrop decision-inbox-backdrop" onMouseDown={() => setDecisionInboxOpen(false)}>
          <section
            className="studio-dialog decision-inbox-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="decision-inbox-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <p className="eyebrow">CEO-Freigaben · zentral und revisionssicher</p>
                <h2 id="decision-inbox-title">
                  <ListChecks /> Beschluss-Inbox
                </h2>
                <p>
                  Geprüfte Beschlüsse bestätigen, zur Überarbeitung geben oder verwerfen – ohne den Überblick zu
                  verlieren.
                </p>
              </div>
              <button aria-label="Beschluss-Inbox schließen" onClick={() => setDecisionInboxOpen(false)}>
                <X />
              </button>
            </header>

            <div className="decision-inbox-stats" aria-label="Beschlussübersicht">
              <button
                className={decisionInboxFilter === 'approval' ? 'active approval' : 'approval'}
                onClick={() => setDecisionInboxFilter('approval')}
              >
                <Crown />
                <span>
                  <small>Deine Freigaben</small>
                  <strong>{decisionInbox.counts.approval}</strong>
                </span>
              </button>
              <button
                className={decisionInboxFilter === 'pipeline' ? 'active' : ''}
                onClick={() => setDecisionInboxFilter('pipeline')}
              >
                <Workflow />
                <span>
                  <small>In Prüfung</small>
                  <strong>{decisionInbox.counts.pipeline}</strong>
                </span>
              </button>
              <button
                className={decisionInboxFilter === 'attention' ? 'active attention' : 'attention'}
                onClick={() => setDecisionInboxFilter('attention')}
              >
                <AlertTriangle />
                <span>
                  <small>Aufmerksamkeit</small>
                  <strong>{decisionInbox.counts.attention}</strong>
                </span>
              </button>
              <button
                className={decisionInboxFilter === 'all' ? 'active' : ''}
                onClick={() => setDecisionInboxFilter('all')}
              >
                <Gavel />
                <span>
                  <small>Alle offen</small>
                  <strong>{decisionInbox.counts.all}</strong>
                </span>
              </button>
            </div>

            <div className="decision-inbox-toolbar">
              <label>
                <Search />
                <input
                  autoFocus
                  value={decisionInboxSearch}
                  onChange={(event) => setDecisionInboxSearch(event.target.value)}
                  placeholder="Beschlüsse, Inhalte oder Status durchsuchen …"
                />
              </label>
              <span>
                {filteredInboxDecisions.length} {inboxFilterLabels[decisionInboxFilter].toLocaleLowerCase('de-DE')}
              </span>
              <button
                aria-label="Beschluss-Inbox aktualisieren"
                disabled={decisionInboxLoading}
                onClick={() => void loadDecisionInbox()}
              >
                <RefreshCw className={decisionInboxLoading ? 'spin' : ''} /> Aktualisieren
              </button>
            </div>

            <div className="decision-inbox-layout">
              <section className="decision-inbox-table-panel" aria-label="Offene Beschlüsse">
                <div className="decision-inbox-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Beschluss</th>
                        <th>Status</th>
                        <th>Gremium</th>
                        <th>Prüfung</th>
                        <th>Erstellt</th>
                        <th aria-label="Öffnen" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredInboxDecisions.map((decision) => (
                        <tr
                          key={decision.id}
                          className={decision.id === inboxDecisionId ? 'selected' : ''}
                          tabIndex={0}
                          onClick={() => setInboxDecisionId(decision.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setInboxDecisionId(decision.id);
                            }
                          }}
                        >
                          <td>
                            <span className={`decision-priority ${decision.importance}`}>{decision.importance}</span>
                            <div>
                              <small>
                                {kindLabels[decision.kind]} · {sourceLabels[decision.source]}
                              </small>
                              <strong>{decision.title}</strong>
                              <p>{decision.instruction}</p>
                            </div>
                          </td>
                          <td>
                            <span className={`state-pill ${decisionStatusClass(decision)}`}>
                              {decisionStatusLabel(decision)}
                            </span>
                          </td>
                          <td>
                            <strong>
                              {decision.council_approvals}/{dashboard?.settings.council_quorum ?? 3}
                            </strong>
                          </td>
                          <td>
                            <strong>{decision.review_approvals}/2</strong>
                          </td>
                          <td>
                            <time>{dateTime(decision.created_at)}</time>
                          </td>
                          <td>
                            <ArrowRight />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!filteredInboxDecisions.length && !decisionInboxLoading && (
                  <div className="decision-inbox-empty">
                    <CheckCircle2 />
                    <strong>
                      {decisionInboxFilter === 'approval'
                        ? 'Keine Freigabe wartet auf dich'
                        : 'Keine Beschlüsse gefunden'}
                    </strong>
                    <span>
                      {decisionInboxSearch
                        ? 'Passe den Suchbegriff oder die Ansicht an.'
                        : 'Das autonome Senderteam arbeitet innerhalb der freigegebenen Leitplanken weiter.'}
                    </span>
                  </div>
                )}
              </section>

              <aside className="decision-inbox-preview" aria-live="polite">
                {inboxDetailLoading && (
                  <div className="decision-inbox-loading">
                    <LoaderCircle className="spin" /> Beschluss wird geladen …
                  </div>
                )}
                {!inboxDetailLoading && inboxDetail && (
                  <>
                    <header>
                      <div>
                        <small>
                          {kindLabels[inboxDetail.kind]} · {sourceLabels[inboxDetail.source]}
                        </small>
                        <h3>{inboxDetail.title}</h3>
                      </div>
                      <span className={`state-pill ${decisionStatusClass(inboxDetail)}`}>
                        {decisionStatusLabel(inboxDetail)}
                      </span>
                    </header>
                    <p className="decision-inbox-instruction">{inboxDetail.instruction}</p>
                    <div className="decision-inbox-checks">
                      <article>
                        <Users />
                        <span>
                          <small>Gremium</small>
                          <strong>
                            {inboxDetail.council_approvals}/{dashboard?.settings.council_quorum ?? 3} Zustimmung
                          </strong>
                        </span>
                      </article>
                      <article>
                        <ShieldCheck />
                        <span>
                          <small>Schlussprüfung</small>
                          <strong>{inboxDetail.review_approvals}/2 bestanden</strong>
                        </span>
                      </article>
                    </div>
                    {isBudgetDeferred(inboxDetail) && (
                      <section className="decision-budget-intervention">
                        <h4>
                          <AlertTriangle /> KI-Budget blockiert diese Entscheidung
                        </h4>
                        <p>
                          Das Gremium darf ohne dein Eingreifen nicht weiter Tokens verbrauchen. Du kannst warten, das
                          freigegebene Budget kontrolliert erhöhen oder den Vorgang abbrechen.
                        </p>
                        <div>
                          <button
                            disabled={Boolean(working)}
                            onClick={() => void submitBudgetIntervention(inboxDetail.id, 'wait', true)}
                          >
                            <Clock3 /> Heute warten
                          </button>
                          <button
                            className="primary-button"
                            disabled={Boolean(working)}
                            onClick={() => void submitBudgetIntervention(inboxDetail.id, 'raise-daily-budget', true)}
                          >
                            <Sparkles /> Tagesbudget +1 USD
                          </button>
                          <button
                            disabled={Boolean(working)}
                            onClick={() => void submitBudgetIntervention(inboxDetail.id, 'raise-request-budget', true)}
                          >
                            <RefreshCw /> Anfragebudget +0,05 USD
                          </button>
                          <button
                            className="danger-button"
                            disabled={Boolean(working)}
                            onClick={() => void submitBudgetIntervention(inboxDetail.id, 'cancel', true)}
                          >
                            <X /> Abbrechen
                          </button>
                        </div>
                      </section>
                    )}
                    <section className="decision-inbox-plan">
                      <h4>Umsetzungsplan</h4>
                      {objectList(inboxDetail.proposal.solutionPlan)
                        .slice(0, 3)
                        .map((solution, index) => (
                          <article key={`${String(solution.problem)}-${index}`}>
                            <span>{index + 1}</span>
                            <div>
                              <strong>{String(solution.problem ?? 'Arbeitspunkt')}</strong>
                              <p>{String(solution.solution ?? '')}</p>
                            </div>
                          </article>
                        ))}
                      {!objectList(inboxDetail.proposal.solutionPlan).length && (
                        <p className="empty-copy">Der konkrete Plan wird noch ausgearbeitet.</p>
                      )}
                    </section>
                    {inboxDetail.status === 'awaiting_ceo' && (
                      <section className="decision-inbox-approval">
                        <h4>
                          <Crown /> Deine Entscheidung
                        </h4>
                        <p>
                          Genehmigen setzt kontrolliert um. Für eine Überarbeitung ist eine Rückmeldung erforderlich.
                        </p>
                        <textarea
                          rows={3}
                          value={inboxFeedback}
                          onChange={(event) => setInboxFeedback(event.target.value)}
                          placeholder="Rückmeldung oder Änderungswunsch …"
                        />
                        <div>
                          <button
                            className="primary-button"
                            disabled={Boolean(working)}
                            onClick={() => void reviewInboxAsCeo('approve')}
                          >
                            {working === `ceo:approve:${inboxDetail.id}` ? (
                              <LoaderCircle className="spin" />
                            ) : (
                              <CheckCircle2 />
                            )}{' '}
                            Genehmigen
                          </button>
                          <button
                            disabled={Boolean(working) || inboxFeedback.trim().length < 2}
                            onClick={() => void reviewInboxAsCeo('revise')}
                          >
                            <RefreshCw /> Überarbeiten
                          </button>
                          <button
                            className="danger-button"
                            disabled={Boolean(working)}
                            onClick={() => void reviewInboxAsCeo('reject')}
                          >
                            <X /> Verwerfen
                          </button>
                        </div>
                      </section>
                    )}
                    {inboxDetail.error && (
                      <div className="decision-inbox-error">
                        <AlertTriangle />
                        <span>{inboxDetail.error}</span>
                      </div>
                    )}
                    <button
                      className="decision-inbox-open-detail"
                      onClick={() => {
                        setDecisionInboxOpen(false);
                        setDetail(inboxDetail);
                      }}
                    >
                      Vollständigen Vorgang öffnen <ArrowRight />
                    </button>
                  </>
                )}
                {!inboxDetailLoading && !inboxDetail && (
                  <div className="decision-inbox-empty compact">
                    <Gavel />
                    <strong>Beschluss auswählen</strong>
                    <span>Wähle links einen Vorgang, um Plan, Prüfstand und Freigabeaktionen zu sehen.</span>
                  </div>
                )}
              </aside>
            </div>

            <footer>
              <span>
                <ShieldCheck /> Jede Entscheidung bleibt mit Gremiumsquorum, zwei Schlussprüfungen und Audit-Protokoll
                gesichert.
              </span>
              <button onClick={() => setDecisionInboxOpen(false)}>Schließen</button>
            </footer>
          </section>
        </div>
      )}

      {settingsOpen && dashboard && (
        <div className="studio-modal-backdrop" onMouseDown={() => setSettingsOpen(false)}>
          <section className="studio-dialog sendegott-settings-dialog" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <p className="eyebrow">Leitplanken</p>
                <h2>Autonomie, Gremium und Budget</h2>
              </div>
              <button aria-label="Schließen" onClick={() => setSettingsOpen(false)}>
                <X />
              </button>
            </header>
            <div className="settings-automation-grid">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={dashboard.settings.operations_enabled}
                  onChange={(event) =>
                    setDashboard({
                      ...dashboard,
                      settings: { ...dashboard.settings, operations_enabled: event.target.checked },
                    })
                  }
                />
                <span>
                  <strong>24/7 Master Control</strong>
                  <small>Überwacht Playout, OBS, Stream, Runner, Quellen, Formate und Sendeplan fortlaufend.</small>
                </span>
              </label>
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={dashboard.settings.automatic_operational_actions}
                  onChange={(event) =>
                    setDashboard({
                      ...dashboard,
                      settings: { ...dashboard.settings, automatic_operational_actions: event.target.checked },
                    })
                  }
                />
                <span>
                  <strong>Betriebsprobleme selbst beheben</strong>
                  <small>Bekannte, reversible Reparaturen werden ohne Rückfrage ausgeführt und protokolliert.</small>
                </span>
              </label>
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={dashboard.settings.enabled}
                  onChange={(event) =>
                    setDashboard({ ...dashboard, settings: { ...dashboard.settings, enabled: event.target.checked } })
                  }
                />
                <span>
                  <strong>Autonome Strategiezyklen</strong>
                  <small>Der Sender entwickelt regelmäßig geprüfte Ausbauvorschläge.</small>
                </span>
              </label>
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={dashboard.settings.require_ceo_approval}
                  onChange={(event) =>
                    setDashboard({
                      ...dashboard,
                      settings: { ...dashboard.settings, require_ceo_approval: event.target.checked },
                    })
                  }
                />
                <span>
                  <strong>Wichtige Beschlüsse durch CEO freigeben</strong>
                  <small>Erst nach Rat und zwei KI-Prüfungen erscheinen Genehmigen, Überarbeiten und Verwerfen.</small>
                </span>
              </label>
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={dashboard.settings.automatic_apply}
                  onChange={(event) =>
                    setDashboard({
                      ...dashboard,
                      settings: { ...dashboard.settings, automatic_apply: event.target.checked },
                    })
                  }
                />
                <span>
                  <strong>Nach Freigabe automatisch umsetzen</strong>
                  <small>Nur nach Gremiumsquorum und zwei verschiedenen Schlussprüfungen.</small>
                </span>
              </label>
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={dashboard.settings.audience_council_enabled}
                  onChange={(event) =>
                    setDashboard({
                      ...dashboard,
                      settings: { ...dashboard.settings, audience_council_enabled: event.target.checked },
                    })
                  }
                />
                <span>
                  <strong>Chatimpulse an das Gremium</strong>
                  <small>Publikumsvorschläge bleiben untrusted und werden niemals direkt ausgeführt.</small>
                </span>
              </label>
              <label>
                Betriebsprüfung (Sekunden)
                <input
                  type="number"
                  min={30}
                  max={3600}
                  value={dashboard.settings.operations_interval_seconds}
                  onChange={(event) =>
                    setDashboard({
                      ...dashboard,
                      settings: { ...dashboard.settings, operations_interval_seconds: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <label>
                Planungshorizont (Stunden)
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={dashboard.settings.schedule_horizon_hours}
                  onChange={(event) =>
                    setDashboard({
                      ...dashboard,
                      settings: { ...dashboard.settings, schedule_horizon_hours: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <label>
                Mindestens kommende Sendungen
                <input
                  type="number"
                  min={1}
                  max={192}
                  value={dashboard.settings.minimum_upcoming_shows}
                  onChange={(event) =>
                    setDashboard({
                      ...dashboard,
                      settings: { ...dashboard.settings, minimum_upcoming_shows: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <label>
                Mindestabdeckung (Minuten)
                <input
                  type="number"
                  min={30}
                  max={10080}
                  value={dashboard.settings.minimum_schedule_minutes}
                  onChange={(event) =>
                    setDashboard({
                      ...dashboard,
                      settings: { ...dashboard.settings, minimum_schedule_minutes: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <label>
                Gremiumsquorum
                <input
                  type="number"
                  min={3}
                  max={5}
                  value={dashboard.settings.council_quorum}
                  onChange={(event) =>
                    setDashboard({
                      ...dashboard,
                      settings: { ...dashboard.settings, council_quorum: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <label>
                Mindestzahl aktiver Formate
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={dashboard.settings.minimum_active_formats}
                  onChange={(event) =>
                    setDashboard({
                      ...dashboard,
                      settings: { ...dashboard.settings, minimum_active_formats: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <label>
                Maximale Lösungsschleifen
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={dashboard.settings.maximum_revision_rounds}
                  onChange={(event) =>
                    setDashboard({
                      ...dashboard,
                      settings: { ...dashboard.settings, maximum_revision_rounds: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <label>
                Strategiezyklus (Stunden)
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={dashboard.settings.cycle_interval_hours}
                  onChange={(event) =>
                    setDashboard({
                      ...dashboard,
                      settings: { ...dashboard.settings, cycle_interval_hours: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <label>
                Gleiche Chatidee bündeln (Minuten)
                <input
                  type="number"
                  min={5}
                  max={1440}
                  value={dashboard.settings.audience_council_cooldown_minutes}
                  onChange={(event) =>
                    setDashboard({
                      ...dashboard,
                      settings: {
                        ...dashboard.settings,
                        audience_council_cooldown_minutes: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
              <label>
                Max. neue Chatvorgänge pro Tag
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={dashboard.settings.audience_council_max_daily}
                  onChange={(event) =>
                    setDashboard({
                      ...dashboard,
                      settings: { ...dashboard.settings, audience_council_max_daily: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <label>
                Tagesbudget (USD)
                <input
                  type="number"
                  min={0.01}
                  max={1000}
                  step={0.1}
                  value={dashboard.settings.daily_budget_usd}
                  onChange={(event) =>
                    setDashboard({
                      ...dashboard,
                      settings: { ...dashboard.settings, daily_budget_usd: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <label>
                Maximum je KI-Anfrage (USD)
                <input
                  type="number"
                  min={0.01}
                  max={25}
                  step={0.01}
                  value={dashboard.settings.max_request_usd}
                  onChange={(event) =>
                    setDashboard({
                      ...dashboard,
                      settings: { ...dashboard.settings, max_request_usd: Number(event.target.value) },
                    })
                  }
                />
              </label>
            </div>
            <footer>
              <button onClick={() => setSettingsOpen(false)}>Abbrechen</button>
              <button className="primary-button" disabled={working === 'settings'} onClick={() => void saveSettings()}>
                {working === 'settings' ? <LoaderCircle className="spin" /> : <Save />} Regeln speichern
              </button>
            </footer>
          </section>
        </div>
      )}

      {editingMember && (
        <div className="studio-modal-backdrop" onMouseDown={() => setEditingMember(null)}>
          <section className="studio-dialog council-dialog" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <p className="eyebrow">Gremiumsarbeitsplatz</p>
                <h2>{editingMember.role_name}</h2>
              </div>
              <button aria-label="Schließen" onClick={() => setEditingMember(null)}>
                <X />
              </button>
            </header>
            <label>
              Anzeigename
              <input
                value={editingMember.display_name}
                onChange={(event) => setEditingMember({ ...editingMember, display_name: event.target.value })}
              />
            </label>
            <label>
              Prüfauftrag
              <textarea
                rows={6}
                value={editingMember.instructions}
                onChange={(event) => setEditingMember({ ...editingMember, instructions: event.target.value })}
              />
            </label>
            <label>
              Bevorzugtes OpenRouter-Modell
              <input
                value={editingMember.preferred_model}
                onChange={(event) => setEditingMember({ ...editingMember, preferred_model: event.target.value })}
              />
            </label>
            <label className="toggle-card">
              <input
                type="checkbox"
                checked={editingMember.enabled}
                onChange={(event) => setEditingMember({ ...editingMember, enabled: event.target.checked })}
              />
              <span>
                <strong>Stimmrecht aktiv</strong>
                <small>Mindestens drei aktive Zustimmungen bleiben zwingend.</small>
              </span>
            </label>
            <footer>
              <button onClick={() => setEditingMember(null)}>Abbrechen</button>
              <button
                className="primary-button"
                disabled={working === 'council'}
                onClick={() => void saveCouncilMember()}
              >
                {working === 'council' ? <LoaderCircle className="spin" /> : <Save />} Rolle speichern
              </button>
            </footer>
          </section>
        </div>
      )}

      {detail && (
        <div className="studio-modal-backdrop" onMouseDown={() => setDetail(null)}>
          <section className="studio-dialog decision-dialog" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <p className="eyebrow">{sourceLabels[detail.source]}</p>
                <h2>{detail.title}</h2>
              </div>
              <button aria-label="Schließen" onClick={() => setDetail(null)}>
                <X />
              </button>
            </header>
            <div className="decision-dialog-summary">
              <span className={`state-pill ${decisionStatusClass(detail)}`}>{decisionStatusLabel(detail)}</span>
              <span>Erstellt {dateTime(detail.created_at)}</span>
              <span>Modell {detail.proposal_model || 'noch nicht gewählt'}</span>
            </div>
            <p className="decision-instruction">{detail.instruction}</p>
            {detail.error && <div className="overview-notice error">{detail.error}</div>}
            {isBudgetDeferred(detail) && (
              <section className="decision-budget-intervention">
                <h3>
                  <AlertTriangle /> KI-Budgetentscheidung erforderlich
                </h3>
                <p>
                  Diese Entscheidung ist wegen des freigegebenen KI-Budgets angehalten. Du entscheidest, ob weiter
                  gewartet, das Budget kontrolliert erhöht oder die Arbeit abgebrochen wird.
                </p>
                <textarea
                  rows={3}
                  value={ceoFeedback}
                  onChange={(event) => setCeoFeedback(event.target.value)}
                  placeholder="Optionaler Hinweis für das Gremium …"
                />
                <div>
                  <button
                    disabled={Boolean(working)}
                    onClick={() => void submitBudgetIntervention(detail.id, 'wait')}
                  >
                    <Clock3 /> Weiter warten
                  </button>
                  <button
                    className="primary-button"
                    disabled={Boolean(working)}
                    onClick={() => void submitBudgetIntervention(detail.id, 'raise-daily-budget')}
                  >
                    <Sparkles /> Tagesbudget +1 USD
                  </button>
                  <button
                    disabled={Boolean(working)}
                    onClick={() => void submitBudgetIntervention(detail.id, 'raise-request-budget')}
                  >
                    <RefreshCw /> Anfragebudget +0,05 USD
                  </button>
                  <button
                    className="danger-button"
                    disabled={Boolean(working)}
                    onClick={() => void submitBudgetIntervention(detail.id, 'cancel')}
                  >
                    <X /> Entscheidung abbrechen
                  </button>
                </div>
              </section>
            )}
            <section>
              <h3>
                <Workflow /> Konkreter Lösungs- und Umsetzungsplan
              </h3>
              <div className="decision-solution-grid">
                {objectList(detail.proposal.solutionPlan).map((solution, index) => (
                  <article key={`${String(solution.problem)}-${index}`}>
                    <small>Problem {index + 1}</small>
                    <strong>{String(solution.problem ?? 'Offener Arbeitspunkt')}</strong>
                    <p>{String(solution.solution ?? '')}</p>
                    <span>
                      {String(solution.owner ?? 'Redaktion')} · {Number(solution.completionDays ?? 0)} Tage
                    </span>
                    <ul>
                      {textList(solution.acceptanceCriteria).map((criterion) => (
                        <li key={criterion}>{criterion}</li>
                      ))}
                    </ul>
                  </article>
                ))}
                {!objectList(detail.proposal.solutionPlan).length && (
                  <p className="empty-copy">Der konkrete Lösungsplan wird während der Planung erstellt.</p>
                )}
              </div>
            </section>
            <section>
              <h3>
                <FileDown /> Arbeitsergebnisse und Handouts
              </h3>
              <div className="decision-deliverable-list">
                {(detail.deliverables ?? []).map((deliverable) => (
                  <article key={deliverable.id}>
                    <FileDown />
                    <div>
                      <strong>{deliverable.title}</strong>
                      <small>
                        {deliverable.kind} ·{' '}
                        {deliverable.status === 'ready'
                          ? 'bereit'
                          : deliverable.status === 'preparing'
                            ? 'wird erstellt'
                            : 'fehlgeschlagen'}
                      </small>
                      {deliverable.error && <p>{deliverable.error}</p>}
                    </div>
                    {deliverable.file_path && deliverable.status === 'ready' && (
                      <a href={`/api/autonomous-studio/deliverables/${deliverable.id}/download`}>
                        PDF <FileDown size={13} />
                      </a>
                    )}
                  </article>
                ))}
                {!detail.deliverables?.length && <p className="empty-copy">Noch keine Arbeitsergebnisse vorhanden.</p>}
              </div>
            </section>
            <section>
              <h3>
                <Users /> Beratung im Gremium
              </h3>
              <div className="decision-review-grid">
                {detail.councilVotes.map((vote) => (
                  <article key={vote.id}>
                    <span
                      className={`state-pill ${statusClass(vote.vote === 'approve' ? 'approved' : vote.vote === 'reject' ? 'rejected' : 'revise')}`}
                    >
                      {vote.vote === 'approve' ? 'Zustimmung' : vote.vote === 'reject' ? 'Ablehnung' : 'Überarbeiten'} ·{' '}
                      {vote.score}/100
                    </span>
                    <strong>{vote.display_name}</strong>
                    <small>{vote.role_name}</small>
                    <p>{vote.summary}</p>
                    <em>{vote.reviewer_model}</em>
                  </article>
                ))}
                {!detail.councilVotes.length && (
                  <p className="empty-copy">Das Gremium beginnt in Kürze mit der Beratung.</p>
                )}
              </div>
            </section>
            {detail.status === 'awaiting_ceo' && (
              <section className="ceo-approval-panel">
                <h3>
                  <Crown /> Deine Entscheidung als CEO
                </h3>
                <p>
                  Das Gremium und zwei unterschiedliche KI-Modelle haben zugestimmt. Prüfe Lösungsplan, Handout und
                  Abnahmekriterien; erst danach darf die Umsetzung beginnen.
                </p>
                <textarea
                  rows={3}
                  value={ceoFeedback}
                  onChange={(event) => setCeoFeedback(event.target.value)}
                  placeholder="Rückmeldung für eine Überarbeitung oder Begründung für die Entscheidung …"
                />
                <div>
                  <button
                    className="primary-button"
                    disabled={Boolean(working)}
                    onClick={() => void reviewAsCeo('approve')}
                  >
                    <CheckCircle2 /> Genehmigt
                  </button>
                  <button
                    disabled={Boolean(working) || ceoFeedback.trim().length < 2}
                    onClick={() => void reviewAsCeo('revise')}
                  >
                    <RefreshCw /> Nochmal überarbeiten
                  </button>
                  <button
                    className="danger-button"
                    disabled={Boolean(working)}
                    onClick={() => void reviewAsCeo('reject')}
                  >
                    <X /> Verwerfen
                  </button>
                </div>
              </section>
            )}
            <section>
              <h3>
                <ShieldCheck /> Unabhängige Schlussprüfungen
              </h3>
              <div className="decision-review-grid final">
                {detail.reviews.map((review) => (
                  <article key={review.id}>
                    <span
                      className={`state-pill ${statusClass(review.decision === 'approve' ? 'approved' : review.decision === 'reject' ? 'rejected' : 'revise')}`}
                    >
                      Prüfung {review.review_slot} · {review.score}/100
                    </span>
                    <strong>{review.reviewer_model}</strong>
                    <p>{review.summary}</p>
                  </article>
                ))}
                {!detail.reviews.length && (
                  <p className="empty-copy">Die Schlussprüfung folgt erst nach dem Gremiumsquorum.</p>
                )}
              </div>
            </section>
            <section>
              <h3>
                <History /> Protokoll
              </h3>
              <div className="decision-event-list">
                {detail.events.map((event) => (
                  <article key={event.id}>
                    <Clock3 />
                    <div>
                      <strong>{event.title}</strong>
                      {event.detail && <p>{event.detail}</p>}
                      <small>{dateTime(event.created_at)}</small>
                    </div>
                  </article>
                ))}
              </div>
            </section>
            <footer>
              {['failed', 'revise', 'rejected'].includes(detail.status) && (
                <button disabled={Boolean(working)} onClick={() => void decisionAction(detail, 'retry')}>
                  <RefreshCw /> Erneut beraten
                </button>
              )}
              {detail.status === 'applied' && (
                <button
                  className="danger-button"
                  disabled={Boolean(working)}
                  onClick={() => void decisionAction(detail, 'rollback')}
                >
                  <RotateCcw /> Kontrolliert zurückrollen
                </button>
              )}
              <button onClick={() => setDetail(null)}>Schließen</button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}

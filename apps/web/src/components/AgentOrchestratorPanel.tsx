import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  ArrowRight,
  Bot,
  BrainCircuit,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Code2,
  FileSearch,
  Gauge,
  Handshake,
  LoaderCircle,
  MemoryStick,
  PauseCircle,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { api, can, type SessionUser } from '../api/client.js';

type Capability =
  | 'read:studio-metrics'
  | 'read:channel-history'
  | 'read:guidelines'
  | 'read:repository-index'
  | 'propose:strategy'
  | 'propose:content'
  | 'propose:code-change'
  | 'handoff:council';

type OrchestratorSettings = {
  enabled: boolean;
  mode: 'running' | 'draining' | 'stopped';
  memory_enabled: boolean;
  memory_mode: 'full_text' | 'disabled';
  memory_retention_days: number;
  max_memories: number;
  max_concurrent_workflows: number;
  default_step_timeout_seconds: number;
  default_workflow_budget_usd: number;
  daily_budget_usd: number;
  safe_broadcast_mode: boolean;
  stopped_reason: string | null;
  stopped_at: string | null;
  updated_at: string;
};

type Agent = {
  id: 'self-improvement-engineer' | 'growth-analytics' | 'dynamic-content-producer';
  display_name: string;
  role_name: string;
  description: string;
  instructions: string;
  enabled: boolean;
  risk_tier: 'low' | 'medium' | 'high';
  allowed_capabilities: Capability[];
  max_cost_per_run_usd: number;
  rate_limit_per_hour: number;
  updated_at: string;
};

type WorkflowStatus = 'queued' | 'running' | 'awaiting_handoff' | 'completed' | 'blocked' | 'failed' | 'cancelled';

type Workflow = {
  id: string;
  template_key: string;
  template_version: number;
  title: string;
  goal: string;
  status: WorkflowStatus;
  risk_tier: 'low' | 'medium' | 'high';
  handoff_decision_id: string | null;
  budget_limit_usd: number;
  budget_spent_usd: number;
  error: string | null;
  created_at: string;
  completed_at: string | null;
};

type Dashboard = {
  settings: OrchestratorSettings;
  agents: Agent[];
  workflows: Workflow[];
  metrics: {
    queued: number;
    running: number;
    awaiting_handoff: number;
    blocked: number;
    completed_24h: number;
    memory_count: number;
    spend_today: number;
    denied_24h: number;
  };
  recentAudit: Array<{
    id: string;
    workflow_id: string;
    workflow_title: string;
    agent_id: string;
    capability: Capability;
    tool_name: string;
    status: string;
    duration_ms: number | null;
    cost_usd: number;
    denial_reason: string | null;
    created_at: string;
  }>;
};

type Template = {
  key: 'self-improvement-review' | 'growth-cycle' | 'format-lab' | 'clip-strategy';
  version: number;
  title: string;
  description: string;
  riskTier: 'low' | 'medium' | 'high';
  steps: Array<{ key: string; title: string; agentId: string; capability: Capability; purpose: string }>;
};

type WorkflowDetail = Workflow & {
  result: Record<string, unknown>;
  steps: Array<{
    id: string;
    step_key: string;
    position: number;
    title: string;
    purpose: string;
    agent_id: string;
    capability: Capability;
    status: string;
    attempts: number;
    cost_usd: number;
    model: string | null;
    tier: string | null;
    error: string | null;
    output: Record<string, unknown>;
    completed_at: string | null;
  }>;
  audit: Dashboard['recentAudit'];
  memories: Array<{ id: string; kind: string; content: string; trust_score: number; created_at: string }>;
};

type Memory = {
  id: string;
  namespace: string;
  kind: string;
  content: string;
  trust_score: number;
  source_type: string;
  retrieval_version: string;
  created_at: string;
};

const workflowLabels: Record<WorkflowStatus, string> = {
  queued: 'Eingeplant',
  running: 'In Arbeit',
  awaiting_handoff: 'Bereit fürs Gremium',
  completed: 'Abgeschlossen',
  blocked: 'Blockiert',
  failed: 'Fehlgeschlagen',
  cancelled: 'Abgebrochen',
};

const capabilityLabels: Record<Capability, string> = {
  'read:studio-metrics': 'Studio-Metriken lesen',
  'read:channel-history': 'Senderverlauf lesen',
  'read:guidelines': 'Leitlinien lesen',
  'read:repository-index': 'Repository-Index lesen',
  'propose:strategy': 'Strategie vorschlagen',
  'propose:content': 'Inhalt vorschlagen',
  'propose:code-change': 'Codeänderung vorschlagen',
  'handoff:council': 'An Gremium übergeben',
};

function dateTime(value?: string | null) {
  if (!value) return '–';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '–' : date.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
}

function statusClass(status: string) {
  if (['completed', 'allowed'].includes(status)) return 'success';
  if (['blocked', 'failed', 'denied', 'cancelled'].includes(status)) return 'error';
  if (['awaiting_handoff', 'draining'].includes(status)) return 'warning';
  return '';
}

function percent(part: number, total: number) {
  return total > 0 ? Math.min(100, Math.round((part / total) * 100)) : 0;
}

export function AgentOrchestratorPanel({ user }: { user: SessionUser }) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [templateKey, setTemplateKey] = useState<Template['key']>('growth-cycle');
  const [workflowTitle, setWorkflowTitle] = useState('');
  const [workflowGoal, setWorkflowGoal] = useState('');
  const [workflowBudget, setWorkflowBudget] = useState(0.25);
  const [working, setWorking] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const allowed = can(user, 'users:write');

  async function load(silent = false) {
    if (!silent) setWorking('load');
    try {
      const [nextDashboard, nextTemplates] = await Promise.all([
        api<Dashboard>('/api/agent-orchestrator'),
        api<{ templates: Template[] }>('/api/agent-orchestrator/templates'),
      ]);
      setDashboard(nextDashboard);
      setTemplates(nextTemplates.templates);
      if (detail) {
        const nextDetail = await api<WorkflowDetail>(`/api/agent-orchestrator/workflows/${detail.id}`);
        setDetail(nextDetail);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      if (!silent) setWorking('');
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.key === templateKey) ?? templates[0],
    [templateKey, templates],
  );

  async function control(mode: OrchestratorSettings['mode']) {
    if (
      mode === 'stopped' &&
      !window.confirm('Agenten-Not-Aus aktivieren? Laufende Freigaben werden widerrufen. Der Broadcast läuft weiter.')
    )
      return;
    setWorking(`control:${mode}`);
    setError('');
    try {
      await api('/api/agent-orchestrator/control', {
        method: 'POST',
        body: JSON.stringify({
          mode,
          reason: mode === 'stopped' ? 'Manueller Not-Aus durch die Senderleitung' : undefined,
        }),
      });
      setMessage(
        mode === 'running'
          ? 'Agenten-Orchestrierung gestartet.'
          : mode === 'draining'
            ? 'Orchestrierung wird kontrolliert leergefahren.'
            : 'Agenten gestoppt; der Broadcast läuft unverändert weiter.',
      );
      await load(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function createWorkflow() {
    if (!selectedTemplate) return;
    setWorking('create');
    setError('');
    try {
      const workflow = await api<Workflow>('/api/agent-orchestrator/workflows', {
        method: 'POST',
        body: JSON.stringify({
          templateKey: selectedTemplate.key,
          title: workflowTitle.trim() || undefined,
          goal: workflowGoal.trim(),
          budgetLimitUsd: workflowBudget,
        }),
      });
      setCreateOpen(false);
      setWorkflowTitle('');
      setWorkflowGoal('');
      setMessage(`Workflow „${workflow.title}“ wurde kontrolliert eingeplant.`);
      await load(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function saveSettings() {
    if (!dashboard) return;
    setWorking('settings');
    setError('');
    try {
      await api('/api/agent-orchestrator/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          memoryEnabled: dashboard.settings.memory_enabled,
          memoryMode: dashboard.settings.memory_mode,
          memoryRetentionDays: dashboard.settings.memory_retention_days,
          maxMemories: dashboard.settings.max_memories,
          maxConcurrentWorkflows: dashboard.settings.max_concurrent_workflows,
          defaultStepTimeoutSeconds: dashboard.settings.default_step_timeout_seconds,
          defaultWorkflowBudgetUsd: dashboard.settings.default_workflow_budget_usd,
          dailyBudgetUsd: dashboard.settings.daily_budget_usd,
        }),
      });
      setSettingsOpen(false);
      setMessage('Orchestrierungsregeln gespeichert.');
      await load(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function saveAgent() {
    if (!editingAgent) return;
    setWorking('agent');
    setError('');
    try {
      await api(`/api/agent-orchestrator/agents/${editingAgent.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: editingAgent.display_name,
          instructions: editingAgent.instructions,
          enabled: editingAgent.enabled,
          maxCostPerRunUsd: editingAgent.max_cost_per_run_usd,
          rateLimitPerHour: editingAgent.rate_limit_per_hour,
        }),
      });
      setEditingAgent(null);
      setMessage('Agentenarbeitsplatz aktualisiert.');
      await load(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function workflowAction(workflow: Workflow, action: 'cancel' | 'retry' | 'handoff') {
    setWorking(`${action}:${workflow.id}`);
    setError('');
    try {
      const result = await api<{ decisionId?: string }>(`/api/agent-orchestrator/workflows/${workflow.id}/${action}`, {
        method: 'POST',
        body:
          action === 'cancel' ? JSON.stringify({ reason: 'Manuell durch die Senderleitung abgebrochen.' }) : undefined,
      });
      setMessage(
        action === 'handoff'
          ? `Vorschlag an das bestehende Gremium übergeben${result.decisionId ? ` · Beschluss ${result.decisionId.slice(0, 8)}` : ''}.`
          : action === 'retry'
            ? 'Workflow wurde erneut eingeplant.'
            : 'Workflow wurde abgebrochen.',
      );
      setDetail(null);
      await load(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function openMemories() {
    setWorking('memory');
    try {
      const result = await api<{ memories: Memory[] }>('/api/agent-orchestrator/memories?limit=150');
      setMemories(result.memories);
      setMemoryOpen(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function deleteMemory(memory: Memory) {
    if (
      !window.confirm('Diesen Memory-Eintrag aus dem aktiven Kontext entfernen? Das Zugriffsprotokoll bleibt erhalten.')
    )
      return;
    setWorking(`memory:${memory.id}`);
    try {
      await api(`/api/agent-orchestrator/memories/${memory.id}`, { method: 'DELETE' });
      setMemories((current) => current.filter((entry) => entry.id !== memory.id));
      await load(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  if (!allowed) return null;

  return (
    <section className="hub-panel agent-orchestrator-panel">
      <header className="agent-orchestrator-header">
        <div>
          <p className="eyebrow">Sichere Multi-Agent-Orchestrierung</p>
          <h2>
            <BrainCircuit /> Autonomes Senderteam
          </h2>
          <p>
            Agenten analysieren und entwerfen. Reale Änderungen bleiben hinter Gremiumsquorum, Doppelprüfung und
            CEO-Freigabe.
          </p>
        </div>
        <div className="agent-orchestrator-actions">
          <span
            className={`state-pill ${dashboard?.settings.mode === 'running' ? 'success' : dashboard?.settings.mode === 'draining' ? 'warning' : 'error'}`}
          >
            {dashboard?.settings.mode === 'running'
              ? 'Läuft'
              : dashboard?.settings.mode === 'draining'
                ? 'Fährt leer'
                : 'Gestoppt'}
          </span>
          <button title="Memory öffnen" onClick={() => void openMemories()} disabled={!dashboard || Boolean(working)}>
            <MemoryStick size={16} /> Memory
          </button>
          <button onClick={() => setSettingsOpen(true)} disabled={!dashboard}>
            <Settings2 size={16} /> Regeln
          </button>
          <button onClick={() => void load()} disabled={working === 'load'}>
            <RefreshCw size={16} className={working === 'load' ? 'spin' : ''} /> Aktualisieren
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
          <AlertOctagon size={16} /> {error}
        </div>
      )}

      <div className="agent-orchestrator-status-grid">
        <article>
          <Activity />
          <span>Aktive Workflows</span>
          <strong>{dashboard?.metrics.running ?? 0}</strong>
          <small>{dashboard?.metrics.queued ?? 0} warten</small>
        </article>
        <article>
          <Handshake />
          <span>Bereit fürs Gremium</span>
          <strong>{dashboard?.metrics.awaiting_handoff ?? 0}</strong>
          <small>Keine automatische Aktivierung</small>
        </article>
        <button type="button" onClick={() => void openMemories()}>
          <MemoryStick />
          <span>Langleit-Memory</span>
          <strong>{dashboard?.metrics.memory_count ?? 0}</strong>
          <small>PostgreSQL-Volltext · {dashboard?.settings.memory_retention_days ?? 0} Tage</small>
        </button>
        <article>
          <CircleDollarSign />
          <span>Agentenkosten heute</span>
          <strong>{(dashboard?.metrics.spend_today ?? 0).toFixed(4)} USD</strong>
          <small>Limit {(dashboard?.settings.daily_budget_usd ?? 0).toFixed(2)} USD</small>
        </article>
        <article className={(dashboard?.metrics.blocked ?? 0) > 0 ? 'warning' : ''}>
          <ShieldCheck />
          <span>Sicherheitsstatus</span>
          <strong>{dashboard?.metrics.blocked ?? 0}</strong>
          <small>{dashboard?.metrics.denied_24h ?? 0} abgewiesene Zugriffe</small>
        </article>
      </div>

      <div className="agent-orchestrator-controlbar">
        <button
          className="primary-button"
          onClick={() => void control('running')}
          disabled={!dashboard || dashboard.settings.mode === 'running' || Boolean(working)}
        >
          <Play size={16} /> Agenten starten
        </button>
        <button
          onClick={() => void control('draining')}
          disabled={!dashboard || dashboard.settings.mode !== 'running' || Boolean(working)}
        >
          <PauseCircle size={16} /> Kontrolliert leerfahren
        </button>
        <button
          className="danger-button"
          onClick={() => void control('stopped')}
          disabled={!dashboard || dashboard.settings.mode === 'stopped' || Boolean(working)}
        >
          <Square size={15} /> Agenten-Not-Aus
        </button>
        <span>
          <ShieldCheck size={15} /> Not-Aus stoppt Agenten, niemals den laufenden Broadcast.
        </span>
        <button className="primary-button" onClick={() => setCreateOpen(true)} disabled={!dashboard}>
          <Sparkles size={16} /> Neuer Arbeitsauftrag
        </button>
      </div>

      <div className="agent-orchestrator-columns">
        <section>
          <header>
            <div>
              <p className="eyebrow">Rollen mit unveränderlichen Grenzen</p>
              <h3>Drei neue Spezialisten</h3>
            </div>
            <Bot />
          </header>
          <div className="agent-role-grid">
            {(dashboard?.agents ?? []).map((agent) => (
              <button
                key={agent.id}
                className={!agent.enabled ? 'disabled' : ''}
                onClick={() => setEditingAgent({ ...agent })}
              >
                <span className={`agent-role-icon ${agent.risk_tier}`}>
                  {agent.id === 'self-improvement-engineer' ? (
                    <Code2 />
                  ) : agent.id === 'growth-analytics' ? (
                    <Gauge />
                  ) : (
                    <Sparkles />
                  )}
                </span>
                <div>
                  <small>{agent.role_name}</small>
                  <strong>{agent.display_name}</strong>
                  <p>{agent.description}</p>
                  <em>
                    {agent.allowed_capabilities.length} Capabilities · {agent.max_cost_per_run_usd.toFixed(3)}{' '}
                    USD/Aufruf
                  </em>
                </div>
                <Settings2 />
              </button>
            ))}
          </div>
        </section>

        <section>
          <header>
            <div>
              <p className="eyebrow">Abhängigkeiten und Nachvollziehbarkeit</p>
              <h3>Arbeitsabläufe</h3>
            </div>
            <Activity />
          </header>
          <div className="agent-workflow-list">
            {(dashboard?.workflows ?? []).slice(0, 16).map((workflow) => (
              <button
                key={workflow.id}
                onClick={() =>
                  void api<WorkflowDetail>(`/api/agent-orchestrator/workflows/${workflow.id}`)
                    .then(setDetail)
                    .catch((requestError) =>
                      setError(requestError instanceof Error ? requestError.message : String(requestError)),
                    )
                }
              >
                <span className={`workflow-state-dot ${statusClass(workflow.status)}`} />
                <div>
                  <small>{workflow.template_key.replaceAll('-', ' ')}</small>
                  <strong>{workflow.title}</strong>
                  <p>{workflow.goal}</p>
                  <div className="agent-budget-bar">
                    <i style={{ width: `${percent(workflow.budget_spent_usd, workflow.budget_limit_usd)}%` }} />
                  </div>
                </div>
                <span className={`state-pill ${statusClass(workflow.status)}`}>{workflowLabels[workflow.status]}</span>
                <ArrowRight />
              </button>
            ))}
            {!dashboard?.workflows.length && (
              <div className="agent-empty-state">
                <FileSearch />
                <strong>Noch kein Agenten-Workflow</strong>
                <span>Lege einen begrenzten Arbeitsauftrag an. Er startet erst, wenn die Orchestrierung läuft.</span>
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="agent-audit-strip">
        <header>
          <div>
            <p className="eyebrow">Unveränderbares Protokoll</p>
            <h3>Letzte Capability-Ereignisse</h3>
          </div>
          <ShieldCheck />
        </header>
        <div>
          {(dashboard?.recentAudit ?? []).slice(0, 8).map((entry) => (
            <article key={entry.id}>
              <span className={`state-pill ${statusClass(entry.status)}`}>{entry.status}</span>
              <div>
                <strong>{entry.workflow_title}</strong>
                <small>
                  {entry.agent_id} · {capabilityLabels[entry.capability] ?? entry.capability}
                </small>
              </div>
              <time>{dateTime(entry.created_at)}</time>
            </article>
          ))}
          {!dashboard?.recentAudit.length && <p className="empty-copy">Noch keine Capability wurde angefordert.</p>}
        </div>
      </section>

      {createOpen && (
        <div className="studio-modal-backdrop" onMouseDown={() => setCreateOpen(false)}>
          <section className="studio-dialog agent-workflow-dialog" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <p className="eyebrow">Begrenzter, auditierter Auftrag</p>
                <h2>Agenten-Workflow anlegen</h2>
              </div>
              <button aria-label="Schließen" onClick={() => setCreateOpen(false)}>
                <X />
              </button>
            </header>
            <label>
              Workflow-Vorlage
              <select value={templateKey} onChange={(event) => setTemplateKey(event.target.value as Template['key'])}>
                {templates.map((template) => (
                  <option key={template.key} value={template.key}>
                    {template.title}
                  </option>
                ))}
              </select>
              <small>{selectedTemplate?.description}</small>
            </label>
            <div className="agent-template-steps">
              {(selectedTemplate?.steps ?? []).map((step, index) => (
                <span key={step.key}>
                  <b>{index + 1}</b>
                  {step.title}
                </span>
              ))}
            </div>
            <label>
              Titel (optional)
              <input
                value={workflowTitle}
                maxLength={180}
                onChange={(event) => setWorkflowTitle(event.target.value)}
                placeholder={selectedTemplate?.title}
              />
            </label>
            <label>
              Konkretes Ziel
              <textarea
                rows={6}
                value={workflowGoal}
                maxLength={4000}
                onChange={(event) => setWorkflowGoal(event.target.value)}
                placeholder="Welches Problem soll mit welchen überprüfbaren Ergebnissen untersucht werden?"
              />
            </label>
            <label>
              Maximales Workflow-Budget (USD)
              <input
                type="number"
                min={0.01}
                max={25}
                step={0.01}
                value={workflowBudget}
                onChange={(event) => setWorkflowBudget(Number(event.target.value))}
              />
            </label>
            <div className="agent-safety-note">
              <ShieldCheck />
              <span>
                Das Ergebnis ist ein Vorschlag. Übergabe, Gremium, zwei Prüfungen und CEO bleiben getrennte Schritte.
              </span>
            </div>
            <footer>
              <button onClick={() => setCreateOpen(false)}>Abbrechen</button>
              <button
                className="primary-button"
                disabled={workflowGoal.trim().length < 3 || working === 'create'}
                onClick={() => void createWorkflow()}
              >
                {working === 'create' ? <LoaderCircle className="spin" /> : <Sparkles />} Kontrolliert einplanen
              </button>
            </footer>
          </section>
        </div>
      )}

      {settingsOpen && dashboard && (
        <div className="studio-modal-backdrop" onMouseDown={() => setSettingsOpen(false)}>
          <section className="studio-dialog agent-settings-dialog" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <p className="eyebrow">Leitplanken</p>
                <h2>Orchestrierung & Memory</h2>
              </div>
              <button aria-label="Schließen" onClick={() => setSettingsOpen(false)}>
                <X />
              </button>
            </header>
            <div className="settings-automation-grid">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={dashboard.settings.memory_enabled}
                  onChange={(event) =>
                    setDashboard({
                      ...dashboard,
                      settings: {
                        ...dashboard.settings,
                        memory_enabled: event.target.checked,
                        memory_mode: event.target.checked ? 'full_text' : 'disabled',
                      },
                    })
                  }
                />
                <span>
                  <strong>Langzeit-Memory</strong>
                  <small>Nur redigierte, secret-freie Erkenntnisse in PostgreSQL speichern.</small>
                </span>
              </label>
              <div className="toggle-card agent-invariant-card" role="status">
                <ShieldCheck />
                <span>
                  <strong>Broadcast dauerhaft entkoppelt</strong>
                  <small>
                    Diese Sicherheitsinvariante ist nicht abschaltbar: Agentenfehler dürfen die laufende Sendung niemals
                    abbrechen.
                  </small>
                </span>
              </div>
              <label>
                Memory-Aufbewahrung (Tage)
                <input
                  type="number"
                  min={7}
                  max={3650}
                  value={dashboard.settings.memory_retention_days}
                  onChange={(event) =>
                    setDashboard({
                      ...dashboard,
                      settings: { ...dashboard.settings, memory_retention_days: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <label>
                Maximale Memory-Einträge
                <input
                  type="number"
                  min={100}
                  max={1_000_000}
                  value={dashboard.settings.max_memories}
                  onChange={(event) =>
                    setDashboard({
                      ...dashboard,
                      settings: { ...dashboard.settings, max_memories: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <label>
                Parallele Workflows
                <input
                  type="number"
                  min={1}
                  max={4}
                  value={dashboard.settings.max_concurrent_workflows}
                  onChange={(event) =>
                    setDashboard({
                      ...dashboard,
                      settings: { ...dashboard.settings, max_concurrent_workflows: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <label>
                Schritt-Zeitlimit (Sekunden)
                <input
                  type="number"
                  min={30}
                  max={900}
                  value={dashboard.settings.default_step_timeout_seconds}
                  onChange={(event) =>
                    setDashboard({
                      ...dashboard,
                      settings: { ...dashboard.settings, default_step_timeout_seconds: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <label>
                Standardbudget je Workflow (USD)
                <input
                  type="number"
                  min={0.01}
                  max={25}
                  step={0.01}
                  value={dashboard.settings.default_workflow_budget_usd}
                  onChange={(event) =>
                    setDashboard({
                      ...dashboard,
                      settings: { ...dashboard.settings, default_workflow_budget_usd: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <label>
                Agenten-Tagesbudget (USD)
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
            </div>
            <footer>
              <button onClick={() => setSettingsOpen(false)}>Abbrechen</button>
              <button className="primary-button" disabled={working === 'settings'} onClick={() => void saveSettings()}>
                {working === 'settings' ? <LoaderCircle className="spin" /> : <Save />} Speichern
              </button>
            </footer>
          </section>
        </div>
      )}

      {editingAgent && (
        <div className="studio-modal-backdrop" onMouseDown={() => setEditingAgent(null)}>
          <section className="studio-dialog agent-settings-dialog" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <p className="eyebrow">Agentenarbeitsplatz</p>
                <h2>{editingAgent.role_name}</h2>
              </div>
              <button aria-label="Schließen" onClick={() => setEditingAgent(null)}>
                <X />
              </button>
            </header>
            <label>
              Anzeigename
              <input
                value={editingAgent.display_name}
                onChange={(event) => setEditingAgent({ ...editingAgent, display_name: event.target.value })}
              />
            </label>
            <label>
              Verbindlicher Arbeitsauftrag
              <textarea
                rows={7}
                value={editingAgent.instructions}
                onChange={(event) => setEditingAgent({ ...editingAgent, instructions: event.target.value })}
              />
            </label>
            <div className="agent-capability-list">
              {editingAgent.allowed_capabilities.map((capability) => (
                <span key={capability}>
                  <ShieldCheck />
                  {capabilityLabels[capability]}
                </span>
              ))}
              <small>Diese Rollenbegrenzung kann auch über die API nicht überschritten werden.</small>
            </div>
            <div className="settings-automation-grid compact">
              <label>
                Maximum je Aufruf (USD)
                <input
                  type="number"
                  min={0.001}
                  max={25}
                  step={0.01}
                  value={editingAgent.max_cost_per_run_usd}
                  onChange={(event) =>
                    setEditingAgent({ ...editingAgent, max_cost_per_run_usd: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Aufrufe pro Stunde
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={editingAgent.rate_limit_per_hour}
                  onChange={(event) =>
                    setEditingAgent({ ...editingAgent, rate_limit_per_hour: Number(event.target.value) })
                  }
                />
              </label>
            </div>
            <label className="toggle-card">
              <input
                type="checkbox"
                checked={editingAgent.enabled}
                onChange={(event) => setEditingAgent({ ...editingAgent, enabled: event.target.checked })}
              />
              <span>
                <strong>Agent aktiv</strong>
                <small>Deaktivieren verhindert neue Capability-Freigaben.</small>
              </span>
            </label>
            <footer>
              <button onClick={() => setEditingAgent(null)}>Abbrechen</button>
              <button className="primary-button" disabled={working === 'agent'} onClick={() => void saveAgent()}>
                {working === 'agent' ? <LoaderCircle className="spin" /> : <Save />} Agent speichern
              </button>
            </footer>
          </section>
        </div>
      )}

      {detail && (
        <div className="studio-modal-backdrop" onMouseDown={() => setDetail(null)}>
          <section className="studio-dialog agent-workflow-detail" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <p className="eyebrow">{detail.template_key}</p>
                <h2>{detail.title}</h2>
                <span className={`state-pill ${statusClass(detail.status)}`}>{workflowLabels[detail.status]}</span>
              </div>
              <button aria-label="Schließen" onClick={() => setDetail(null)}>
                <X />
              </button>
            </header>
            <p className="agent-workflow-goal">{detail.goal}</p>
            <div className="agent-workflow-meta">
              <span>
                <CircleDollarSign />
                {detail.budget_spent_usd.toFixed(4)} / {detail.budget_limit_usd.toFixed(4)} USD
              </span>
              <span>
                <Clock3 />
                {dateTime(detail.created_at)}
              </span>
              <span>
                <ShieldCheck />
                Risiko {detail.risk_tier}
              </span>
            </div>
            {detail.error && (
              <div className="overview-notice error">
                <AlertOctagon />
                {detail.error}
              </div>
            )}
            <div className="agent-step-timeline">
              {detail.steps.map((step, index) => (
                <article key={step.id} className={statusClass(step.status)}>
                  <span>{index + 1}</span>
                  <div>
                    <small>
                      {step.agent_id} · {capabilityLabels[step.capability]}
                    </small>
                    <strong>{step.title}</strong>
                    <p>{step.purpose}</p>
                    {step.error && <em>{step.error}</em>}
                    {typeof step.output?.summary === 'string' && <blockquote>{step.output.summary}</blockquote>}
                  </div>
                  <aside>
                    <span className={`state-pill ${statusClass(step.status)}`}>{step.status}</span>
                    <small>{step.model || '–'}</small>
                    <small>{step.cost_usd.toFixed(4)} USD</small>
                  </aside>
                </article>
              ))}
            </div>
            <section className="agent-detail-audit">
              <h3>
                <ShieldCheck /> Auditkette
              </h3>
              {detail.audit.slice(-12).map((entry) => (
                <article key={entry.id}>
                  <span className={`state-pill ${statusClass(entry.status)}`}>{entry.status}</span>
                  <strong>{entry.tool_name}</strong>
                  <small>{dateTime(entry.created_at)}</small>
                </article>
              ))}
            </section>
            <footer>
              {['queued', 'running', 'blocked'].includes(detail.status) && (
                <button
                  className="danger-button"
                  disabled={Boolean(working)}
                  onClick={() => void workflowAction(detail, 'cancel')}
                >
                  <Trash2 /> Abbrechen
                </button>
              )}
              {['blocked', 'failed'].includes(detail.status) && (
                <button disabled={Boolean(working)} onClick={() => void workflowAction(detail, 'retry')}>
                  <RotateCcw /> Erneut versuchen
                </button>
              )}
              {detail.status === 'awaiting_handoff' && (
                <button
                  className="primary-button"
                  disabled={Boolean(working)}
                  onClick={() => void workflowAction(detail, 'handoff')}
                >
                  <Handshake /> An Gremium übergeben
                </button>
              )}
              {detail.handoff_decision_id && (
                <a className="button primary-button" href={`#/sendegott?decision=${detail.handoff_decision_id}`}>
                  <ArrowRight /> Beschluss öffnen
                </a>
              )}
              <button onClick={() => setDetail(null)}>Schließen</button>
            </footer>
          </section>
        </div>
      )}

      {memoryOpen && (
        <div className="studio-modal-backdrop" onMouseDown={() => setMemoryOpen(false)}>
          <section className="studio-dialog agent-memory-dialog" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <p className="eyebrow">Redigiertes Langzeitgedächtnis</p>
                <h2>Memory & RAG</h2>
              </div>
              <button aria-label="Schließen" onClick={() => setMemoryOpen(false)}>
                <X />
              </button>
            </header>
            <div className="agent-memory-list">
              {memories.map((memory) => (
                <article key={memory.id}>
                  <span className="state-pill">{memory.kind}</span>
                  <div>
                    <strong>{memory.namespace}</strong>
                    <p>{memory.content}</p>
                    <small>
                      {memory.source_type} · {memory.retrieval_version} · Vertrauen {memory.trust_score}/100 ·{' '}
                      {dateTime(memory.created_at)}
                    </small>
                  </div>
                  <button
                    className="icon-button ghost-button"
                    title="Aus aktivem Memory entfernen"
                    disabled={Boolean(working)}
                    onClick={() => void deleteMemory(memory)}
                  >
                    <Trash2 />
                  </button>
                </article>
              ))}
              {!memories.length && <p className="empty-copy">Noch keine redigierten Memory-Einträge vorhanden.</p>}
            </div>
            <footer>
              <span>
                <ShieldCheck /> Secrets werden nicht gespeichert; Zugriffe bleiben im Audit erhalten.
              </span>
              <button onClick={() => setMemoryOpen(false)}>Schließen</button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}

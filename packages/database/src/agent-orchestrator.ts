import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import { query, transaction } from './index.js';

const AGENT_CAPABILITIES = [
  'read:studio-metrics',
  'read:channel-history',
  'read:guidelines',
  'read:repository-index',
  'propose:strategy',
  'propose:content',
  'propose:code-change',
  'handoff:council',
] as const;

const HARD_AGENT_CAPABILITY_LIMITS: Record<AgentRoleId, readonly AgentCapability[]> = {
  'self-improvement-engineer': [
    'read:studio-metrics',
    'read:guidelines',
    'read:repository-index',
    'propose:code-change',
    'handoff:council',
  ],
  'growth-analytics': [
    'read:studio-metrics',
    'read:channel-history',
    'read:guidelines',
    'propose:strategy',
    'handoff:council',
  ],
  'dynamic-content-producer': [
    'read:studio-metrics',
    'read:channel-history',
    'read:guidelines',
    'propose:content',
    'handoff:council',
  ],
};

export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];
export type AgentRiskTier = 'low' | 'medium' | 'high';
export type AgentOrchestratorMode = 'running' | 'draining' | 'stopped';
export type AgentRoleId = 'self-improvement-engineer' | 'growth-analytics' | 'dynamic-content-producer';
export type AgentWorkflowStatus =
  'queued' | 'running' | 'awaiting_handoff' | 'completed' | 'blocked' | 'failed' | 'cancelled';
export type AgentStepStatus = 'pending' | 'running' | 'completed' | 'blocked' | 'failed' | 'cancelled';
export interface AgentMemoryCandidate {
  kind: 'fact' | 'decision' | 'guideline' | 'outcome' | 'lesson';
  content: string;
  sourceType: string;
  sourceId?: string | null;
  trustScore: number;
  metadata?: Record<string, unknown>;
}
export interface AgentWorkOutput {
  summary: string;
  findings: Array<{ title: string; detail: string; evidenceIds: string[]; confidence: number }>;
  proposals: Array<{
    title: string;
    detail: string;
    expectedImpact: string;
    risk: string;
    verification: string[];
  }>;
  evidenceRequests: string[];
  nextActions: string[];
  confidence: number;
  memoryCandidates: AgentMemoryCandidate[];
}
export interface MemoryDocument {
  id: string;
  namespace: string;
  kind: AgentMemoryCandidate['kind'];
  content: string;
  metadata: Record<string, unknown>;
  trustScore: number;
  createdAt: string;
}

function createCapabilityToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashCapabilityToken(token) };
}

function hashCapabilityToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function stablePayloadHash(value: unknown) {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function redactAgentPayload(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[DEPTH_LIMIT]';
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => redactAgentPayload(entry, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([key, entry]) => [
          key,
          /(secret|token|password|authorization|cookie|api.?key)/i.test(key)
            ? '[REDACTED]'
            : redactAgentPayload(entry, depth + 1),
        ]),
    );
  }
  if (typeof value === 'string')
    return value.replace(/\b(sk-|ghp_|github_pat_)[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]').slice(0, 24_000);
  return value;
}

export interface AgentOrchestratorSettings extends QueryResultRow {
  id: boolean;
  enabled: boolean;
  mode: AgentOrchestratorMode;
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
  updated_by: string | null;
  updated_at: string;
}

export interface AgentOrchestratorAgent extends QueryResultRow {
  id: AgentRoleId;
  display_name: string;
  role_name: string;
  description: string;
  instructions: string;
  enabled: boolean;
  risk_tier: AgentRiskTier;
  allowed_capabilities: AgentCapability[];
  max_cost_per_run_usd: number;
  rate_limit_per_hour: number;
  updated_by: string | null;
  updated_at: string;
}

export interface AgentWorkflow extends QueryResultRow {
  id: string;
  template_key: string;
  template_version: number;
  title: string;
  goal: string;
  source: 'manual' | 'automatic' | 'council' | 'audience' | 'system';
  status: AgentWorkflowStatus;
  risk_tier: AgentRiskTier;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  requested_by: string | null;
  requested_by_system: string | null;
  parent_workflow_id: string | null;
  handoff_decision_id: string | null;
  budget_limit_usd: number;
  budget_spent_usd: number;
  error: string | null;
  cancellation_reason: string | null;
  locked_at: string | null;
  locked_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentWorkflowStep extends QueryResultRow {
  id: string;
  workflow_id: string;
  step_key: string;
  position: number;
  title: string;
  purpose: string;
  agent_id: AgentRoleId;
  capability: AgentCapability;
  depends_on: string[];
  status: AgentStepStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  attempts: number;
  timeout_seconds: number;
  cost_usd: number;
  model: string | null;
  tier: string | null;
  error: string | null;
  locked_at: string | null;
  locked_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentStepClaim extends AgentWorkflowStep {
  workflow_title: string;
  workflow_goal: string;
  workflow_input: Record<string, unknown>;
  workflow_risk_tier: AgentRiskTier;
  workflow_budget_limit_usd: number;
  workflow_budget_spent_usd: number;
  agent_display_name: string;
  agent_role_name: string;
  agent_description: string;
  agent_instructions: string;
  agent_allowed_capabilities: AgentCapability[];
  agent_max_cost_per_run_usd: number;
  agent_rate_limit_per_hour: number;
}

export interface AgentMemory extends QueryResultRow {
  id: string;
  namespace: string;
  kind: AgentMemoryCandidate['kind'];
  content: string;
  content_hash: string;
  metadata: Record<string, unknown>;
  source_type: string;
  source_id: string | null;
  trust_score: number;
  sensitivity: 'public' | 'internal' | 'restricted';
  retrieval_version: string;
  superseded_by: string | null;
  expires_at: string | null;
  deleted_at: string | null;
  created_by_workflow_id: string | null;
  created_at: string;
  updated_at: string;
  relevance_score?: number;
}

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function settingsRow(row: AgentOrchestratorSettings) {
  return {
    ...row,
    default_workflow_budget_usd: asNumber(row.default_workflow_budget_usd),
    daily_budget_usd: asNumber(row.daily_budget_usd),
  };
}

function agentRow(row: AgentOrchestratorAgent) {
  return {
    ...row,
    allowed_capabilities: Array.isArray(row.allowed_capabilities) ? row.allowed_capabilities : [],
    max_cost_per_run_usd: asNumber(row.max_cost_per_run_usd),
  };
}

function workflowRow(row: AgentWorkflow) {
  return {
    ...row,
    budget_limit_usd: asNumber(row.budget_limit_usd),
    budget_spent_usd: asNumber(row.budget_spent_usd),
  };
}

function stepRow<T extends AgentWorkflowStep>(row: T) {
  return { ...row, cost_usd: asNumber(row.cost_usd) };
}

function assertCapabilities(value: unknown): AgentCapability[] {
  if (!Array.isArray(value)) throw new Error('Capabilities müssen als Liste angegeben werden.');
  const allowed = new Set<string>(AGENT_CAPABILITIES);
  const capabilities = [...new Set(value.filter((entry): entry is string => typeof entry === 'string'))];
  if (!capabilities.length || capabilities.some((entry) => !allowed.has(entry))) {
    throw new Error('Mindestens eine gültige Agenten-Capability ist erforderlich.');
  }
  return capabilities as AgentCapability[];
}

export async function getAgentOrchestratorSettings() {
  const row = (await query<AgentOrchestratorSettings>('select * from agent_orchestrator_settings where id=true'))
    .rows[0];
  if (!row) throw new Error('Agenten-Orchestrierung ist noch nicht migriert.');
  return settingsRow(row);
}

export async function updateAgentOrchestratorSettings(
  input: Partial<{
    memoryEnabled: boolean;
    memoryMode: 'full_text' | 'disabled';
    memoryRetentionDays: number;
    maxMemories: number;
    maxConcurrentWorkflows: number;
    defaultStepTimeoutSeconds: number;
    defaultWorkflowBudgetUsd: number;
    dailyBudgetUsd: number;
  }>,
  actorUserId?: string | null,
) {
  const row = (
    await query<AgentOrchestratorSettings>(
      `update agent_orchestrator_settings set
       memory_enabled=coalesce($1,memory_enabled),memory_mode=coalesce($2,memory_mode),
       memory_retention_days=coalesce($3,memory_retention_days),max_memories=coalesce($4,max_memories),
       max_concurrent_workflows=coalesce($5,max_concurrent_workflows),
       default_step_timeout_seconds=coalesce($6,default_step_timeout_seconds),
       default_workflow_budget_usd=coalesce($7,default_workflow_budget_usd),
       daily_budget_usd=coalesce($8,daily_budget_usd),updated_by=$9,updated_at=now()
       where id=true returning *`,
      [
        input.memoryEnabled ?? null,
        input.memoryMode ?? null,
        input.memoryRetentionDays ?? null,
        input.maxMemories ?? null,
        input.maxConcurrentWorkflows ?? null,
        input.defaultStepTimeoutSeconds ?? null,
        input.defaultWorkflowBudgetUsd ?? null,
        input.dailyBudgetUsd ?? null,
        actorUserId ?? null,
      ],
    )
  ).rows[0]!;
  return settingsRow(row);
}

export async function controlAgentOrchestrator(
  mode: AgentOrchestratorMode,
  input: { reason?: string | null; actorUserId?: string | null } = {},
) {
  return transaction(async (client) => {
    const reason = input.reason?.replace(/\s+/g, ' ').trim().slice(0, 500) || null;
    const enabled = mode !== 'stopped';
    const settings = (
      await client.query<AgentOrchestratorSettings>(
        `update agent_orchestrator_settings set enabled=$1,mode=$2,
         stopped_reason=case when $2='stopped' then coalesce($3,'Manuell gestoppt') else null end,
         stopped_at=case when $2='stopped' then now() else null end,
         updated_by=$4,updated_at=now() where id=true returning *`,
        [enabled, mode, reason, input.actorUserId ?? null],
      )
    ).rows[0]!;
    if (mode === 'stopped') {
      await client.query(
        `update agent_capability_grants set status='revoked',revoked_at=now(),
         revocation_reason=coalesce($1,'Globaler Agenten-Not-Aus') where status='issued'`,
        [reason],
      );
      await client.query(
        `update agent_workflow_steps set status='blocked',error=coalesce($1,'Agenten-Orchestrierung gestoppt'),
         locked_at=null,locked_by=null,updated_at=now() where status='running'`,
        [reason],
      );
      await client.query(
        `update agent_workflows set status='blocked',error=coalesce($1,'Agenten-Orchestrierung gestoppt'),
         locked_at=null,locked_by=null,updated_at=now() where status='running'`,
        [reason],
      );
    }
    return settingsRow(settings);
  });
}

export async function settleAgentOrchestratorDrain() {
  return transaction(async (client) => {
    const settings = (
      await client.query<AgentOrchestratorSettings>(
        "select * from agent_orchestrator_settings where id=true and mode='draining' for update",
      )
    ).rows[0];
    if (!settings) return null;
    const running = asNumber(
      (
        await client.query<{ count: number }>(
          "select count(*)::int count from agent_workflow_steps where status='running'",
        )
      ).rows[0]?.count,
    );
    if (running > 0) return settingsRow(settings);
    return settingsRow(
      (
        await client.query<AgentOrchestratorSettings>(
          `update agent_orchestrator_settings set enabled=false,mode='stopped',stopped_reason='Kontrolliert leergefahren',
           stopped_at=now(),updated_at=now() where id=true returning *`,
        )
      ).rows[0]!,
    );
  });
}

export async function listAgentOrchestratorAgents() {
  return (
    await query<AgentOrchestratorAgent>('select * from agent_orchestrator_agents order by risk_tier desc,role_name')
  ).rows.map(agentRow);
}

export async function updateAgentOrchestratorAgent(
  id: AgentRoleId,
  input: Partial<{
    displayName: string;
    instructions: string;
    enabled: boolean;
    allowedCapabilities: AgentCapability[];
    maxCostPerRunUsd: number;
    rateLimitPerHour: number;
  }>,
  actorUserId?: string | null,
) {
  const capabilities = input.allowedCapabilities ? assertCapabilities(input.allowedCapabilities) : null;
  if (capabilities?.some((capability) => !HARD_AGENT_CAPABILITY_LIMITS[id].includes(capability))) {
    throw new Error('Die gewählte Capability liegt außerhalb der unveränderlichen Rollenbegrenzung.');
  }
  const row = (
    await query<AgentOrchestratorAgent>(
      `update agent_orchestrator_agents set display_name=coalesce($2,display_name),
       instructions=coalesce($3,instructions),enabled=coalesce($4,enabled),
       allowed_capabilities=coalesce($5::jsonb,allowed_capabilities),
       max_cost_per_run_usd=coalesce($6,max_cost_per_run_usd),rate_limit_per_hour=coalesce($7,rate_limit_per_hour),
       updated_by=$8,updated_at=now() where id=$1 returning *`,
      [
        id,
        input.displayName?.replace(/\s+/g, ' ').trim().slice(0, 100) || null,
        input.instructions?.trim().slice(0, 6000) || null,
        input.enabled ?? null,
        capabilities ? JSON.stringify(capabilities) : null,
        input.maxCostPerRunUsd ?? null,
        input.rateLimitPerHour ?? null,
        actorUserId ?? null,
      ],
    )
  ).rows[0];
  if (!row) throw new Error('Agent nicht gefunden.');
  return agentRow(row);
}

export async function createAgentWorkflow(input: {
  templateKey: string;
  templateVersion: number;
  title: string;
  goal: string;
  context?: Record<string, unknown>;
  riskTier: AgentRiskTier;
  steps: Array<{
    key: string;
    position: number;
    title: string;
    purpose: string;
    agentId: AgentRoleId;
    capability: AgentCapability;
    dependsOn?: string[];
    timeoutSeconds?: number;
  }>;
  source?: AgentWorkflow['source'];
  requestedBy?: string | null;
  requestedBySystem?: string | null;
  budgetLimitUsd?: number;
  parentWorkflowId?: string | null;
}) {
  const goal = input.goal.replace(/\s+/g, ' ').trim();
  const title = input.title.replace(/\s+/g, ' ').trim().slice(0, 180);
  if (goal.length < 3 || goal.length > 4000 || title.length < 2 || !input.steps.length || input.steps.length > 20) {
    throw new Error('Workflow-Plan ist ungültig.');
  }
  return transaction(async (client) => {
    const settings = settingsRow(
      (
        await client.query<AgentOrchestratorSettings>(
          'select * from agent_orchestrator_settings where id=true for share',
        )
      ).rows[0]!,
    );
    const requestedBudget = input.budgetLimitUsd ?? settings.default_workflow_budget_usd;
    const budget = Math.max(0.001, Math.min(settings.daily_budget_usd, 25, requestedBudget));
    const workflow = (
      await client.query<AgentWorkflow>(
        `insert into agent_workflows(
           template_key,template_version,title,goal,source,risk_tier,input,requested_by,requested_by_system,
           parent_workflow_id,budget_limit_usd
         ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
        [
          input.templateKey,
          input.templateVersion,
          title,
          goal,
          input.source ?? 'manual',
          input.riskTier,
          { goal, context: redactAgentPayload(input.context ?? {}) },
          input.requestedBy ?? null,
          input.requestedBySystem ?? null,
          input.parentWorkflowId ?? null,
          budget,
        ],
      )
    ).rows[0]!;
    for (const step of input.steps) {
      if (!AGENT_CAPABILITIES.includes(step.capability)) throw new Error('Workflow enthält eine ungültige Capability.');
      await client.query(
        `insert into agent_workflow_steps(
           workflow_id,step_key,position,title,purpose,agent_id,capability,depends_on,input,timeout_seconds
         ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          workflow.id,
          step.key,
          step.position,
          step.title,
          step.purpose,
          step.agentId,
          step.capability,
          step.dependsOn ?? [],
          { goal, workflowContext: redactAgentPayload(input.context ?? {}) },
          Math.max(30, Math.min(900, step.timeoutSeconds ?? settings.default_step_timeout_seconds)),
        ],
      );
    }
    return workflowRow(workflow);
  });
}

export async function listAgentWorkflows(limit = 80) {
  return (
    await query<AgentWorkflow>(
      `select workflow.* from agent_workflows workflow order by workflow.created_at desc limit $1`,
      [Math.max(1, Math.min(300, limit))],
    )
  ).rows.map(workflowRow);
}

export async function getAgentWorkflow(id: string) {
  const workflow = (await query<AgentWorkflow>('select * from agent_workflows where id=$1', [id])).rows[0];
  if (!workflow) return null;
  const [steps, grants, audit, memories] = await Promise.all([
    query<AgentWorkflowStep>('select * from agent_workflow_steps where workflow_id=$1 order by position', [id]),
    query(
      `select id,workflow_step_id,agent_id,capability,status,max_invocations,invocations,budget_limit_usd,
       expires_at,consumed_at,revoked_at,revocation_reason,created_at
       from agent_capability_grants where workflow_id=$1 order by created_at desc`,
      [id],
    ),
    query(
      `select id,workflow_step_id,agent_id,capability,tool_name,status,input_hash,output_hash,input_summary,
       output_summary,duration_ms,cost_usd,denial_reason,previous_entry_hash,entry_hash,created_at
       from agent_tool_audit where workflow_id=$1 order by created_at,id`,
      [id],
    ),
    query<AgentMemory>(
      `select * from agent_memories where created_by_workflow_id=$1 and deleted_at is null order by created_at desc`,
      [id],
    ),
  ]);
  return {
    ...workflowRow(workflow),
    steps: steps.rows.map(stepRow),
    grants: grants.rows.map((entry) => ({ ...entry, budget_limit_usd: asNumber(entry.budget_limit_usd) })),
    audit: audit.rows.map((entry) => ({ ...entry, cost_usd: asNumber(entry.cost_usd) })),
    memories: memories.rows,
  };
}

export async function getAgentOrchestratorDashboard() {
  const [settings, agents, workflows, metrics, recentAudit] = await Promise.all([
    getAgentOrchestratorSettings(),
    listAgentOrchestratorAgents(),
    listAgentWorkflows(60),
    query<{
      queued: number;
      running: number;
      awaiting_handoff: number;
      blocked: number;
      completed_24h: number;
      memory_count: number;
      spend_today: number;
      denied_24h: number;
    }>(
      `select
       (select count(*)::int from agent_workflows where status='queued') queued,
       (select count(*)::int from agent_workflows where status='running') running,
       (select count(*)::int from agent_workflows where status='awaiting_handoff') awaiting_handoff,
       (select count(*)::int from agent_workflows where status='blocked') blocked,
       (select count(*)::int from agent_workflows where status='completed' and completed_at>now()-interval '24 hours') completed_24h,
       (select count(*)::int from agent_memories where deleted_at is null and (expires_at is null or expires_at>now())) memory_count,
       (select coalesce(sum(cost_usd),0)::float8 from agent_tool_audit where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') spend_today,
       (select count(*)::int from agent_tool_audit where status='denied' and created_at>now()-interval '24 hours') denied_24h`,
    ),
    query(
      `select audit.id,audit.workflow_id,audit.agent_id,audit.capability,audit.tool_name,audit.status,
       audit.duration_ms,audit.cost_usd,audit.denial_reason,audit.created_at,workflow.title workflow_title
       from agent_tool_audit audit join agent_workflows workflow on workflow.id=audit.workflow_id
       order by audit.created_at desc limit 30`,
    ),
  ]);
  return {
    settings,
    agents,
    workflows,
    metrics: {
      ...metrics.rows[0],
      spend_today: asNumber(metrics.rows[0]?.spend_today),
    },
    recentAudit: recentAudit.rows.map((entry) => ({ ...entry, cost_usd: asNumber(entry.cost_usd) })),
  };
}

export async function releaseStaleAgentSteps() {
  return transaction(async (client) => {
    const rows = (
      await client.query<{ id: string; workflow_id: string; attempts: number }>(
        `select step.id,step.workflow_id,step.attempts from agent_workflow_steps step
         where step.status='running' and step.locked_at<now()-make_interval(secs => step.timeout_seconds+60)
         for update skip locked`,
      )
    ).rows;
    for (const row of rows) {
      const status = row.attempts >= 3 ? 'blocked' : 'pending';
      await client.query(
        `update agent_workflow_steps set status=$2,error='Zeitüberschreitung; Capability widerrufen',
         locked_at=null,locked_by=null,updated_at=now() where id=$1`,
        [row.id, status],
      );
      await client.query(
        `update agent_capability_grants set status='revoked',revoked_at=now(),revocation_reason='Schritt-Zeitüberschreitung'
         where workflow_step_id=$1 and status='issued'`,
        [row.id],
      );
      if (status === 'blocked') {
        await client.query(
          `update agent_workflows set status='blocked',error='Ein Agentenschritt ist wiederholt abgelaufen.',
           locked_at=null,locked_by=null,updated_at=now() where id=$1`,
          [row.workflow_id],
        );
      }
    }
    return rows.length;
  });
}

export async function claimReadyAgentStep(workerId: string) {
  return transaction(async (client) => {
    const settings = (
      await client.query<AgentOrchestratorSettings>('select * from agent_orchestrator_settings where id=true for share')
    ).rows[0];
    if (!settings?.enabled || settings.mode !== 'running') return null;
    const runningWorkflows = asNumber(
      (await client.query<{ count: number }>("select count(*)::int count from agent_workflows where status='running'"))
        .rows[0]?.count,
    );
    const candidate = (
      await client.query<AgentStepClaim>(
        `select step.*,
         workflow.title workflow_title,workflow.goal workflow_goal,workflow.input workflow_input,
         workflow.risk_tier workflow_risk_tier,workflow.budget_limit_usd workflow_budget_limit_usd,
         workflow.budget_spent_usd workflow_budget_spent_usd,
         agent.display_name agent_display_name,agent.role_name agent_role_name,
         agent.description agent_description,agent.instructions agent_instructions,
         agent.allowed_capabilities agent_allowed_capabilities,
         agent.max_cost_per_run_usd agent_max_cost_per_run_usd,
         agent.rate_limit_per_hour agent_rate_limit_per_hour
         from agent_workflow_steps step
         join agent_workflows workflow on workflow.id=step.workflow_id
         join agent_orchestrator_agents agent on agent.id=step.agent_id
         where step.status='pending' and workflow.status in ('queued','running') and agent.enabled=true
           and workflow.budget_spent_usd<workflow.budget_limit_usd
           and not exists(select 1 from agent_workflow_steps active
             where active.workflow_id=workflow.id and active.status='running')
           and not exists(
             select 1 from unnest(step.depends_on) dependency
             where not exists(select 1 from agent_workflow_steps predecessor
               where predecessor.workflow_id=workflow.id and predecessor.step_key=dependency
                 and predecessor.status='completed')
           )
           and (workflow.status='running' or $1::int<$2::int)
         order by case workflow.risk_tier when 'low' then 0 when 'medium' then 1 else 2 end,
           workflow.created_at,step.position
         for update of step,workflow skip locked limit 1`,
        [runningWorkflows, settings.max_concurrent_workflows],
      )
    ).rows[0];
    if (!candidate) return null;
    const step = (
      await client.query<AgentStepClaim>(
        `update agent_workflow_steps set status='running',attempts=attempts+1,locked_at=now(),locked_by=$2,
         started_at=coalesce(started_at,now()),error=null,updated_at=now() where id=$1 returning *`,
        [candidate.id, workerId],
      )
    ).rows[0]!;
    await client.query(
      `update agent_workflows set status='running',started_at=coalesce(started_at,now()),
       locked_at=now(),locked_by=$2,error=null,updated_at=now() where id=$1`,
      [candidate.workflow_id, workerId],
    );
    return stepRow({ ...candidate, ...step });
  });
}

export async function issueAgentCapabilityGrant(claim: AgentStepClaim) {
  const issued = createCapabilityToken();
  return transaction(async (client) => {
    const settings = (
      await client.query<AgentOrchestratorSettings>(
        'select * from agent_orchestrator_settings where id=true for update',
      )
    ).rows[0];
    if (!settings?.enabled || settings.mode !== 'running') {
      throw new Error('Die Agenten-Orchestrierung wurde angehalten.');
    }
    const locked = (
      await client.query<{
        step_status: AgentStepStatus;
        workflow_status: AgentWorkflowStatus;
        workflow_budget_limit_usd: number;
        workflow_budget_spent_usd: number;
        allowed_capabilities: AgentCapability[];
        max_cost_per_run_usd: number;
        rate_limit_per_hour: number;
        timeout_seconds: number;
      }>(
        `select step.status step_status,workflow.status workflow_status,
         workflow.budget_limit_usd workflow_budget_limit_usd,workflow.budget_spent_usd workflow_budget_spent_usd,
         agent.allowed_capabilities,agent.max_cost_per_run_usd,agent.rate_limit_per_hour,step.timeout_seconds
         from agent_workflow_steps step join agent_workflows workflow on workflow.id=step.workflow_id
         join agent_orchestrator_agents agent on agent.id=step.agent_id
         where step.id=$1 and step.workflow_id=$2 and step.agent_id=$3 for update of step,workflow,agent`,
        [claim.id, claim.workflow_id, claim.agent_id],
      )
    ).rows[0];
    if (!locked || locked.step_status !== 'running' || locked.workflow_status !== 'running') {
      throw new Error('Der Agentenschritt ist nicht ausführbar.');
    }
    const capabilities = assertCapabilities(locked.allowed_capabilities);
    if (!capabilities.includes(claim.capability))
      throw new Error('Capability ist für diesen Agenten nicht freigegeben.');
    const recent = asNumber(
      (
        await client.query<{ count: number }>(
          `select count(*)::int count from agent_capability_grants
           where agent_id=$1 and created_at>now()-interval '1 hour'`,
          [claim.agent_id],
        )
      ).rows[0]?.count,
    );
    if (recent >= locked.rate_limit_per_hour) throw new Error('Agenten-Rate-Limit erreicht.');
    const spentToday = asNumber(
      (
        await client.query<{ spent: number }>(
          `select coalesce(sum(cost_usd),0)::float8 spent from agent_tool_audit
           where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'`,
        )
      ).rows[0]?.spent,
    );
    const dailyRemaining = asNumber(settings.daily_budget_usd) - spentToday;
    const remaining = asNumber(locked.workflow_budget_limit_usd) - asNumber(locked.workflow_budget_spent_usd);
    const budget = Math.min(remaining, dailyRemaining, asNumber(locked.max_cost_per_run_usd));
    if (dailyRemaining < 0.001) throw new Error('Globales Agenten-Tagesbudget ist ausgeschöpft.');
    if (budget < 0.001) throw new Error('Workflow-Budget ist ausgeschöpft.');
    await client.query(
      `update agent_capability_grants set status='revoked',revoked_at=now(),revocation_reason='Durch neuen Versuch ersetzt'
       where workflow_step_id=$1 and status='issued'`,
      [claim.id],
    );
    const grant = (
      await client.query<{ id: string; expires_at: string; budget_limit_usd: number }>(
        `insert into agent_capability_grants(
           workflow_id,workflow_step_id,agent_id,capability,resource_scope,token_hash,budget_limit_usd,expires_at
         ) values($1,$2,$3,$4,$5,$6,$7,now()+make_interval(secs => $8::int))
         returning id,expires_at,budget_limit_usd`,
        [
          claim.workflow_id,
          claim.id,
          claim.agent_id,
          claim.capability,
          { workflowId: claim.workflow_id, stepId: claim.id, readOnly: true, proposalOnly: true },
          issued.tokenHash,
          budget,
          Math.min(960, locked.timeout_seconds + 30),
        ],
      )
    ).rows[0]!;
    return { ...grant, budget_limit_usd: asNumber(grant.budget_limit_usd), token: issued.token };
  });
}

export async function consumeAgentCapabilityGrant(input: {
  token: string;
  workflowId: string;
  stepId: string;
  agentId: AgentRoleId;
  capability: AgentCapability;
}) {
  const tokenHash = hashCapabilityToken(input.token);
  return transaction(async (client) => {
    const grant = (
      await client.query<{
        id: string;
        status: string;
        workflow_id: string;
        workflow_step_id: string;
        agent_id: AgentRoleId;
        capability: AgentCapability;
        invocations: number;
        max_invocations: number;
        expires_at: string;
        budget_limit_usd: number;
      }>('select * from agent_capability_grants where token_hash=$1 for update', [tokenHash])
    ).rows[0];
    if (!grant) throw new Error('Capability-Token ist unbekannt.');
    if (grant.status !== 'issued') throw new Error('Capability-Token ist nicht mehr aktiv.');
    if (new Date(grant.expires_at).getTime() <= Date.now()) {
      await client.query("update agent_capability_grants set status='expired' where id=$1", [grant.id]);
      throw new Error('Capability-Token ist abgelaufen.');
    }
    if (
      grant.workflow_id !== input.workflowId ||
      grant.workflow_step_id !== input.stepId ||
      grant.agent_id !== input.agentId ||
      grant.capability !== input.capability
    ) {
      throw new Error('Capability-Token passt nicht zum angeforderten Schritt.');
    }
    const invocations = grant.invocations + 1;
    if (invocations > grant.max_invocations) throw new Error('Capability-Token wurde bereits verbraucht.');
    await client.query(
      `update agent_capability_grants set invocations=$2,status=case when $2>=max_invocations then 'consumed' else status end,
       consumed_at=case when $2>=max_invocations then now() else consumed_at end where id=$1`,
      [grant.id, invocations],
    );
    return { ...grant, budget_limit_usd: asNumber(grant.budget_limit_usd), invocations };
  });
}

export async function recordAgentToolAudit(input: {
  workflowId: string;
  workflowStepId?: string | null;
  capabilityGrantId?: string | null;
  agentId: AgentRoleId;
  capability: AgentCapability;
  toolName: string;
  status: 'requested' | 'allowed' | 'denied' | 'completed' | 'failed' | 'timed_out';
  input: unknown;
  output?: unknown;
  durationMs?: number | null;
  costUsd?: number;
  denialReason?: string | null;
}) {
  return transaction(async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [input.workflowId]);
    const previous = (
      await client.query<{ entry_hash: string }>(
        'select entry_hash from agent_tool_audit where workflow_id=$1 order by created_at desc,id desc limit 1',
        [input.workflowId],
      )
    ).rows[0]?.entry_hash;
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const inputSummary = redactAgentPayload(input.input);
    const outputSummary = redactAgentPayload(input.output ?? {});
    const inputHash = stablePayloadHash(inputSummary);
    const outputHash = input.output === undefined ? null : stablePayloadHash(outputSummary);
    const entryHash = stablePayloadHash({
      id,
      workflowId: input.workflowId,
      workflowStepId: input.workflowStepId ?? null,
      agentId: input.agentId,
      capability: input.capability,
      toolName: input.toolName,
      status: input.status,
      inputHash,
      outputHash,
      previous: previous ?? null,
      createdAt,
    });
    return (
      await client.query(
        `insert into agent_tool_audit(
           id,workflow_id,workflow_step_id,capability_grant_id,agent_id,capability,tool_name,status,
           input_hash,output_hash,input_summary,output_summary,duration_ms,cost_usd,denial_reason,
           previous_entry_hash,entry_hash,created_at
         ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning *`,
        [
          id,
          input.workflowId,
          input.workflowStepId ?? null,
          input.capabilityGrantId ?? null,
          input.agentId,
          input.capability,
          input.toolName.slice(0, 160),
          input.status,
          inputHash,
          outputHash,
          inputSummary,
          outputSummary,
          input.durationMs == null ? null : Math.max(0, Math.min(3_600_000, Math.round(input.durationMs))),
          Math.max(0, input.costUsd ?? 0),
          input.denialReason?.slice(0, 1000) ?? null,
          previous ?? null,
          entryHash,
          createdAt,
        ],
      )
    ).rows[0];
  });
}

export async function completeAgentStep(input: {
  claim: AgentStepClaim;
  grantId: string;
  output: AgentWorkOutput;
  model: string;
  tier: string;
  costUsd: number;
}) {
  return transaction(async (client) => {
    const step = (
      await client.query<AgentWorkflowStep>(
        "select * from agent_workflow_steps where id=$1 and status='running' for update",
        [input.claim.id],
      )
    ).rows[0];
    if (!step) return null;
    const workflow = (
      await client.query<AgentWorkflow>('select * from agent_workflows where id=$1 for update', [step.workflow_id])
    ).rows[0]!;
    const grant = (
      await client.query<{ budget_limit_usd: number }>(
        'select budget_limit_usd from agent_capability_grants where id=$1',
        [input.grantId],
      )
    ).rows[0];
    const cost = Math.max(0, asNumber(input.costUsd));
    const workflowRemaining = asNumber(workflow.budget_limit_usd) - asNumber(workflow.budget_spent_usd);
    if (!grant || cost > asNumber(grant.budget_limit_usd) + 0.000001 || cost > workflowRemaining + 0.000001) {
      await client.query(
        `update agent_workflow_steps set status='blocked',cost_usd=$2,error='Agentenschritt überschritt sein Budget',
         locked_at=null,locked_by=null,updated_at=now() where id=$1`,
        [step.id, cost],
      );
      await client.query(
        `update agent_workflows set status='blocked',budget_spent_usd=budget_spent_usd+$2,
         error='Workflow-Budget überschritten',locked_at=null,locked_by=null,updated_at=now() where id=$1`,
        [workflow.id, cost],
      );
      return { status: 'blocked' as const };
    }
    await client.query(
      `update agent_workflow_steps set status='completed',output=$2,cost_usd=$3,model=$4,tier=$5,
       completed_at=now(),locked_at=null,locked_by=null,error=null,updated_at=now() where id=$1`,
      [step.id, redactAgentPayload(input.output), cost, input.model, input.tier],
    );
    await client.query(`update agent_capability_grants set proposal_hash=$2 where id=$1`, [
      input.grantId,
      stablePayloadHash(input.output.proposals),
    ]);
    const remaining = asNumber(
      (
        await client.query<{ count: number }>(
          `select count(*)::int count from agent_workflow_steps where workflow_id=$1 and status='pending'`,
          [workflow.id],
        )
      ).rows[0]?.count,
    );
    const result =
      (
        await client.query<{ result: Record<string, unknown> }>(
          `select coalesce(jsonb_object_agg(step_key,output order by position),'{}'::jsonb) result
         from agent_workflow_steps where workflow_id=$1 and status='completed'`,
          [workflow.id],
        )
      ).rows[0]?.result ?? {};
    const nextStatus: AgentWorkflowStatus =
      remaining > 0 ? 'running' : step.capability === 'handoff:council' ? 'awaiting_handoff' : 'completed';
    await client.query(
      `update agent_workflows set status=$2,result=$3,budget_spent_usd=budget_spent_usd+$4,
       completed_at=case when $2 in ('awaiting_handoff','completed') then now() else completed_at end,
       locked_at=null,locked_by=null,error=null,updated_at=now() where id=$1`,
      [workflow.id, nextStatus, result, cost],
    );
    return { status: nextStatus, remaining };
  });
}

export async function failAgentStep(
  claim: AgentStepClaim,
  error: string,
  input: { transient?: boolean; grantId?: string | null } = {},
) {
  return transaction(async (client) => {
    const step = (
      await client.query<AgentWorkflowStep>('select * from agent_workflow_steps where id=$1 for update', [claim.id])
    ).rows[0];
    if (!step || !['running', 'pending'].includes(step.status)) return null;
    const retry = input.transient !== false && step.attempts < 3;
    const stepStatus: AgentStepStatus = retry ? 'pending' : 'blocked';
    await client.query(
      `update agent_workflow_steps set status=$2,error=$3,locked_at=null,locked_by=null,updated_at=now() where id=$1`,
      [step.id, stepStatus, error.slice(0, 2000)],
    );
    if (input.grantId) {
      await client.query(
        `update agent_capability_grants set status='revoked',revoked_at=now(),revocation_reason=$2
         where id=$1 and status='issued'`,
        [input.grantId, error.slice(0, 500)],
      );
    }
    await client.query(
      `update agent_workflows set status=$2,error=$3,locked_at=null,locked_by=null,updated_at=now() where id=$1`,
      [step.workflow_id, retry ? 'running' : 'blocked', error.slice(0, 2000)],
    );
    return { retry, status: stepStatus };
  });
}

export async function cancelAgentWorkflow(id: string, reason: string, actorUserId?: string | null) {
  return transaction(async (client) => {
    const workflow = (
      await client.query<AgentWorkflow>(
        `update agent_workflows set status='cancelled',cancellation_reason=$2,cancelled_at=now(),
         locked_at=null,locked_by=null,updated_at=now()
         where id=$1 and status not in ('completed','cancelled') returning *`,
        [id, reason.replace(/\s+/g, ' ').trim().slice(0, 1000)],
      )
    ).rows[0];
    if (!workflow) return null;
    await client.query(
      `update agent_workflow_steps set status='cancelled',locked_at=null,locked_by=null,updated_at=now()
       where workflow_id=$1 and status in ('pending','running','blocked')`,
      [id],
    );
    await client.query(
      `update agent_capability_grants set status='revoked',revoked_at=now(),revocation_reason='Workflow abgebrochen'
       where workflow_id=$1 and status='issued'`,
      [id],
    );
    void actorUserId;
    return workflowRow(workflow);
  });
}

export async function retryAgentWorkflow(id: string) {
  return transaction(async (client) => {
    const workflow = (
      await client.query<AgentWorkflow>(
        `update agent_workflows set status='queued',error=null,cancellation_reason=null,
         locked_at=null,locked_by=null,completed_at=null,cancelled_at=null,updated_at=now()
         where id=$1 and status in ('blocked','failed') returning *`,
        [id],
      )
    ).rows[0];
    if (!workflow) return null;
    await client.query(
      `update agent_workflow_steps set status='pending',attempts=0,error=null,locked_at=null,locked_by=null,updated_at=now()
       where workflow_id=$1 and status in ('blocked','failed')`,
      [id],
    );
    await client.query(
      `update agent_capability_grants set status='revoked',revoked_at=now(),revocation_reason='Workflow erneut gestartet'
       where workflow_id=$1 and status='issued'`,
      [id],
    );
    return workflowRow(workflow);
  });
}

function memoryHasSecret(value: string) {
  return (
    /\b(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/.test(value) ||
    /(?:password|passwort|api.?key|client.?secret|authorization)\s*[:=]\s*\S+/i.test(value)
  );
}

export async function storeAgentMemory(input: {
  namespace: string;
  candidate: AgentMemoryCandidate;
  workflowId?: string | null;
  agentId: AgentRoleId;
}) {
  const settings = await getAgentOrchestratorSettings();
  if (!settings.memory_enabled || settings.memory_mode === 'disabled') return null;
  const content = input.candidate.content
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, 24_000);
  if (content.length < 2 || memoryHasSecret(content)) return null;
  const namespace = input.namespace
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .slice(0, 120);
  const contentHash = createHash('sha256').update(content, 'utf8').digest('hex');
  return transaction(async (client) => {
    const memory = (
      await client.query<AgentMemory>(
        `insert into agent_memories(
           namespace,kind,content,content_hash,metadata,source_type,source_id,trust_score,sensitivity,
           expires_at,created_by_workflow_id
         ) values($1,$2,$3,$4,$5,$6,$7,$8,'internal',now()+make_interval(days => $9::int),$10)
         on conflict(namespace,content_hash) do update set
           metadata=agent_memories.metadata||excluded.metadata,
           trust_score=greatest(agent_memories.trust_score,excluded.trust_score),
           expires_at=greatest(agent_memories.expires_at,excluded.expires_at),deleted_at=null,updated_at=now()
         returning *`,
        [
          namespace,
          input.candidate.kind,
          content,
          contentHash,
          redactAgentPayload(input.candidate.metadata ?? {}),
          input.candidate.sourceType.slice(0, 100),
          input.candidate.sourceId?.slice(0, 240) ?? null,
          Math.max(0, Math.min(100, Math.round(input.candidate.trustScore))),
          settings.memory_retention_days,
          input.workflowId ?? null,
        ],
      )
    ).rows[0]!;
    await client.query(
      `insert into agent_memory_access(workflow_id,agent_id,memory_id,access_kind,query_hash,relevance_score)
       values($1,$2,$3,'written',$4,1)`,
      [input.workflowId ?? null, input.agentId, memory.id, stablePayloadHash(content)],
    );
    await client.query(
      `with overflow as (
         select id from agent_memories where deleted_at is null order by created_at desc offset $1
       ) update agent_memories set deleted_at=now(),updated_at=now() where id in(select id from overflow)`,
      [settings.max_memories],
    );
    return memory;
  });
}

export async function retrieveAgentMemories(input: {
  queryText: string;
  namespaces: string[];
  agentId: AgentRoleId;
  workflowId?: string | null;
  workflowStepId?: string | null;
  limit?: number;
}) {
  const settings = await getAgentOrchestratorSettings();
  if (!settings.memory_enabled || settings.memory_mode === 'disabled') return [];
  const queryText = input.queryText.replace(/\s+/g, ' ').trim().slice(0, 1000);
  const namespaces = [...new Set(input.namespaces)].slice(0, 20);
  if (!queryText || !namespaces.length) return [];
  const limit = Math.max(1, Math.min(30, input.limit ?? 10));
  const rows = (
    await query<AgentMemory>(
      `select memory.*,
       (ts_rank_cd(memory.search_document,websearch_to_tsquery('simple',$1))*0.7
        + memory.trust_score::float8/500
        + 0.1/(1+extract(epoch from (now()-memory.created_at))/2592000))::float8 relevance_score
       from agent_memories memory
       where memory.namespace=any($2::text[]) and memory.deleted_at is null
         and memory.superseded_by is null and (memory.expires_at is null or memory.expires_at>now())
         and memory.search_document @@ websearch_to_tsquery('simple',$1)
       order by relevance_score desc,memory.created_at desc limit $3`,
      [queryText, namespaces, limit],
    )
  ).rows;
  if (!rows.length) {
    rows.push(
      ...(
        await query<AgentMemory>(
          `select memory.*,0.05::float8 relevance_score from agent_memories memory
           where memory.namespace=any($1::text[]) and memory.deleted_at is null
             and memory.kind in ('guideline','decision') and (memory.expires_at is null or memory.expires_at>now())
           order by memory.trust_score desc,memory.created_at desc limit $2`,
          [namespaces, Math.min(4, limit)],
        )
      ).rows,
    );
  }
  if (rows.length) {
    await transaction(async (client) => {
      for (const memory of rows) {
        await client.query(
          `insert into agent_memory_access(
             workflow_id,workflow_step_id,agent_id,memory_id,access_kind,query_hash,relevance_score
           ) values($1,$2,$3,$4,'retrieved',$5,$6)`,
          [
            input.workflowId ?? null,
            input.workflowStepId ?? null,
            input.agentId,
            memory.id,
            stablePayloadHash(queryText),
            asNumber(memory.relevance_score),
          ],
        );
      }
    });
  }
  return rows.map((memory) => ({ ...memory, relevance_score: asNumber(memory.relevance_score) }));
}

export async function listAgentMemories(limit = 100) {
  return (
    await query<AgentMemory>(
      `select * from agent_memories where deleted_at is null and (expires_at is null or expires_at>now())
       order by created_at desc limit $1`,
      [Math.max(1, Math.min(500, limit))],
    )
  ).rows;
}

export async function deleteAgentMemory(id: string, actorAgentId: AgentRoleId = 'self-improvement-engineer') {
  return transaction(async (client) => {
    const memory = (
      await client.query<AgentMemory>(
        'update agent_memories set deleted_at=now(),updated_at=now() where id=$1 and deleted_at is null returning *',
        [id],
      )
    ).rows[0];
    if (!memory) return null;
    await client.query(
      `insert into agent_memory_access(agent_id,memory_id,access_kind,query_hash,relevance_score)
       values($1,$2,'deleted',$3,1)`,
      [actorAgentId, memory.id, stablePayloadHash({ id, action: 'delete' })],
    );
    return memory;
  });
}

export async function pruneAgentMemories() {
  return (
    (
      await query<{ count: number }>(
        `with stale as (
         update agent_memories set deleted_at=now(),updated_at=now()
         where deleted_at is null and expires_at is not null and expires_at<=now() returning id
       ) select count(*)::int count from stale`,
      )
    ).rows[0]?.count ?? 0
  );
}

export function memoryDocuments(memories: AgentMemory[]): MemoryDocument[] {
  return memories.map((memory) => ({
    id: memory.id,
    namespace: memory.namespace,
    kind: memory.kind,
    content: memory.content,
    metadata: memory.metadata,
    trustScore: memory.trust_score,
    createdAt: memory.created_at,
  }));
}

export async function handoffAgentWorkflowToCouncil(input: { workflowId: string; actorUserId: string }) {
  return transaction(async (client) => {
    const workflow = (
      await client.query<AgentWorkflow>(
        `select * from agent_workflows where id=$1 and status='awaiting_handoff' and handoff_decision_id is null for update`,
        [input.workflowId],
      )
    ).rows[0];
    if (!workflow) throw new Error('Workflow ist nicht zur Gremiumsübergabe bereit.');
    const incomplete = asNumber(
      (
        await client.query<{ count: number }>(
          "select count(*)::int count from agent_workflow_steps where workflow_id=$1 and status<>'completed'",
          [workflow.id],
        )
      ).rows[0]?.count,
    );
    if (incomplete > 0) throw new Error('Der Workflow ist noch nicht vollständig abgeschlossen.');
    const kind =
      workflow.template_key === 'format-lab'
        ? 'format'
        : workflow.template_key === 'clip-strategy'
          ? 'production'
          : 'strategy';
    const proposal = {
      orchestratorWorkflowId: workflow.id,
      template: workflow.template_key,
      goal: workflow.goal,
      result: workflow.result,
      implementationMode:
        workflow.template_key === 'self-improvement-review' ? 'proposal-only-no-code-execution' : 'council-controlled',
      safetyChain: ['council-quorum', 'two-independent-reviews', 'ceo-approval', 'controlled-apply', 'verification'],
    };
    const decision = (
      await client.query<{ id: string }>(
        `insert into autonomous_studio_decisions(
           kind,source,title,instruction,requested_by,requested_by_system,proposal,status,importance,ceo_status
         ) values($1,'manual',$2,$3,$4,$5,$6,'awaiting_council','high','pending') returning id`,
        [
          kind,
          workflow.title,
          `Der Agenten-Workflow hat einen Vorschlag vorbereitet. Prüfe Ziel, Belege, Risiken, Budget und Rückrollplan vollständig: ${workflow.goal}`.slice(
            0,
            12_000,
          ),
          input.actorUserId,
          `agent-orchestrator:${workflow.id}`,
          proposal,
        ],
      )
    ).rows[0]!;
    await client.query(
      `insert into autonomous_studio_events(decision_id,event_type,title,detail,metadata,actor_user_id)
       values($1,'agent_workflow_handoff','Agentenentwurf an das Gremium übergeben',$2,$3,$4)`,
      [decision.id, workflow.goal, { workflowId: workflow.id, template: workflow.template_key }, input.actorUserId],
    );
    await client.query(
      `update agent_workflows set status='completed',handoff_decision_id=$2,completed_at=now(),updated_at=now()
       where id=$1`,
      [workflow.id, decision.id],
    );
    return { workflowId: workflow.id, decisionId: decision.id };
  });
}

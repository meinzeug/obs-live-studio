export const AGENT_CAPABILITIES = [
  'read:studio-metrics',
  'read:channel-history',
  'read:guidelines',
  'read:repository-index',
  'propose:strategy',
  'propose:content',
  'propose:code-change',
  'handoff:council',
] as const;

export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];
export type AgentRiskTier = 'low' | 'medium' | 'high';
export type AgentOrchestratorMode = 'running' | 'draining' | 'stopped';
export type AgentWorkflowStatus =
  'queued' | 'running' | 'awaiting_handoff' | 'completed' | 'blocked' | 'failed' | 'cancelled';
export type AgentStepStatus = 'pending' | 'running' | 'completed' | 'blocked' | 'failed' | 'cancelled';

export type AgentRoleId = 'self-improvement-engineer' | 'growth-analytics' | 'dynamic-content-producer';

export interface AgentDefinition {
  id: AgentRoleId;
  displayName: string;
  roleName: string;
  description: string;
  instructions: string;
  riskTier: AgentRiskTier;
  capabilities: AgentCapability[];
  maxCostPerRunUsd: number;
  rateLimitPerHour: number;
}

export interface WorkflowStepTemplate {
  key: string;
  title: string;
  agentId: AgentRoleId;
  capability: AgentCapability;
  dependsOn?: string[];
  purpose: string;
  timeoutSeconds?: number;
}

export interface WorkflowTemplate {
  key: string;
  version: number;
  title: string;
  description: string;
  riskTier: AgentRiskTier;
  steps: WorkflowStepTemplate[];
}

export interface InstantiatedWorkflow {
  templateKey: string;
  templateVersion: number;
  title: string;
  goal: string;
  riskTier: AgentRiskTier;
  input: Record<string, unknown>;
  steps: Array<WorkflowStepTemplate & { position: number }>;
}

export interface UntrustedEvidence {
  sourceType: 'chat' | 'web' | 'article' | 'transcript' | 'metric' | 'guideline' | 'repository';
  sourceId?: string | null;
  title: string;
  content: string;
  trustScore: number;
  observedAt?: string | null;
  untrusted: boolean;
}

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
  findings: Array<{
    title: string;
    detail: string;
    evidenceIds: string[];
    confidence: number;
  }>;
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

export interface RankedMemory extends MemoryDocument {
  score: number;
}

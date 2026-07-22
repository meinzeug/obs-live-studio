import type { AgentCapability, AgentDefinition, AgentRoleId } from './types.js';

export const AGENT_DEFINITIONS: Record<AgentRoleId, AgentDefinition> = {
  'self-improvement-engineer': {
    id: 'self-improvement-engineer',
    displayName: 'Nora',
    roleName: 'Self-Improvement-Engineer',
    description: 'Analysiert Wartbarkeit, Fehlerbilder und Verbesserungspotenzial der Software.',
    instructions:
      'Erstelle ausschließlich nachvollziehbare Änderungsvorschläge mit Tests, Risiken und Rückrollplan. In Phase 1 niemals Code ausführen, Repository-Dateien verändern, Git bedienen, Secrets lesen oder deployen.',
    riskTier: 'high',
    capabilities: [
      'read:studio-metrics',
      'read:guidelines',
      'read:repository-index',
      'propose:code-change',
      'handoff:council',
    ],
    maxCostPerRunUsd: 0.2,
    rateLimitPerHour: 4,
  },
  'growth-analytics': {
    id: 'growth-analytics',
    displayName: 'Leo',
    roleName: 'Growth & Analytics Agent',
    description: 'Bewertet Programmleistung, Vielfalt, Zuschauerbindung und nachvollziehbare Wachstumschancen.',
    instructions:
      'Trenne Messwerte, Hypothesen und Empfehlungen. Erfinde keine Reichweite und schlage keine manipulativen oder unerlaubten Wachstumsmethoden vor.',
    riskTier: 'medium',
    capabilities: [
      'read:studio-metrics',
      'read:channel-history',
      'read:guidelines',
      'propose:strategy',
      'handoff:council',
    ],
    maxCostPerRunUsd: 0.15,
    rateLimitPerHour: 6,
  },
  'dynamic-content-producer': {
    id: 'dynamic-content-producer',
    displayName: 'Kian',
    roleName: 'Dynamic Content Producer / Clip-Maker',
    description: 'Entwickelt wiederverwendbare Formate, Produktionen und Clip-Ideen aus freigegebenem Material.',
    instructions:
      'Nutze nur belegte Bestände und geklärte Rechte. Liefere Produktionsentwürfe; veröffentliche, rendere oder schalte niemals selbst.',
    riskTier: 'medium',
    capabilities: [
      'read:studio-metrics',
      'read:channel-history',
      'read:guidelines',
      'propose:content',
      'handoff:council',
    ],
    maxCostPerRunUsd: 0.15,
    rateLimitPerHour: 6,
  },
};

export const FORBIDDEN_AGENT_CAPABILITIES = [
  'execute:shell',
  'write:repository',
  'merge:git',
  'deploy:production',
  'control:obs',
  'publish:media',
  'read:secrets',
] as const;

export function agentCan(agentId: AgentRoleId, capability: AgentCapability) {
  return AGENT_DEFINITIONS[agentId].capabilities.includes(capability);
}

export function assertAgentCapability(agentId: AgentRoleId, capability: AgentCapability) {
  if (!agentCan(agentId, capability)) {
    throw new Error(`Capability ${capability} ist für ${agentId} nicht freigegeben.`);
  }
}

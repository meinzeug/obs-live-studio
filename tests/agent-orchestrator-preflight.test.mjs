import { describe, expect, it } from 'vitest';
import { inspectAgentOrchestrator } from '../scripts/agent-orchestrator-runtime-status.mjs';

function inspectorFixture(overrides = {}) {
  const fixture = {
    schema: {
      settings: 'agent_orchestrator_settings',
      workflows: 'agent_workflows',
      audit: 'agent_tool_audit',
      memories: 'agent_memories',
    },
    settings: {
      mode: 'stopped',
      enabled: false,
      safe_broadcast_mode: true,
      daily_budget_usd: 1.5,
    },
    agents: { total: 3, enabled: 3 },
    triggers: { audit: 1, memory: 1 },
    runtime: { running_steps: 0, stale_steps: 0, spend_today: 0.1 },
    ...overrides,
  };
  return async (operation) =>
    operation(async (sql) => {
      if (sql.includes("to_regclass('agent_orchestrator_settings')")) return { rows: [fixture.schema] };
      if (sql.includes('from agent_orchestrator_settings')) return { rows: [fixture.settings] };
      if (sql.includes('from agent_orchestrator_agents')) return { rows: [fixture.agents] };
      if (sql.includes('from pg_trigger')) return { rows: [fixture.triggers] };
      return { rows: [fixture.runtime] };
    });
}

describe('agent orchestrator preflight', () => {
  it('treats a deliberately stopped orchestrator as safe and the broadcast as independent', async () => {
    const report = await inspectAgentOrchestrator(
      { DATABASE_URL: 'postgresql://redacted.invalid/studio' },
      { query: inspectorFixture() },
    );
    expect(report.ok).toBe(true);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'agent-orchestrator-isolation', status: 'ok' }),
        expect.objectContaining({ id: 'agent-orchestrator-runtime', status: 'disabled' }),
      ]),
    );
  });

  it('fails closed for broken isolation, stale work or a spent budget', async () => {
    const report = await inspectAgentOrchestrator(
      { DATABASE_URL: 'postgresql://redacted.invalid/studio' },
      {
        query: inspectorFixture({
          settings: { mode: 'stopped', enabled: true, safe_broadcast_mode: false, daily_budget_usd: 0.05 },
          runtime: { running_steps: 1, stale_steps: 1, spend_today: 0.2 },
        }),
      },
    );
    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'agent-orchestrator-isolation', status: 'error' }),
        expect.objectContaining({ id: 'agent-orchestrator-runtime', status: 'error' }),
        expect.objectContaining({ id: 'agent-orchestrator-budget', status: 'error' }),
      ]),
    );
    expect(JSON.stringify(report)).not.toContain('redacted.invalid');
  });
});

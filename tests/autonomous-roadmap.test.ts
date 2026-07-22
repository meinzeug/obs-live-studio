import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);

async function source(path: string) {
  return readFile(new URL(path, root), 'utf8');
}

describe('autonomous council phase-zero contract', () => {
  it('documents the current flow, trust boundaries and immutable approvals', async () => {
    const architecture = await source('docs/AUTONOMOUS_STUDIO_ARCHITECTURE.md');
    expect(architecture).toContain('sequenceDiagram');
    expect(architecture).toContain('trg_autonomous_studio_double_approval');
    expect(architecture).toContain('trg_freeze_reviewed_autonomous_studio_decision');
    expect(architecture).toContain('Chattext ist ausschließlich Datenmaterial');
  });

  it('keeps code, publishing and infrastructure behind explicit CEO approval', async () => {
    const threatModel = await source('docs/AUTONOMOUS_AGENT_THREAT_MODEL.md');
    expect(threatModel).toContain('Kein autonomer Merge nach `main`');
    expect(threatModel).toContain('Capability-Grant');
    expect(threatModel).toContain('Sandbox ohne Secrets');
    expect(threatModel).toContain('globaler Not-Aus');
  });

  it('selects a deterministic TypeScript core instead of a privileged second control plane', async () => {
    const adr = await source('docs/adr/0001-native-typescript-agent-orchestrator.md');
    expect(adr).toContain('Status: angenommen');
    expect(adr).toContain('packages/agent-orchestrator');
    expect(adr).toContain('PostgreSQL bleibt die persistente Quelle der Wahrheit');
  });

  it('provides a read-only and aggregate-only baseline command', async () => {
    const script = await source('scripts/autonomous-baseline.mjs');
    const sqlStatements = [...script.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim().toLowerCase());
    expect(sqlStatements.some((statement) => statement.startsWith('select'))).toBe(true);
    expect(sqlStatements.some((statement) => /^(insert|update|delete|alter|drop|create)\b/.test(statement))).toBe(
      false,
    );
    const baseline = await source('docs/baselines/AUTONOMOUS_STUDIO_2026-07-22.md');
    expect(baseline).toMatch(/Verletzungen von Quorum oder Doppelprüfung\s*\|\s*0/);
    expect(baseline).toContain('keine Chattexte, Titel, Benutzerdaten oder Secrets');
  });
});

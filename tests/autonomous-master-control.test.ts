import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('autonomous station master control', () => {
  it('runs a durable operations cycle that monitors and repairs the real station', async () => {
    const [migration, supervisor, worker, database] = await Promise.all([
      readFile('packages/database/src/059_autonomous_master_control.sql', 'utf8'),
      readFile('apps/worker/src/autonomous-operations.ts', 'utf8'),
      readFile('apps/worker/src/index.ts', 'utf8'),
      readFile('packages/database/src/autonomous-studio.ts', 'utf8'),
    ]);
    expect(migration).toContain('autonomous_studio_operations_cycles');
    expect(migration).toContain('automatic_operational_actions');
    expect(supervisor).toContain('secure-continuity-schedule');
    expect(supervisor).toContain('requestBroadcastRecoveryOperation');
    expect(supervisor).toContain('start-stream');
    expect(supervisor).toContain('createMissingFormatDecisions');
    expect(supervisor).toContain('createDailyProductionDecision');
    expect(supervisor).toContain("'applying','revise'");
    expect(worker).toContain('new AutonomousOperationsSupervisor');
    expect(database).toContain('JSON.stringify(input.findings)');
    expect(database).toContain('JSON.stringify(input.actions)');
  });

  it('materializes approved formats and productions instead of only storing AI prose', async () => {
    const [implementation, database] = await Promise.all([
      readFile('apps/worker/src/autonomous-studio.ts', 'utf8'),
      readFile('packages/database/src/autonomous-studio.ts', 'utf8'),
    ]);
    expect(implementation).toContain('createBroadcastFormat');
    expect(implementation).toContain('createDedicatedFormatOverlay');
    expect(implementation).toContain('materializeAutonomousProduction');
    expect(implementation).toContain("playlist.settings->>'autopilotFormatId'");
    expect(implementation).toContain('item_count');
    expect(implementation).toContain('revisionResolution');
    expect(implementation).toContain('deterministicPlanningFallback');
    expect(implementation).toContain('deterministic-autonomy-fallback');
    expect(implementation).toContain('useLocalRecoveryPlan');
    expect(implementation).toContain('autonomous_studio_deferred');
    expect(database).not.toContain("decision.kind in ('strategy','directive')");
    expect(database).not.toContain("status='queued' and kind in ('strategy','directive')");
    expect(database).toContain('maximum-revision-rounds-exhausted');
    expect(database).toContain('recoverAutonomousDecisionFailure');
    expect(database).toContain('technical_failure_recovered');
    expect(database).toContain('solution_recovery_started');
    expect(database).toContain('automatic-budget-backoff');
  });

  it('shows operational findings, concrete actions, and autonomy controls to the CEO', async () => {
    const [routes, page] = await Promise.all([
      readFile('apps/api/src/autonomous-studio.ts', 'utf8'),
      readFile('apps/web/src/pages/SendegottPage.tsx', 'utf8'),
    ]);
    expect(routes).toContain('listAutonomousOperationsCycles');
    expect(routes).toContain("'/api/autonomous-studio/operations/run'");
    expect(page).toContain('Autonomes Master Control');
    expect(page).toContain('Ausgeführte Arbeit');
    expect(page).toContain('Betriebsprobleme selbst beheben');
  });
});

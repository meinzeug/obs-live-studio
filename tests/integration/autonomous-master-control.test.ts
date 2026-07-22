import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool, query } from '@ans/database';
import {
  claimAutonomousOperationsCycle,
  claimAutonomousPlanningDecision,
  completeAutonomousOperationsCycle,
  createAutonomousStudioDecision,
  recoverAutonomousDecisionFailure,
  spawnAutonomousDecisionRevision,
} from '@ans/database/autonomous-studio';

const describeIntegration = process.env.VITEST_INCLUDE_INTEGRATION === 'true' ? describe : describe.skip;

describeIntegration('autonomous master control PostgreSQL integration', () => {
  beforeEach(async () => {
    await query(`delete from autonomous_studio_operations_cycles where worker_id='master-control-integration'`);
    await query(
      `update autonomous_studio_settings
       set enabled=true,operations_enabled=true,paused_reason=null,next_operations_cycle_at=now()
       where id=true`,
    );
  });

  afterAll(async () => {
    await query(`delete from autonomous_studio_operations_cycles where worker_id='master-control-integration'`);
    await pool.end();
  });

  it('persists findings and actions as JSON arrays', async () => {
    const cycle = await claimAutonomousOperationsCycle('master-control-integration', {
      force: true,
      trigger: 'manual',
    });
    expect(cycle).toBeTruthy();
    const completed = await completeAutonomousOperationsCycle({
      id: cycle!.id,
      status: 'repaired',
      snapshotBefore: { onAir: false },
      findings: [{ code: 'off-air', severity: 'critical' }],
      actions: [{ type: 'repair-schedule-and-playout', status: 'queued' }],
      verification: { onAir: true },
    });
    expect(completed).toMatchObject({
      status: 'repaired',
      findings: [{ code: 'off-air', severity: 'critical' }],
      actions: [{ type: 'repair-schedule-and-playout', status: 'queued' }],
      verification: { onAir: true },
    });
  });

  it('starts a fresh review loop when an autonomous production needs revision', async () => {
    const original = await createAutonomousStudioDecision({
      kind: 'production',
      source: 'automatic',
      title: 'Master-Control Integration Produktion',
      instruction: 'Erzeuge eine reale, befüllte Testproduktion und löse alle Gremiumsblocker.',
      proposal: {
        kind: 'long-video',
        title: 'Master-Control Integration Produktion',
        brief: 'Eine konkrete redaktionelle Produktion für den Integrationstest.',
        presenter: 'ava',
        sourceRule: 'Nur freigegebene Testinhalte verwenden.',
        platforms: ['broadcast'],
      },
      requestedBySystem: 'master-control-integration',
      importance: 'normal',
    });
    await query(`update autonomous_studio_decisions set status='revise' where id=$1`, [original!.id]);
    const revision = await spawnAutonomousDecisionRevision();
    expect(revision).toMatchObject({
      kind: 'production',
      status: 'queued',
      importance: 'normal',
      ceo_status: 'not_required',
      previous_decision_id: original!.id,
      revision_number: 1,
    });
    expect(await claimAutonomousPlanningDecision('master-control-integration')).toMatchObject({
      id: revision!.id,
      kind: 'production',
      status: 'planning',
    });
    expect(
      (
        await query(`select status,superseded_by_decision_id from autonomous_studio_decisions where id=$1`, [
          original!.id,
        ])
      ).rows[0],
    ).toMatchObject({ status: 'cancelled', superseded_by_decision_id: revision!.id });
  });

  it('automatically resumes technical failures without bypassing review gates', async () => {
    const decision = await createAutonomousStudioDecision({
      kind: 'format',
      source: 'automatic',
      title: 'Technisch unterbrochener Formatentwurf',
      instruction: 'Materialisiere einen überprüfbaren Formatentwurf.',
      requestedBySystem: 'master-control-integration',
      importance: 'normal',
    });
    await query(
      `update autonomous_studio_decisions
       set status='failed',error='OpenRouter hat keine gültige strukturierte Antwort geliefert.',failed_at=now()
       where id=$1`,
      [decision!.id],
    );
    const recovery = await recoverAutonomousDecisionFailure({ force: true, decisionId: decision!.id });
    expect(recovery).toMatchObject({
      mode: 'technical-retry',
      previousDecisionId: decision!.id,
      decision: { id: decision!.id, status: 'queued', error: null },
    });
    expect(recovery?.decision.revision_context).toMatchObject({ automaticRecoveryAttempts: 1 });
  });

  it('opens a fresh solution path after the revision limit instead of abandoning the work', async () => {
    const decision = await createAutonomousStudioDecision({
      kind: 'production',
      source: 'automatic',
      title: 'Neuer Lösungsweg Integration',
      instruction: 'Erzeuge eine verifizierte Sendung und löse erkannte Produktionsblocker.',
      requestedBySystem: 'master-control-integration',
      importance: 'normal',
    });
    await query(
      `update autonomous_studio_decisions
       set status='failed',error='maximum-revision-rounds-exhausted',revision_number=3,failed_at=now()
       where id=$1`,
      [decision!.id],
    );
    const recovery = await recoverAutonomousDecisionFailure({ force: true, decisionId: decision!.id });
    expect(recovery).toMatchObject({
      mode: 'fresh-solution',
      previousDecisionId: decision!.id,
      decision: { status: 'queued', revision_number: 0, previous_decision_id: decision!.id },
    });
    expect(
      (await query(`select superseded_by_decision_id from autonomous_studio_decisions where id=$1`, [decision!.id]))
        .rows[0],
    ).toMatchObject({ superseded_by_decision_id: recovery!.decision.id });
  });
});

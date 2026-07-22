import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { instantiateWorkflow } from '@ans/agent-orchestrator';
import { query } from '../../packages/database/src/index.js';
import { auditLog } from '../../packages/database/src/auth.js';
import {
  cancelAgentWorkflow,
  claimReadyAgentStep,
  completeAgentStep,
  consumeAgentCapabilityGrant,
  controlAgentOrchestrator,
  createAgentWorkflow,
  getAgentWorkflow,
  handoffAgentWorkflowToCouncil,
  issueAgentCapabilityGrant,
  recordAgentToolAudit,
  updateAgentOrchestratorSettings,
} from '../../packages/database/src/agent-orchestrator.js';

const integration = process.env.VITEST_INCLUDE_INTEGRATION === 'true' ? describe : describe.skip;

integration('agent orchestrator PostgreSQL invariants', () => {
  const workerId = `vitest-agent-${randomUUID()}`;
  let userId = '';
  let workflowId = '';
  let decisionId = '';

  beforeAll(async () => {
    userId = (
      await query<{ id: string }>(
        `insert into users(email,password_hash,display_name,active)
         values($1,'integration-only-not-a-real-hash','Agent Integration',true) returning id`,
        [`agent-${randomUUID()}@example.invalid`],
      )
    ).rows[0]!.id;
    await controlAgentOrchestrator('running', { reason: 'Integrationstest', actorUserId: userId });
  });

  afterAll(async () => {
    await controlAgentOrchestrator('stopped', { reason: 'Integrationstest beendet', actorUserId: userId }).catch(
      () => null,
    );
  });

  it('audits the global singleton without writing a text sentinel into a UUID column', async () => {
    await expect(
      auditLog(userId, 'agent_orchestrator.control', 'agent_orchestrator_settings', undefined, {
        scope: 'global',
        mode: 'running',
      }),
    ).resolves.toBeUndefined();
    const audit = (
      await query<{ entity_id: string | null; details: { scope?: string } }>(
        `select entity_id,details from audit_logs
         where user_id=$1 and action='agent_orchestrator.control' order by created_at desc limit 1`,
        [userId],
      )
    ).rows[0];
    expect(audit?.entity_id).toBeNull();
    expect(audit?.details.scope).toBe('global');
  });

  it('issues one-time grants, chains immutable audit entries and requires explicit council handoff', async () => {
    const plan = instantiateWorkflow('growth-cycle', {
      goal: 'Prüfe die Programmvielfalt mit echten Metriken und liefere nur einen kontrollierten Vorschlag.',
    });
    const workflow = await createAgentWorkflow({
      templateKey: plan.templateKey,
      templateVersion: plan.templateVersion,
      title: plan.title,
      goal: plan.goal,
      context: plan.input.context as Record<string, unknown>,
      riskTier: plan.riskTier,
      steps: plan.steps,
      requestedBy: userId,
      source: 'manual',
      budgetLimitUsd: 0.5,
    });
    workflowId = workflow.id;

    for (let index = 0; index < plan.steps.length; index += 1) {
      const claim = await claimReadyAgentStep(workerId);
      expect(claim?.workflow_id).toBe(workflow.id);
      expect(claim?.step_key).toBe(plan.steps[index]!.key);
      const grant = await issueAgentCapabilityGrant(claim!);
      expect(grant.token).not.toMatch(/^[a-f0-9]{64}$/);
      const stored = (
        await query<{ token_hash: string; status: string }>(
          'select token_hash,status from agent_capability_grants where id=$1',
          [grant.id],
        )
      ).rows[0]!;
      expect(stored.token_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(stored.token_hash).not.toContain(grant.token);
      await expect(
        consumeAgentCapabilityGrant({
          token: `${grant.token}invalid`,
          workflowId: workflow.id,
          stepId: claim!.id,
          agentId: claim!.agent_id,
          capability: claim!.capability,
        }),
      ).rejects.toThrow(/unbekannt/);
      await consumeAgentCapabilityGrant({
        token: grant.token,
        workflowId: workflow.id,
        stepId: claim!.id,
        agentId: claim!.agent_id,
        capability: claim!.capability,
      });
      await expect(
        consumeAgentCapabilityGrant({
          token: grant.token,
          workflowId: workflow.id,
          stepId: claim!.id,
          agentId: claim!.agent_id,
          capability: claim!.capability,
        }),
      ).rejects.toThrow(/nicht mehr aktiv/);

      const audit = await recordAgentToolAudit({
        workflowId: workflow.id,
        workflowStepId: claim!.id,
        capabilityGrantId: grant.id,
        agentId: claim!.agent_id,
        capability: claim!.capability,
        toolName: 'vitest.controlled-step',
        status: 'completed',
        input: { step: claim!.step_key },
        output: { ok: true },
      });
      expect(audit.entry_hash).toMatch(/^[a-f0-9]{64}$/);
      await expect(query("update agent_tool_audit set status='failed' where id=$1", [audit.id])).rejects.toMatchObject({
        code: 'P0001',
      });

      await completeAgentStep({
        claim: claim!,
        grantId: grant.id,
        model: 'integration/no-model',
        tier: 'free',
        costUsd: 0,
        output: {
          summary: `Kontrolliertes Ergebnis für ${claim!.step_key}`,
          findings: [],
          proposals: claim!.capability.startsWith('propose:')
            ? [
                {
                  title: 'Integration-Vorschlag',
                  detail: 'Dieser Vorschlag dient ausschließlich der Prüfung der sicheren Übergabekette.',
                  expectedImpact: 'Keine reale Änderung im Integrationstest.',
                  risk: 'Kein operatives Risiko, weil keine Anwendung erfolgt.',
                  verification: ['Gremiumsstatus bleibt awaiting_council.'],
                },
              ]
            : [],
          evidenceRequests: [],
          nextActions: ['Nächsten kontrollierten Workflowschritt ausführen.'],
          confidence: 80,
          memoryCandidates: [],
        },
      });
    }

    const completed = await getAgentWorkflow(workflow.id);
    expect(completed?.status).toBe('awaiting_handoff');
    expect(completed?.steps.every((step) => step.status === 'completed')).toBe(true);
    const handoff = await handoffAgentWorkflowToCouncil({ workflowId: workflow.id, actorUserId: userId });
    decisionId = handoff.decisionId;
    const decision = (
      await query<{ status: string; importance: string; ceo_status: string; requested_by_system: string }>(
        'select status,importance,ceo_status,requested_by_system from autonomous_studio_decisions where id=$1',
        [decisionId],
      )
    ).rows[0]!;
    expect(decision).toEqual({
      status: 'awaiting_council',
      importance: 'high',
      ceo_status: 'pending',
      requested_by_system: `agent-orchestrator:${workflowId}`,
    });
    await expect(
      query("update autonomous_studio_decisions set status='approved' where id=$1", [decisionId]),
    ).rejects.toMatchObject({ code: '23514' });
  }, 30_000);

  it('claims a workflow step at most once under concurrent workers', async () => {
    const plan = instantiateWorkflow('clip-strategy', {
      goal: 'Prüfe einen konkurrierenden Claim ohne Doppelverarbeitung.',
    });
    const workflow = await createAgentWorkflow({
      templateKey: plan.templateKey,
      templateVersion: plan.templateVersion,
      title: plan.title,
      goal: plan.goal,
      context: {},
      riskTier: plan.riskTier,
      steps: plan.steps,
      requestedBy: userId,
      source: 'manual',
      budgetLimitUsd: 0.5,
    });
    const claims = await Promise.all([claimReadyAgentStep(`${workerId}-a`), claimReadyAgentStep(`${workerId}-b`)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)?.workflow_id).toBe(workflow.id);
    await cancelAgentWorkflow(workflow.id, 'Race-Condition-Test abgeschlossen', userId);
  });

  it('enforces the global daily budget before issuing another capability', async () => {
    await recordAgentToolAudit({
      workflowId,
      agentId: 'growth-analytics',
      capability: 'read:studio-metrics',
      toolName: 'vitest.daily-budget-charge',
      status: 'completed',
      input: { purpose: 'budget-guard-test' },
      output: { charged: true },
      costUsd: 0.02,
    });
    await updateAgentOrchestratorSettings({ dailyBudgetUsd: 0.01 }, userId);
    const plan = instantiateWorkflow('growth-cycle', { goal: 'Prüfe die harte Tagesbudgetgrenze.' });
    const workflow = await createAgentWorkflow({
      templateKey: plan.templateKey,
      templateVersion: plan.templateVersion,
      title: plan.title,
      goal: plan.goal,
      context: {},
      riskTier: plan.riskTier,
      steps: plan.steps,
      requestedBy: userId,
      source: 'manual',
      budgetLimitUsd: 0.5,
    });
    const claim = await claimReadyAgentStep(workerId);
    expect(claim?.workflow_id).toBe(workflow.id);
    await expect(issueAgentCapabilityGrant(claim!)).rejects.toThrow(/Tagesbudget/);
    await updateAgentOrchestratorSettings({ dailyBudgetUsd: 1.5 }, userId);
    await controlAgentOrchestrator('stopped', { reason: 'Budgettest aufräumen', actorUserId: userId });
    await controlAgentOrchestrator('running', { reason: 'Weitere Integrationstests', actorUserId: userId });
  });

  it('locks broadcast isolation in PostgreSQL and discards late results after the global stop', async () => {
    await expect(
      query('update agent_orchestrator_settings set safe_broadcast_mode=false where id=true'),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      query("update agent_orchestrator_settings set enabled=true,mode='stopped' where id=true"),
    ).rejects.toMatchObject({ code: '23514' });

    await controlAgentOrchestrator('running', { reason: 'Not-Aus-Test', actorUserId: userId });
    const plan = instantiateWorkflow('format-lab', { goal: 'Prüfe das Verwerfen verspäteter Modellresultate.' });
    const workflow = await createAgentWorkflow({
      templateKey: plan.templateKey,
      templateVersion: plan.templateVersion,
      title: plan.title,
      goal: plan.goal,
      context: {},
      riskTier: plan.riskTier,
      steps: plan.steps,
      requestedBy: userId,
      source: 'manual',
      budgetLimitUsd: 0.5,
    });
    const claim = await claimReadyAgentStep(workerId);
    expect(claim?.workflow_id).toBe(workflow.id);
    const grant = await issueAgentCapabilityGrant(claim!);
    await consumeAgentCapabilityGrant({
      token: grant.token,
      workflowId: workflow.id,
      stepId: claim!.id,
      agentId: claim!.agent_id,
      capability: claim!.capability,
    });
    await controlAgentOrchestrator('stopped', { reason: 'Globaler Not-Aus im Modellaufruf', actorUserId: userId });
    const completion = await completeAgentStep({
      claim: claim!,
      grantId: grant.id,
      model: 'integration/late-result',
      tier: 'free',
      costUsd: 0,
      output: {
        summary: 'Dieses verspätete Ergebnis darf nicht übernommen werden.',
        findings: [],
        proposals: [],
        evidenceRequests: [],
        nextActions: [],
        confidence: 10,
        memoryCandidates: [],
      },
    });
    expect(completion).toBeNull();
    const stored = await getAgentWorkflow(workflow.id);
    expect(stored?.status).toBe('blocked');
    expect(stored?.steps[0]?.status).toBe('blocked');
  });
});

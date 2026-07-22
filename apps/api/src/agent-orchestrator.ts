import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AGENT_CAPABILITIES, WORKFLOW_TEMPLATES, instantiateWorkflow, type AgentRoleId } from '@ans/agent-orchestrator';
import {
  cancelAgentWorkflow,
  controlAgentOrchestrator,
  createAgentWorkflow,
  deleteAgentMemory,
  getAgentOrchestratorDashboard,
  getAgentWorkflow,
  handoffAgentWorkflowToCouncil,
  listAgentMemories,
  retryAgentWorkflow,
  updateAgentOrchestratorAgent,
  updateAgentOrchestratorSettings,
} from '@ans/database/agent-orchestrator';
import { auditLog } from '@ans/database/auth';
import type { WritePermission } from '@ans/security/auth';

type RequirePermission = (request: FastifyRequest, reply: FastifyReply, permission: WritePermission) => unknown;

const agentIdSchema = z.enum(['self-improvement-engineer', 'growth-analytics', 'dynamic-content-producer']);
const capabilitySchema = z.enum(AGENT_CAPABILITIES);

const settingsSchema = z
  .object({
    memoryEnabled: z.boolean().optional(),
    memoryMode: z.enum(['full_text', 'disabled']).optional(),
    memoryRetentionDays: z.number().int().min(7).max(3650).optional(),
    maxMemories: z.number().int().min(100).max(1_000_000).optional(),
    maxConcurrentWorkflows: z.number().int().min(1).max(4).optional(),
    defaultStepTimeoutSeconds: z.number().int().min(30).max(900).optional(),
    defaultWorkflowBudgetUsd: z.number().min(0.01).max(25).optional(),
    dailyBudgetUsd: z.number().min(0.01).max(1000).optional(),
  })
  .strict();

const agentSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100).optional(),
    instructions: z.string().trim().min(10).max(6000).optional(),
    enabled: z.boolean().optional(),
    allowedCapabilities: z.array(capabilitySchema).min(1).max(8).optional(),
    maxCostPerRunUsd: z.number().min(0.001).max(25).optional(),
    rateLimitPerHour: z.number().int().min(1).max(120).optional(),
  })
  .strict();

const workflowSchema = z
  .object({
    templateKey: z.enum(['self-improvement-review', 'growth-cycle', 'format-lab', 'clip-strategy']),
    title: z.string().trim().min(2).max(180).optional(),
    goal: z.string().trim().min(3).max(4000),
    context: z.record(z.string(), z.unknown()).optional(),
    budgetLimitUsd: z.number().min(0.001).max(25).optional(),
  })
  .strict();

export function registerAgentOrchestratorRoutes(app: FastifyInstance, requirePermission: RequirePermission) {
  app.get('/api/agent-orchestrator', async () => getAgentOrchestratorDashboard());

  app.get('/api/agent-orchestrator/templates', async () => ({
    templates: Object.values(WORKFLOW_TEMPLATES).map((template) => ({
      key: template.key,
      version: template.version,
      title: template.title,
      description: template.description,
      riskTier: template.riskTier,
      steps: template.steps,
    })),
  }));

  app.get('/api/agent-orchestrator/workflows/:id', async (request, reply) => {
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const workflow = await getAgentWorkflow(id);
    if (!workflow) return reply.code(404).send({ error: 'Agenten-Workflow nicht gefunden.' });
    return workflow;
  });

  app.get('/api/agent-orchestrator/memories', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    const input = z
      .object({ limit: z.coerce.number().int().min(1).max(500).default(100) })
      .strict()
      .parse(request.query ?? {});
    return { memories: await listAgentMemories(input.limit) };
  });

  app.patch('/api/agent-orchestrator/settings', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    const input = settingsSchema.parse(request.body ?? {});
    const settings = await updateAgentOrchestratorSettings(input, request.user?.id ?? null);
    await auditLog(
      request.user?.id ?? null,
      'agent_orchestrator.settings.update',
      'agent_orchestrator_settings',
      undefined,
      {
        scope: 'global',
        fields: Object.keys(input),
      },
    );
    return settings;
  });

  app.post('/api/agent-orchestrator/control', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    const input = z
      .object({ mode: z.enum(['running', 'draining', 'stopped']), reason: z.string().trim().max(500).optional() })
      .strict()
      .parse(request.body ?? {});
    const settings = await controlAgentOrchestrator(input.mode, {
      reason: input.reason,
      actorUserId: request.user?.id ?? null,
    });
    await auditLog(request.user?.id ?? null, 'agent_orchestrator.control', 'agent_orchestrator_settings', undefined, {
      scope: 'global',
      mode: input.mode,
      reason: input.reason ?? null,
    });
    return settings;
  });

  app.patch('/api/agent-orchestrator/agents/:id', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    const id = agentIdSchema.parse((request.params as { id: string }).id) as AgentRoleId;
    const input = agentSchema.parse(request.body ?? {});
    const agent = await updateAgentOrchestratorAgent(id, input, request.user?.id ?? null);
    await auditLog(
      request.user?.id ?? null,
      'agent_orchestrator.agent.update',
      'agent_orchestrator_agents',
      undefined,
      {
        agentId: id,
        fields: Object.keys(input),
      },
    );
    return agent;
  });

  app.post('/api/agent-orchestrator/workflows', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const input = workflowSchema.parse(request.body ?? {});
    if (input.templateKey === 'self-improvement-review') requirePermission(request, reply, 'users:write');
    const plan = instantiateWorkflow(input.templateKey, {
      title: input.title,
      goal: input.goal,
      context: input.context,
    });
    const workflow = await createAgentWorkflow({
      templateKey: plan.templateKey,
      templateVersion: plan.templateVersion,
      title: plan.title,
      goal: plan.goal,
      context: plan.input.context as Record<string, unknown>,
      riskTier: plan.riskTier,
      steps: plan.steps,
      source: 'manual',
      requestedBy: request.user?.id ?? null,
      budgetLimitUsd: input.budgetLimitUsd,
    });
    await auditLog(request.user?.id ?? null, 'agent_orchestrator.workflow.create', 'agent_workflows', workflow.id, {
      templateKey: plan.templateKey,
      riskTier: plan.riskTier,
      budgetLimitUsd: workflow.budget_limit_usd,
    });
    return reply.code(201).send(workflow);
  });

  app.post('/api/agent-orchestrator/workflows/:id/cancel', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const input = z
      .object({ reason: z.string().trim().min(3).max(1000).default('Manuell durch die Senderleitung abgebrochen.') })
      .strict()
      .parse(request.body ?? {});
    const workflow = await cancelAgentWorkflow(id, input.reason, request.user?.id ?? null);
    if (!workflow)
      return reply.code(409).send({ error: 'Workflow kann im aktuellen Zustand nicht abgebrochen werden.' });
    await auditLog(request.user?.id ?? null, 'agent_orchestrator.workflow.cancel', 'agent_workflows', id, {
      reason: input.reason,
    });
    return workflow;
  });

  app.post('/api/agent-orchestrator/workflows/:id/retry', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const workflow = await retryAgentWorkflow(id);
    if (!workflow)
      return reply
        .code(409)
        .send({ error: 'Nur blockierte oder fehlgeschlagene Workflows können neu gestartet werden.' });
    await auditLog(request.user?.id ?? null, 'agent_orchestrator.workflow.retry', 'agent_workflows', id);
    return workflow;
  });

  app.post('/api/agent-orchestrator/workflows/:id/handoff', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    if (!request.user?.id) return reply.code(401).send({ error: 'Anmeldung erforderlich.' });
    const handoff = await handoffAgentWorkflowToCouncil({ workflowId: id, actorUserId: request.user.id });
    await auditLog(request.user.id, 'agent_orchestrator.workflow.handoff', 'agent_workflows', id, {
      decisionId: handoff.decisionId,
    });
    return handoff;
  });

  app.delete('/api/agent-orchestrator/memories/:id', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const memory = await deleteAgentMemory(id);
    if (!memory) return reply.code(404).send({ error: 'Memory-Eintrag nicht gefunden.' });
    await auditLog(request.user?.id ?? null, 'agent_orchestrator.memory.delete', 'agent_memories', id);
    return { deleted: true };
  });
}

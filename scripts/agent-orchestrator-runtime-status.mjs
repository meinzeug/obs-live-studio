import pg from 'pg';

const { Client } = pg;

function check(id, status, message, detail) {
  return { id, status, message, ...(detail ? { detail } : {}) };
}

async function withDatabase(databaseUrl, operation) {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3_000 });
  await client.connect();
  try {
    return await operation((text, parameters) => client.query(text, parameters));
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function inspectAgentOrchestrator(env = process.env, options = {}) {
  const databaseUrl = String(env.DATABASE_URL ?? '');
  if (!databaseUrl) {
    return {
      ok: true,
      checks: [check('agent-orchestrator-database', 'disabled', 'Agentenstatus ohne DATABASE_URL nicht geprüft.')],
    };
  }
  const execute = options.query ? options.query : (operation) => withDatabase(databaseUrl, operation);
  try {
    const snapshot = await execute(async (query) => {
      // `pg.Client` serialisiert Abfragen nicht dauerhaft implizit. Bewusst
      // sequenziell bleiben, damit der Preflight auch mit pg >= 9 stabil ist.
      const schema = await query(
        `select to_regclass('agent_orchestrator_settings') settings,
                to_regclass('agent_workflows') workflows,
                to_regclass('agent_tool_audit') audit,
                to_regclass('agent_memories') memories`,
      );
      const settings = await query('select * from agent_orchestrator_settings where id=true');
      const agents = await query(
        'select count(*)::int total,count(*) filter(where enabled)::int enabled from agent_orchestrator_agents',
      );
      const triggers = await query(
        `select count(*) filter(where tgname='trg_agent_tool_audit_append_only')::int audit,
                count(*) filter(where tgname='trg_agent_memory_access_append_only')::int memory
           from pg_trigger where not tgisinternal`,
      );
      const runtime = await query(
        `select
           (select count(*)::int from agent_workflow_steps where status='running') running_steps,
           (select count(*)::int from agent_workflow_steps
             where status='running' and locked_at<now()-make_interval(secs => timeout_seconds+60)) stale_steps,
           (select coalesce(sum(cost_usd),0)::float8 from agent_tool_audit
             where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') spend_today`,
      );
      return {
        schema: schema.rows[0] ?? {},
        settings: settings.rows[0] ?? null,
        agents: agents.rows[0] ?? { total: 0, enabled: 0 },
        triggers: triggers.rows[0] ?? { audit: 0, memory: 0 },
        runtime: runtime.rows[0] ?? { running_steps: 0, stale_steps: 0, spend_today: 0 },
      };
    });

    const schemaReady = Object.values(snapshot.schema).every(Boolean);
    const settings = snapshot.settings;
    const invariantReady = Boolean(
      settings && settings.safe_broadcast_mode === true && settings.enabled === (settings.mode !== 'stopped'),
    );
    const auditReady = Number(snapshot.triggers.audit) === 1 && Number(snapshot.triggers.memory) === 1;
    const agentsReady = Number(snapshot.agents.total) >= 3;
    const staleSteps = Number(snapshot.runtime.stale_steps ?? 0);
    const spend = Number(snapshot.runtime.spend_today ?? 0);
    const dailyBudget = Number(settings?.daily_budget_usd ?? 0);
    const budgetReady = Boolean(settings) && spend <= dailyBudget + 0.000001;
    const checks = [
      check(
        'agent-orchestrator-schema',
        schemaReady ? 'ok' : 'error',
        schemaReady
          ? 'Agenten-Orchestrierung und Memory sind migriert.'
          : 'Agenten-Orchestrierung ist unvollständig migriert.',
      ),
      check(
        'agent-orchestrator-isolation',
        invariantReady ? 'ok' : 'error',
        invariantReady
          ? 'Agentenstatus und Broadcast-Isolation sind durch Datenbankregeln konsistent.'
          : 'Agentenstatus oder Broadcast-Isolation verletzt eine Sicherheitsinvariante.',
      ),
      check(
        'agent-orchestrator-audit',
        auditReady ? 'ok' : 'error',
        auditReady ? 'Tool- und Memory-Audit sind append-only geschützt.' : 'Ein Agenten-Audit-Trigger fehlt.',
      ),
      check(
        'agent-orchestrator-agents',
        agentsReady ? 'ok' : 'error',
        agentsReady
          ? `${snapshot.agents.enabled}/${snapshot.agents.total} Agenten sind aktiviert.`
          : 'Die drei verbindlichen Agentenrollen sind nicht vollständig vorhanden.',
      ),
      check(
        'agent-orchestrator-runtime',
        staleSteps === 0 ? (settings?.mode === 'stopped' ? 'disabled' : 'ok') : 'error',
        staleSteps === 0
          ? settings?.mode === 'stopped'
            ? 'Agenten-Orchestrierung ist sicher gestoppt; der Broadcast läuft unabhängig weiter.'
            : `Agenten-Orchestrierung ist ${settings?.mode}; ${snapshot.runtime.running_steps} Schritt(e) laufen.`
          : `${staleSteps} Agentenschritt(e) haben ihr Zeitlimit überschritten.`,
      ),
      check(
        'agent-orchestrator-budget',
        budgetReady ? 'ok' : 'error',
        budgetReady ? 'Das Agenten-Tagesbudget ist eingehalten.' : 'Das Agenten-Tagesbudget ist überschritten.',
        settings ? `${spend.toFixed(4)} / ${dailyBudget.toFixed(4)} USD (UTC)` : undefined,
      ),
    ];
    return { ok: checks.every((entry) => entry.status !== 'error'), checks, snapshot };
  } catch (error) {
    return {
      ok: false,
      checks: [
        check(
          'agent-orchestrator-database',
          'error',
          'Agenten-Orchestrierung konnte nicht geprüft werden.',
          error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined,
        ),
      ],
    };
  }
}

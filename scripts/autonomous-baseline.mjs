import pg from 'pg';

function boundedDays(value) {
  const parsed = Number(value ?? 30);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(365, Math.trunc(parsed))) : 30;
}

function number(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rate(part, total) {
  return total > 0 ? Math.round((part / total) * 10_000) / 100 : null;
}

function keyed(rows, key) {
  return Object.fromEntries(rows.map((row) => [String(row[key]), number(row.count)]));
}

export async function collectAutonomousBaseline(options = {}) {
  const days = boundedDays(options.days);
  const pool = options.pool ?? new pg.Pool({ connectionString: options.databaseUrl ?? process.env.DATABASE_URL });
  const closePool = !options.pool;
  const one = async (sql, params = []) => (await pool.query(sql, params)).rows[0];
  const many = async (sql, params = []) => (await pool.query(sql, params)).rows;
  try {
    const generated = await one('select now() generated_at');
    const settings = await one(`select enabled,automatic_apply,cycle_interval_hours,planning_horizon_days,
       max_formats_per_week,max_productions_per_day,max_shorts_per_day,council_quorum,
       max_request_usd::float8,daily_budget_usd::float8,require_ceo_approval,minimum_active_formats,
       maximum_revision_rounds,audience_council_enabled,audience_council_max_daily
       from autonomous_studio_settings where id=true`);
    const decisions = await one(
      `select count(*)::int total,
       count(*) filter(where created_at>=now()-make_interval(days => $1::int))::int in_window,
       count(*) filter(where status='applied' and created_at>=now()-make_interval(days => $1::int))::int applied,
       count(*) filter(where status='failed' and created_at>=now()-make_interval(days => $1::int))::int failed,
       count(*) filter(where status='rolled_back' and created_at>=now()-make_interval(days => $1::int))::int rolled_back,
       count(*) filter(where status='cancelled' and created_at>=now()-make_interval(days => $1::int))::int cancelled,
       count(*) filter(where status='rejected' and created_at>=now()-make_interval(days => $1::int))::int rejected,
       count(*) filter(where revision_number>0 and created_at>=now()-make_interval(days => $1::int))::int revisions,
       round(avg(extract(epoch from (approved_at-created_at)))
         filter(where approved_at is not null and created_at>=now()-make_interval(days => $1::int)))::int avg_seconds_to_approval,
       round(avg(extract(epoch from (applied_at-created_at)))
         filter(where applied_at is not null and created_at>=now()-make_interval(days => $1::int)))::int avg_seconds_to_apply
       from autonomous_studio_decisions`,
      [days],
    );
    const [statuses, sources, kinds] = await Promise.all([
      many('select status,count(*)::int count from autonomous_studio_decisions group by status order by status'),
      many(
        `select source,count(*)::int count from autonomous_studio_decisions
         where created_at>=now()-make_interval(days => $1::int) group by source order by source`,
        [days],
      ),
      many(
        `select kind,count(*)::int count from autonomous_studio_decisions
         where created_at>=now()-make_interval(days => $1::int) group by kind order by kind`,
        [days],
      ),
    ]);
    const invariant = await one(`select count(*)::int violations from autonomous_studio_decisions d
      where d.status in ('awaiting_ceo','approved','applying','applied') and (
        (select count(*) from autonomous_studio_council_votes v where v.decision_id=d.id and v.vote='approve')
          < (select council_quorum from autonomous_studio_settings where id=true)
        or (select count(*) from autonomous_studio_reviews r where r.decision_id=d.id and r.decision='approve')<2
        or (select count(distinct reviewer_model) from autonomous_studio_reviews r
            where r.decision_id=d.id and r.decision='approve')<2)`);
    const operations = await one(`select
      (select count(*)::int from broadcast_templates where active=true and deleted_at is null) active_formats,
      (select count(*)::int from broadcast_playlists
        where scheduled_at between now() and now()+interval '24 hours') shows_next_24h,
      (select count(*)::int from ai_host_chat_messages
        where received_at>now()-interval '24 hours') chat_messages_24h,
      (select count(*)::int from autonomous_studio_audience_inputs
        where created_at>now()-interval '24 hours') audience_inputs_24h,
      (select count(*)::int from notifications
        where resolved_at is null and level in ('error','critical')) open_incidents,
      (select count(*)::int from autonomous_studio_deliverables where status='ready') ready_deliverables`);
    const budget = await one(`select
      coalesce(sum(actual_cost_usd) filter(where status='completed'),0)::float8 spent_usd,
      coalesce(sum(reserved_cost_usd) filter(where status in ('reserved','uncertain')),0)::float8 reserved_usd,
      count(*) filter(where status='completed')::int paid_requests,
      count(*) filter(where status='blocked')::int blocked_requests
      from openrouter_usage_events
      where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'`);
    const council = await one(`select count(*) filter(where enabled)::int enabled_members,
      count(*)::int configured_members,
      count(distinct preferred_model) filter(where enabled)::int preferred_model_families
      from autonomous_studio_council_members`);
    const windowCount = number(decisions.in_window);
    const terminal = ['applied', 'failed', 'rolled_back', 'cancelled', 'rejected'].reduce(
      (sum, key) => sum + number(decisions[key]),
      0,
    );
    return {
      schemaVersion: 1,
      generatedAt: new Date(generated.generated_at).toISOString(),
      windowDays: days,
      settings: {
        ...settings,
        max_request_usd: number(settings.max_request_usd),
        daily_budget_usd: number(settings.daily_budget_usd),
      },
      decisions: {
        ...decisions,
        total: number(decisions.total),
        in_window: windowCount,
        applied: number(decisions.applied),
        failed: number(decisions.failed),
        rolled_back: number(decisions.rolled_back),
        cancelled: number(decisions.cancelled),
        rejected: number(decisions.rejected),
        revisions: number(decisions.revisions),
        success_rate_percent: rate(number(decisions.applied), terminal),
        failure_rate_percent: rate(number(decisions.failed), windowCount),
        revision_rate_percent: rate(number(decisions.revisions), windowCount),
      },
      status: keyed(statuses, 'status'),
      sources: keyed(sources, 'source'),
      kinds: keyed(kinds, 'kind'),
      approvalInvariantViolations: number(invariant.violations),
      operations: Object.fromEntries(Object.entries(operations).map(([key, value]) => [key, number(value)])),
      budget: Object.fromEntries(Object.entries(budget).map(([key, value]) => [key, number(value)])),
      council: Object.fromEntries(Object.entries(council).map(([key, value]) => [key, number(value)])),
    };
  } finally {
    if (closePool) await pool.end();
  }
}

function shown(value, suffix = '') {
  return value === null || value === undefined ? 'nicht messbar' : `${value}${suffix}`;
}

export function formatAutonomousBaseline(baseline) {
  return (
    `# Autonomie-Baseline\n\n` +
    `Erfasst: ${baseline.generatedAt} · Fenster: ${baseline.windowDays} Tage\n\n` +
    `| Kennzahl | Wert |\n| --- | ---: |\n` +
    `| Entscheidungen im Fenster | ${baseline.decisions.in_window} |\n` +
    `| Angewendet | ${baseline.decisions.applied} |\n` +
    `| Erfolgsquote terminaler Entscheidungen | ${shown(baseline.decisions.success_rate_percent, ' %')} |\n` +
    `| Fehlerrate | ${shown(baseline.decisions.failure_rate_percent, ' %')} |\n` +
    `| Revisionsquote | ${shown(baseline.decisions.revision_rate_percent, ' %')} |\n` +
    `| Mittlere Zeit bis Freigabe | ${shown(baseline.decisions.avg_seconds_to_approval, ' s')} |\n` +
    `| Mittlere Zeit bis Anwendung | ${shown(baseline.decisions.avg_seconds_to_apply, ' s')} |\n` +
    `| Verletzungen der Freigabeinvariante | ${baseline.approvalInvariantViolations} |\n` +
    `| Aktive Formate | ${baseline.operations.active_formats} |\n` +
    `| Sendungen in den nächsten 24 h | ${baseline.operations.shows_next_24h} |\n` +
    `| Chatnachrichten letzte 24 h | ${baseline.operations.chat_messages_24h} |\n` +
    `| Offene Fehler/Kritisch-Meldungen | ${baseline.operations.open_incidents} |\n` +
    `| OpenRouter-Ausgaben heute | ${baseline.budget.spent_usd.toFixed(4)} USD |\n` +
    `| OpenRouter-Reservierungen heute | ${baseline.budget.reserved_usd.toFixed(4)} USD |\n`
  );
}

async function main() {
  const daysArg = process.argv.find((argument) => argument.startsWith('--days='));
  const baseline = await collectAutonomousBaseline({ days: daysArg?.split('=', 2)[1] });
  process.stdout.write(
    process.argv.includes('--json') ? `${JSON.stringify(baseline, null, 2)}\n` : formatAutonomousBaseline(baseline),
  );
}

if (process.argv[1] && new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname) {
  main().catch((error) => {
    console.error(
      `Autonomie-Baseline konnte nicht gelesen werden: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}

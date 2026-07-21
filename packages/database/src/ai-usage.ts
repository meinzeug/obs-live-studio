import type { QueryResultRow } from 'pg';
import { query, transaction } from './index.js';
import { resolveOperationalNotification, upsertOperationalNotification } from './notifications.js';

export type OpenRouterBudgetSummary = {
  date: string;
  dailyLimitUsd: number;
  requestLimitUsd: number;
  spentUsd: number;
  reservedUsd: number;
  remainingUsd: number;
  paidRequests: number;
  blockedRequests: number;
  lastPaidModel: string | null;
  lastPaidAt: string | null;
};

export type OpenRouterBudgetReservation =
  | {
      ok: true;
      reservationId: string;
      reservedUsd: number;
      remainingUsd: number;
    }
  | {
      ok: false;
      reason: 'daily-budget-disabled' | 'daily-budget-exhausted';
      remainingUsd: number;
    };

type BudgetAggregate = QueryResultRow & {
  spent_usd: number | string;
  reserved_usd: number | string;
  paid_requests: number | string;
  blocked_requests: number | string;
};

const budgetNotificationKey = 'openrouter:paid-budget';

function amount(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function money(value: unknown) {
  return Math.round(amount(value) * 100_000_000) / 100_000_000;
}

function utcDayStartSql() {
  return "date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'";
}

async function aggregateForToday(client: { query: typeof query }) {
  return (
    await client.query<BudgetAggregate>(
      `select
         coalesce(sum(actual_cost_usd) filter(where status='completed'),0)::float8 spent_usd,
         coalesce(sum(reserved_cost_usd) filter(where status in ('reserved','uncertain')),0)::float8 reserved_usd,
         count(*) filter(where status='completed')::int paid_requests,
         count(*) filter(where status='blocked')::int blocked_requests
       from openrouter_usage_events
       where created_at >= ${utcDayStartSql()}`,
    )
  ).rows[0]!;
}

export async function reserveOpenRouterBudget(input: {
  task: string;
  modelCandidates: string[];
  dailyBudgetUsd: number;
  requestLimitUsd: number;
}): Promise<OpenRouterBudgetReservation> {
  const dailyBudgetUsd = amount(input.dailyBudgetUsd);
  const requestLimitUsd = Math.min(amount(input.requestLimitUsd), dailyBudgetUsd);
  return transaction(async (client) => {
    await client.query(
      "select pg_advisory_xact_lock(hashtext('openrouter-paid-budget-' || (now() at time zone 'UTC')::date::text))",
    );
    const totals = await aggregateForToday(client as unknown as { query: typeof query });
    const committed = money(amount(totals.spent_usd) + amount(totals.reserved_usd));
    const remainingUsd = money(Math.max(0, dailyBudgetUsd - committed));
    const reason =
      dailyBudgetUsd <= 0 || requestLimitUsd <= 0
        ? 'daily-budget-disabled'
        : remainingUsd + Number.EPSILON < requestLimitUsd
          ? 'daily-budget-exhausted'
          : null;
    if (reason) {
      await client.query(
        `insert into openrouter_usage_events(task,status,model_candidates,blocked_reason)
         values($1,'blocked',$2::jsonb,$3)`,
        [input.task, JSON.stringify(input.modelCandidates), reason],
      );
      return { ok: false as const, reason, remainingUsd };
    }
    const row = (
      await client.query<{ id: string }>(
        `insert into openrouter_usage_events(task,status,model_candidates,reserved_cost_usd)
         values($1,'reserved',$2::jsonb,$3) returning id`,
        [input.task, JSON.stringify(input.modelCandidates), requestLimitUsd],
      )
    ).rows[0]!;
    return {
      ok: true as const,
      reservationId: row.id,
      reservedUsd: requestLimitUsd,
      remainingUsd: money(Math.max(0, remainingUsd - requestLimitUsd)),
    };
  });
}

export async function settleOpenRouterBudget(input: {
  reservationId: string;
  model: string;
  costUsd: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}) {
  await query(
    `update openrouter_usage_events
     set status='completed',model=$2,actual_cost_usd=$3,prompt_tokens=$4,completion_tokens=$5,total_tokens=$6,
         completed_at=now(),blocked_reason=null
     where id=$1 and status='reserved'`,
    [
      input.reservationId,
      input.model,
      amount(input.costUsd),
      input.promptTokens,
      input.completionTokens,
      input.totalTokens,
    ],
  );
}

export async function failOpenRouterBudgetReservation(
  reservationId: string,
  options: { uncertain?: boolean; reason?: string } = {},
) {
  await query(
    `update openrouter_usage_events
     set status=$2,blocked_reason=$3,completed_at=now()
     where id=$1 and status='reserved'`,
    [reservationId, options.uncertain ? 'uncertain' : 'failed', options.reason?.slice(0, 500) ?? null],
  );
}

export async function recordOpenRouterBudgetBlock(input: { task: string; modelCandidates: string[]; reason: string }) {
  await query(
    `insert into openrouter_usage_events(task,status,model_candidates,blocked_reason)
     values($1,'blocked',$2::jsonb,$3)`,
    [input.task, JSON.stringify(input.modelCandidates), input.reason.slice(0, 500)],
  );
}

export async function getOpenRouterBudgetSummary(
  dailyLimitUsd: number,
  requestLimitUsd: number,
): Promise<OpenRouterBudgetSummary> {
  const totals = await aggregateForToday({ query });
  const recent = (
    await query<{ model: string | null; completed_at: string | null }>(
      `select model,completed_at from openrouter_usage_events
       where status='completed' and created_at >= ${utcDayStartSql()}
       order by completed_at desc nulls last limit 1`,
    )
  ).rows[0];
  const spentUsd = money(totals.spent_usd);
  const reservedUsd = money(totals.reserved_usd);
  return {
    date: new Date().toISOString().slice(0, 10),
    dailyLimitUsd: amount(dailyLimitUsd),
    requestLimitUsd: amount(requestLimitUsd),
    spentUsd,
    reservedUsd,
    remainingUsd: money(Math.max(0, amount(dailyLimitUsd) - spentUsd - reservedUsd)),
    paidRequests: Number(totals.paid_requests ?? 0),
    blockedRequests: Number(totals.blocked_requests ?? 0),
    lastPaidModel: recent?.model ?? null,
    lastPaidAt: recent?.completed_at ?? null,
  };
}

export const openRouterDatabaseBudgetAdapter = {
  async reserve(input: Parameters<typeof reserveOpenRouterBudget>[0]) {
    const result = await reserveOpenRouterBudget(input);
    if (result.ok) {
      await resolveOperationalNotification(budgetNotificationKey).catch(() => null);
      return result;
    }
    await upsertOperationalNotification({
      level: 'warning',
      component: 'openrouter',
      dedupeKey: budgetNotificationKey,
      message: 'Der bezahlte OpenRouter-Fallback wurde durch das Ausgabenbudget gestoppt.',
      details: {
        task: input.task,
        reason: result.reason,
        dailyBudgetUsd: input.dailyBudgetUsd,
        requestLimitUsd: input.requestLimitUsd,
        remainingUsd: result.remainingUsd,
        requiredAction: 'KI-Budget prüfen oder auf die nächste UTC-Tagesperiode warten.',
      },
    }).catch(() => null);
    return result;
  },
  settle: settleOpenRouterBudget,
  fail: failOpenRouterBudgetReservation,
  async block(input: {
    task: string;
    modelCandidates: string[];
    dailyBudgetUsd: number;
    requestLimitUsd: number;
    reason: string;
  }) {
    await recordOpenRouterBudgetBlock(input);
    await upsertOperationalNotification({
      level: 'warning',
      component: 'openrouter',
      dedupeKey: budgetNotificationKey,
      message: 'Für den bezahlten OpenRouter-Fallback wurde kein Modell innerhalb des Budgets gefunden.',
      details: {
        task: input.task,
        reason: input.reason,
        dailyBudgetUsd: input.dailyBudgetUsd,
        requestLimitUsd: input.requestLimitUsd,
        requiredAction: 'Limit je Anfrage erhöhen oder OpenRouter-Modellkatalog erneut prüfen.',
      },
    }).catch(() => null);
  },
};

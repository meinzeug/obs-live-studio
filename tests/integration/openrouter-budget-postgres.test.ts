import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool, query } from '@ans/database';
import {
  failOpenRouterBudgetReservation,
  getOpenRouterBudgetSummary,
  reserveOpenRouterBudget,
  settleOpenRouterBudget,
} from '@ans/database/ai-usage';
import { runMigrations } from '../../packages/database/src/migrate.js';

describe('OpenRouter budget ledger integration', () => {
  beforeAll(runMigrations);
  beforeEach(async () => {
    await query("delete from openrouter_usage_events where task like 'vitest-budget%'");
  });
  afterAll(async () => {
    await query("delete from openrouter_usage_events where task like 'vitest-budget%'");
    await pool.end();
  });

  it('serializes concurrent reservations and releases the unused amount after settlement', async () => {
    const baseline = await getOpenRouterBudgetSummary(1000, 0.03);
    const baselineCommittedUsd = baseline.spentUsd + baseline.reservedUsd;
    const input = {
      task: 'vitest-budget-chat',
      modelCandidates: ['provider/cheap-model'],
      dailyBudgetUsd: baselineCommittedUsd + 0.05,
      requestLimitUsd: 0.03,
    };
    const reservations = await Promise.all([reserveOpenRouterBudget(input), reserveOpenRouterBudget(input)]);
    const accepted = reservations.find((reservation) => reservation.ok);
    const denied = reservations.find((reservation) => !reservation.ok);

    expect(accepted).toMatchObject({ ok: true, reservedUsd: 0.03 });
    expect(denied).toMatchObject({ ok: false, reason: 'daily-budget-exhausted' });
    if (!accepted?.ok) throw new Error('Budgetreservierung wurde unerwartet abgelehnt.');
    await settleOpenRouterBudget({
      reservationId: accepted.reservationId,
      model: 'provider/cheap-model',
      costUsd: 0.01,
      promptTokens: 100,
      completionTokens: 40,
      totalTokens: 140,
    });

    const next = await reserveOpenRouterBudget(input);
    expect(next).toMatchObject({ ok: true, reservedUsd: 0.03 });
    const summary = await getOpenRouterBudgetSummary(input.dailyBudgetUsd, 0.03);
    expect(summary.spentUsd).toBeCloseTo(baseline.spentUsd + 0.01, 8);
    expect(summary.reservedUsd).toBeCloseTo(baseline.reservedUsd + 0.03, 8);
    expect(summary.remainingUsd).toBeCloseTo(0.01, 8);
    expect(summary.paidRequests).toBe(baseline.paidRequests + 1);
    expect(summary.blockedRequests).toBe(baseline.blockedRequests + 1);
    expect(summary.lastPaidModel).toBe('provider/cheap-model');

    if (next.ok) await failOpenRouterBudgetReservation(next.reservationId, { reason: 'vitest cleanup' });
    const released = await getOpenRouterBudgetSummary(input.dailyBudgetUsd, 0.03);
    expect(released.reservedUsd).toBeCloseTo(baseline.reservedUsd, 8);
    expect(released.remainingUsd).toBeCloseTo(0.04, 8);
  });
});

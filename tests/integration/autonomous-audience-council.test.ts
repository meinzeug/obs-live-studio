import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { query } from '../../packages/database/src/index.js';
import {
  completeAutonomousDecision,
  recordAutonomousCouncilVote,
  recordAutonomousIndependentReview,
  registerAutonomousAudienceInput,
} from '../../packages/database/src/autonomous-studio.js';
import { insertAiHostChatMessages } from '../../packages/database/src/ai-staff.js';

const integration = process.env.VITEST_INCLUDE_INTEGRATION === 'true' ? describe : describe.skip;
const sessionIds: string[] = [];
const decisionIds: string[] = [];

integration('autonomous audience council', () => {
  afterEach(async () => {
    if (sessionIds.length) await query('delete from ai_host_sessions where id=any($1::uuid[])', [sessionIds.splice(0)]);
    if (decisionIds.length)
      await query('delete from autonomous_studio_decisions where id=any($1::uuid[])', [decisionIds.splice(0)]);
  });

  async function chatMessage(message: string) {
    const session = (
      await query<{ id: string }>(
        `insert into ai_host_sessions(youtube_video_id,video_title,channel_title,video_url,status)
         values($1,'Integration Sendung','Integration Kanal',$2,'live') returning id`,
        [`integration-${randomUUID()}`, 'https://example.invalid/integration'],
      )
    ).rows[0]!;
    sessionIds.push(session.id);
    const providerMessageId = `integration-${randomUUID()}`;
    await insertAiHostChatMessages(session.id, [
      {
        provider: 'studio',
        providerMessageId,
        authorName: 'Integration Viewer',
        message,
        safe: true,
        publishedAt: new Date().toISOString(),
      },
    ]);
    const row = (
      await query<{ id: string }>('select id from ai_host_chat_messages where provider=$1 and provider_message_id=$2', [
        'studio',
        providerMessageId,
      ])
    ).rows[0]!;
    return { sessionId: session.id, messageId: row.id };
  }

  it('turns a viewer objection into a non-executable council decision protected by the double-approval trigger', async () => {
    const chat = await chatMessage('!einwand Die gezeigte Zahl braucht eine aktuellere belastbare Primärquelle');
    const result = await registerAutonomousAudienceInput({
      chatMessageId: chat.messageId,
      sessionId: chat.sessionId,
      provider: 'studio',
      authorName: 'Integration Viewer',
      kind: 'objection',
      command: '!einwand',
      text: 'Die gezeigte Zahl braucht eine aktuellere belastbare Primärquelle',
      fingerprint: `integration:${randomUUID()}`,
    });

    expect(result).toMatchObject({ accepted: true, duplicate: false, status: 'council' });
    expect(result.decisionId).toBeTruthy();
    decisionIds.push(result.decisionId!);
    const decision = (
      await query<{ source: string; kind: string; status: string; requested_by_system: string }>(
        'select source,kind,status,requested_by_system from autonomous_studio_decisions where id=$1',
        [result.decisionId],
      )
    ).rows[0];
    expect(decision).toEqual({
      source: 'audience',
      kind: 'directive',
      status: 'awaiting_council',
      requested_by_system: 'audience:studio',
    });
    await expect(
      query("update autonomous_studio_decisions set status='approved' where id=$1", [result.decisionId]),
    ).rejects.toMatchObject({ code: '23514' });
    await query("update autonomous_studio_decisions set error='transienter Providerfehler' where id=$1", [
      result.decisionId,
    ]);

    const members = (
      await query<{ id: string }>(
        'select id from autonomous_studio_council_members where enabled=true order by sort_order limit 3',
      )
    ).rows;
    const checks = ['editorial', 'evidence', 'safety', 'feasibility', 'budget', 'diversity'].map((area) => ({
      area,
      passed: true,
      finding: `${area} im Integrationstest bestanden`,
    }));
    for (const [index, member] of members.entries())
      await recordAutonomousCouncilVote({
        decisionId: result.decisionId!,
        councilMemberId: member.id,
        model: `council-model-${index + 1}`,
        tier: 'paid',
        vote: 'approve',
        score: 90,
        summary: 'Der Vorschlag ist nach den sechs Prüfbereichen kontrolliert umsetzbar.',
        checks,
        blockers: [],
        requiredChanges: [],
        usage: { cost: 0.01 },
      });
    await expect(
      query("update autonomous_studio_decisions set instruction='Nachträglich ausgetauscht' where id=$1", [
        result.decisionId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    expect(
      (
        await query<{ status: string; error: string | null }>(
          'select status,error from autonomous_studio_decisions where id=$1',
          [result.decisionId],
        )
      ).rows[0],
    ).toEqual({ status: 'awaiting_reviews', error: null });

    await recordAutonomousIndependentReview({
      decisionId: result.decisionId!,
      slot: 1,
      model: 'independent-model-a',
      tier: 'paid',
      decision: 'approve',
      score: 92,
      summary: 'Die erste unabhängige Prüfung stimmt nach vollständiger Kontrolle zu.',
      checks,
      blockers: [],
      requiredChanges: [],
      usage: { cost: 0.01 },
    });
    await recordAutonomousIndependentReview({
      decisionId: result.decisionId!,
      slot: 2,
      model: 'independent-model-b',
      tier: 'paid',
      decision: 'approve',
      score: 93,
      summary: 'Die zweite unabhängige Prüfung stimmt mit einem anderen Modell zu.',
      checks,
      blockers: [],
      requiredChanges: [],
      usage: { cost: 0.01 },
    });
    expect(
      (
        await query<{ status: string }>('select status from autonomous_studio_decisions where id=$1', [
          result.decisionId,
        ])
      ).rows[0]?.status,
    ).toBe('approved');

    await query(
      `insert into autonomous_studio_announcements(decision_id,headline,text,status,presented_at)
       values($1,'Alte Beratung','Der Einwand war zunächst noch nicht entscheidungsreif.','presented',now())`,
      [result.decisionId],
    );
    await query("update autonomous_studio_decisions set status='applying' where id=$1", [result.decisionId]);
    const completed = await completeAutonomousDecision({
      id: result.decisionId!,
      snapshotBefore: { policy: 'vorher' },
      applyResult: { policy: 'nachher' },
      announcement: {
        headline: 'Publikumseinwand wird umgesetzt',
        text: 'Der vollständig geprüfte Einwand ist freigegeben und wird kontrolliert umgesetzt.',
      },
    });
    expect(completed?.status).toBe('applied');
    expect(
      (
        await query<{
          headline: string;
          status: string;
          session_id: string | null;
          turn_id: string | null;
          presented_at: string | null;
        }>(
          `select headline,status,session_id,turn_id,presented_at
           from autonomous_studio_announcements where decision_id=$1`,
          [result.decisionId],
        )
      ).rows[0],
    ).toEqual({
      headline: 'Publikumseinwand wird umgesetzt',
      status: 'queued',
      session_id: null,
      turn_id: null,
      presented_at: null,
    });
  });

  it('records a pro signal without creating or applying a studio decision', async () => {
    const chat = await chatMessage('!pro Mehr Quellen direkt im Overlay');
    const result = await registerAutonomousAudienceInput({
      chatMessageId: chat.messageId,
      sessionId: chat.sessionId,
      provider: 'studio',
      authorName: 'Integration Viewer',
      kind: 'pro',
      command: '!pro',
      text: 'Mehr Quellen direkt im Overlay',
      fingerprint: `integration:${randomUUID()}`,
    });

    expect(result).toMatchObject({ accepted: true, status: 'represented', decisionId: null });
    const stored = (
      await query<{ status: string; decision_id: string | null }>(
        'select status,decision_id from autonomous_studio_audience_inputs where chat_message_id=$1',
        [chat.messageId],
      )
    ).rows[0];
    expect(stored).toEqual({ status: 'represented', decision_id: null });
  });
});

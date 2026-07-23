import type { QueryResultRow } from 'pg';
import { query, transaction } from './index.js';

export type AudienceGreetingProvider = 'youtube' | 'twitch' | 'studio';
export type AudienceGreetingEventType =
  | 'youtube-membership'
  | 'youtube-subscription'
  | 'youtube-like'
  | 'twitch-subscription'
  | 'twitch-follow'
  | 'studio-test';

export type AudienceGreetingEvent = QueryResultRow & {
  id: string;
  provider: AudienceGreetingProvider;
  provider_event_id: string;
  event_type: AudienceGreetingEventType;
  viewer_id: string | null;
  viewer_name: string | null;
  quantity: number;
  named: boolean;
  status: 'pending' | 'claimed' | 'scheduled' | 'ignored' | 'failed';
  session_id: string | null;
  turn_id: string | null;
  metadata: Record<string, unknown>;
  attempts: number;
  error: string | null;
  occurred_at: string;
  claimed_at: string | null;
  greeted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AudienceGreetingProviderState = QueryResultRow & {
  provider_key: string;
  state: Record<string, unknown>;
  last_success_at: string | null;
  retry_at: string | null;
  error: string | null;
  updated_at: string;
};

function compact(value: string | null | undefined, maximum: number) {
  return value?.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum) || null;
}

export async function queueAudienceGreetingEvent(input: {
  provider: AudienceGreetingProvider;
  providerEventId: string;
  eventType: AudienceGreetingEventType;
  viewerId?: string | null;
  viewerName?: string | null;
  quantity?: number;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}) {
  const viewerName = compact(input.viewerName, 120);
  return (
    (
      await query<AudienceGreetingEvent>(
        `insert into audience_greeting_events(
           provider,provider_event_id,event_type,viewer_id,viewer_name,quantity,named,metadata,occurred_at
         ) values($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz)
         on conflict(provider,provider_event_id) do nothing returning *`,
        [
          input.provider,
          compact(input.providerEventId, 500),
          input.eventType,
          compact(input.viewerId, 240),
          viewerName,
          Math.max(1, Math.min(100_000, Math.floor(input.quantity ?? 1))),
          Boolean(viewerName),
          input.metadata ?? {},
          input.occurredAt ?? new Date().toISOString(),
        ],
      )
    ).rows[0] ?? null
  );
}

export async function claimNextAudienceGreetingEvent(sessionId: string, cooldownSeconds: number) {
  return transaction(async (client) => {
    await client.query(
      `update audience_greeting_events
       set status='pending',claimed_at=null,updated_at=now(),error='Verwaiste Reservierung automatisch freigegeben.'
       where status='claimed' and claimed_at < now()-interval '5 minutes'`,
    );
    await client.query(
      `update audience_greeting_events set status='ignored',updated_at=now(),error='Ereignis war für einen Live-Gruß zu alt.'
       where status='pending' and occurred_at < now()-interval '12 hours'`,
    );
    const recent = (
      await client.query<{ blocked: boolean }>(
        `select exists(
           select 1 from audience_greeting_events
           where status='scheduled' and greeted_at > now()-($1::int * interval '1 second')
         ) blocked`,
        [Math.max(15, Math.min(900, Math.floor(cooldownSeconds)))],
      )
    ).rows[0]?.blocked;
    if (recent) return null;
    return (
      (
        await client.query<AudienceGreetingEvent>(
          `with candidate as (
             select id from audience_greeting_events
             where status='pending'
             order by occurred_at asc,created_at asc
             for update skip locked limit 1
           )
           update audience_greeting_events event
           set status='claimed',session_id=$1,claimed_at=now(),attempts=attempts+1,error=null,updated_at=now()
           from candidate where event.id=candidate.id returning event.*`,
          [sessionId],
        )
      ).rows[0] ?? null
    );
  });
}

export async function scheduleAudienceGreetingEvent(id: string, sessionId: string, turnId: string) {
  return (
    (
      await query<AudienceGreetingEvent>(
        `update audience_greeting_events
         set status='scheduled',session_id=$2,turn_id=$3,greeted_at=now(),updated_at=now()
         where id=$1 and status='claimed' returning *`,
        [id, sessionId, turnId],
      )
    ).rows[0] ?? null
  );
}

export async function releaseAudienceGreetingEvent(id: string, error: string) {
  return (
    (
      await query<AudienceGreetingEvent>(
        `update audience_greeting_events set
           status=case when attempts>=3 then 'failed' else 'pending' end,
           claimed_at=null,error=$2,updated_at=now()
         where id=$1 and status='claimed' returning *`,
        [id, compact(error, 1200)],
      )
    ).rows[0] ?? null
  );
}

export async function getAudienceGreetingProviderState(providerKey: string) {
  return (
    (
      await query<AudienceGreetingProviderState>(
        'select * from audience_greeting_provider_state where provider_key=$1',
        [compact(providerKey, 240)],
      )
    ).rows[0] ?? null
  );
}

export async function setAudienceGreetingProviderState(input: {
  providerKey: string;
  state: Record<string, unknown>;
  success?: boolean;
  retryAt?: string | null;
  error?: string | null;
}) {
  return (
    await query<AudienceGreetingProviderState>(
      `insert into audience_greeting_provider_state(provider_key,state,last_success_at,retry_at,error)
       values($1,$2,case when $3 then now() else null end,$4::timestamptz,$5)
       on conflict(provider_key) do update set
         state=excluded.state,
         last_success_at=case when $3 then now() else audience_greeting_provider_state.last_success_at end,
         retry_at=excluded.retry_at,error=excluded.error,updated_at=now()
       returning *`,
      [
        compact(input.providerKey, 240),
        input.state,
        input.success === true,
        input.retryAt ?? null,
        compact(input.error, 1200),
      ],
    )
  ).rows[0]!;
}

export async function audienceGreetingSummary(limit = 30) {
  const [counts, events, providers] = await Promise.all([
    query<{
      pending: number;
      scheduled_today: number;
      named_today: number;
      failed: number;
    }>(`select
          count(*) filter(where status in ('pending','claimed'))::int pending,
          count(*) filter(where status='scheduled' and greeted_at>=date_trunc('day',now()))::int scheduled_today,
          count(*) filter(where status='scheduled' and named=true and greeted_at>=date_trunc('day',now()))::int named_today,
          count(*) filter(where status='failed')::int failed
        from audience_greeting_events`),
    query<AudienceGreetingEvent>('select * from audience_greeting_events order by created_at desc limit $1', [
      Math.max(1, Math.min(100, Math.floor(limit))),
    ]),
    query<AudienceGreetingProviderState>('select * from audience_greeting_provider_state order by provider_key'),
  ]);
  return { counts: counts.rows[0]!, events: events.rows, providers: providers.rows };
}


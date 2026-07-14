import type { QueryResultRow } from 'pg';
import { query } from './index.js';

export type NotificationLevel = 'info' | 'warning' | 'error' | 'critical';

export interface OperationalNotificationRecord extends QueryResultRow {
  id: string;
  level: NotificationLevel;
  component: string;
  message: string;
  dedupe_key: string | null;
  details: Record<string, unknown>;
  occurrences: number;
  created_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  user_read_at?: string | null;
}

function normalizedText(value: unknown, maximum: number) {
  return String(value ?? '').trim().slice(0, maximum);
}

function normalizedDetails(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export async function upsertOperationalNotification(input: {
  level: NotificationLevel;
  component: string;
  message: string;
  dedupeKey: string;
  details?: Record<string, unknown>;
}) {
  const component = normalizedText(input.component, 100) || 'system';
  const message = normalizedText(input.message, 1000);
  const dedupeKey = normalizedText(input.dedupeKey, 250);
  if (!message) throw new Error('Benachrichtigung benötigt eine Nachricht');
  if (!dedupeKey) throw new Error('Benachrichtigung benötigt einen Deduplizierungsschlüssel');
  return (
    await query<OperationalNotificationRecord>(
      `insert into notifications(level,component,message,dedupe_key,details,last_seen_at,occurrences)
       values($1,$2,$3,$4,$5,now(),1)
       on conflict(dedupe_key) where dedupe_key is not null and resolved_at is null
       do update set level=excluded.level,component=excluded.component,message=excluded.message,
         details=excluded.details,last_seen_at=now(),occurrences=notifications.occurrences+1
       returning *`,
      [input.level, component, message, dedupeKey, normalizedDetails(input.details)],
    )
  ).rows[0];
}

export async function resolveOperationalNotification(dedupeKey: string) {
  return (
    await query<OperationalNotificationRecord>(
      `update notifications set resolved_at=now(),last_seen_at=now()
       where dedupe_key=$1 and resolved_at is null returning *`,
      [normalizedText(dedupeKey, 250)],
    )
  ).rows[0] ?? null;
}

export async function listOperationalNotifications(
  userId: string,
  options: { limit?: number; includeResolved?: boolean } = {},
) {
  const limit = Math.max(1, Math.min(200, Number(options.limit ?? 100)));
  const includeResolved = options.includeResolved === true;
  return (
    await query<OperationalNotificationRecord>(
      `select n.*,nr.read_at user_read_at
       from notifications n
       left join notification_reads nr on nr.notification_id=n.id and nr.user_id=$1
       where $2::boolean or n.resolved_at is null
       order by (n.resolved_at is null) desc,
         case n.level when 'critical' then 4 when 'error' then 3 when 'warning' then 2 else 1 end desc,
         n.last_seen_at desc
       limit $3`,
      [userId, includeResolved, limit],
    )
  ).rows;
}

export async function unreadOperationalNotificationCount(userId: string) {
  const row = (
    await query<{ count: string }>(
      `select count(*)::text count
       from notifications n
       left join notification_reads nr on nr.notification_id=n.id and nr.user_id=$1
       where n.resolved_at is null and nr.notification_id is null`,
      [userId],
    )
  ).rows[0];
  return Number(row?.count ?? 0);
}

export async function markOperationalNotificationRead(notificationId: string, userId: string) {
  const exists = (
    await query<{ id: string }>('select id from notifications where id=$1', [notificationId])
  ).rows[0];
  if (!exists) return null;
  await query(
    `insert into notification_reads(notification_id,user_id,read_at) values($1,$2,now())
     on conflict(notification_id,user_id) do update set read_at=excluded.read_at`,
    [notificationId, userId],
  );
  return exists;
}

export async function markAllOperationalNotificationsRead(userId: string) {
  const result = await query(
    `insert into notification_reads(notification_id,user_id,read_at)
     select id,$1,now() from notifications where resolved_at is null
     on conflict(notification_id,user_id) do update set read_at=excluded.read_at`,
    [userId],
  );
  return result.rowCount ?? 0;
}

export async function queueSourceFetch(sourceId: string) {
  const source = (
    await query<{ id: string; name: string }>(
      'select id,name from sources where id=$1 and deleted_at is null',
      [sourceId],
    )
  ).rows[0];
  if (!source) return { source: null, queued: false, alreadyQueued: false };
  const job = (
    await query<{ id: string }>(
      `insert into worker_jobs(kind,payload,scheduled_at)
       values('fetch-source',jsonb_build_object('sourceId',$1::text),now())
       on conflict do nothing returning id`,
      [sourceId],
    )
  ).rows[0];
  return { source, queued: Boolean(job), alreadyQueued: !job };
}

import { query, transaction } from './index.js';
export type RoleName = 'administrator' | 'redaktion' | 'nur_lesen';
const ADMIN_MUTATION_LOCK_KEY = '4711708359795182';

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  role: RoleName;
  active: boolean;
  permissions: string[];
}
export interface SessionRecord {
  id: string;
  user_id: string;
  csrf_token: string;
  token_hash: string;
  user_agent: string | null;
  ip_address: string | null;
  expires_at: string;
  created_at: string;
}
export interface ActiveSessionRecord {
  id: string;
  user_id: string;
  email: string;
  display_name: string;
  user_agent: string | null;
  ip_address: string | null;
  expires_at: string;
  created_at: string;
}
export interface AuditLogRecord {
  id: string;
  user_id: string | null;
  user_email: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}
const roleSql = `insert into roles(name,description) values ('administrator','Vollzugriff'),('redaktion','Redaktionelle Schreibrechte'),('nur_lesen','Nur-Lesen') on conflict(name) do nothing`;
const permissionSql = `insert into permissions(key,description) values ('sources:write','Quellen verwalten'),('articles:write','Beiträge bearbeiten'),('broadcast:write','Sendelisten und Sendelauf steuern'),('obs:write','OBS steuern'),('users:write','Benutzer und Rollen verwalten') on conflict(key) do nothing`;
export async function ensureAuthDefaults() {
  await transaction(async (c) => {
    await c.query(roleSql);
    await c.query(permissionSql);
    await c.query(
      `insert into role_permissions(role_id,permission_id) select r.id,p.id from roles r cross join permissions p where r.name='administrator' on conflict do nothing`,
    );
    await c.query(
      `insert into role_permissions(role_id,permission_id) select r.id,p.id from roles r join permissions p on p.key in ('sources:write','articles:write','broadcast:write','obs:write') where r.name='redaktion' on conflict do nothing`,
    );
  });
}
export async function needsInitialAdmin() {
  await ensureAuthDefaults();
  return (
    Number(
      (
        await query<{ count: string }>(
          `select count(*) from users u join roles r on r.id=u.role_id where r.name='administrator' and u.deleted_at is null`,
        )
      ).rows[0].count,
    ) === 0
  );
}
export async function createUser(input: { email: string; displayName: string; passwordHash: string; role: RoleName }) {
  await ensureAuthDefaults();
  return (
    await query<AuthUser>(
      `insert into users(email,password_hash,display_name,role_id) select lower($1),$2,$3,r.id from roles r where r.name=$4 returning id,email,display_name,$4::text as role,active,array[]::text[] as permissions`,
      [input.email, input.passwordHash, input.displayName, input.role],
    )
  ).rows[0];
}
export async function createInitialAdmin(input: { email: string; displayName: string; passwordHash: string }) {
  await ensureAuthDefaults();
  return transaction(async (client) => {
    await client.query('select pg_advisory_xact_lock($1::bigint)', [ADMIN_MUTATION_LOCK_KEY]);
    const existing = await client.query(
      `select 1 from users u join roles r on r.id=u.role_id
       where r.name='administrator' and u.deleted_at is null limit 1`,
    );
    if (existing.rowCount) return null;
    return (
      (
        await client.query<AuthUser>(
          `insert into users(email,password_hash,display_name,role_id)
           select lower($1),$2,$3,r.id from roles r where r.name='administrator'
           returning id,email,display_name,'administrator'::text as role,active,array[]::text[] as permissions`,
          [input.email, input.passwordHash, input.displayName],
        )
      ).rows[0] ?? null
    );
  });
}
export async function getUserForLogin(email: string) {
  return (
    (
      await query<{
        id: string;
        email: string;
        display_name: string;
        password_hash: string;
        active: boolean;
        role: RoleName;
      }>(
        `select u.id,u.email,u.display_name,u.password_hash,u.active,r.name as role from users u join roles r on r.id=u.role_id where u.email=lower($1) and u.deleted_at is null`,
        [email],
      )
    ).rows[0] ?? null
  );
}
export async function getAuthUser(id: string) {
  return (
    (
      await query<AuthUser>(
        `select u.id,u.email,u.display_name,r.name as role,u.active,coalesce(array_agg(p.key) filter(where p.key is not null),'{}') permissions from users u join roles r on r.id=u.role_id left join role_permissions rp on rp.role_id=r.id left join permissions p on p.id=rp.permission_id where u.id=$1 and u.deleted_at is null group by u.id,r.name`,
        [id],
      )
    ).rows[0] ?? null
  );
}
export async function createSession(input: {
  userId: string;
  csrfToken: string;
  tokenHash: string;
  ttlSeconds: number;
  userAgent?: string | null;
  ipAddress?: string | null;
}) {
  const userAgent = input.userAgent?.trim().slice(0, 500) || null;
  const ipAddress = input.ipAddress?.trim() || null;
  return (
    await query<SessionRecord>(
      `insert into sessions(user_id,csrf_token,token_hash,user_agent,ip_address,expires_at)
       values($1,$2,$3,$4,nullif($5,'')::inet,now()+($6||' seconds')::interval)
       returning id,user_id,csrf_token,token_hash,user_agent,host(ip_address) ip_address,expires_at,created_at`,
      [input.userId, input.csrfToken, input.tokenHash, userAgent, ipAddress, input.ttlSeconds],
    )
  ).rows[0];
}
export async function getSession(id: string) {
  return (
    (
      await query<SessionRecord>(
        `select id,user_id,csrf_token,token_hash,user_agent,host(ip_address) ip_address,expires_at,created_at
       from sessions where id=$1 and expires_at>now()`,
        [id],
      )
    ).rows[0] ?? null
  );
}
export async function getSessionByTokenHash(tokenHash: string) {
  return (
    (
      await query<SessionRecord>(
        `select id,user_id,csrf_token,token_hash,user_agent,host(ip_address) ip_address,expires_at,created_at
       from sessions where token_hash=$1 and expires_at>now()`,
        [tokenHash],
      )
    ).rows[0] ?? null
  );
}
export async function deleteSession(id: string) {
  return query(`delete from sessions where id=$1`, [id]);
}
export async function listActiveSessions() {
  return (
    await query<ActiveSessionRecord>(
      `select s.id,s.user_id,s.expires_at,s.created_at,s.user_agent,host(s.ip_address) ip_address,
        u.email,u.display_name
       from sessions s join users u on u.id=s.user_id
       where s.expires_at>now() and u.deleted_at is null
       order by s.created_at desc`,
    )
  ).rows;
}
export async function revokeOtherUserSessions(userId: string, currentSessionId: string) {
  return query(`delete from sessions where user_id=$1 and id<>$2`, [userId, currentSessionId]);
}
export async function revokeAllOtherSessions(currentSessionId: string) {
  return query(`delete from sessions where id<>$1`, [currentSessionId]);
}
export async function pruneSessions() {
  await query(`delete from sessions where expires_at<=now()`);
}
export async function listUsers() {
  return (
    await query<AuthUser>(
      `select u.id,u.email,u.display_name,r.name as role,u.active,array[]::text[] permissions from users u join roles r on r.id=u.role_id where u.deleted_at is null order by u.created_at desc`,
    )
  ).rows;
}
export async function updateUserRole(id: string, role: RoleName) {
  return transaction(async (client) => {
    await client.query('select pg_advisory_xact_lock($1::bigint)', [ADMIN_MUTATION_LOCK_KEY]);
    const current = (
      await client.query<{ role: RoleName }>(
        `select r.name role from users u join roles r on r.id=u.role_id
         where u.id=$1 and u.deleted_at is null for update of u`,
        [id],
      )
    ).rows[0];
    if (!current) throw new Error('Benutzer nicht gefunden');
    if (current.role === 'administrator' && role !== 'administrator') {
      const remaining = await client.query(
        `select 1 from users u join roles r on r.id=u.role_id
         where r.name='administrator' and u.active=true and u.deleted_at is null and u.id<>$1 limit 1`,
        [id],
      );
      if (!remaining.rowCount) throw new Error('Der letzte aktive Administrator kann nicht herabgestuft werden');
    }
    return (
      await client.query<AuthUser>(
        `update users set role_id=r.id,version=version+1 from roles r
         where users.id=$1 and r.name=$2 and users.deleted_at is null
         returning users.id,users.email,users.display_name,$2::text as role,users.active,array[]::text[] permissions`,
        [id, role],
      )
    ).rows[0];
  });
}
export async function setUserActive(id: string, active: boolean) {
  return transaction(async (client) => {
    await client.query('select pg_advisory_xact_lock($1::bigint)', [ADMIN_MUTATION_LOCK_KEY]);
    const current = (
      await client.query<{ role: RoleName; active: boolean }>(
        `select r.name role,u.active from users u join roles r on r.id=u.role_id
         where u.id=$1 and u.deleted_at is null for update of u`,
        [id],
      )
    ).rows[0];
    if (!current) throw new Error('Benutzer nicht gefunden');
    if (current.role === 'administrator' && current.active && !active) {
      const remaining = await client.query(
        `select 1 from users u join roles r on r.id=u.role_id
         where r.name='administrator' and u.active=true and u.deleted_at is null and u.id<>$1 limit 1`,
        [id],
      );
      if (!remaining.rowCount) throw new Error('Der letzte aktive Administrator kann nicht deaktiviert werden');
    }
    return (
      await client.query<AuthUser>(
        `update users set active=$2,version=version+1 where id=$1 and deleted_at is null
         returning id,email,display_name,(select name from roles where id=users.role_id) role,active,array[]::text[] permissions`,
        [id, active],
      )
    ).rows[0];
  });
}
export async function resetUserPassword(id: string, passwordHash: string) {
  await query(`update users set password_hash=$2,version=version+1 where id=$1 and deleted_at is null`, [
    id,
    passwordHash,
  ]);
}
export async function revokeUserSessions(userId: string) {
  return query(`delete from sessions where user_id=$1`, [userId]);
}
export async function recordLoginFailure(email: string, ip: string | undefined, reason: string) {
  await query(`insert into login_failures(email,ip_address,reason) values(lower($1),nullif($2,'')::inet,$3)`, [
    email,
    ip ?? '',
    reason,
  ]);
}
export async function recentLoginFailures(email: string, ip: string | undefined, windowMinutes = 15) {
  return Number(
    (
      await query<{ count: string }>(
        `select count(*) from login_failures where created_at>now()-($3||' minutes')::interval and (email=lower($1) or ip_address=nullif($2,'')::inet)`,
        [email, ip ?? '', windowMinutes],
      )
    ).rows[0].count,
  );
}
export async function auditLog(
  userId: string | null,
  action: string,
  entityType?: string,
  entityId?: string,
  details: unknown = {},
) {
  await query(`insert into audit_logs(user_id,action,entity_type,entity_id,details) values($1,$2,$3,$4,$5)`, [
    userId,
    action,
    entityType ?? null,
    entityId ?? null,
    details,
  ]);
}
export async function listAuditLogs(search = '', limit = 200) {
  const normalized = search.trim();
  return (
    await query<AuditLogRecord>(
      `select a.id,a.user_id,u.email user_email,a.action,a.entity_type,a.entity_id,a.details,a.created_at
       from audit_logs a left join users u on u.id=a.user_id
       where $1='' or a.action ilike '%'||$1||'%' or coalesce(a.entity_type,'') ilike '%'||$1||'%'
         or coalesce(u.email,'') ilike '%'||$1||'%' or a.details::text ilike '%'||$1||'%'
       order by a.created_at desc limit $2`,
      [normalized, Math.max(1, Math.min(limit, 500))],
    )
  ).rows;
}

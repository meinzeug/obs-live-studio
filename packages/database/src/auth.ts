import { query, transaction } from './index.js';
export type RoleName = 'administrator' | 'redaktion' | 'nur_lesen';

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
  expires_at: string;
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
export async function createSession(userId: string, csrfToken: string, ttlSeconds: number) {
  return (
    await query<SessionRecord>(
      `insert into sessions(user_id,csrf_token,expires_at) values($1,$2,now()+($3||' seconds')::interval) returning *`,
      [userId, csrfToken, ttlSeconds],
    )
  ).rows[0];
}
export async function getSession(id: string) {
  return (await query<SessionRecord>(`select * from sessions where id=$1 and expires_at>now()`, [id])).rows[0] ?? null;
}
export async function deleteSession(id: string) {
  await query(`delete from sessions where id=$1`, [id]);
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
  return (
    await query<AuthUser>(
      `update users set role_id=r.id,version=version+1 from roles r where users.id=$1 and r.name=$2 and users.deleted_at is null returning users.id,users.email,users.display_name,$2::text as role,users.active,array[]::text[] permissions`,
      [id, role],
    )
  ).rows[0];
}
export async function setUserActive(id: string, active: boolean) {
  return (
    await query<AuthUser>(
      `update users set active=$2,version=version+1 where id=$1 and deleted_at is null returning id,email,display_name,(select name from roles where id=users.role_id) role,active,array[]::text[] permissions`,
      [id, active],
    )
  ).rows[0];
}
export async function resetUserPassword(id: string, passwordHash: string) {
  await query(`update users set password_hash=$2,version=version+1 where id=$1 and deleted_at is null`, [
    id,
    passwordHash,
  ]);
}
export async function revokeUserSessions(userId: string) {
  await query(`delete from sessions where user_id=$1`, [userId]);
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

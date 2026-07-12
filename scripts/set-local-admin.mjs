import argon2 from 'argon2';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const email = String(process.argv[2] ?? process.env.ADMIN_EMAIL ?? '')
  .trim()
  .toLowerCase();
const displayName = String(process.env.ADMIN_DISPLAY_NAME ?? 'Dennis Wicht').trim();

async function readPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/[\r\n]+$/, '');
}

if (!email || !email.includes('@'))
  throw new Error('Eine gültige Admin-E-Mail muss als erstes Argument angegeben werden');
const password = await readPassword();
if (password.length < 8) throw new Error('Das Admin-Passwort muss mindestens acht Zeichen lang sein');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL fehlt');

const passwordHash = await argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
let userId;
try {
  await client.query('begin');
  const role = (
    await client.query(
      `insert into roles(name,description) values('administrator','Vollzugriff')
       on conflict(name) do update set description=excluded.description returning id`,
    )
  ).rows[0];
  const target = (await client.query('select id from users where email=$1 and deleted_at is null for update', [email]))
    .rows[0];
  if (target) {
    userId = target.id;
    await client.query(
      `update users set password_hash=$2,display_name=$3,role_id=$4,active=true,version=version+1 where id=$1`,
      [userId, passwordHash, displayName, role.id],
    );
  } else {
    const initialAdmin = (
      await client.query(
        `select u.id from users u join roles r on r.id=u.role_id
         where r.name='administrator' and u.deleted_at is null order by u.created_at asc for update of u limit 1`,
      )
    ).rows[0];
    if (initialAdmin) {
      userId = initialAdmin.id;
      await client.query(
        `update users set email=$2,password_hash=$3,display_name=$4,role_id=$5,active=true,version=version+1 where id=$1`,
        [userId, email, passwordHash, displayName, role.id],
      );
    } else {
      userId = (
        await client.query(
          `insert into users(email,password_hash,display_name,role_id,active)
           values($1,$2,$3,$4,true) returning id`,
          [email, passwordHash, displayName, role.id],
        )
      ).rows[0].id;
    }
  }
  await client.query('delete from sessions where user_id=$1', [userId]);
  await client.query('commit');
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  client.release();
  await pool.end();
}

const root = resolve(new URL('..', import.meta.url).pathname);
const credentialsFile = resolve(root, 'var', 'admin-credentials.json');
await mkdir(resolve(root, 'var'), { recursive: true });
await writeFile(
  credentialsFile,
  `${JSON.stringify({ url: 'http://127.0.0.1:12001', email, password, displayName }, null, 2)}\n`,
  { mode: 0o600 },
);
await chmod(credentialsFile, 0o600);

console.log(JSON.stringify({ ok: true, userId, email, role: 'administrator', credentialsFile }));

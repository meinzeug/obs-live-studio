import { randomUUID, createHash } from 'node:crypto';
import { query } from '@ans/database';

export type BroadcastFixtureScope = 'broadcast-integration' | 'e2e';

export interface BroadcastFixtureOptions {
  scope: BroadcastFixtureScope;
  items?: number;
  audio?: boolean;
  overlay?: boolean;
  overlayConfigured?: boolean;
  durationSeconds?: number;
}

export interface BroadcastFixture {
  suffix: string;
  playlistId: string;
  articleIds: string[];
  itemIds: string[];
  scriptIds: string[];
  mediaIds: string[];
  overlayProjectId: string | null;
  overlayVersionId: string | null;
}

export async function cleanupBroadcastFixtures(scope: BroadcastFixtureScope, adminEmail?: string) {
  await query('delete from sessions where user_id in (select id from users where email=$1)', [
    adminEmail ?? `${scope}-admin@example.test`,
  ]);
  await query("delete from live_events where payload->>'testRun'=$1 or dedupe_key like $2", [scope, `${scope}:%`]);
  await query('delete from broadcast_recovery_operations where requested_by=$1 or new_runner_id like $2', [
    scope,
    `${scope}%`,
  ]);
  await query("delete from broadcast_runner_leases where runner_id like $1 or runner_id like 'runner-%'", [
    `${scope}%`,
  ]);
  await query('delete from broadcast_commands where idempotency_key like $1', [`${scope}:%`]);
  await query('delete from playback_state where id=true');
  await query("delete from broadcast_runs where last_state->>'testRun'=$1", [scope]);
  await query(
    'delete from broadcast_items where playlist_id in (select id from broadcast_playlists where name like $1)',
    [`${scope}-%`],
  );
  await query(
    'delete from audio_assets where script_id in (select s.id from scripts s join articles a on a.id=s.article_id where a.title like $1)',
    [`${scope}-%`],
  );
  await query('delete from media_assets where filename like $1', [`/tmp/${scope}-%`]);
  await query('delete from scripts where article_id in (select id from articles where title like $1)', [`${scope}-%`]);
  await query('delete from overlay_versions where project_id in (select id from overlay_projects where name like $1)', [
    `${scope}-%`,
  ]);
  await query('delete from broadcast_playlists where name like $1', [`${scope}-%`]);
  await query('delete from overlay_projects where name like $1', [`${scope}-%`]);
  await query('delete from articles where title like $1', [`${scope}-%`]);
  if (adminEmail) await query('delete from users where email=$1', [adminEmail]);
}

export async function createBroadcastFixture(options: BroadcastFixtureOptions): Promise<BroadcastFixture> {
  const opts = { items: 1, audio: true, overlay: true, overlayConfigured: true, durationSeconds: 2, ...options };
  const suffix = randomUUID();
  let overlayProjectId: string | null = null;
  let overlayVersionId: string | null = null;
  if (opts.overlay) {
    const project = (
      await query(
        `insert into overlay_projects(name,width,height,template,status,public_live_id,public_token_hash,public_url)
       values($1,1920,1080,'main-news','active',$2,$3,$4) returning id`,
        [
          `${opts.scope}-${suffix}`,
          `${opts.scope}-live-${suffix}`,
          `hash-${suffix}`,
          `/overlays/${opts.scope}-${suffix}`,
        ],
      )
    ).rows[0];
    overlayProjectId = project.id;
    const version = (
      await query(
        `insert into overlay_versions(project_id,version,snapshot,status,published,label)
       values($1,1,$2,'published',true,'Fixture 1') returning id`,
        [project.id, { elements: [], testRun: opts.scope }],
      )
    ).rows[0];
    overlayVersionId = version.id;
    if (opts.overlayConfigured)
      await query(`update overlay_projects set obs_configured_version_id=$2 where id=$1`, [project.id, version.id]);
  }
  const playlist = (
    await query(`insert into broadcast_playlists(name,status,current_position) values($1,'draft',0) returning id`, [
      `${opts.scope}-${suffix}`,
    ])
  ).rows[0];
  const articleIds: string[] = [],
    itemIds: string[] = [],
    scriptIds: string[] = [],
    mediaIds: string[] = [];
  for (let i = 0; i < opts.items; i += 1) {
    const title = `${opts.scope}-${suffix}-${i}`;
    const url = `https://example.test/${opts.scope}/${suffix}/${i}`;
    const article = (
      await query(
        `insert into articles(title,url,canonical_url,content_hash,status,source,main_text) values($1,$2,$2,$3,'approved',$4,'Fixture text') returning id`,
        [title, url, createHash('sha1').update(`${suffix}-${i}`).digest('hex'), opts.scope],
      )
    ).rows[0];
    articleIds.push(article.id);
    const script = (
      await query(
        `insert into scripts(article_id,text,screen_text,ticker_text) values($1,'Fixture script','Fixture screen','Fixture ticker') returning id`,
        [article.id],
      )
    ).rows[0];
    scriptIds.push(script.id);
    if (opts.audio) {
      const media = (
        await query(
          `insert into media_assets(filename,mime_type,size_bytes,duration_seconds,usage,source) values($1,'audio/wav',1,$2,'article-voice',$3) returning id`,
          [`/tmp/${title}.wav`, opts.durationSeconds, opts.scope],
        )
      ).rows[0];
      mediaIds.push(media.id);
      await query(`insert into audio_assets(script_id,media_id,duration_seconds,word_timings) values($1,$2,$3,'[]')`, [
        script.id,
        media.id,
        opts.durationSeconds,
      ]);
    }
    const item = (
      await query(
        `insert into broadcast_items(playlist_id,article_id,position,status,rules) values($1,$2,$3,'planned','{}') returning id`,
        [playlist.id, article.id, i],
      )
    ).rows[0];
    itemIds.push(item.id);
  }
  return {
    suffix,
    playlistId: playlist.id,
    articleIds,
    itemIds,
    scriptIds,
    mediaIds,
    overlayProjectId,
    overlayVersionId,
  };
}

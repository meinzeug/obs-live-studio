import { randomUUID, createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { query, transaction } from '@ans/database';

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
  runIds: string[];
  commandIds: string[];
  eventIds: number[];
  operationIds: string[];
  audioAssetIds: string[];
  mediaFiles: string[];
}

const fixtures = new Map<BroadcastFixtureScope, BroadcastFixture[]>();

function wavBytes(durationSeconds: number) {
  const sampleRate = 8000;
  const samples = Math.max(1, Math.round(sampleRate * durationSeconds));
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

async function cleanupPersistedScope(scope: BroadcastFixtureScope, client: any) {
  const playlists = (
    await client.query(`select id from broadcast_playlists where name like $1`, [`${scope}-%`])
  ).rows.map((row: { id: string }) => row.id);
  const articles = (
    await client.query(`select id from articles where url like $1`, [`https://example.test/${scope}/%`])
  ).rows.map((row: { id: string }) => row.id);
  const overlays = (await client.query(`select id from overlay_projects where name like $1`, [`${scope}-%`])).rows.map(
    (row: { id: string }) => row.id,
  );
  if (playlists.length) {
    const runs = (
      await client.query(`select id from broadcast_runs where playlist_id=any($1::uuid[])`, [playlists])
    ).rows.map((row: { id: string }) => row.id);
    if (runs.length) {
      await client.query('delete from broadcast_commands where broadcast_run_id=any($1::uuid[])', [runs]);
      await client.query('delete from live_events where broadcast_run_id=any($1::uuid[])', [runs]);
      await client.query('delete from broadcast_recovery_operations where broadcast_run_id=any($1::uuid[])', [runs]);
      await client.query('delete from broadcast_runner_leases where broadcast_run_id=any($1::uuid[])', [runs]);
      await client.query('delete from broadcast_runs where id=any($1::uuid[])', [runs]);
    }
    await client.query(`delete from playback_state where (state->>'playlistId')=any($1::text[])`, [playlists]);
    await client.query('delete from broadcast_items where playlist_id=any($1::uuid[])', [playlists]);
    await client.query('delete from broadcast_playlists where id=any($1::uuid[])', [playlists]);
  }
  if (articles.length) {
    const scripts = (
      await client.query(`select id from scripts where article_id=any($1::uuid[])`, [articles])
    ).rows.map((row: { id: string }) => row.id);
    if (scripts.length) {
      const media = (
        await client.query(
          `select ma.id
           from audio_assets aa
           join media_assets ma on ma.id=aa.media_id
           where aa.script_id=any($1::uuid[])`,
          [scripts],
        )
      ).rows.map((row: { id: string }) => row.id);
      await client.query('delete from audio_assets where script_id=any($1::uuid[])', [scripts]);
      if (media.length) await client.query('delete from media_assets where id=any($1::uuid[])', [media]);
      await client.query('delete from scripts where id=any($1::uuid[])', [scripts]);
    }
    await client.query('delete from articles where id=any($1::uuid[])', [articles]);
  }
  if (overlays.length) {
    await client.query('delete from obs_overlay_sources where project_id=any($1::uuid[])', [overlays]);
    await client.query('delete from overlay_versions where project_id=any($1::uuid[])', [overlays]);
    await client.query('delete from overlay_projects where id=any($1::uuid[])', [overlays]);
  }
}

async function refreshGeneratedIds(fixture: BroadcastFixture) {
  const runs = (await query<{ id: string }>(`select id from broadcast_runs where playlist_id=$1`, [fixture.playlistId]))
    .rows;
  fixture.runIds = runs.map((r) => r.id);
  if (fixture.runIds.length) {
    const commands = (
      await query<{ id: string }>(`select id from broadcast_commands where broadcast_run_id=any($1::uuid[])`, [
        fixture.runIds,
      ])
    ).rows;
    fixture.commandIds = commands.map((r) => r.id);
    const events = (
      await query<{ id: string }>(`select id::text id from live_events where broadcast_run_id=any($1::uuid[])`, [
        fixture.runIds,
      ])
    ).rows;
    fixture.eventIds = events.map((r) => Number(r.id));
    const ops = (
      await query<{ id: string }>(
        `select id from broadcast_recovery_operations where broadcast_run_id=any($1::uuid[])`,
        [fixture.runIds],
      )
    ).rows;
    fixture.operationIds = ops.map((r) => r.id);
  }
}

export async function cleanupBroadcastFixtures(
  scope: BroadcastFixtureScope,
  adminEmailOrFixture?: string | BroadcastFixture,
) {
  const adminEmail = typeof adminEmailOrFixture === 'string' ? adminEmailOrFixture : undefined;
  const explicit = typeof adminEmailOrFixture === 'object' ? [adminEmailOrFixture] : [];
  const targets = [...explicit, ...(fixtures.get(scope) ?? [])];
  for (const fixture of targets) await refreshGeneratedIds(fixture);
  await transaction(async (client) => {
    if (!explicit.length) await cleanupPersistedScope(scope, client);
    if (adminEmail) {
      await client.query('delete from sessions where user_id in (select id from users where email=$1)', [adminEmail]);
      await client.query('delete from audit_logs where user_id in (select id from users where email=$1)', [adminEmail]);
      await client.query('delete from login_failures where email=lower($1)', [adminEmail]);
      await client.query(
        'update overlay_projects set created_by=null where created_by in (select id from users where email=$1)',
        [adminEmail],
      );
    }
    for (const fixture of targets) {
      if (fixture.runIds.length) {
        await client.query('delete from broadcast_commands where id=any($1::uuid[])', [fixture.commandIds]);
        await client.query('delete from live_events where id=any($1::bigint[])', [fixture.eventIds]);
        await client.query('delete from broadcast_recovery_operations where id=any($1::uuid[])', [
          fixture.operationIds,
        ]);
        await client.query('delete from broadcast_runner_leases where broadcast_run_id=any($1::uuid[])', [
          fixture.runIds,
        ]);
        await client.query('delete from broadcast_runs where id=any($1::uuid[])', [fixture.runIds]);
      }
      await client.query(
        `delete from playback_state where (state->>'playlistId')=$1 or (state->>'runId')=any($2::text[])`,
        [fixture.playlistId, fixture.runIds],
      );
      await client.query('delete from audio_assets where id=any($1::uuid[])', [fixture.audioAssetIds]);
      await client.query('delete from broadcast_items where id=any($1::uuid[])', [fixture.itemIds]);
      await client.query('delete from scripts where id=any($1::uuid[])', [fixture.scriptIds]);
      await client.query('delete from media_assets where id=any($1::uuid[])', [fixture.mediaIds]);
      if (fixture.overlayProjectId)
        await client.query('update overlay_projects set obs_configured_version_id=null where id=$1', [
          fixture.overlayProjectId,
        ]);
      if (fixture.overlayVersionId)
        await client.query('delete from obs_overlay_sources where version_id=$1', [fixture.overlayVersionId]);
      if (fixture.overlayVersionId)
        await client.query('delete from overlay_versions where id=$1', [fixture.overlayVersionId]);
      await client.query('delete from broadcast_playlists where id=$1', [fixture.playlistId]);
      if (fixture.overlayProjectId)
        await client.query('delete from overlay_projects where id=$1', [fixture.overlayProjectId]);
      await client.query('delete from articles where id=any($1::uuid[])', [fixture.articleIds]);
    }
    if (adminEmail) await client.query('delete from users where email=$1', [adminEmail]);
  });
  await Promise.all(targets.flatMap((fixture) => fixture.mediaFiles.map((file) => rm(file, { force: true }))));
  if (explicit.length) {
    const removed = new Set(explicit);
    fixtures.set(
      scope,
      (fixtures.get(scope) ?? []).filter((fixture) => !removed.has(fixture)),
    );
  } else {
    fixtures.set(scope, []);
  }
}

export async function createBroadcastFixture(options: BroadcastFixtureOptions): Promise<BroadcastFixture> {
  const opts: Required<BroadcastFixtureOptions> = {
    scope: options.scope,
    items: 1,
    audio: true,
    overlay: true,
    overlayConfigured: true,
    durationSeconds: 2,
  };
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) (opts as any)[key] = value;
  }
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
    mediaIds: string[] = [],
    audioAssetIds: string[] = [],
    mediaFiles: string[] = [];
  const mediaDir = process.env.MEDIA_UPLOAD_DIR ?? join(tmpdir(), 'obs-live-studio-test-media');
  await mkdir(mediaDir, { recursive: true });
  for (let i = 0; i < opts.items; i += 1) {
    const title = `${opts.scope}-${suffix}-${i}`;
    const url = `https://example.test/${opts.scope}/${suffix}/${i}`;
    const article = (
      await query(
        `insert into articles(title,url,canonical_url,content_hash,status,source_id,main_text) values($1,$2,$2,$3,'approved',NULL,'Fixture text') returning id`,
        [title, url, createHash('sha1').update(`${suffix}-${i}`).digest('hex')],
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
      const mediaFile = join(mediaDir, `${title}.wav`);
      const wav = wavBytes(opts.durationSeconds);
      await writeFile(mediaFile, wav);
      mediaFiles.push(mediaFile);
      const media = (
        await query(
          `insert into media_assets(filename,mime_type,size_bytes,duration_seconds,usage,source) values($1,'audio/wav',$2,$3,'article-voice',$4) returning id`,
          [mediaFile, wav.length, opts.durationSeconds, opts.scope],
        )
      ).rows[0];
      mediaIds.push(media.id);
      const audio = (
        await query(
          `insert into audio_assets(script_id,media_id,duration_seconds,word_timings) values($1,$2,$3,'[]') returning id`,
          [script.id, media.id, opts.durationSeconds],
        )
      ).rows[0];
      audioAssetIds.push(audio.id);
    }
    const item = (
      await query(
        `insert into broadcast_items(playlist_id,article_id,position,status,rules) values($1,$2,$3,'planned','{}') returning id`,
        [playlist.id, article.id, i],
      )
    ).rows[0];
    itemIds.push(item.id);
  }
  const fixture = {
    suffix,
    playlistId: playlist.id,
    articleIds,
    itemIds,
    scriptIds,
    mediaIds,
    overlayProjectId,
    overlayVersionId,
    runIds: [],
    commandIds: [],
    eventIds: [],
    operationIds: [],
    audioAssetIds,
    mediaFiles,
  };
  fixtures.set(opts.scope, [...(fixtures.get(opts.scope) ?? []), fixture]);
  return fixture;
}

import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  appendLiveEvent,
  createOverlayProject,
  query,
  rotateOverlayPublicToken,
} from '../../packages/database/src/index.js';

const integration = process.env.VITEST_INCLUDE_INTEGRATION === 'true' ? describe : describe.skip;

integration('overlay live event deduplication', () => {
  beforeEach(async () => {
    await query("delete from live_events where payload->>'testRun'='live-event-dedupe'");
  });

  it('stores one publication event per overlay version even when callers emit twice', async () => {
    const project = await createOverlayProject({
      name: `live-event-dedupe-${randomUUID()}`,
      width: 1920,
      height: 1080,
      template: 'main-news',
      snapshot: { nodes: [] },
    });
    const version = (
      await query<{ id: string }>('select id from overlay_versions where project_id=$1 order by version desc limit 1', [
        project.id,
      ])
    ).rows[0];

    const first = await appendLiveEvent({
      type: 'overlay-published',
      overlayVersionId: version.id,
      payload: { projectId: project.id, template: 'main-news', testRun: 'live-event-dedupe' },
    });
    const second = await appendLiveEvent({
      type: 'overlay-published',
      overlayVersionId: version.id,
      payload: { projectId: project.id, versionId: version.id, testRun: 'live-event-dedupe' },
      dedupeKey: `overlay-published:${version.id}`,
    });

    const events = await query<{ id: string; dedupe_key: string }>(
      `select id,dedupe_key from live_events
       where type='overlay-published' and overlay_version_id=$1`,
      [version.id],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].dedupe_key).toBe(`overlay-published:${version.id}`);
    expect(String(first.id)).toBe(String(second.id));
  });

  it('deduplicates both token-rotation emissions but permits a later rotation', async () => {
    const project = await createOverlayProject({
      name: `live-event-dedupe-${randomUUID()}`,
      width: 1920,
      height: 1080,
      template: 'ticker',
      snapshot: { nodes: [] },
    });
    await rotateOverlayPublicToken(project.id, 'hash-1', 'http://127.0.0.1/overlay/one');

    const payload = { projectId: project.id, reason: 'token-rotated', testRun: 'live-event-dedupe' };
    await appendLiveEvent({ type: 'overlay-version-changed', payload });
    await appendLiveEvent({
      type: 'overlay-version-changed',
      payload,
      dedupeKey: `overlay-token-rotated:${project.id}:${Date.now()}`,
    });

    let events = await query<{ dedupe_key: string }>(
      `select dedupe_key from live_events
       where type='overlay-version-changed'
         and payload->>'projectId'=$1
         and payload->>'reason'='token-rotated'`,
      [project.id],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].dedupe_key).toMatch(new RegExp(`^overlay-token-rotated:${project.id}:\\d+$`));

    await query(
      `update overlay_projects
       set public_token_created_at=public_token_created_at + interval '1 second'
       where id=$1`,
      [project.id],
    );
    await appendLiveEvent({ type: 'overlay-version-changed', payload });

    events = await query<{ dedupe_key: string }>(
      `select dedupe_key from live_events
       where type='overlay-version-changed'
         and payload->>'projectId'=$1
         and payload->>'reason'='token-rotated'
       order by id`,
      [project.id],
    );
    expect(events.rows).toHaveLength(2);
    expect(new Set(events.rows.map((event) => event.dedupe_key)).size).toBe(2);
  });
});

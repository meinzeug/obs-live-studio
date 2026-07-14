import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addBroadcastItem,
  createBroadcastPlaylist,
  createOverlayProject,
  createSource,
  query,
  setArticleStatus,
  upsertArticle,
} from '../../packages/database/src/index.js';
import { getArticleMediaReadiness } from '../../packages/database/src/article-media.js';

const integration = process.env.VITEST_INCLUDE_INTEGRATION === 'true' ? describe : describe.skip;

integration('mandatory article visual media', () => {
  beforeEach(async () => {
    await query("delete from broadcast_playlists where name like 'article-visual-test-%'");
    await query("delete from overlay_projects where name like 'article-visual-test-%'");
    await query("delete from sources where name like 'article-visual-test-%'");
  });

  async function articleFixture() {
    const suffix = randomUUID();
    const source = await createSource({
      name: `article-visual-test-${suffix}`,
      url: `https://example.org/feed-${suffix}.xml`,
      type: 'rss',
    });
    const article = await upsertArticle({
      sourceId: source.id,
      title: `Visueller Beitrag ${suffix}`,
      url: `https://example.org/article-${suffix}`,
      contentHash: suffix.replaceAll('-', ''),
      mainText: 'Die Produktion stieg um 42 Prozent.',
      trustScore: 90,
    });
    if (!article) throw new Error('Artikel konnte nicht angelegt werden');
    return { source, article, suffix };
  }

  it('queues media discovery in the article insert transaction and blocks playlist insertion without video', async () => {
    const { article, suffix } = await articleFixture();
    const job = await query<{ kind: string; article_id: string }>(
      `select kind,payload->>'articleId' article_id
       from worker_jobs
       where kind='discover-article-media' and payload->>'articleId'=$1`,
      [article.id],
    );
    expect(job.rows).toEqual([{ kind: 'discover-article-media', article_id: article.id }]);

    await setArticleStatus(article.id, 'approved');
    const playlist = await createBroadcastPlaylist(`article-visual-test-${suffix}`);
    await expect(addBroadcastItem(playlist.id, article.id)).rejects.toThrow(/Kein freigegebenes lokales Video/);

    const media = (
      await query<{ id: string }>(
        `insert into media_assets(
           filename,mime_type,size_bytes,duration_seconds,usage,storage_path,sha256,media_kind,provider,provider_asset_id
         ) values($1,'video/mp4',1024,12,'article-video',$2,$3,'video','integration-test',$4)
         returning id`,
        [`${suffix}.mp4`, `/tmp/${suffix}.mp4`, suffix.replaceAll('-', ''), suffix],
      )
    ).rows[0];
    await query('insert into media_links(media_id,article_id,purpose) values($1,$2,\'article-video\')', [
      media.id,
      article.id,
    ]);

    const readiness = await getArticleMediaReadiness(article.id);
    expect(readiness).toMatchObject({ ready: true, approved_videos: 1 });
    await expect(addBroadcastItem(playlist.id, article.id)).resolves.toMatchObject({ article_id: article.id });
  });

  it('normalizes main-news overlay backgrounds so article video remains visible', async () => {
    const suffix = randomUUID();
    const project = await createOverlayProject({
      name: `article-visual-test-${suffix}`,
      width: 1920,
      height: 1080,
      template: 'main-news',
      snapshot: {
        width: 1920,
        height: 1080,
        elements: [
          {
            id: 'background',
            type: 'shape',
            name: 'Hintergrund',
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            props: { background: '#111318' },
          },
        ],
      },
    });
    const version = (
      await query<{ snapshot: { elements: Array<{ name: string; props: { background: string } }> } }>(
        'select snapshot from overlay_versions where project_id=$1 order by version desc limit 1',
        [project.id],
      )
    ).rows[0];

    expect(version.snapshot.elements.find((element) => element.name === 'Hintergrund')?.props.background).toBe(
      'rgba(17,19,24,0.32)',
    );
  });
});

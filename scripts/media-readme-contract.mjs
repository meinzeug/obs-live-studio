import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const requirements = [
  {
    path: 'README.md',
    tokens: [
      'Videos, Grafiken und Statistiken pro Beitrag',
      'mindestens ein geprüftes lokales Video',
      'docs/MEDIA_RESEARCH.md',
    ],
  },
  {
    path: 'packages/database/src/012_article_visual_media.sql',
    tokens: [
      'articles_enqueue_media_discovery',
      'broadcast_items_require_article_video',
      'normalize_main_news_video_background',
    ],
  },
  {
    path: 'packages/media-engine/src/workflow.ts',
    tokens: ['discoverArticleMedia', 'createStatisticGraphic', 'downloadRemoteVideoSecure'],
  },
  {
    path: 'packages/obs-controller/src/article-visual-resolver.ts',
    tokens: ['Kein freigegebenes lokales Video', 'ANS_ARTICLE_GRAPHIC', 'ARTICLE_VIDEO_INPUT'],
  },
  {
    path: 'apps/web/src/pages/ArticleDetailPage.tsx',
    tokens: ['Passende Medien suchen', 'Eigenes Video auswählen', 'Nutzungsrechte'],
  },
];

export async function auditMediaReadmeContract(root = process.cwd()) {
  const missing = [];
  for (const requirement of requirements) {
    try {
      const text = await readFile(resolve(root, requirement.path), 'utf8');
      for (const token of requirement.tokens) {
        if (!text.includes(token)) missing.push(`${requirement.path}: ${token}`);
      }
    } catch (error) {
      missing.push(`${requirement.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    id: 'mandatory-article-visual-media',
    path: 'README.md + media pipeline',
    ok: missing.length === 0,
    missing,
  };
}

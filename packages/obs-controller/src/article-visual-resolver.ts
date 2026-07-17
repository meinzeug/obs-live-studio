import { ARTICLE_VIDEO_INPUT, MAIN_NEWS_SCENE, ObsController } from './index.js';

export const ARTICLE_GRAPHIC_INPUT = 'ANS_ARTICLE_GRAPHIC';

export interface ArticleVisualSelection {
  video: { storage_path: string } | null;
  graphic?: { storage_path: string } | null;
  videoRequired?: boolean;
}

export type ArticleVisualResolver = (articleId: string) => Promise<ArticleVisualSelection>;

type ContributionOptions = Parameters<ObsController['playTestContribution']>[0];

let activeResolver: ArticleVisualResolver | null = null;
let installed = false;

async function configureGraphic(controller: ObsController, graphicPath: string) {
  await controller.ensureInput(MAIN_NEWS_SCENE, ARTICLE_GRAPHIC_INPUT, 'image_source', {
    file: graphicPath,
    unload: false,
  });
  const item = await controller
    .call<{ sceneItemId: number }>('GetSceneItemId', {
      sceneName: MAIN_NEWS_SCENE,
      sourceName: ARTICLE_GRAPHIC_INPUT,
    })
    .catch(() => null);
  if (item?.sceneItemId == null) return null;
  await controller.call('SetSceneItemTransform', {
    sceneName: MAIN_NEWS_SCENE,
    sceneItemId: item.sceneItemId,
    sceneItemTransform: {
      positionX: 1260,
      positionY: 530,
      boundsType: 'OBS_BOUNDS_SCALE_INNER',
      boundsWidth: 560,
      boundsHeight: 315,
      alignment: 5,
    },
  });
  await controller.call('SetSceneItemIndex', {
    sceneName: MAIN_NEWS_SCENE,
    sceneItemId: item.sceneItemId,
    sceneItemIndex: 1,
  });
  await controller.call('SetSceneItemEnabled', {
    sceneName: MAIN_NEWS_SCENE,
    sceneItemId: item.sceneItemId,
    sceneItemEnabled: true,
  });
  return item.sceneItemId;
}

async function hideGraphic(controller: ObsController, sceneItemId: number | null) {
  if (sceneItemId == null) return;
  await controller
    .call('SetSceneItemEnabled', {
      sceneName: MAIN_NEWS_SCENE,
      sceneItemId,
      sceneItemEnabled: false,
    })
    .catch(() => undefined);
}

export function installArticleVisualResolver(resolver: ArticleVisualResolver) {
  activeResolver = resolver;
  if (installed) return;
  installed = true;
  const original = ObsController.prototype.playTestContribution;
  ObsController.prototype.playTestContribution = async function (options: ContributionOptions) {
    const selection = await activeResolver?.(options.articleId);
    const videoPath = options.videoPath ?? selection?.video?.storage_path;
    if (!videoPath && selection?.videoRequired !== false) {
      throw new Error(`Kein freigegebenes lokales Video für Beitrag ${options.articleId} vorhanden`);
    }
    await this.ensureConnectedWithRetry();
    const graphicPath = selection?.graphic?.storage_path;
    const graphicItemId = graphicPath ? await configureGraphic(this, graphicPath) : null;
    try {
      return await original.call(this, { ...options, videoPath });
    } finally {
      await this.stopMedia(ARTICLE_VIDEO_INPUT).catch(() => undefined);
      await hideGraphic(this, graphicItemId);
    }
  };
}

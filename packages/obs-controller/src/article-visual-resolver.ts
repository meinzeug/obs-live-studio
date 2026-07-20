import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
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

function localMediaPath(storagePath: string) {
  if (isAbsolute(storagePath)) return storagePath;
  const candidates = [resolve(process.cwd(), storagePath), resolve(process.cwd(), '../..', storagePath)];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

async function graphicSceneItemId(controller: ObsController) {
  const item = await controller
    .call<{ sceneItemId: number }>('GetSceneItemId', {
      sceneName: MAIN_NEWS_SCENE,
      sourceName: ARTICLE_GRAPHIC_INPUT,
    })
    .catch(() => null);
  return item?.sceneItemId ?? null;
}

async function configureGraphic(controller: ObsController, graphicPath: string) {
  await controller.ensureInput(MAIN_NEWS_SCENE, ARTICLE_GRAPHIC_INPUT, 'image_source', {
    file: graphicPath,
    unload: false,
  });
  const sceneItemId = await graphicSceneItemId(controller);
  if (sceneItemId == null) return null;
  await controller.call('SetSceneItemTransform', {
    sceneName: MAIN_NEWS_SCENE,
    sceneItemId,
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
    sceneItemId,
    sceneItemIndex: 1,
  });
  await controller.call('SetSceneItemEnabled', {
    sceneName: MAIN_NEWS_SCENE,
    sceneItemId,
    sceneItemEnabled: true,
  });
  return sceneItemId;
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
    const videoPath =
      options.videoPath ?? (selection?.video?.storage_path ? localMediaPath(selection.video.storage_path) : undefined);
    const graphicPath = selection?.graphic?.storage_path ? localMediaPath(selection.graphic.storage_path) : undefined;
    if (!videoPath && !graphicPath && selection?.videoRequired !== false) {
      throw new Error(`Kein freigegebenes lokales Video oder Bild/Grafik für Beitrag ${options.articleId} vorhanden`);
    }
    await this.ensureConnectedWithRetry();
    const existingGraphicItemId = await graphicSceneItemId(this);
    if (!graphicPath) await hideGraphic(this, existingGraphicItemId);
    const graphicItemId = graphicPath ? await configureGraphic(this, graphicPath) : existingGraphicItemId;
    try {
      return await original.call(this, { ...options, videoPath });
    } finally {
      await this.stopMedia(ARTICLE_VIDEO_INPUT).catch(() => undefined);
      await hideGraphic(this, graphicItemId);
    }
  };
}

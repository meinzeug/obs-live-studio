import { assertPublicHttpUrl } from '@ans/security';
import { isAllowedLocalStudioTestUrl, type FetchOptions } from '@ans/source-connectors';

export type SourceUrlValidator = (rawUrl: string, allowPrivate?: boolean) => Promise<unknown>;

export interface SourceUrlPolicy {
  allowPrivate: boolean;
  validateStoredSourceUrl(rawUrl: string): Promise<void>;
  fetchOptions: Pick<FetchOptions, 'allowPrivate' | 'allowPrivateUrl'>;
}

export function createSourceUrlPolicy(
  env: NodeJS.ProcessEnv = process.env,
  validator: SourceUrlValidator = assertPublicHttpUrl,
): SourceUrlPolicy {
  const allowPrivate = env.ALLOW_PRIVATE_SOURCES === 'true';
  const appPort = env.APP_PORT ?? 12000;
  const allowLocalTestFeed = (url: string | URL) =>
    isAllowedLocalStudioTestUrl(url, {
      appPort,
      allowedPaths: ['/test-feed.xml'],
    });

  return {
    allowPrivate,
    async validateStoredSourceUrl(rawUrl: string) {
      await validator(rawUrl, allowPrivate || allowLocalTestFeed(rawUrl));
    },
    fetchOptions: {
      allowPrivate,
      allowPrivateUrl: (url) => allowLocalTestFeed(url),
    },
  };
}

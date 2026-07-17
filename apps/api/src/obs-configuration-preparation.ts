import { isObsAuthenticationError } from '@ans/obs-controller';

type StreamStatus = { outputActive?: boolean };

export type ObsConfigurationPreparationDependencies = {
  getStreamStatus: () => Promise<StreamStatus>;
  reconnect: () => Promise<void>;
  disconnect: () => Promise<unknown>;
  stopProcess: () => Promise<unknown>;
};

function activeStreamError() {
  return Object.assign(new Error('Streaming-Ziele können während eines laufenden Livestreams nicht geändert werden.'), {
    statusCode: 409,
  });
}

export async function prepareRunningObsForConfiguration(dependencies: ObsConfigurationPreparationDependencies) {
  let streamStatus: StreamStatus | null = null;
  let authenticationRecovered = false;
  try {
    streamStatus = await dependencies.getStreamStatus();
  } catch (firstError) {
    if (isObsAuthenticationError(firstError)) {
      authenticationRecovered = true;
    } else {
      try {
        await dependencies.reconnect();
        streamStatus = await dependencies.getStreamStatus();
      } catch (retryError) {
        if (isObsAuthenticationError(retryError)) {
          authenticationRecovered = true;
        } else {
          throw Object.assign(
            new Error('Der OBS-Sendestatus konnte nicht sicher geprüft werden. Bitte OBS erneut starten.'),
            { statusCode: 503 },
          );
        }
      }
    }
  }

  if (streamStatus?.outputActive) throw activeStreamError();
  await dependencies.disconnect().catch(() => undefined);
  await dependencies.stopProcess();
  return { authenticationRecovered };
}

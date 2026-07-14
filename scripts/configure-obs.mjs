import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const multistreamEnabled = process.env.MULTISTREAM_ENABLED === 'true';
const relayServer = process.env.MULTISTREAM_RELAY_SERVER ?? 'rtmp://127.0.0.1:19350/live';
const relayKey = process.env.MULTISTREAM_RELAY_KEY ?? 'studio';

if (multistreamEnabled) {
  process.env.STREAM_SERVICE = 'multistream';
  process.env.STREAM_SERVER = relayServer;
  process.env.STREAM_KEY = relayKey;
}

await import('./configure-obs-direct.mjs');

if (multistreamEnabled) {
  const profileName = process.env.OBS_PROFILE_NAME ?? 'Automated News Studio';
  const safeProfile = profileName.replace(/[^A-Za-z0-9_-]+/g, '_');
  const configRoot = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'obs-studio');
  const profileDir = join(configRoot, 'basic', 'profiles', safeProfile);
  await mkdir(profileDir, { recursive: true });
  const serviceFile = join(profileDir, 'service.json');
  const relayService = {
    type: 'rtmp_custom',
    settings: {
      server: relayServer,
      key: relayKey,
      use_auth: false,
    },
  };
  await writeFile(serviceFile, `${JSON.stringify(relayService)}\n`, { mode: 0o600 });
  await chmod(serviceFile, 0o600);
  console.log(`OBS sendet im Multistream-Modus an den lokalen Relay ${relayServer}.`);
}

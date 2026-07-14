import { access, chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  publicRelayStatus,
  renderNginxConfig,
  renderStunnelConfig,
  resolveStreamRelayConfig,
  validateModulePath,
} from './stream-relay-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const relayDir = resolve(root, process.env.MULTISTREAM_CONFIG_DIR ?? 'var/stream-relay');
const logDir = resolve(root, 'var/logs');
const nginxFile = resolve(relayDir, 'nginx.conf');
const stunnelFile = resolve(relayDir, 'stunnel.conf');
const statusFile = resolve(relayDir, 'status.json');

async function firstExisting(paths) {
  for (const path of paths) {
    try {
      await access(path, constants.R_OK);
      return path;
    } catch {}
  }
  return null;
}

await mkdir(relayDir, { recursive: true, mode: 0o700 });
await mkdir(logDir, { recursive: true, mode: 0o700 });
await chmod(relayDir, 0o700);
const config = resolveStreamRelayConfig(process.env);

if (!config.enabled) {
  await Promise.all([rm(nginxFile, { force: true }), rm(stunnelFile, { force: true })]);
  await writeFile(statusFile, `${JSON.stringify(publicRelayStatus(config), null, 2)}\n`, { mode: 0o600 });
  await chmod(statusFile, 0o600);
  console.log('Multistream-Relay ist deaktiviert.');
  process.exit(0);
}

const modulePath = validateModulePath(
  process.env.NGINX_RTMP_MODULE ??
    (await firstExisting([
      '/usr/lib/nginx/modules/ngx_rtmp_module.so',
      '/usr/lib/x86_64-linux-gnu/nginx/modules/ngx_rtmp_module.so',
      '/usr/lib/aarch64-linux-gnu/nginx/modules/ngx_rtmp_module.so',
    ])),
);
if (!modulePath) throw new Error('ngx_rtmp_module.so wurde nicht gefunden; Paket libnginx-mod-rtmp installieren');

const nginxConfig = renderNginxConfig(config, {
  rtmpModulePath: modulePath,
  pidPath: resolve(relayDir, 'nginx.pid'),
  errorLogPath: resolve(logDir, 'stream-relay-nginx.log'),
});
const stunnelConfig = renderStunnelConfig(config, {
  logPath: resolve(logDir, 'stream-relay-stunnel.log'),
  caFile: process.env.MULTISTREAM_CA_FILE ?? '/etc/ssl/certs/ca-certificates.crt',
});

await Promise.all([
  writeFile(nginxFile, nginxConfig, { mode: 0o600 }),
  writeFile(stunnelFile, stunnelConfig, { mode: 0o600 }),
  writeFile(statusFile, `${JSON.stringify(publicRelayStatus(config), null, 2)}\n`, { mode: 0o600 }),
]);
await Promise.all([chmod(nginxFile, 0o600), chmod(stunnelFile, 0o600), chmod(statusFile, 0o600)]);
console.log(`Multistream-Relay für ${config.targets.map((target) => target.name).join(' + ')} konfiguriert.`);

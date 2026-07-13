import http from 'node:http';
import { ObsWebSocketV5TestServer } from '../tests/helpers/obs-websocket-v5-server.ts';

const configuredPort = process.env.OBS_PORT == null || process.env.OBS_PORT === '' ? 0 : Number(process.env.OBS_PORT);
if (!Number.isInteger(configuredPort) || configuredPort < 0)
  throw new Error(`Invalid OBS_PORT: ${process.env.OBS_PORT}`);

const server = new ObsWebSocketV5TestServer();
await server.start(configuredPort);

const statusPort = Number(process.env.OBS_MOCK_STATUS_PORT ?? 4456);
const statusServer = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  if (url.pathname === '/ready') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ready: true, port: server.port }));
    return;
  }
  if (url.pathname === '/requests') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ requests: server.requests }));
    return;
  }
  if (url.pathname === '/reset' && req.method === 'POST') {
    server.requests.length = 0;
    res.writeHead(204);
    res.end();
    return;
  }
  res.writeHead(404).end();
});
await new Promise((resolve) => statusServer.listen(statusPort, '127.0.0.1', resolve));
console.log(`OBS mock listening on ${server.port}; status on ${statusPort}`);

async function stop() {
  await new Promise((resolve) => statusServer.close(resolve));
  await server.stop();
}
process.on('SIGTERM', async () => {
  await stop();
  process.exit(0);
});
process.on('SIGINT', async () => {
  await stop();
  process.exit(0);
});
setInterval(() => {}, 1000);

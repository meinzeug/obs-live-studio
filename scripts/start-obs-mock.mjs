import { ObsWebSocketV5TestServer } from '../tests/helpers/obs-websocket-v5-server.ts';
const server = new ObsWebSocketV5TestServer();
await server.start();
console.log(`OBS mock listening on ${server.port}`);
process.on('SIGTERM', async () => {
  await server.stop();
  process.exit(0);
});
process.on('SIGINT', async () => {
  await server.stop();
  process.exit(0);
});
setInterval(() => {}, 1000);

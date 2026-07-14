import dotenv from 'dotenv';

dotenv.config();

const multistreamEnabled = process.env.MULTISTREAM_ENABLED === 'true';
if (multistreamEnabled) {
  process.env.STREAM_SERVICE = 'multistream';
  process.env.STREAM_SERVER = process.env.MULTISTREAM_RELAY_SERVER ?? 'rtmp://127.0.0.1:19350/live';
  process.env.STREAM_KEY = process.env.MULTISTREAM_RELAY_KEY ?? 'studio';
  const channelName = process.env.CHANNEL_NAME ?? 'ArgumentationsKette';
  process.env.CHANNEL_NAME = `${channelName} · YouTube + Twitch`;
}

await import('./server.js');

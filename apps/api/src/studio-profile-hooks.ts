import type { FastifyInstance, FastifyRequest } from 'fastify';
import { resolveStudioProfile, type StudioProfile } from '../../../packages/streaming-platforms/index.mjs';

function pathOf(req: FastifyRequest) {
  return req.url.split('?', 1)[0];
}

function studioFeed(profile: StudioProfile, port: string) {
  const channel = escapeXml(profile.channelName);
  const studio = escapeXml(profile.studioName);
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>${studio} – lokaler Testfeed</title><item><title>${channel} ist auf Sendung</title><link>http://127.0.0.1:${port}/test/articles/on-air</link><guid>open-tv-studio-on-air</guid><pubDate>${new Date().toUTCString()}</pubDate><description>Willkommen bei ${channel}. Das lokale TV-Studio verbindet Quellenverwaltung, Redaktion, Sprachausgabe, Overlays und OBS mit dem individuell konfigurierten Streaming-Ziel.</description></item></channel></rss>`;
}

function studioArticle(profile: StudioProfile) {
  const channel = escapeHtml(profile.channelName);
  const primary = escapeHtml(profile.primary.name);
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>${channel} ist auf Sendung</title></head>
<body><main><article><h1>${channel} ist auf Sendung</h1>
<p>Willkommen bei ${channel}. Das lokale TV-Studio verbindet Quellenverwaltung, Redaktion, Sprachausgabe, Overlays und OBS.</p>
<p>Das konfigurierte Hauptziel ist ${primary}; weitere RTMP-Ziele können synchron ergänzt werden.</p>
</article></main></body></html>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeXml(value: string) {
  return escapeHtml(value);
}

function replaceObsProfile(payload: unknown, profile: StudioProfile) {
  if (typeof payload !== 'string') return payload;
  try {
    const document = JSON.parse(payload);
    if (!document || typeof document !== 'object' || Array.isArray(document)) return payload;
    return JSON.stringify({ ...document, streamProfile: profile });
  } catch {
    return payload;
  }
}

export function installStudioProfileHooks(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    const path = pathOf(req);
    if (req.method === 'GET' && path === '/api/stream-profile') {
      return reply.send(resolveStudioProfile(process.env));
    }
    if (req.method === 'GET' && path === '/test-feed.xml') {
      const profile = resolveStudioProfile(process.env);
      return reply.type('application/rss+xml').send(studioFeed(profile, String(process.env.APP_PORT ?? 12000)));
    }
    if (req.method === 'GET' && path === '/test/articles/on-air') {
      return reply.type('text/html; charset=utf-8').send(studioArticle(resolveStudioProfile(process.env)));
    }
    if (req.method === 'POST' && path === '/api/obs/youtube/reset') {
      const profile = resolveStudioProfile(process.env);
      if (profile.primary.platform !== 'youtube') {
        return reply.code(409).send({
          error: `Das Hauptziel ist ${profile.primary.name}; die YouTube-Kontoaktion ist nicht verfügbar.`,
        });
      }
    }
  });

  app.addHook('onSend', async (req, _reply, payload) => {
    if (req.method === 'GET' && pathOf(req) === '/api/obs/status') {
      return replaceObsProfile(payload, resolveStudioProfile(process.env));
    }
    return payload;
  });
}

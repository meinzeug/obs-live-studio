import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { storeUploadedImage } from '@ans/media-engine';
import { storeUploadedVideo } from '@ans/media-engine/video-upload';
import { createMediaAssetWithDerivatives } from '@ans/database';
import {
  advertisingDashboard,
  archiveAdvertisingCampaign,
  claimDueAdvertisingPlayout,
  createAdvertisingCampaign,
  createAdvertisingCreative,
  createAdvertisingSchedule,
  deleteAdvertisingCreative,
  deleteAdvertisingSchedule,
  endAdvertisingPlayout,
  getActiveAdvertisingPlayout,
  getAdvertisingPlayoutMedia,
  startAdvertisingPlayout,
  updateAdvertisingCampaign,
  updateAdvertisingCreative,
  updateAdvertisingSchedule,
} from '@ans/database/advertising';

type RequirePermission = (request: FastifyRequest, reply: FastifyReply, permission: 'broadcast:write') => void;

const optionalDate = z.preprocess((value) => (value === '' || value == null ? null : value), z.string().datetime().nullable());
const optionalTime = z.preprocess(
  (value) => (value === '' || value == null ? null : value),
  z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/).nullable(),
);
const weekdays = z.array(z.number().int().min(1).max(7)).min(1).max(7);

const campaignSchema = z
  .object({
    name: z.string().trim().min(2).max(140),
    advertiser: z.string().trim().max(140).default(''),
    status: z.enum(['draft', 'active', 'paused', 'completed']).default('draft'),
    startsAt: optionalDate.default(null),
    endsAt: optionalDate.default(null),
    dailyStart: optionalTime.default(null),
    dailyEnd: optionalTime.default(null),
    weekdays: weekdays.default([1, 2, 3, 4, 5, 6, 7]),
    timezone: z.string().trim().min(1).max(80).default('Europe/Berlin'),
    priority: z.coerce.number().int().min(0).max(100).default(50),
    maxPerHour: z.coerce.number().int().min(1).max(60).default(6),
    minimumGapSeconds: z.coerce.number().int().min(10).max(86400).default(300),
    notes: z.string().trim().max(2000).default(''),
  })
  .strict();

const creativeSchema = z
  .object({
    campaignId: z.string().uuid(),
    name: z.string().trim().min(2).max(140),
    creativeType: z.enum(['text', 'banner', 'image', 'video']),
    headline: z.string().trim().max(160).default(''),
    body: z.string().trim().max(800).default(''),
    callToAction: z.string().trim().max(100).default(''),
    destinationUrl: z.string().trim().max(1000).default(''),
    mediaId: z.string().uuid().nullable().default(null),
    placement: z.enum(['fullscreen', 'top', 'lower-third', 'bottom-right']).default('lower-third'),
    style: z.enum(['studio', 'light', 'bold', 'minimal']).default('studio'),
    transition: z.enum(['fade', 'slide', 'zoom', 'cut']).default('fade'),
    durationSeconds: z.coerce.number().int().min(2).max(300).default(10),
    weight: z.coerce.number().int().min(1).max(100).default(10),
    active: z.boolean().default(true),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.creativeType === 'image' || value.creativeType === 'video') && !value.mediaId) {
      context.addIssue({ code: 'custom', path: ['mediaId'], message: 'Für dieses Werbemittel fehlt eine Mediendatei.' });
    }
    if ((value.creativeType === 'text' || value.creativeType === 'banner') && !value.headline && !value.body) {
      context.addIssue({ code: 'custom', path: ['headline'], message: 'Überschrift oder Text fehlt.' });
    }
  });

const scheduleSchema = z
  .object({
    campaignId: z.string().uuid(),
    creativeId: z.string().uuid().nullable().default(null),
    name: z.string().trim().min(2).max(140),
    scheduleType: z.enum(['fixed', 'interval', 'daypart']).default('interval'),
    startsAt: optionalDate.default(null),
    endsAt: optionalDate.default(null),
    weekdays: weekdays.default([1, 2, 3, 4, 5, 6, 7]),
    dailyStart: optionalTime.default(null),
    dailyEnd: optionalTime.default(null),
    intervalMinutes: z.coerce.number().int().min(1).max(1440).default(30),
    nextRunAt: z.string().datetime(),
    enabled: z.boolean().default(true),
  })
  .strict();

function rendererHtml() {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=1920,height=1080">
<style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:Inter,Arial,sans-serif;color:#fff}
#stage{position:absolute;inset:0;pointer-events:none}.ad{position:absolute;display:flex;align-items:center;gap:24px;overflow:hidden;padding:24px 32px;
border:2px solid #1ee2d2;border-radius:20px;background:linear-gradient(120deg,rgba(3,13,22,.97),rgba(11,35,50,.96));
box-shadow:0 24px 80px rgba(0,0,0,.55),inset 7px 0 #1ee2d2}.ad:before{content:"WERBUNG";position:absolute;top:10px;right:16px;
font-size:13px;font-weight:900;letter-spacing:.16em;color:#66f5ea}.ad.top{top:45px;left:110px;right:110px;min-height:170px}
.ad.lower-third{left:90px;right:90px;bottom:72px;min-height:190px}.ad.bottom-right{right:66px;bottom:66px;width:720px;min-height:290px}
.ad.fullscreen{inset:0;padding:0;border:0;border-radius:0;background:#000}.copy{min-width:0;flex:1}.sponsor{color:#65f2e7;font-size:18px;font-weight:900;text-transform:uppercase;letter-spacing:.1em}
h1{margin:6px 0 7px;font-size:47px;line-height:1.05}p{margin:0;font-size:25px;line-height:1.28;color:#dce9f1;white-space:pre-wrap}
.cta{display:inline-block;margin-top:12px;padding:8px 13px;border-radius:7px;background:#1ee2d2;color:#03201e;font-weight:900}
.media{width:100%;height:100%;object-fit:contain;background:#000}.top .media,.lower-third .media{width:340px;height:145px;border-radius:12px}
.bottom-right .media{width:250px;height:190px;border-radius:12px}.media-only.top .media,.media-only.lower-third .media,.media-only.bottom-right .media{width:100%;height:100%;max-height:420px}
.light{color:#08131b;background:rgba(248,251,253,.97);border-color:#fff;box-shadow:0 24px 80px rgba(0,0,0,.4),inset 7px 0 #fff}.light p{color:#33414b}
.bold{border-color:#ffbf24;background:linear-gradient(120deg,#141007,#492e00);box-shadow:0 24px 80px rgba(0,0,0,.5),inset 7px 0 #ffbf24}.bold .sponsor,.bold:before{color:#ffd66b}
.minimal{border-color:rgba(255,255,255,.35);background:rgba(2,7,12,.87);box-shadow:0 14px 40px rgba(0,0,0,.4)}
.fade{animation:fade .45s ease both}.slide{animation:slide .55s cubic-bezier(.2,.8,.2,1) both}.zoom{animation:zoom .4s ease both}
@keyframes fade{from{opacity:0}to{opacity:1}}@keyframes slide{from{opacity:0;translate:0 75px}to{opacity:1;translate:0 0}}
@keyframes zoom{from{opacity:0;scale:.88}to{opacity:1;scale:1}}
</style></head><body><main id="stage"></main><script>
const stage=document.getElementById('stage');let current='';
function el(tag,cls,value){const node=document.createElement(tag);node.className=cls;if(value)node.textContent=value;return node}
function render(ad){if(!ad){current='';stage.replaceChildren();return}if(current===ad.id)return;current=ad.id;
 const card=el('section',['ad',ad.placement,ad.style,ad.transition].join(' '));const hasCopy=Boolean(ad.headline||ad.body||ad.call_to_action);if(!hasCopy)card.classList.add('media-only');
 if(ad.mediaUrl){const media=document.createElement(ad.creative_type==='video'?'video':'img');media.className='media';media.src=ad.mediaUrl;
  if(media.tagName==='VIDEO'){media.autoplay=true;media.playsInline=true;media.loop=true;media.volume=1;media.play().catch(()=>{})}card.append(media)}
 if(hasCopy){const copy=el('div','copy');copy.append(el('div','sponsor',ad.advertiser||'Partner'));
  if(ad.headline)copy.append(el('h1','',ad.headline));if(ad.body)copy.append(el('p','',ad.body));if(ad.call_to_action)copy.append(el('span','cta',ad.call_to_action));card.append(copy)}
 stage.replaceChildren(card)}
async function load(){try{const r=await fetch('/api/overlay/advertising/active',{cache:'no-store'});if(r.ok)render((await r.json()).active)}catch{}}
load();setInterval(load,500);
</script></body></html>`;
}

function sendMedia(reply: FastifyReply, media: any, buffer: Buffer, range?: string) {
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = Math.min(match?.[2] ? Number(match[2]) : buffer.length - 1, buffer.length - 1);
    if (!match || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end) {
      return reply.code(416).header('content-range', `bytes */${buffer.length}`).send();
    }
    return reply
      .code(206)
      .headers({
        'content-type': media.mime_type,
        'accept-ranges': 'bytes',
        'content-range': `bytes ${start}-${end}/${buffer.length}`,
        'content-length': String(end - start + 1),
      })
      .send(buffer.subarray(start, end + 1));
  }
  return reply
    .headers({
      'content-type': media.mime_type,
      'accept-ranges': 'bytes',
      'content-length': String(buffer.length),
    })
    .send(buffer);
}

export function registerAdvertisingRoutes(
  app: FastifyInstance,
  requirePermission: RequirePermission,
  options: {
    readStoredFile: (path: string) => Promise<Buffer>;
    onPlayout?: (event: 'started' | 'ended', playout: any) => Promise<void>;
  },
) {
  app.get('/api/advertising', async () => advertisingDashboard());
  app.post('/api/advertising/campaigns', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    return reply.code(201).send(await createAdvertisingCampaign(campaignSchema.parse(request.body), request.user?.id));
  });
  app.put('/api/advertising/campaigns/:id', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const result = await updateAdvertisingCampaign(
      z.string().uuid().parse((request.params as any).id),
      campaignSchema.parse(request.body),
    );
    return result ?? reply.code(404).send({ error: 'Kampagne nicht gefunden.' });
  });
  app.delete('/api/advertising/campaigns/:id', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const result = await archiveAdvertisingCampaign(z.string().uuid().parse((request.params as any).id));
    return result ? { ok: true } : reply.code(404).send({ error: 'Kampagne nicht gefunden.' });
  });
  app.post('/api/advertising/creatives', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    return reply.code(201).send(await createAdvertisingCreative(creativeSchema.parse(request.body)));
  });
  app.put('/api/advertising/creatives/:id', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const result = await updateAdvertisingCreative(
      z.string().uuid().parse((request.params as any).id),
      creativeSchema.parse(request.body),
    );
    return result ?? reply.code(404).send({ error: 'Werbemittel nicht gefunden.' });
  });
  app.delete('/api/advertising/creatives/:id', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const result = await deleteAdvertisingCreative(z.string().uuid().parse((request.params as any).id));
    return result ? { ok: true } : reply.code(404).send({ error: 'Werbemittel nicht gefunden.' });
  });
  app.post('/api/advertising/schedules', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    return reply.code(201).send(await createAdvertisingSchedule(scheduleSchema.parse(request.body)));
  });
  app.put('/api/advertising/schedules/:id', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const result = await updateAdvertisingSchedule(
      z.string().uuid().parse((request.params as any).id),
      scheduleSchema.parse(request.body),
    );
    return result ?? reply.code(404).send({ error: 'Werbezeitplan nicht gefunden.' });
  });
  app.delete('/api/advertising/schedules/:id', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const result = await deleteAdvertisingSchedule(z.string().uuid().parse((request.params as any).id));
    return result ? { ok: true } : reply.code(404).send({ error: 'Werbezeitplan nicht gefunden.' });
  });
  app.post('/api/advertising/creatives/:id/play', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    try {
      const playout = await startAdvertisingPlayout({
        creativeId: z.string().uuid().parse((request.params as any).id),
        triggerType: 'manual',
        createdBy: request.user?.id,
      });
      await options.onPlayout?.('started', playout);
      return reply.code(201).send(playout);
    } catch (error) {
      if (error instanceof Error && error.message === 'advertising-creative-not-ready') {
        return reply.code(409).send({ error: 'Kampagne oder Werbemittel ist nicht aktiv.' });
      }
      throw error;
    }
  });
  app.delete('/api/advertising/playouts/:id', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const playout = await endAdvertisingPlayout(z.string().uuid().parse((request.params as any).id));
    if (!playout) return reply.code(404).send({ error: 'Aktive Werbeeinblendung nicht gefunden.' });
    await options.onPlayout?.('ended', playout);
    return { ok: true };
  });
  app.post('/api/advertising/assets', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'Bitte ein Bild oder einen Videoclip auswählen.' });
    const directory = process.env.ADVERTISING_MEDIA_DIR ?? 'generated/advertising';
    const stored = file.mimetype.startsWith('video/')
      ? await storeUploadedVideo({
          stream: file.file,
          declaredMime: file.mimetype,
          directory,
          maxDurationSeconds: 300,
        })
      : await storeUploadedImage({
          stream: file.file,
          filename: file.filename,
          declaredMime: file.mimetype,
          directory,
        });
    const media = await createMediaAssetWithDerivatives({
      filename: file.filename,
      mimeType: stored.mime,
      sizeBytes: stored.size,
      storagePath: stored.originalPath,
      sha256: stored.sha256,
      source: 'Werbeverwaltung',
      metadata: { width: stored.width, height: stored.height, durationSeconds: 'durationSeconds' in stored ? stored.durationSeconds : null },
      derivativePaths: Object.fromEntries(stored.derivatives.map((item) => [item.label, item])),
    });
    return reply.code(201).send(media);
  });
  app.get('/api/overlay/advertising/active', async () => {
    const active = await getActiveAdvertisingPlayout();
    return {
      active: active
        ? {
            ...active,
            mediaUrl: active.media_id ? `/api/overlay/advertising/media/${encodeURIComponent(active.id)}` : null,
            remainingMs: Math.max(0, new Date(active.expires_at).getTime() - Date.now()),
          }
        : null,
    };
  });
  app.get('/api/overlay/advertising/media/:id', async (request, reply) => {
    const media = await getAdvertisingPlayoutMedia(z.string().uuid().parse((request.params as any).id));
    if (!media?.storage_path) return reply.code(404).send({ error: 'Werbemedium nicht gefunden.' });
    return sendMedia(reply, media, await options.readStoredFile(media.storage_path), request.headers.range);
  });
  app.get('/overlay/advertising', async (_request, reply) =>
    reply.type('text/html; charset=utf-8').send(rendererHtml()),
  );
}

export async function runAdvertisingScheduler(
  onPlayout?: (event: 'started' | 'ended', playout: any) => Promise<void>,
) {
  const playout = await claimDueAdvertisingPlayout();
  if (playout) await onPlayout?.('started', playout);
  return playout;
}

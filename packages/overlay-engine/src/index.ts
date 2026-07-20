import { z } from 'zod';

export const overlayElementTypes = ['text', 'image', 'shape', 'line', 'clock', 'logo', 'ticker'] as const;
export const overlayBindings = [
  'article.title',
  'article.summary',
  'article.source',
  'article.publishedAt',
  'article.publishedDate',
  'article.category',
  'article.region',
  'playlist.current',
  'clock.time',
  'playback.status',
  'channel.name',
  'youtube.title',
  'youtube.channel',
  'youtube.url',
  'live.sourceCount',
  'live.layout',
  'live.programSourceName',
  'live.summary',
] as const;
export const overlayTemplates = [
  'main-news',
  'breaking-news',
  'lower-third',
  'ticker',
  'maintenance',
  'fullscreen-graphic',
  'live-studio',
  'youtube-video',
  'youtube-news-sidebar',
] as const;
export type OverlayElementType = (typeof overlayElementTypes)[number];
export type OverlayBinding = (typeof overlayBindings)[number];
export type OverlayTemplate = (typeof overlayTemplates)[number];

const color = z.string().regex(/^(#[0-9a-fA-F]{6}|rgba\((?:\d{1,3},){3}(?:0|1|0?\.\d+)\)|transparent)$/);
const px = z.number().int().min(0).max(4096);
const fontSize = z.number().int().min(8).max(220);
const opacity = z.number().min(0).max(1);
const radius = z.number().int().min(0).max(128);
const commonProps = z
  .object({
    fontFamily: z.enum(['Inter', 'Arial', 'Georgia', 'Roboto', 'system']).default('Inter'),
    fontSize: fontSize.default(42),
    fontWeight: z.enum(['300', '400', '500', '600', '700', '800', '900']).default('700'),
    color: color.default('#ffffff'),
    background: color.default('transparent'),
    borderColor: color.default('transparent'),
    borderWidth: z.number().int().min(0).max(24).default(0),
    borderRadius: radius.default(0),
    padding: radius.default(0),
    align: z.enum(['left', 'center', 'right']).default('left'),
    objectFit: z.enum(['contain', 'cover', 'fill']).default('contain'),
    src: z.string().max(500).optional(),
    text: z.string().max(2000).optional(),
    shape: z.enum(['rect', 'ellipse']).optional(),
    animation: z.enum(['none', 'fade', 'slide', 'ticker']).default('none'),
  })
  .strict();
export const overlayElementSchema = z
  .object({
    id: z.string().min(1).max(80),
    type: z.enum(overlayElementTypes),
    name: z.string().min(1).max(120),
    x: px,
    y: px,
    width: px.min(1),
    height: px.min(1),
    rotation: z.number().min(-360).max(360).default(0),
    opacity,
    zIndex: z.number().int().min(0).max(999).default(0),
    locked: z.boolean().default(false),
    hidden: z.boolean().default(false),
    binding: z.enum(overlayBindings).optional(),
    props: commonProps.default({
      fontFamily: 'Inter',
      fontSize: 42,
      fontWeight: '700',
      color: '#ffffff',
      background: 'transparent',
      borderColor: 'transparent',
      borderWidth: 0,
      borderRadius: 0,
      padding: 0,
      align: 'left',
      objectFit: 'contain',
      animation: 'none',
    }),
  })
  .strict();
export const overlayDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    template: z.enum(overlayTemplates),
    width: z.union([z.literal(1920), z.literal(1080)]),
    height: z.union([z.literal(1080), z.literal(1920)]),
    elements: z.array(overlayElementSchema).max(80),
    updatedAt: z.string().datetime().optional(),
  })
  .strict()
  .refine(
    (v) => (v.width === 1920 && v.height === 1080) || (v.width === 1080 && v.height === 1920),
    'Unsupported overlay resolution',
  );
export type OverlayElement = z.infer<typeof overlayElementSchema>;
export type OverlayDocument = z.infer<typeof overlayDocumentSchema>;

export function validateOverlayDocument(input: unknown): OverlayDocument {
  return overlayDocumentSchema.parse(input);
}
export function makeElement(
  type: OverlayElementType,
  partial: Omit<Partial<OverlayElement>, 'props'> & { props?: Record<string, unknown> } = {},
): OverlayElement {
  const id = partial.id ?? `${type}-${Math.random().toString(36).slice(2, 9)}`;
  return overlayElementSchema.parse({
    id,
    type,
    name: partial.name ?? type,
    x: partial.x ?? 80,
    y: partial.y ?? 80,
    width: partial.width ?? 500,
    height: partial.height ?? 120,
    rotation: partial.rotation ?? 0,
    opacity: partial.opacity ?? 1,
    zIndex: partial.zIndex ?? 0,
    locked: partial.locked ?? false,
    hidden: partial.hidden ?? false,
    binding: partial.binding,
    props: {
      ...{
        fontFamily: 'Inter',
        fontSize: 42,
        fontWeight: '700',
        color: '#ffffff',
        background: 'transparent',
        borderColor: 'transparent',
        borderWidth: 0,
        borderRadius: 0,
        padding: 0,
        align: 'left',
        objectFit: 'contain',
        animation: 'none',
      },
      ...(partial.props ?? {}),
    },
  });
}
export function createTemplate(
  template: OverlayTemplate,
  width = 1920,
  height = 1080,
  channelName = 'MEIN KANAL',
): OverlayDocument {
  const base = {
    schemaVersion: 1 as const,
    template,
    width: width as 1920 | 1080,
    height: height as 1080 | 1920,
    updatedAt: new Date().toISOString(),
  };
  const senderName = channelName.trim().toUpperCase().slice(0, 80) || 'MEIN KANAL';
  const landscape = width > height;
  const els: OverlayElement[] = [];
  if (template === 'main-news') {
    els.push(
      makeElement('shape', { name: 'Hintergrund', x: 0, y: 0, width, height, props: { background: '#111318' } }),
    );
    els.push(
      makeElement('shape', {
        name: 'Markenlinie',
        x: landscape ? 120 : 70,
        y: landscape ? 76 : 92,
        width: landscape ? 104 : 84,
        height: 12,
        props: { background: '#d20a2e' },
      }),
    );
    els.push(
      makeElement('text', {
        name: 'Sender',
        x: landscape ? 120 : 70,
        y: landscape ? 104 : 124,
        width: landscape ? 900 : 940,
        height: 72,
        binding: 'channel.name',
        props: { text: senderName, fontSize: landscape ? 40 : 36, fontWeight: '900', color: '#ffffff' },
      }),
    );
    els.push(
      makeElement('shape', {
        name: 'Live-Fläche',
        x: width - (landscape ? 300 : 250),
        y: landscape ? 76 : 92,
        width: landscape ? 180 : 160,
        height: 64,
        props: { background: '#d20a2e', borderRadius: 4 },
      }),
    );
    els.push(
      makeElement('text', {
        name: 'Live',
        x: width - (landscape ? 300 : 250),
        y: landscape ? 85 : 101,
        width: landscape ? 180 : 160,
        height: 48,
        props: { text: 'LIVE', fontSize: 32, fontWeight: '900', align: 'center', color: '#ffffff' },
      }),
    );
    els.push(
      makeElement('text', {
        name: 'Headline',
        x: landscape ? 120 : 70,
        y: landscape ? 230 : 280,
        width: landscape ? 1500 : 940,
        height: landscape ? 210 : 220,
        binding: 'article.title',
        props: { fontSize: landscape ? 62 : 58, fontWeight: '900', color: '#ffffff' },
      }),
    );
    els.push(
      makeElement('text', {
        name: 'Zusammenfassung',
        x: landscape ? 120 : 70,
        y: landscape ? 450 : 560,
        width: landscape ? 1500 : 920,
        height: landscape ? 290 : 220,
        binding: 'article.summary',
        props: { fontSize: landscape ? 32 : 30, fontWeight: '500', color: '#d9e6f5' },
      }),
    );
    els.push(
      makeElement('text', {
        name: 'Quelle',
        x: landscape ? 120 : 70,
        y: landscape ? 770 : 820,
        width: landscape ? 620 : 560,
        height: 54,
        binding: 'article.source',
        props: { fontSize: 26, fontWeight: '700', color: '#b9c0ca' },
      }),
    );
    els.push(
      makeElement('text', {
        name: 'Erscheinungsdatum',
        x: landscape ? 760 : 650,
        y: landscape ? 770 : 820,
        width: landscape ? 360 : 320,
        height: 54,
        binding: 'article.publishedDate',
        props: { fontSize: 26, fontWeight: '700', color: '#b9c0ca' },
      }),
    );
    els.push(
      makeElement('ticker', {
        name: 'Ticker',
        x: 0,
        y: height - 92,
        width,
        height: 92,
        binding: 'article.summary',
        props: { fontSize: 32, fontWeight: '800', background: '#d20a2e', color: '#ffffff', animation: 'ticker' },
      }),
    );
  } else if (template === 'breaking-news') {
    els.push(
      makeElement('shape', { name: 'Alarmfläche', x: 0, y: 0, width, height, props: { background: '#21080a' } }),
    );
    els.push(
      makeElement('text', {
        name: 'Eilmeldung',
        x: 80,
        y: 100,
        width: 700,
        height: 100,
        props: { text: 'EILMELDUNG', fontSize: 68, fontWeight: '900', background: '#c1121f', padding: 16 },
      }),
    );
    els.push(
      makeElement('text', {
        name: 'Headline',
        x: 80,
        y: 280,
        width: width - 160,
        height: 360,
        binding: 'article.title',
        props: { fontSize: 86, fontWeight: '900' },
      }),
    );
  } else if (template === 'lower-third') {
    els.push(
      makeElement('shape', {
        name: 'Bauchbinde',
        x: 80,
        y: height - 260,
        width: width - 160,
        height: 180,
        props: { background: 'rgba(7,17,31,0.92)', borderColor: '#c1121f', borderWidth: 6, borderRadius: 18 },
      }),
    );
    els.push(
      makeElement('text', {
        name: 'Titel',
        x: 130,
        y: height - 235,
        width: width - 260,
        height: 70,
        binding: 'article.title',
        props: { fontSize: 44, fontWeight: '900' },
      }),
    );
    els.push(
      makeElement('text', {
        name: 'Quelle',
        x: 130,
        y: height - 160,
        width: Math.floor((width - 260) * 0.62),
        height: 52,
        binding: 'article.source',
        props: { fontSize: 26, fontWeight: '600', color: '#b8c7d9' },
      }),
    );
    els.push(
      makeElement('text', {
        name: 'Erscheinungsdatum',
        x: Math.floor(width * 0.66),
        y: height - 160,
        width: Math.floor(width * 0.28),
        height: 52,
        binding: 'article.publishedDate',
        props: { fontSize: 26, fontWeight: '600', align: 'right', color: '#b8c7d9' },
      }),
    );
  } else if (template === 'ticker') {
    els.push(
      makeElement('ticker', {
        name: 'Ticker',
        x: 0,
        y: height - 100,
        width,
        height: 100,
        binding: 'article.summary',
        props: {
          fontSize: 38,
          fontWeight: '800',
          background: '#07111f',
          borderColor: '#c1121f',
          borderWidth: 4,
          animation: 'ticker',
        },
      }),
    );
  } else if (template === 'youtube-video') {
    els.push(
      makeElement('shape', {
        name: 'Video-Rahmen Schatten',
        x: landscape ? 62 : 38,
        y: landscape ? 54 : 64,
        width: landscape ? width - 124 : width - 76,
        height: landscape ? height - 138 : height - 148,
        props: { background: 'transparent', borderColor: 'rgba(0,0,0,0.72)', borderWidth: 12, borderRadius: 28 },
      }),
    );
    els.push(
      makeElement('shape', {
        name: 'Video-Rahmen',
        x: landscape ? 72 : 48,
        y: landscape ? 64 : 74,
        width: landscape ? width - 144 : width - 96,
        height: landscape ? height - 158 : height - 168,
        props: { background: 'transparent', borderColor: '#f43f5e', borderWidth: 5, borderRadius: 22 },
      }),
    );
    els.push(
      makeElement('shape', {
        name: 'Rahmen Glanz',
        x: landscape ? 92 : 66,
        y: landscape ? 84 : 92,
        width: landscape ? width - 184 : width - 132,
        height: 3,
        props: { background: 'rgba(255,255,255,0.82)', borderRadius: 3 },
      }),
    );
    els.push(
      makeElement('shape', {
        name: 'Kanal Badge',
        x: landscape ? 92 : 66,
        y: landscape ? 82 : 102,
        width: landscape ? 520 : width - 132,
        height: 74,
        props: {
          background: 'rgba(7,11,17,0.86)',
          borderColor: 'rgba(255,255,255,0.16)',
          borderWidth: 2,
          borderRadius: 14,
        },
      }),
    );
    els.push(
      makeElement('text', {
        name: 'Kanal',
        x: landscape ? 116 : 90,
        y: landscape ? 94 : 114,
        width: landscape ? 472 : width - 180,
        height: 48,
        binding: 'youtube.channel',
        props: { text: 'YouTube', fontSize: landscape ? 30 : 25, fontWeight: '900', color: '#ffffff' },
      }),
    );
    els.push(
      makeElement('shape', {
        name: 'YouTube Marker',
        x: landscape ? width - 256 : width - 258,
        y: landscape ? 82 : height - 180,
        width: 184,
        height: 62,
        props: { background: '#ef4444', borderRadius: 31 },
      }),
    );
    els.push(
      makeElement('text', {
        name: 'YouTube Label',
        x: landscape ? width - 256 : width - 258,
        y: landscape ? 96 : height - 166,
        width: 184,
        height: 38,
        props: { text: 'YOUTUBE', fontSize: 24, fontWeight: '900', align: 'center', color: '#ffffff' },
      }),
    );
    els.push(
      makeElement('shape', {
        name: 'Quelle Fläche',
        x: landscape ? 72 : 48,
        y: height - (landscape ? 118 : 126),
        width: landscape ? width - 144 : width - 96,
        height: landscape ? 74 : 82,
        props: {
          background: 'rgba(7,11,17,0.90)',
          borderColor: 'rgba(244,63,94,0.70)',
          borderWidth: 2,
          borderRadius: 18,
        },
      }),
    );
    els.push(
      makeElement('text', {
        name: 'Video Titel',
        x: landscape ? 104 : 78,
        y: height - (landscape ? 102 : 112),
        width: landscape ? Math.floor((width - 208) * 0.52) : width - 156,
        height: landscape ? 44 : 38,
        binding: 'youtube.title',
        props: { text: 'YouTube Video', fontSize: landscape ? 28 : 23, fontWeight: '900', color: '#ffffff' },
      }),
    );
    els.push(
      makeElement('text', {
        name: 'Video URL',
        x: landscape ? Math.floor(width * 0.5) : 78,
        y: height - (landscape ? 96 : 72),
        width: landscape ? Math.floor(width * 0.44) : width - 156,
        height: landscape ? 36 : 34,
        binding: 'youtube.url',
        props: {
          text: 'youtube.com',
          fontSize: landscape ? 22 : 20,
          fontWeight: '700',
          align: landscape ? 'right' : 'left',
          color: '#cbd5e1',
        },
      }),
    );
  } else if (template === 'youtube-news-sidebar') {
    els.push(
      makeElement('shape', {
        name: 'Sidebar Fläche',
        x: 54,
        y: 54,
        width: landscape ? 1010 : Math.max(640, width - 108),
        height: height - 108,
        props: {
          background: 'rgba(5,8,14,0.92)',
          borderColor: 'rgba(244,63,94,0.64)',
          borderWidth: 2,
          borderRadius: 26,
        },
      }),
    );
    els.push(
      makeElement('shape', {
        name: 'Sidebar Akzent',
        x: 54,
        y: 54,
        width: 14,
        height: height - 108,
        props: { background: '#ef4444', borderRadius: 7 },
      }),
    );
    els.push(
      makeElement('text', {
        name: 'Format Label',
        x: 92,
        y: 86,
        width: 360,
        height: 42,
        props: { text: 'NEWS LIVEBOARD', fontSize: 28, fontWeight: '900', color: '#fb7185' },
      }),
    );
    els.push(
      makeElement('text', {
        name: 'Sender',
        x: 92,
        y: 126,
        width: landscape ? 870 : width - 184,
        height: 56,
        binding: 'channel.name',
        props: { text: senderName, fontSize: 42, fontWeight: '900', color: '#ffffff' },
      }),
    );
    const cardWidth = landscape ? 886 : width - 184;
    for (let index = 0; index < 4; index++) {
      const y = 220 + index * 180;
      if (y + 144 > height - 120) break;
      els.push(
        makeElement('shape', {
          name: `News Karte ${index + 1}`,
          x: 92,
          y,
          width: cardWidth,
          height: 144,
          props: {
            background: index === 0 ? 'rgba(244,63,94,0.20)' : 'rgba(15,23,42,0.76)',
            borderColor: index === 0 ? 'rgba(251,113,133,0.76)' : 'rgba(148,163,184,0.18)',
            borderWidth: 2,
            borderRadius: 18,
          },
        }),
      );
      els.push(
        makeElement('text', {
          name: `News Titel ${index + 1}`,
          x: 120,
          y: y + 18,
          width: cardWidth - 56,
          height: 42,
          props: {
            text:
              index === 0
                ? 'Nachrichtenbeitrag wird eingeblendet'
                : index === 1
                  ? 'Weitere Meldung'
                  : index === 2
                    ? 'Kurzmeldung'
                    : 'Update',
            fontSize: 30,
            fontWeight: '900',
            color: '#ffffff',
          },
        }),
      );
      els.push(
        makeElement('text', {
          name: `News Text ${index + 1}`,
          x: 120,
          y: y + 62,
          width: cardWidth - 56,
          height: 44,
          props: {
            text: 'Titel, Text und Quelle laufen ohne Sprecher-Audio parallel zum YouTube-Video.',
            fontSize: 21,
            fontWeight: '600',
            color: '#dbeafe',
          },
        }),
      );
      els.push(
        makeElement('text', {
          name: `News Quelle ${index + 1}`,
          x: 120,
          y: y + 108,
          width: cardWidth - 56,
          height: 24,
          props: { text: 'Quelle', fontSize: 18, fontWeight: '800', color: '#93c5fd' },
        }),
      );
    }
    const videoX = landscape ? 1136 : 80;
    const videoY = landscape ? 176 : Math.floor(height * 0.58);
    const videoW = landscape ? 704 : width - 160;
    const videoH = landscape ? 396 : Math.floor((videoW / 16) * 9);
    els.push(
      makeElement('shape', {
        name: 'YouTube Feld Schatten',
        x: videoX - 14,
        y: videoY - 14,
        width: videoW + 28,
        height: videoH + 28,
        props: { background: 'rgba(0,0,0,0.58)', borderRadius: 24 },
      }),
    );
    els.push(
      makeElement('shape', {
        name: 'YouTube Feld Rahmen',
        x: videoX - 2,
        y: videoY - 2,
        width: videoW + 4,
        height: videoH + 4,
        props: { background: 'transparent', borderColor: '#ef4444', borderWidth: 4, borderRadius: 18 },
      }),
    );
    els.push(
      makeElement('shape', {
        name: 'YouTube Quellenfläche',
        x: videoX - 2,
        y: videoY + videoH + 22,
        width: videoW + 4,
        height: 156,
        props: {
          background: 'rgba(5,8,14,0.90)',
          borderColor: 'rgba(244,63,94,0.54)',
          borderWidth: 2,
          borderRadius: 18,
        },
      }),
    );
    els.push(
      makeElement('text', {
        name: 'YouTube Kanal',
        x: videoX + 24,
        y: videoY + videoH + 42,
        width: videoW - 48,
        height: 36,
        binding: 'youtube.channel',
        props: { text: 'Kanal @ YouTube', fontSize: 25, fontWeight: '900', color: '#ffffff' },
      }),
    );
    els.push(
      makeElement('text', {
        name: 'YouTube Titel',
        x: videoX + 24,
        y: videoY + videoH + 80,
        width: videoW - 48,
        height: 34,
        binding: 'youtube.title',
        props: { text: 'YouTube Video', fontSize: 22, fontWeight: '800', color: '#fecdd3' },
      }),
    );
    els.push(
      makeElement('text', {
        name: 'YouTube URL',
        x: videoX + 24,
        y: videoY + videoH + 114,
        width: videoW - 48,
        height: 28,
        binding: 'youtube.url',
        props: { text: 'youtube.com', fontSize: 18, fontWeight: '700', color: '#cbd5e1' },
      }),
    );
  } else if (template === 'live-studio') {
    els.push(
      makeElement('shape', {
        name: 'Transparenter Hintergrund',
        x: 0,
        y: 0,
        width,
        height,
        props: { background: 'transparent' },
      }),
    );
    els.push(
      makeElement('shape', {
        name: 'Live-Status',
        x: landscape ? 72 : 48,
        y: landscape ? 64 : 72,
        width: landscape ? 220 : 196,
        height: 58,
        props: { background: '#d20a2e', borderRadius: 4 },
      }),
    );
    els.push(
      makeElement('text', {
        name: 'Live-Label',
        x: landscape ? 72 : 48,
        y: landscape ? 72 : 80,
        width: landscape ? 220 : 196,
        height: 44,
        props: {
          text: 'LIVE STUDIO',
          fontSize: landscape ? 28 : 24,
          fontWeight: '900',
          align: 'center',
          color: '#ffffff',
        },
      }),
    );
    els.push(
      makeElement('text', {
        name: 'Sender',
        x: landscape ? 312 : 48,
        y: landscape ? 70 : 144,
        width: landscape ? 760 : 720,
        height: 54,
        binding: 'channel.name',
        props: { text: senderName, fontSize: landscape ? 34 : 30, fontWeight: '800', color: '#ffffff' },
      }),
    );
    els.push(
      makeElement('shape', {
        name: 'Unterkante',
        x: 0,
        y: height - 76,
        width,
        height: 76,
        props: { background: 'rgba(11,14,20,0.78)' },
      }),
    );
    els.push(
      makeElement('text', {
        name: 'Hinweis',
        x: landscape ? 72 : 48,
        y: height - 58,
        width: width - (landscape ? 144 : 96),
        height: 40,
        binding: 'live.summary',
        props: {
          text: 'Live zugeschaltet',
          fontSize: landscape ? 28 : 24,
          fontWeight: '800',
          color: '#ffffff',
        },
      }),
    );
  } else if (template === 'maintenance') {
    els.push(
      makeElement('shape', { name: 'Hintergrund', x: 0, y: 0, width, height, props: { background: '#111318' } }),
    );
    els.push(
      makeElement('text', {
        name: 'Sender',
        x: width / 2 - 500,
        y: height / 2 - 250,
        width: 1000,
        height: 90,
        props: { text: senderName, fontSize: 58, fontWeight: '900', align: 'center', color: '#ffffff' },
      }),
    );
    els.push(
      makeElement('clock', {
        name: 'Uhr',
        x: width / 2 - 220,
        y: height / 2 - 90,
        width: 440,
        height: 120,
        binding: 'clock.time',
        props: { fontSize: 72, fontWeight: '800', align: 'center' },
      }),
    );
    els.push(
      makeElement('text', {
        name: 'Hinweis',
        x: width / 2 - 400,
        y: height / 2 + 50,
        width: 800,
        height: 80,
        props: { text: 'Sendung startet in Kürze', fontSize: 42, align: 'center' },
      }),
    );
    els.push(
      makeElement('shape', {
        name: 'Live-Fläche',
        x: width / 2 - 90,
        y: height / 2 + 150,
        width: 180,
        height: 64,
        props: { background: '#d20a2e', borderRadius: 4 },
      }),
    );
    els.push(
      makeElement('text', {
        name: 'Live',
        x: width / 2 - 90,
        y: height / 2 + 159,
        width: 180,
        height: 48,
        props: { text: 'LIVE', fontSize: 32, fontWeight: '900', align: 'center', color: '#ffffff' },
      }),
    );
    els.push(
      makeElement('text', {
        name: 'Claim',
        x: width / 2 - 500,
        y: height / 2 + 250,
        width: 1000,
        height: 70,
        props: {
          text: 'Analyse · Einordnung · Argumente',
          fontSize: 30,
          fontWeight: '600',
          align: 'center',
          color: '#b9c0ca',
        },
      }),
    );
  } else {
    els.push(
      makeElement('image', {
        name: 'Vollbildgrafik',
        x: 0,
        y: 0,
        width,
        height,
        props: { src: '', objectFit: 'cover' },
      }),
    );
  }
  return validateOverlayDocument({ ...base, elements: els });
}

export function bindText(el: OverlayElement, data: Record<string, any>): string {
  if (el.props.text && !el.binding) return el.props.text;
  switch (el.binding) {
    case 'article.title':
      return data.article?.title ?? '';
    case 'article.summary':
      return data.article?.summary ?? '';
    case 'article.source':
      return data.article?.source ?? '';
    case 'article.publishedAt':
      return data.article?.publishedAt ?? '';
    case 'article.publishedDate':
      return data.article?.publishedDate ?? '';
    case 'article.category':
      return data.article?.category ?? '';
    case 'article.region':
      return data.article?.region ?? '';
    case 'playlist.current':
      return data.playlist?.current ?? '';
    case 'clock.time':
      return new Date(data.serverTime ?? Date.now()).toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
      });
    case 'playback.status':
      return data.playback?.status ?? '';
    case 'channel.name':
      return data.channel?.name ?? '';
    case 'youtube.title':
      return data.youtube?.title ?? '';
    case 'youtube.channel':
      return data.youtube?.channel ?? '';
    case 'youtube.url':
      return data.youtube?.url ?? '';
    case 'live.sourceCount':
      return data.live?.sourceCount ?? '';
    case 'live.layout':
      return data.live?.layout ?? '';
    case 'live.programSourceName':
      return data.live?.programSourceName ?? '';
    case 'live.summary':
      return data.live?.summary ?? '';
    default:
      return el.props.text ?? '';
  }
}
export function safeStyle(el: OverlayElement) {
  return {
    left: `${el.x}px`,
    top: `${el.y}px`,
    width: `${el.width}px`,
    height: `${el.height}px`,
    opacity: String(el.opacity),
    zIndex: String(el.zIndex),
    transform: `rotate(${el.rotation}deg)`,
    color: el.props.color,
    background: el.props.background,
    border: `${el.props.borderWidth}px solid ${el.props.borderColor}`,
    borderRadius: `${el.props.borderRadius}px`,
    padding: `${el.props.padding}px`,
    fontFamily: el.props.fontFamily === 'system' ? 'system-ui, sans-serif' : el.props.fontFamily,
    fontSize: `${el.props.fontSize}px`,
    fontWeight: el.props.fontWeight,
    lineHeight: '1.15',
    overflowWrap: 'anywhere' as const,
    textAlign: el.props.align,
    boxSizing: 'border-box' as const,
  };
}

export function renderOverlay(doc: unknown, data: Record<string, any> = {}) {
  const safe = validateOverlayDocument(doc);
  return safe.elements
    .filter((e) => !e.hidden)
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((e) => ({ id: e.id, type: e.type, text: bindText(e, data), style: safeStyle(e), props: e.props }));
}

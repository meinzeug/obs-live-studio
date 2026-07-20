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

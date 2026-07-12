import { z } from 'zod';

export const overlayElementTypes = ['text', 'image', 'shape', 'line', 'clock', 'logo', 'ticker'] as const;
export const overlayBindings = [
  'article.title',
  'article.summary',
  'article.source',
  'article.category',
  'article.region',
  'playlist.current',
  'clock.time',
  'playback.status',
] as const;
export const overlayTemplates = [
  'main-news',
  'breaking-news',
  'lower-third',
  'ticker',
  'maintenance',
  'fullscreen-graphic',
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
export function createTemplate(template: OverlayTemplate, width = 1920, height = 1080): OverlayDocument {
  const base = {
    schemaVersion: 1 as const,
    template,
    width: width as 1920 | 1080,
    height: height as 1080 | 1920,
    updatedAt: new Date().toISOString(),
  };
  const landscape = width > height;
  const els: OverlayElement[] = [];
  if (template === 'main-news') {
    els.push(
      makeElement('shape', { name: 'Hintergrund', x: 0, y: 0, width, height, props: { background: '#07111f' } }),
    );
    els.push(
      makeElement('text', {
        name: 'Headline',
        x: landscape ? 120 : 70,
        y: landscape ? 220 : 260,
        width: landscape ? 1500 : 940,
        height: 220,
        binding: 'article.title',
        props: { fontSize: landscape ? 72 : 58, fontWeight: '900', color: '#ffffff' },
      }),
    );
    els.push(
      makeElement('text', {
        name: 'Zusammenfassung',
        x: landscape ? 120 : 70,
        y: landscape ? 470 : 560,
        width: landscape ? 1380 : 920,
        height: 180,
        binding: 'article.summary',
        props: { fontSize: landscape ? 36 : 30, fontWeight: '500', color: '#d9e6f5' },
      }),
    );
    els.push(
      makeElement('ticker', {
        name: 'Ticker',
        x: 0,
        y: height - 92,
        width,
        height: 92,
        binding: 'playlist.current',
        props: { fontSize: 32, fontWeight: '800', background: '#c1121f', color: '#ffffff', animation: 'ticker' },
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
        width: width - 260,
        height: 52,
        binding: 'article.source',
        props: { fontSize: 26, fontWeight: '600', color: '#b8c7d9' },
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
  } else if (template === 'maintenance') {
    els.push(
      makeElement('shape', { name: 'Hintergrund', x: 0, y: 0, width, height, props: { background: '#07111f' } }),
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

import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ShortsFontFamily, ShortsLayoutConfig, ShortsTextLayoutElement } from '@ans/database/youtube-shorts';

type TextSlot = 'formatLabel' | 'title' | 'commentary' | 'source';

const fontCandidates: Record<ShortsFontFamily, Record<'regular' | 'semibold' | 'bold', string[]>> = {
  'dejavu-sans': {
    regular: ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'],
    semibold: ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'],
    bold: ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'],
  },
  'ibm-plex-sans': {
    regular: ['/usr/share/fonts/truetype/ibm-plex/IBMPlexSans-Regular.ttf'],
    semibold: ['/usr/share/fonts/truetype/ibm-plex/IBMPlexSans-SemiBold.ttf'],
    bold: ['/usr/share/fonts/truetype/ibm-plex/IBMPlexSans-Bold.ttf'],
  },
  'ibm-plex-condensed': {
    regular: ['/usr/share/fonts/truetype/ibm-plex/IBMPlexSansCondensed-Regular.ttf'],
    semibold: ['/usr/share/fonts/truetype/ibm-plex/IBMPlexSansCondensed-SemiBold.ttf'],
    bold: ['/usr/share/fonts/truetype/ibm-plex/IBMPlexSansCondensed-Bold.ttf'],
  },
  'liberation-sans': {
    regular: [
      '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
      '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
    ],
    semibold: [
      '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
      '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf',
    ],
    bold: [
      '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
      '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf',
    ],
  },
  'nimbus-sans': {
    regular: ['/usr/share/fonts/opentype/urw-base35/NimbusSans-Regular.otf'],
    semibold: ['/usr/share/fonts/opentype/urw-base35/NimbusSans-Bold.otf'],
    bold: ['/usr/share/fonts/opentype/urw-base35/NimbusSans-Bold.otf'],
  },
};

function escapeFilterPath(path: string) {
  return path.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", "\\'");
}

function fontFile(element: ShortsTextLayoutElement) {
  return (
    fontCandidates[element.fontFamily][element.fontWeight].find((path) => existsSync(path)) ??
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
  );
}

function wrappedText(value: string, element: ShortsTextLayoutElement) {
  const clean = value.replace(/\s+/g, ' ').trim();
  const horizontalPadding = element.background === 'none' ? 4 : 28;
  const columns = Math.max(8, Math.floor((element.width - horizontalPadding * 2) / (element.fontSize * 0.54)));
  const lineHeight = element.fontSize * 1.22;
  const lines = Math.max(1, Math.floor((element.height - 12) / lineHeight));
  const words = clean.split(' ').filter(Boolean);
  const rows: string[] = [];
  let current = '';
  let consumed = 0;
  for (const word of words) {
    const candidate = `${current} ${word}`.trim();
    if (!current || candidate.length <= columns) {
      current = candidate;
      consumed += 1;
      continue;
    }
    rows.push(current);
    if (rows.length >= lines) break;
    current = word;
    consumed += 1;
  }
  if (current && rows.length < lines) rows.push(current);
  if (consumed < words.length && rows.length) rows[rows.length - 1] = `${rows.at(-1)!.replace(/…?$/, '')}…`;
  return rows.join('\n');
}

export async function writeShortsLayoutTextFiles(
  directory: string,
  layout: ShortsLayoutConfig,
  content: Record<TextSlot, string>,
) {
  const files = {} as Record<TextSlot, string>;
  await Promise.all(
    (Object.keys(content) as TextSlot[]).map(async (slot) => {
      const path = join(directory, `layout-${slot}.txt`);
      files[slot] = path;
      await writeFile(path, wrappedText(content[slot], layout.elements[slot]), { mode: 0o600 });
    }),
  );
  return files;
}

function backgroundFilter(style: ShortsLayoutConfig['backgroundStyle']) {
  if (style === 'clean')
    return 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=brightness=-0.42:saturation=0.48';
  if (style === 'studio')
    return 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=42,eq=brightness=-0.48:saturation=0.62';
  return 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=34,eq=brightness=-0.38:saturation=0.72';
}

function nextStage(filters: string[], current: string, operation: string, index: number) {
  const next = `layout${index}`;
  filters.push(`[${current}]${operation}[${next}]`);
  return next;
}

export function buildShortsVisualFilters(input: {
  layout: ShortsLayoutConfig;
  durationSeconds: number;
  leadSeconds: number;
  speechSeconds: number;
  idleTail: number;
  sourceInput: number;
  speakingInput: number;
  idleInput: number;
  brandingInput?: number;
  textFiles: Record<TextSlot, string>;
}) {
  const { layout } = input;
  const filters: string[] = layout.elements.sourceVideo.visible
    ? [
        `[${input.sourceInput}:v]split=2[sourcebg][sourcemain]`,
        `[sourcebg]${backgroundFilter(layout.backgroundStyle)}[layoutbg]`,
      ]
    : [`[${input.sourceInput}:v]${backgroundFilter(layout.backgroundStyle)}[layoutbg]`];
  let current = 'layoutbg';
  let stage = 0;
  const source = layout.elements.sourceVideo;
  if (source.visible) {
    const aspect = source.fit === 'cover' ? 'increase' : 'decrease';
    const scaled =
      source.fit === 'cover'
        ? `scale=${source.width}:${source.height}:force_original_aspect_ratio=${aspect}:force_divisible_by=2,crop=${source.width}:${source.height},setsar=1`
        : `scale=${source.width}:${source.height}:force_original_aspect_ratio=${aspect}:force_divisible_by=2,setsar=1,pad=${source.width}:${source.height}:(ow-iw)/2:(oh-ih)/2:color=black`;
    filters.push(`[sourcemain]${scaled}[layoutsource]`);
    if (source.borderWidth > 0) {
      const border = source.borderWidth;
      current = nextStage(
        filters,
        current,
        `drawbox=x=${Math.max(0, source.x - border)}:y=${Math.max(0, source.y - border)}:w=${Math.min(1080, source.width + border * 2)}:h=${Math.min(1920, source.height + border * 2)}:color=0x${layout.accentColor.slice(1)}ff:t=fill`,
        stage++,
      );
    }
    const overlaid = `layout${stage++}`;
    filters.push(`[${current}][layoutsource]overlay=${source.x}:${source.y}:shortest=0[${overlaid}]`);
    current = overlaid;
  }

  for (const slot of ['formatLabel', 'title', 'commentary', 'source'] as TextSlot[]) {
    const element = layout.elements[slot];
    if (!element.visible) continue;
    if (element.background !== 'none') {
      const color = element.background === 'solid' ? '0x050b14f2' : '0x06101dcc';
      current = nextStage(
        filters,
        current,
        `drawbox=x=${element.x}:y=${element.y}:w=${element.width}:h=${element.height}:color=${color}:t=fill,drawbox=x=${element.x}:y=${element.y}:w=8:h=${element.height}:color=0x${layout.accentColor.slice(1)}ff:t=fill`,
        stage++,
      );
    }
    const padding = element.background === 'none' ? 4 : 24;
    const x =
      element.align === 'center'
        ? `${element.x}+(${element.width}-text_w)/2`
        : element.align === 'right'
          ? `${element.x + element.width - padding}-text_w`
          : String(element.x + padding);
    current = nextStage(
      filters,
      current,
      `drawtext=fontfile='${escapeFilterPath(fontFile(element))}':textfile='${escapeFilterPath(input.textFiles[slot])}':fontcolor=0x${element.color.slice(1)}:fontsize=${element.fontSize}:line_spacing=${Math.round(element.fontSize * 0.18)}:x=${x}:y=${element.y + Math.max(4, Math.round(element.fontSize * 0.18))}`,
      stage++,
    );
  }

  const avatar = layout.elements.avatar;
  if (avatar.visible) {
    filters.push(
      `[${input.idleInput}:v]split=2[idlepre0][idlepost0]`,
      `[idlepre0]scale=${avatar.width}:${avatar.height}:force_original_aspect_ratio=decrease:force_divisible_by=2,trim=duration=${input.leadSeconds},setpts=PTS-STARTPTS[idlepre]`,
      `[${input.speakingInput}:v]scale=${avatar.width}:${avatar.height}:force_original_aspect_ratio=decrease:force_divisible_by=2,trim=duration=${input.speechSeconds.toFixed(3)},setpts=PTS-STARTPTS[speaking]`,
      `[idlepost0]scale=${avatar.width}:${avatar.height}:force_original_aspect_ratio=decrease:force_divisible_by=2,trim=duration=${input.idleTail.toFixed(3)},setpts=PTS-STARTPTS[idlepost]`,
      '[idlepre][speaking][idlepost]concat=n=3:v=1:a=0[layoutavatar]',
    );
    if (avatar.borderWidth > 0) {
      const border = avatar.borderWidth;
      current = nextStage(
        filters,
        current,
        `drawbox=x=${Math.max(0, avatar.x - border)}:y=${Math.max(0, avatar.y - border)}:w=${Math.min(1080, avatar.width + border * 2)}:h=${Math.min(1920, avatar.height + border * 2)}:color=0x${layout.accentColor.slice(1)}ff:t=fill`,
        stage++,
      );
    }
    const overlaid = `layout${stage++}`;
    filters.push(`[${current}][layoutavatar]overlay=${avatar.x}:${avatar.y}:shortest=0[${overlaid}]`);
    current = overlaid;
  }

  if (layout.brandingOverlayVisible && input.brandingInput !== undefined) {
    filters.push(`[${input.brandingInput}:v]scale=1080:1920[layoutbranding]`);
    const branded = `layout${stage++}`;
    filters.push(`[${current}][layoutbranding]overlay=0:0:shortest=0[${branded}]`);
    current = branded;
  }
  filters.push(`[${current}]format=yuv420p[videoout]`);
  return filters;
}

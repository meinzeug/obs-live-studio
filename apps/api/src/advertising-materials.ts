import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { z } from 'zod';
import {
  advertisingMaterialsDashboard,
  archiveAdvertisingMaterialProject,
  createAdvertisingMaterialExport,
  createAdvertisingMaterialProject,
  getAdvertisingMaterialExport,
  getAdvertisingMaterialProject,
  updateAdvertisingMaterialProject,
} from '@ans/database/advertising-materials';
import { PROJECT_ROOT } from './project-root.js';

type RequirePermission = (request: FastifyRequest, reply: FastifyReply, permission: 'broadcast:write') => void;

const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const materialSchema = z
  .object({
    campaignId: z.string().uuid().nullable().default(null),
    name: z.string().trim().min(2).max(140),
    materialKind: z.enum(['flyer', 'poster', 'social', 'tshirt', 'card']).default('flyer'),
    formatPreset: z.enum(['a6', 'a5', 'a4', 'a3', 'square', 'story', 'tshirt']).default('a5'),
    orientation: z.enum(['portrait', 'landscape']).default('portrait'),
    visualStyle: z.enum(['broadcast', 'editorial', 'bold', 'minimal', 'community']).default('broadcast'),
    headline: z.string().trim().min(2).max(280),
    body: z.string().trim().max(1800).default(''),
    callToAction: z.string().trim().max(180).default(''),
    website: z.string().trim().max(500).default(''),
    advertiser: z.string().trim().max(180).default(''),
    primaryColor: color.default('#07111f'),
    accentColor: color.default('#22d3ee'),
    textColor: color.default('#f8fafc'),
    backgroundMode: z.enum(['gradient', 'dark', 'light', 'accent']).default('gradient'),
    design: z.record(z.string(), z.unknown()).default({}),
    status: z.enum(['draft', 'ready']).default('draft'),
  })
  .strict();

export const advertisingMaterialFormats = {
  a6: { label: 'A6 Flyer', width: 1240, height: 1748, dpi: 300 },
  a5: { label: 'A5 Flyer', width: 1748, height: 2480, dpi: 300 },
  a4: { label: 'A4 Poster', width: 2480, height: 3508, dpi: 300 },
  a3: { label: 'A3 Poster', width: 3508, height: 4961, dpi: 300 },
  square: { label: 'Social Quadrat', width: 2160, height: 2160, dpi: 300 },
  story: { label: 'Story / Reel', width: 1080, height: 1920, dpi: 144 },
  tshirt: { label: 'T-Shirt Frontprint', width: 4500, height: 5400, dpi: 300 },
} as const;

function xml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function wrapText(value: string, maxCharacters: number, maxLines: number) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxCharacters || !line) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length >= maxLines - 1) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1]!.replace(/[.,;:!?]*$/, '')}…`;
  }
  return lines;
}

function materialDimensions(project: any) {
  const preset = advertisingMaterialFormats[project.format_preset as keyof typeof advertisingMaterialFormats];
  if (!preset) throw new Error('Unbekanntes Werbematerial-Format.');
  const landscape = project.orientation === 'landscape' && !['story', 'tshirt'].includes(project.format_preset);
  return {
    ...preset,
    width: landscape ? preset.height : preset.width,
    height: landscape ? preset.width : preset.height,
  };
}

export function advertisingMaterialSvg(project: any, requestedWidth?: number) {
  const format = materialDimensions(project);
  const scale = requestedWidth ? Math.min(1, requestedWidth / format.width) : 1;
  const width = Math.max(320, Math.round(format.width * scale));
  const height = Math.max(320, Math.round(format.height * scale));
  const ratio = width / format.width;
  const unit = Math.max(1, Math.min(width, height) / 1000);
  const pad = Math.round(Math.min(width, height) * 0.075);
  const primary =
    project.background_mode === 'light'
      ? '#eef5f7'
      : project.background_mode === 'accent'
        ? project.accent_color
        : project.primary_color;
  const secondary =
    project.background_mode === 'light'
      ? '#ffffff'
      : project.background_mode === 'dark'
        ? '#02060c'
        : project.visual_style === 'bold'
          ? project.accent_color
          : '#0b2235';
  const foreground = project.background_mode === 'light' ? '#07111f' : project.text_color;
  const headlineLines = wrapText(project.headline, Math.max(14, Math.floor(34 / Math.max(0.55, ratio))), 5);
  const bodyLines = wrapText(project.body, Math.max(28, Math.floor(62 / Math.max(0.55, ratio))), 8);
  const headlineSize = Math.max(34, Math.round(Math.min(width * 0.085, height * 0.065)));
  const bodySize = Math.max(18, Math.round(headlineSize * 0.38));
  const kickerSize = Math.max(15, Math.round(headlineSize * 0.27));
  const headlineY = Math.round(height * 0.27);
  const headlineSpacing = Math.round(headlineSize * 1.02);
  const bodyY = headlineY + headlineLines.length * headlineSpacing + Math.round(headlineSize * 0.6);
  const bodySpacing = Math.round(bodySize * 1.38);
  const styleMark =
    project.visual_style === 'editorial'
      ? 'MAGAZIN · DISKURS · LIVE'
      : project.visual_style === 'community'
        ? 'COMMUNITY · MITMACHEN · MITGESTALTEN'
        : project.visual_style === 'minimal'
          ? 'OPEN TV STUDIO'
          : 'OPEN TV STUDIO · LIVE · DIGITAL';
  const texture =
    project.material_kind === 'tshirt'
      ? ''
      : `<g opacity=".12"><path d="M0 ${height * 0.72} L${width} ${height * 0.42}" stroke="${xml(
          project.accent_color,
        )}" stroke-width="${Math.max(8, width * 0.016)}"/><circle cx="${width * 0.82}" cy="${height * 0.2}" r="${
          Math.min(width, height) * 0.22
        }" fill="none" stroke="${xml(project.accent_color)}" stroke-width="${Math.max(4, width * 0.006)}"/></g>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${xml(primary)}"/>
      <stop offset="1" stop-color="${xml(secondary)}"/>
    </linearGradient>
    <radialGradient id="glow"><stop stop-color="${xml(project.accent_color)}" stop-opacity=".32"/><stop offset="1" stop-color="${xml(project.accent_color)}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <circle cx="${width * 0.82}" cy="${height * 0.22}" r="${Math.min(width, height) * 0.4}" fill="url(#glow)"/>
  ${texture}
  <rect x="${pad}" y="${pad}" width="${Math.max(2, width - pad * 2)}" height="${Math.max(
    2,
    height - pad * 2,
  )}" rx="${Math.round(22 * unit)}" fill="none" stroke="${xml(project.accent_color)}" stroke-width="${Math.max(
    3,
    Math.round(3 * unit),
  )}" opacity=".82"/>
  <rect x="${pad}" y="${pad}" width="${Math.max(8, Math.round(10 * unit))}" height="${Math.max(
    80,
    height - pad * 2,
  )}" rx="${Math.max(4, Math.round(5 * unit))}" fill="${xml(project.accent_color)}"/>
  <text x="${pad * 1.45}" y="${Math.round(height * 0.13)}" fill="${xml(
    project.accent_color,
  )}" font-family="Inter,Arial,sans-serif" font-size="${kickerSize}" font-weight="900" letter-spacing="${Math.max(
    2,
    Math.round(kickerSize * 0.16),
  )}">${xml(styleMark)}</text>
  <text x="${pad * 1.45}" y="${Math.round(height * 0.18)}" fill="${xml(
    foreground,
  )}" font-family="Inter,Arial,sans-serif" font-size="${Math.round(kickerSize * 1.15)}" font-weight="800">${xml(
    project.advertiser || project.campaign_name || 'ZEITKANTE',
  )}</text>
  <g fill="${xml(foreground)}" font-family="Inter,Arial,sans-serif" font-size="${headlineSize}" font-weight="950">
    ${headlineLines
      .map((line, index) => `<text x="${pad * 1.45}" y="${headlineY + index * headlineSpacing}">${xml(line)}</text>`)
      .join('')}
  </g>
  <g fill="${xml(foreground)}" opacity=".86" font-family="Inter,Arial,sans-serif" font-size="${bodySize}" font-weight="560">
    ${bodyLines
      .map((line, index) => `<text x="${pad * 1.45}" y="${bodyY + index * bodySpacing}">${xml(line)}</text>`)
      .join('')}
  </g>
  ${
    project.call_to_action
      ? `<rect x="${pad * 1.45}" y="${height * 0.78}" width="${Math.min(
          width - pad * 2.9,
          project.call_to_action.length * bodySize * 0.68 + pad,
        )}" height="${bodySize * 2.25}" rx="${bodySize * 0.55}" fill="${xml(project.accent_color)}"/>
  <text x="${pad * 1.8}" y="${height * 0.78 + bodySize * 1.47}" fill="${
    project.background_mode === 'accent' ? project.primary_color : '#031018'
  }" font-family="Inter,Arial,sans-serif" font-size="${bodySize}" font-weight="950">${xml(
    project.call_to_action,
  )}</text>`
      : ''
  }
  <text x="${pad * 1.45}" y="${height - pad * 1.45}" fill="${xml(
    foreground,
  )}" font-family="Inter,Arial,sans-serif" font-size="${Math.max(16, Math.round(bodySize * 0.86))}" font-weight="850">${xml(
    project.website,
  )}</text>
</svg>`;
}

export function advertisingMaterialPdfFromJpeg(jpeg: Buffer, widthPx: number, heightPx: number, dpi: number) {
  const pageWidth = Number(((widthPx / dpi) * 72).toFixed(3));
  const pageHeight = Number(((heightPx / dpi) * 72).toFixed(3));
  const content = Buffer.from(`q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`, 'ascii');
  const objects: Buffer[] = [
    Buffer.from('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n', 'ascii'),
    Buffer.from('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n', 'ascii'),
    Buffer.from(
      `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
      'ascii',
    ),
    Buffer.concat([
      Buffer.from(
        `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
        'ascii',
      ),
      jpeg,
      Buffer.from('\nendstream\nendobj\n', 'ascii'),
    ]),
    Buffer.concat([
      Buffer.from(`5 0 obj\n<< /Length ${content.length} >>\nstream\n`, 'ascii'),
      content,
      Buffer.from('endstream\nendobj\n', 'ascii'),
    ]),
  ];
  const header = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary');
  const offsets = [0];
  let offset = header.length;
  for (const object of objects) {
    offsets.push(offset);
    offset += object.length;
  }
  const xref = Buffer.from(
    `xref\n0 6\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((value) => `${String(value).padStart(10, '0')} 00000 n \n`)
      .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`,
    'ascii',
  );
  return Buffer.concat([header, ...objects, xref]);
}

export function registerAdvertisingMaterialRoutes(app: FastifyInstance, requirePermission: RequirePermission) {
  app.get('/api/advertising-materials', async () => ({
    ...(await advertisingMaterialsDashboard()),
    formats: advertisingMaterialFormats,
  }));

  app.post('/api/advertising-materials', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    return reply
      .code(201)
      .send(await createAdvertisingMaterialProject(materialSchema.parse(request.body), request.user?.id));
  });

  app.put('/api/advertising-materials/:id', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const project = await updateAdvertisingMaterialProject(
      z.string().uuid().parse((request.params as any).id),
      materialSchema.parse(request.body),
    );
    return project ?? reply.code(404).send({ error: 'Werbematerial-Projekt nicht gefunden.' });
  });

  app.delete('/api/advertising-materials/:id', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const project = await archiveAdvertisingMaterialProject(z.string().uuid().parse((request.params as any).id));
    return project ? { ok: true } : reply.code(404).send({ error: 'Werbematerial-Projekt nicht gefunden.' });
  });

  app.get('/api/advertising-materials/:id/preview', async (request, reply) => {
    const project = await getAdvertisingMaterialProject(z.string().uuid().parse((request.params as any).id));
    if (!project) return reply.code(404).send({ error: 'Werbematerial-Projekt nicht gefunden.' });
    const width = z.coerce.number().int().min(320).max(1400).catch(720).parse((request.query as any)?.width);
    return reply
      .header('cache-control', 'no-store')
      .type('image/svg+xml; charset=utf-8')
      .send(advertisingMaterialSvg(project, width));
  });

  app.post('/api/advertising-materials/:id/render', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const projectId = z.string().uuid().parse((request.params as any).id);
    const { exportType } = z
      .object({ exportType: z.enum(['png', 'pdf', 'jpeg']).default('pdf') })
      .strict()
      .parse(request.body ?? {});
    const project = await getAdvertisingMaterialProject(projectId);
    if (!project) return reply.code(404).send({ error: 'Werbematerial-Projekt nicht gefunden.' });
    const format = materialDimensions(project);
    const svg = Buffer.from(advertisingMaterialSvg(project));
    const image = sharp(svg, { density: format.dpi });
    const rendered =
      exportType === 'png'
        ? await image.png({ compressionLevel: 8 }).toBuffer()
        : exportType === 'jpeg'
          ? await image.jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toBuffer()
          : advertisingMaterialPdfFromJpeg(
              await image.flatten({ background: project.primary_color }).jpeg({ quality: 94 }).toBuffer(),
              format.width,
              format.height,
              format.dpi,
            );
    const mimeType =
      exportType === 'pdf' ? 'application/pdf' : exportType === 'jpeg' ? 'image/jpeg' : 'image/png';
    const extension = exportType === 'jpeg' ? 'jpg' : exportType;
    const relativePath = `generated/advertising-materials/${project.id}/${randomUUID()}.${extension}`;
    const absolutePath = resolve(PROJECT_ROOT, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, rendered, { mode: 0o640 });
    const saved = await createAdvertisingMaterialExport({
      projectId,
      exportType,
      formatPreset: project.format_preset,
      widthPx: format.width,
      heightPx: format.height,
      dpi: format.dpi,
      storagePath: relativePath,
      mimeType,
      sizeBytes: rendered.length,
    });
    return reply.code(201).send({ ...saved, downloadUrl: `/api/advertising-materials/exports/${saved.id}` });
  });

  app.get('/api/advertising-materials/exports/:id', async (request, reply) => {
    const item = await getAdvertisingMaterialExport(z.string().uuid().parse((request.params as any).id));
    if (!item) return reply.code(404).send({ error: 'Export nicht gefunden.' });
    const buffer = await readFile(resolve(PROJECT_ROOT, item.storage_path));
    const filename = `${String(item.project_name).replace(/[^a-z0-9äöüß_-]+/gi, '-').replace(/^-|-$/g, '')}.${
      item.export_type === 'jpeg' ? 'jpg' : item.export_type
    }`;
    return reply
      .header('content-type', item.mime_type)
      .header('content-length', String(buffer.length))
      .header('content-disposition', `attachment; filename="${filename || `werbematerial.${item.export_type}`}"`)
      .send(buffer);
  });
}

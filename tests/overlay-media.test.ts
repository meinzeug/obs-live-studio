import { describe, expect, it } from 'vitest';
import { createTemplate, renderOverlay, validateOverlayDocument } from '@ans/overlay-engine';
import sharp from 'sharp';
import { inspectImage } from '@ans/media-engine';
describe('overlay engine validation', () => {
  it('creates safe main-news documents and binds text without html interpolation', () => {
    const doc = createTemplate('main-news', 1920, 1080);
    const rendered = renderOverlay(doc, {
      article: { title: '<b>Alarm</b>', summary: 'Zusammenfassung', source: 'Quelle' },
      serverTime: '2026-07-12T10:00:00Z',
    });
    expect(validateOverlayDocument(doc).elements.length).toBeGreaterThan(0);
    expect(rendered.find((e) => e.type === 'text')?.text).toContain('<b>Alarm</b>');
    expect(rendered.find((e) => e.type === 'text')?.style.boxSizing).toBe('border-box');
  });
  it('rejects unsupported element properties', () => {
    const doc = createTemplate('ticker', 1920, 1080) as any;
    doc.elements[0].props.color = 'url(javascript:alert(1))';
    expect(() => validateOverlayDocument(doc)).toThrow();
  });
});
describe('media inspection', () => {
  it('accepts real png signatures and rejects mime confusion', async () => {
    const png = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#00000000' } })
      .png()
      .toBuffer();
    await expect(inspectImage(png, 'image/png')).resolves.toMatchObject({ mime: 'image/png' });
    await expect(inspectImage(png, 'image/jpeg')).rejects.toThrow(/MIME|beschädigter/);
  });
});

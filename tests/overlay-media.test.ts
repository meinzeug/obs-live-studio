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
    const title = rendered.find((element) => element.type === 'text' && element.text.includes('<b>Alarm</b>'));
    expect(title?.text).toContain('<b>Alarm</b>');
    expect(title?.style.boxSizing).toBe('border-box');
  });
  it('rejects unsupported element properties', () => {
    const doc = createTemplate('ticker', 1920, 1080) as any;
    doc.elements[0].props.color = 'url(javascript:alert(1))';
    expect(() => validateOverlayDocument(doc)).toThrow();
  });
  it('creates and binds the YouTube video overlay template', () => {
    const doc = createTemplate('youtube-video', 1920, 1080, 'Zeitkante');
    expect(validateOverlayDocument(doc).template).toBe('youtube-video');

    const rendered = renderOverlay(doc, {
      youtube: {
        title: 'Dokumentation im Abendprogramm',
        channel: 'Doku Kanal @ YouTube',
        url: 'https://www.youtube.com/watch?v=abcDEF_1234',
      },
    });

    expect(rendered.some((element) => element.type === 'text' && element.text === 'Doku Kanal @ YouTube')).toBe(true);
    expect(
      rendered.some(
        (element) => element.type === 'text' && element.text === 'https://www.youtube.com/watch?v=abcDEF_1234',
      ),
    ).toBe(true);
  });
  it('creates the YouTube news sidebar overlay with visible source fields', () => {
    const doc = createTemplate('youtube-news-sidebar', 1920, 1080, 'Zeitkante');
    expect(validateOverlayDocument(doc).template).toBe('youtube-news-sidebar');

    const rendered = renderOverlay(doc, {
      channel: { name: 'Zeitkante' },
      youtube: {
        title: 'Lange Analyse',
        channel: 'Analyse Kanal @ YouTube',
        url: 'https://www.youtube.com/watch?v=abcDEF_1234',
      },
    });

    expect(rendered.some((element) => element.type === 'text' && element.text === 'Analyse Kanal @ YouTube')).toBe(
      true,
    );
    expect(rendered.some((element) => element.type === 'text' && element.text.includes('abcDEF_1234'))).toBe(true);
  });
  it('creates a dedicated editable YouTube context overlay', () => {
    const doc = createTemplate('youtube-context', 1920, 1080, 'Zeitkante');
    expect(validateOverlayDocument(doc).template).toBe('youtube-context');
    expect(doc.elements.some((element) => element.name === 'AVA Studio Fläche')).toBe(true);
    expect(doc.elements.some((element) => element.name === 'YouTube Kanal')).toBe(true);
    expect(doc.elements.some((element) => element.name === 'Nächster Countdown')).toBe(true);
    expect(doc.elements.find((element) => element.name === 'Chat CTA Hinweis')?.props.text).toBe(
      'Stellt eure Fragen im Chat!',
    );
    expect(doc.elements.find((element) => element.name === 'YouTube Like Text')?.props.text).toBe('👍 LIKEN');
    expect(doc.elements.find((element) => element.name === 'YouTube Teilen Text')?.props.text).toBe('↗ TEILEN');
    expect(doc.elements.find((element) => element.name === 'YouTube Abonnieren Text')?.props.text).toBe('ABONNIEREN');
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

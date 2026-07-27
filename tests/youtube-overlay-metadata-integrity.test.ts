import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createTemplate } from '@ans/overlay-engine';
import { aiRoundtableOverlayHtml } from '../apps/api/src/ai-roundtable.js';

describe('YouTube overlay metadata integrity', () => {
  it.each(['youtube-video', 'youtube-news-sidebar', 'youtube-context'] as const)(
    'keeps title, channel and URL visible in %s',
    (template) => {
      const overlay = createTemplate(template, 1920, 1080, 'Zeitkante');
      for (const binding of ['youtube.title', 'youtube.channel', 'youtube.url']) {
        const element = overlay.elements.find((candidate) => candidate.binding === binding);
        expect(element, `${template}: ${binding}`).toBeDefined();
        expect(element?.hidden).not.toBe(true);
      }
    },
  );

  it('repairs missing or hidden metadata elements in published legacy overlays', async () => {
    const api = await readFile('apps/api/src/index.ts', 'utf8');
    expect(api).toContain("const metadataBindings = new Set(['youtube.title', 'youtube.channel', 'youtube.url'])");
    expect(api).toContain('{ ...element, hidden: false');
  });

  it('shows the current video title, YouTube channel and URL in the KI roundtable', () => {
    const html = aiRoundtableOverlayHtml();
    expect(html).toContain('class="video-meta"');
    expect(html).toContain('class="video-source"');
    expect(html).toContain('video.title||d.settings.topic');
    expect(html).toContain('+" @ YouTube"');
    expect(html).toContain('video.url');
  });
});

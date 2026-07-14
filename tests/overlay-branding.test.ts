import { describe, expect, it } from 'vitest';
import { createTemplate } from '@ans/overlay-engine';

describe('channel-neutral overlay templates', () => {
  it('uses a generic default sender name', () => {
    const main = createTemplate('main-news');
    const maintenance = createTemplate('maintenance');
    const serialized = JSON.stringify([main, maintenance]);

    expect(serialized).toContain('MEIN KANAL');
    expect(serialized).not.toContain('ARGUMENTATIONSKETTE');
  });

  it('uses the configured channel name in sender elements', () => {
    const template = createTemplate('main-news', 1920, 1080, 'Kanal Nord');
    const sender = template.elements.find((element) => element.name === 'Sender');

    expect(sender?.props.text).toBe('KANAL NORD');
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  appendUndoSnapshot,
  moveOverlayElement,
  patchOverlayElement,
  SerialTaskQueue,
  type OverlayDocument,
} from '../apps/web/src/overlay-editor-utils.js';

function document(locked = false): OverlayDocument {
  return {
    schemaVersion: 1,
    template: 'main-news',
    width: 1920,
    height: 1080,
    elements: [
      {
        id: 'title',
        type: 'text',
        name: 'Titel',
        x: 10,
        y: 20,
        width: 300,
        height: 80,
        zIndex: 1,
        locked,
        hidden: false,
        props: { text: 'Nachricht' },
        opacity: 1,
        rotation: 0,
      },
    ],
  };
}

describe('overlay editor helpers', () => {
  it('keeps locked elements immutable but allows the explicit unlock action', () => {
    const locked = document(true);
    expect(patchOverlayElement(locked, 'title', { x: 500 }).elements[0].x).toBe(10);
    expect(patchOverlayElement(locked, 'title', { locked: false }, true).elements[0].locked).toBe(false);
  });

  it('records one undo snapshot for an entire drag instead of every mouse movement', () => {
    const before = document();
    let after = before;
    for (let step = 1; step <= 50; step += 1) {
      after = moveOverlayElement(after, 'title', { x: 10 + step, y: 20 + step });
    }
    const history = appendUndoSnapshot([], before, after);
    expect(history).toHaveLength(1);
    expect(history[0].elements[0]).toMatchObject({ x: 10, y: 20 });
    expect(appendUndoSnapshot(history, after, after)).toBe(history);
  });

  it('runs autosaves and publish preparation strictly in enqueue order', async () => {
    const queue = new SerialTaskQueue();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.enqueue(async () => {
      order.push('autosave:start');
      await firstGate;
      order.push('autosave:end');
    });
    const second = queue.enqueue(async () => {
      order.push('manual-save');
    });
    const third = queue.enqueue(async () => {
      order.push('publish');
    });

    await vi.waitFor(() => expect(order).toEqual(['autosave:start']));
    releaseFirst();
    await Promise.all([first, second, third]);
    await queue.idle();
    expect(order).toEqual(['autosave:start', 'autosave:end', 'manual-save', 'publish']);
  });

  it('continues the queue after a failed save', async () => {
    const queue = new SerialTaskQueue();
    await expect(
      queue.enqueue(async () => {
        throw new Error('save failed');
      }),
    ).rejects.toThrow('save failed');
    await expect(queue.enqueue(async () => 'recovered')).resolves.toBe('recovered');
  });
});

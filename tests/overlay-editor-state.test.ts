import { describe, expect, it, vi } from 'vitest';
import { canvasPoint, patchOverlayElement, SerialTaskQueue } from '../apps/web/src/overlay-editor-state.js';

describe('overlay editor state', () => {
  it('blocks normal edits on locked elements but still permits explicit unlock controls', () => {
    const elements = [{ id: 'title', locked: true, hidden: false, name: 'Titel' }];

    const blocked = patchOverlayElement(elements, 'title', { name: 'Geändert' });
    expect(blocked[0].name).toBe('Titel');
    expect(blocked[0]).toBe(elements[0]);

    const unlocked = patchOverlayElement(elements, 'title', { locked: false }, { allowLocked: true });
    expect(unlocked[0].locked).toBe(false);
    expect(unlocked[0]).not.toBe(elements[0]);
  });

  it('converts pointer positions from the scaled canvas without an element-relative jump', () => {
    const pointer = canvasPoint({ left: 100, top: 50 }, 300, 150, 0.5);
    expect(pointer).toEqual({ x: 400, y: 200 });

    const element = { x: 120, y: 80 };
    const dragOffset = { x: pointer.x - element.x, y: pointer.y - element.y };
    const movedPointer = canvasPoint({ left: 100, top: 50 }, 325, 175, 0.5);

    expect(Math.round(movedPointer.x - dragOffset.x)).toBe(170);
    expect(Math.round(movedPointer.y - dragOffset.y)).toBe(130);
  });

  it('runs saves in submission order even when an earlier request is slower', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const order: string[] = [];
    const queue = new SerialTaskQueue();

    const first = queue.enqueue(async () => {
      order.push('first-start');
      await firstGate;
      order.push('first-end');
      return 'first';
    });
    const secondTask = vi.fn(async () => {
      order.push('second');
      return 'second';
    });
    const second = queue.enqueue(secondTask);

    await Promise.resolve();
    expect(secondTask).not.toHaveBeenCalled();
    releaseFirst();

    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(order).toEqual(['first-start', 'first-end', 'second']);
  });

  it('continues with the next save after a failed request', async () => {
    const queue = new SerialTaskQueue();
    await expect(
      queue.enqueue(async () => {
        throw new Error('save failed');
      }),
    ).rejects.toThrow('save failed');

    await expect(queue.enqueue(async () => 'recovered')).resolves.toBe('recovered');
  });
});

export function patchOverlayElement<T extends { id: string; locked: boolean }>(
  elements: T[],
  id: string,
  patch: Partial<T>,
  options: { allowLocked?: boolean } = {},
) {
  return elements.map((element) => {
    if (element.id !== id) return element;
    if (element.locked && !options.allowLocked) return element;
    return { ...element, ...patch };
  });
}

export class SerialTaskQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.catch(() => undefined).then(task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

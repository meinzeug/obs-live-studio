export type OverlayElement = {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  locked: boolean;
  hidden: boolean;
  binding?: string;
  props: any;
  opacity: number;
  rotation: number;
};

export type OverlayDocument = {
  schemaVersion: 1;
  template: string;
  width: number;
  height: number;
  elements: OverlayElement[];
  updatedAt?: string;
};

export function cloneOverlayValue<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export function patchOverlayElement(
  doc: OverlayDocument,
  id: string,
  patch: Partial<OverlayElement>,
  allowLocked = false,
): OverlayDocument {
  return {
    ...doc,
    elements: doc.elements.map((element) =>
      element.id === id && (allowLocked || !element.locked) ? { ...element, ...patch } : element,
    ),
  };
}

export function moveOverlayElement(
  doc: OverlayDocument,
  id: string,
  position: Pick<OverlayElement, 'x' | 'y'>,
): OverlayDocument {
  return patchOverlayElement(doc, id, position);
}

export function appendUndoSnapshot(
  history: OverlayDocument[],
  before: OverlayDocument,
  after: OverlayDocument,
  limit = 31,
) {
  if (JSON.stringify(before) === JSON.stringify(after)) return history;
  return [...history.slice(-(Math.max(1, limit) - 1)), cloneOverlayValue(before)];
}

export class SerialTaskQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.catch(() => undefined).then(task);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  idle() {
    return this.tail;
  }
}

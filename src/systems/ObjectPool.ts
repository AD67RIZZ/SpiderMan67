export interface PoolOptions<T> {
  create: () => T;
  reset?: (item: T) => void;
  dispose?: (item: T) => void;
  initialSize?: number;
  maximumSize?: number;
}

/** Generic pool with explicit release semantics and a hard growth limit. */
export class ObjectPool<T> {
  private readonly available: T[] = [];
  private readonly active = new Set<T>();
  private readonly createItem: () => T;
  private readonly resetItem?: (item: T) => void;
  private readonly disposeItem?: (item: T) => void;
  private readonly maximumSize: number;

  constructor(options: PoolOptions<T>) {
    this.createItem = options.create;
    this.resetItem = options.reset;
    this.disposeItem = options.dispose;
    this.maximumSize = Math.max(1, options.maximumSize ?? 128);
    const initialSize = Math.min(this.maximumSize, Math.max(0, options.initialSize ?? 0));
    for (let index = 0; index < initialSize; index += 1) {
      this.available.push(this.createItem());
    }
  }

  acquire(): T | null {
    let item = this.available.pop();
    if (item === undefined) {
      if (this.size >= this.maximumSize) {
        return null;
      }
      item = this.createItem();
    }
    this.active.add(item);
    return item;
  }

  release(item: T): boolean {
    if (!this.active.delete(item)) {
      return false;
    }
    this.resetItem?.(item);
    this.available.push(item);
    return true;
  }

  releaseAll(): void {
    for (const item of Array.from(this.active)) {
      this.release(item);
    }
  }

  forEachActive(callback: (item: T) => void): void {
    this.active.forEach(callback);
  }

  get activeCount(): number {
    return this.active.size;
  }

  get size(): number {
    return this.active.size + this.available.length;
  }

  dispose(): void {
    if (this.disposeItem !== undefined) {
      for (const item of this.active) {
        this.disposeItem(item);
      }
      for (const item of this.available) {
        this.disposeItem(item);
      }
    }
    this.active.clear();
    this.available.length = 0;
  }
}

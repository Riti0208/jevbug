import { wrap } from './geometry';
import type { Vec2 } from './types';

/**
 * Uniform-grid spatial index over a square torus world. Rebuilt once per
 * tick from a snapshot; `queryRadius` returns candidates in the surrounding
 * cells (a superset of the true radius match) — callers must still verify
 * the exact torus distance.
 */
export class SpatialIndex<T> {
  private readonly cellSize: number;
  private readonly cols: number;
  private readonly cells: Map<number, T[]> = new Map();
  private readonly getPos: (item: T) => Vec2;

  constructor(
    private readonly worldSize: number,
    cellSize: number,
    items: readonly T[],
    getPos: (item: T) => Vec2,
  ) {
    this.cellSize = Math.max(cellSize, 1e-6);
    this.cols = Math.max(1, Math.ceil(worldSize / this.cellSize));
    this.getPos = getPos;
    for (const item of items) this.insert(item);
  }

  private cellKey(cx: number, cy: number): number {
    return cy * this.cols + cx;
  }

  private cellCoord(pos: Vec2): [number, number] {
    const cx = Math.floor(wrap(pos.x, this.worldSize) / this.cellSize) % this.cols;
    const cy = Math.floor(wrap(pos.y, this.worldSize) / this.cellSize) % this.cols;
    return [cx, cy];
  }

  insert(item: T): void {
    const [cx, cy] = this.cellCoord(this.getPos(item));
    const key = this.cellKey(cx, cy);
    let bucket = this.cells.get(key);
    if (!bucket) {
      bucket = [];
      this.cells.set(key, bucket);
    }
    bucket.push(item);
  }

  /** Candidate items in cells covering `radius` around `pos` (torus-aware). */
  queryRadius(pos: Vec2, radius: number): T[] {
    const result: T[] = [];
    const cellRadius = Math.max(1, Math.ceil(radius / this.cellSize));
    const [cx, cy] = this.cellCoord(pos);
    for (let dy = -cellRadius; dy <= cellRadius; dy++) {
      const ncy = ((cy + dy) % this.cols + this.cols) % this.cols;
      for (let dx = -cellRadius; dx <= cellRadius; dx++) {
        const ncx = ((cx + dx) % this.cols + this.cols) % this.cols;
        const bucket = this.cells.get(this.cellKey(ncx, ncy));
        if (bucket) result.push(...bucket);
      }
    }
    return result;
  }
}

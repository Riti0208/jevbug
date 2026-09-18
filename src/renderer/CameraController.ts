import type { Vec2 } from '@/simulation/types';

export interface Viewport {
  widthPx: number;
  heightPx: number;
}

/**
 * Pure camera math for an orthographic top-down view over a square world.
 * No three.js, no DOM — fully unit-testable. `ThreeRenderer` owns a `CameraController`
 * and copies its state (`centerX`, `centerY`, `pixelsPerWorldUnit`) into the actual
 * `THREE.OrthographicCamera` frustum every frame/resize.
 *
 * Screen-space convention: pixel coordinates are relative to the canvas's top-left
 * corner, x right, y DOWN (standard DOM/pointer-event convention). World-space is x
 * right, y UP, matching `RenderBug.x/y` etc. directly (spec §41).
 */
export class CameraController {
  centerX: number;
  centerY: number;
  /** Zoom level: screen pixels per one world unit. */
  pixelsPerWorldUnit: number;

  private worldSize: number;
  private viewport: Viewport;
  /** pixels-per-world-unit that exactly fits the world (with margin) in the current viewport. */
  private fitPPWU: number;

  private static readonly MIN_ZOOM_FACTOR = 0.5;
  private static readonly MAX_ZOOM_FACTOR = 40;
  /** Fractional margin added around the world when fitting (spec: "small margin"). */
  private static readonly FIT_MARGIN = 1.08;

  constructor(worldSize: number, viewport: Viewport) {
    this.worldSize = worldSize;
    this.viewport = { ...viewport };
    this.fitPPWU = CameraController.computeFitPPWU(worldSize, viewport);
    this.centerX = worldSize / 2;
    this.centerY = worldSize / 2;
    this.pixelsPerWorldUnit = this.fitPPWU;
  }

  private static computeFitPPWU(worldSize: number, viewport: Viewport): number {
    const w = Math.max(viewport.widthPx, 1);
    const h = Math.max(viewport.heightPx, 1);
    const size = Math.max(worldSize, 1e-6) * CameraController.FIT_MARGIN;
    return Math.min(w, h) / size;
  }

  private get minPPWU(): number {
    return this.fitPPWU * CameraController.MIN_ZOOM_FACTOR;
  }

  private get maxPPWU(): number {
    return this.fitPPWU * CameraController.MAX_ZOOM_FACTOR;
  }

  private clampPPWU(v: number): number {
    return Math.min(this.maxPPWU, Math.max(this.minPPWU, v));
  }

  /** Reset to show the whole world with a small margin, centered. */
  fitWorld(): void {
    this.fitPPWU = CameraController.computeFitPPWU(this.worldSize, this.viewport);
    this.centerX = this.worldSize / 2;
    this.centerY = this.worldSize / 2;
    this.pixelsPerWorldUnit = this.fitPPWU;
  }

  /** Update the known viewport size (e.g. on container resize). Recomputes fit bounds
   * and clamps the current zoom into them, but does not otherwise move the camera. */
  setViewport(viewport: Viewport): void {
    this.viewport = { ...viewport };
    this.fitPPWU = CameraController.computeFitPPWU(this.worldSize, this.viewport);
    this.pixelsPerWorldUnit = this.clampPPWU(this.pixelsPerWorldUnit);
  }

  setWorldSize(worldSize: number): void {
    this.worldSize = worldSize;
    this.fitPPWU = CameraController.computeFitPPWU(this.worldSize, this.viewport);
    this.pixelsPerWorldUnit = this.clampPPWU(this.pixelsPerWorldUnit);
  }

  getWorldUnitsPerPixel(): number {
    return 1 / this.pixelsPerWorldUnit;
  }

  /** Convert a canvas-local pixel position (x right, y down) to world coordinates. */
  screenToWorld(px: number, py: number): Vec2 {
    const halfW = this.viewport.widthPx / 2;
    const halfH = this.viewport.heightPx / 2;
    return {
      x: this.centerX + (px - halfW) / this.pixelsPerWorldUnit,
      y: this.centerY - (py - halfH) / this.pixelsPerWorldUnit,
    };
  }

  /** Convert a world position to canvas-local pixel coordinates (x right, y down). */
  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    const halfW = this.viewport.widthPx / 2;
    const halfH = this.viewport.heightPx / 2;
    return {
      x: halfW + (wx - this.centerX) * this.pixelsPerWorldUnit,
      y: halfH - (wy - this.centerY) * this.pixelsPerWorldUnit,
    };
  }

  /** Pan by a screen-pixel delta (e.g. pointer movement since the last event), keeping
   * the dragged world point under the pointer. */
  pan(dxPx: number, dyPx: number): void {
    this.centerX -= dxPx / this.pixelsPerWorldUnit;
    this.centerY += dyPx / this.pixelsPerWorldUnit;
  }

  /** Zoom by `factor` (>1 = zoom in) around a canvas-local pixel position, keeping the
   * world point currently under that pixel fixed on screen. */
  zoomAt(px: number, py: number, factor: number): void {
    const ppwu0 = this.pixelsPerWorldUnit;
    const ppwu1 = this.clampPPWU(ppwu0 * factor);
    if (ppwu1 === ppwu0) return;
    const halfW = this.viewport.widthPx / 2;
    const halfH = this.viewport.heightPx / 2;
    const k = 1 / ppwu0 - 1 / ppwu1;
    this.centerX += (px - halfW) * k;
    this.centerY -= (py - halfH) * k;
    this.pixelsPerWorldUnit = ppwu1;
  }

  /** The orthographic frustum half-extents (world units) for the current viewport/zoom,
   * i.e. what `ThreeRenderer` should feed into `camera.left/right/top/bottom`. */
  getFrustumHalfExtents(): { halfWidth: number; halfHeight: number } {
    return {
      halfWidth: this.viewport.widthPx / 2 / this.pixelsPerWorldUnit,
      halfHeight: this.viewport.heightPx / 2 / this.pixelsPerWorldUnit,
    };
  }
}

/** Tracks a single pointer's drag state to distinguish a click from a pan (spec:
 * movement < 4px and < 300ms ⇒ click). Pure, no DOM — driven by plain numbers so it is
 * unit-testable; `ThreeRenderer` feeds it real PointerEvent coordinates/timestamps. */
export class ClickVsDragTracker {
  private static readonly CLICK_MAX_MOVE_PX = 4;
  private static readonly CLICK_MAX_MS = 300;

  private startX = 0;
  private startY = 0;
  private startTime = 0;
  private maxMove = 0;
  private active = false;

  begin(x: number, y: number, timeMs: number): void {
    this.startX = x;
    this.startY = y;
    this.startTime = timeMs;
    this.maxMove = 0;
    this.active = true;
  }

  update(x: number, y: number): void {
    if (!this.active) return;
    const d = Math.hypot(x - this.startX, y - this.startY);
    if (d > this.maxMove) this.maxMove = d;
  }

  /** Call on pointer-up. Returns true if this gesture qualifies as a click. */
  end(timeMs: number): boolean {
    this.active = false;
    const dt = timeMs - this.startTime;
    return this.maxMove < ClickVsDragTracker.CLICK_MAX_MOVE_PX && dt < ClickVsDragTracker.CLICK_MAX_MS;
  }
}

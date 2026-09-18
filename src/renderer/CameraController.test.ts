import { describe, expect, it } from 'vitest';
import { CameraController, ClickVsDragTracker } from './CameraController';

describe('CameraController', () => {
  it('fitWorld centers the camera on the world and shows it all with a margin', () => {
    const cam = new CameraController(100, { widthPx: 800, heightPx: 600 });
    cam.fitWorld();
    expect(cam.centerX).toBeCloseTo(50);
    expect(cam.centerY).toBeCloseTo(50);
    // The shorter viewport dimension (600px) divided by ~1.08x the world size fits it,
    // with a bit of margin (frustum half-extent along the short axis a little more than half the world).
    const { halfWidth, halfHeight } = cam.getFrustumHalfExtents();
    expect(Math.min(halfWidth, halfHeight)).toBeGreaterThan(50);
    expect(Math.min(halfWidth, halfHeight)).toBeLessThan(55);
  });

  it('screenToWorld/worldToScreen are inverses at the current zoom', () => {
    const cam = new CameraController(100, { widthPx: 800, heightPx: 600 });
    cam.fitWorld();
    const world = cam.screenToWorld(200, 150);
    const screen = cam.worldToScreen(world.x, world.y);
    expect(screen.x).toBeCloseTo(200);
    expect(screen.y).toBeCloseTo(150);
  });

  it('screen center maps to the camera center in world space', () => {
    const cam = new CameraController(100, { widthPx: 800, heightPx: 600 });
    cam.fitWorld();
    const world = cam.screenToWorld(400, 300);
    expect(world.x).toBeCloseTo(cam.centerX);
    expect(world.y).toBeCloseTo(cam.centerY);
  });

  it('screen y-down maps to world y-up', () => {
    const cam = new CameraController(100, { widthPx: 800, heightPx: 600 });
    cam.fitWorld();
    const above = cam.screenToWorld(400, 100); // above center on screen
    const below = cam.screenToWorld(400, 500); // below center on screen
    expect(above.y).toBeGreaterThan(cam.centerY);
    expect(below.y).toBeLessThan(cam.centerY);
  });

  it('pan keeps the dragged world point under the pointer', () => {
    const cam = new CameraController(100, { widthPx: 800, heightPx: 600 });
    cam.fitWorld();
    const before = cam.screenToWorld(300, 250);
    cam.pan(40, -20); // pointer moved right/up by (40,-20) px
    const after = cam.screenToWorld(340, 230); // pointer now here
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('zoomAt keeps the world point under the cursor fixed', () => {
    const cam = new CameraController(100, { widthPx: 800, heightPx: 600 });
    cam.fitWorld();
    const cursorPx = { x: 550, y: 200 };
    const before = cam.screenToWorld(cursorPx.x, cursorPx.y);
    cam.zoomAt(cursorPx.x, cursorPx.y, 2);
    const after = cam.screenToWorld(cursorPx.x, cursorPx.y);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('zoomAt actually changes zoom level within bounds', () => {
    const cam = new CameraController(100, { widthPx: 800, heightPx: 600 });
    cam.fitWorld();
    const fitPPWU = cam.pixelsPerWorldUnit;
    cam.zoomAt(400, 300, 2);
    expect(cam.pixelsPerWorldUnit).toBeCloseTo(fitPPWU * 2, 6);
  });

  it('clamps zoom-in to the max zoom factor', () => {
    const cam = new CameraController(100, { widthPx: 800, heightPx: 600 });
    cam.fitWorld();
    const fitPPWU = cam.pixelsPerWorldUnit;
    for (let i = 0; i < 30; i++) cam.zoomAt(400, 300, 2);
    expect(cam.pixelsPerWorldUnit).toBeLessThanOrEqual(fitPPWU * 40 + 1e-6);
  });

  it('clamps zoom-out to the min zoom factor', () => {
    const cam = new CameraController(100, { widthPx: 800, heightPx: 600 });
    cam.fitWorld();
    const fitPPWU = cam.pixelsPerWorldUnit;
    for (let i = 0; i < 30; i++) cam.zoomAt(400, 300, 0.5);
    expect(cam.pixelsPerWorldUnit).toBeGreaterThanOrEqual(fitPPWU * 0.5 - 1e-6);
  });

  it('setViewport re-clamps zoom into the new fit bounds without moving the center', () => {
    const cam = new CameraController(100, { widthPx: 800, heightPx: 600 });
    cam.fitWorld();
    cam.zoomAt(400, 300, 3);
    const centerBefore = { x: cam.centerX, y: cam.centerY };
    cam.setViewport({ widthPx: 400, heightPx: 300 });
    expect(cam.centerX).toBeCloseTo(centerBefore.x);
    expect(cam.centerY).toBeCloseTo(centerBefore.y);
  });

  it('setWorldSize recomputes the fit reference without moving the camera by itself', () => {
    const cam = new CameraController(100, { widthPx: 800, heightPx: 600 });
    cam.fitWorld();
    const ppwuBefore = cam.pixelsPerWorldUnit;
    cam.setWorldSize(200);
    // pixelsPerWorldUnit stays put (only the allowed zoom range moves), until fitWorld() is called again.
    expect(cam.pixelsPerWorldUnit).toBeCloseTo(ppwuBefore);
  });

  it('getWorldUnitsPerPixel is the reciprocal of pixelsPerWorldUnit', () => {
    const cam = new CameraController(100, { widthPx: 800, heightPx: 600 });
    cam.fitWorld();
    expect(cam.getWorldUnitsPerPixel()).toBeCloseTo(1 / cam.pixelsPerWorldUnit);
  });
});

describe('ClickVsDragTracker', () => {
  it('reports a click for a short, near-stationary gesture', () => {
    const t = new ClickVsDragTracker();
    t.begin(10, 10, 1000);
    t.update(11, 11);
    t.update(12, 9);
    expect(t.end(1100)).toBe(true);
  });

  it('reports a drag when movement exceeds the pixel threshold', () => {
    const t = new ClickVsDragTracker();
    t.begin(10, 10, 1000);
    t.update(30, 10); // 20px
    expect(t.end(1050)).toBe(false);
  });

  it('reports a drag when the gesture takes too long even without much movement', () => {
    const t = new ClickVsDragTracker();
    t.begin(10, 10, 1000);
    t.update(11, 10);
    expect(t.end(1500)).toBe(false);
  });

  it('is right at the boundary: just under thresholds is a click', () => {
    const t = new ClickVsDragTracker();
    t.begin(0, 0, 0);
    t.update(3, 0); // 3px < 4px
    expect(t.end(299)).toBe(true);
  });
});

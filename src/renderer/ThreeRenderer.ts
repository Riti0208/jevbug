import * as THREE from 'three';
import type { RenderSnapshot, Vec2 } from '@/simulation/types';
import { CameraController, ClickVsDragTracker } from './CameraController';
import { BugParticles } from './BugParticles';
import { PredatorParticles } from './PredatorParticles';
import { FoodParticles } from './FoodParticles';
import { SignalParticles } from './SignalParticles';
import { COLORS, SIZES } from './palette';

export interface ThreeRendererOptions {
  worldSize: number;
  /** world units a signal wave expands to (bugSignalDistance), default 8 */
  signalRadius?: number;
  /** ms a signal wave stays visible, default 700 */
  signalLifetimeMs?: number;
  /** device pixel ratio cap, default 2 */
  maxPixelRatio?: number;
}

/** Visual pulse radius in world units — a small glow around the emitter, not the reception range. */
const DEFAULT_SIGNAL_RADIUS = 2.2;
const DEFAULT_SIGNAL_LIFETIME_MS = 550;
const DEFAULT_MAX_PIXEL_RATIO = 2;

const SELECTION_RING_VERTEX_SHADER = /* glsl */ `
uniform float uScale;
uniform float uSize;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize * uScale;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const SELECTION_RING_FRAGMENT_SHADER = /* glsl */ `
precision mediump float;
uniform vec3 uColor;
uniform float uOpacity;
void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv) * 2.0;
  float ring = smoothstep(0.72, 0.82, d) * (1.0 - smoothstep(0.94, 1.0, d));
  gl_FragColor = vec4(uColor, ring * uOpacity);
}
`;

function hexToVec3(hex: number): THREE.Vector3 {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b);
}

type ClickCallback = (world: Vec2, event: PointerEvent) => void;

/**
 * Three.js renderer for JevBug Experiment 0 (spec §20-21, §41-44): a black, scientific,
 * "microscope" view of the simulation — no text, no game UI.
 *
 * Owns the WebGLRenderer/scene/camera and one `Points`/`InstancedMesh` per entity kind.
 * The public surface (see class members) is the contract the UI layer codes against.
 */
export class ThreeRenderer {
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;
  private readonly cameraController: CameraController;
  private readonly resizeObserver: ResizeObserver;

  private readonly bugParticles: BugParticles;
  private readonly predatorParticles: PredatorParticles;
  private readonly foodParticles: FoodParticles;
  private readonly signalParticles: SignalParticles;

  private readonly worldBoundsLine: THREE.LineLoop;
  private readonly selectionRing: THREE.Points;
  private readonly selectionRingMaterial: THREE.ShaderMaterial;

  private worldSize: number;
  private readonly maxPixelRatio: number;

  private latestSnapshot: RenderSnapshot | null = null;
  private pendingSignals: RenderSnapshot['signals'] = [];
  private selectedBugId: string | null = null;

  private hasValidSize = false;
  private hasFitted = false;

  // Pointer / drag / click state.
  private readonly dragTracker = new ClickVsDragTracker();
  private readonly activePointers = new Map<number, { x: number; y: number }>();
  private dragging = false;
  private pinching = false;
  private pinchStartDist = 0;
  private clickCallbacks = new Set<ClickCallback>();

  // Bound listeners kept for removal in dispose().
  private readonly onPointerDown = (e: PointerEvent) => this.handlePointerDown(e);
  private readonly onPointerMove = (e: PointerEvent) => this.handlePointerMove(e);
  private readonly onPointerUp = (e: PointerEvent) => this.handlePointerUp(e);
  private readonly onWheel = (e: WheelEvent) => this.handleWheel(e);
  private readonly onContextMenu = (e: MouseEvent) => e.preventDefault();

  constructor(container: HTMLElement, options: ThreeRendererOptions) {
    this.container = container;
    this.worldSize = options.worldSize;
    this.maxPixelRatio = options.maxPixelRatio ?? DEFAULT_MAX_PIXEL_RATIO;

    this.renderer = new THREE.WebGLRenderer({ alpha: false, antialias: true });
    this.renderer.setClearColor(COLORS.background, 1);
    this.canvas = this.renderer.domElement;
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.touchAction = 'none';
    this.container.appendChild(this.canvas);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    this.camera.position.z = 10;

    this.cameraController = new CameraController(this.worldSize, { widthPx: 1, heightPx: 1 });

    this.bugParticles = new BugParticles();
    this.predatorParticles = new PredatorParticles();
    this.foodParticles = new FoodParticles();
    this.signalParticles = new SignalParticles(
      options.signalRadius ?? DEFAULT_SIGNAL_RADIUS,
      options.signalLifetimeMs ?? DEFAULT_SIGNAL_LIFETIME_MS,
    );

    this.worldBoundsLine = this.buildWorldBoundsLine();
    const ring = this.buildSelectionRing();
    this.selectionRing = ring.points;
    this.selectionRingMaterial = ring.material;

    // Draw order: bounds, food (dimmest), predators, bugs, selection ring, signals on top.
    this.scene.add(this.worldBoundsLine);
    this.scene.add(this.foodParticles.points);
    this.scene.add(this.predatorParticles.points);
    this.scene.add(this.bugParticles.points);
    this.scene.add(this.selectionRing);
    this.scene.add(this.signalParticles.object);

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.onContextMenu);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);

    // Attempt an initial size read in case the container is already laid out.
    this.resize();
  }

  private buildWorldBoundsLine(): THREE.LineLoop {
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.LineBasicMaterial({
      color: COLORS.worldBounds,
      transparent: true,
      opacity: COLORS.worldBoundsOpacity,
      depthTest: false,
    });
    const line = new THREE.LineLoop(geometry, material);
    this.setWorldBoundsGeometry(geometry, this.worldSize);
    return line;
  }

  private setWorldBoundsGeometry(geometry: THREE.BufferGeometry, size: number): void {
    const positions = new Float32Array([0, 0, 0, size, 0, 0, size, size, 0, 0, size, 0]);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  }

  private buildSelectionRing(): { points: THREE.Points; material: THREE.ShaderMaterial } {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
    const material = new THREE.ShaderMaterial({
      vertexShader: SELECTION_RING_VERTEX_SHADER,
      fragmentShader: SELECTION_RING_FRAGMENT_SHADER,
      uniforms: {
        uScale: { value: 1 },
        uSize: { value: 0 }, // 0 hides the ring until a selection is active and present
        uColor: { value: hexToVec3(COLORS.selectionRing) },
        uOpacity: { value: 0.9 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    return { points, material };
  }

  // ---------------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------------

  setSnapshot(snapshot: RenderSnapshot): void {
    this.latestSnapshot = snapshot;
    this.bugParticles.update(snapshot.bugs, this.selectedBugId);
    this.predatorParticles.update(snapshot.predators);
    this.foodParticles.update(snapshot.foods);
    // Signals get their real `startMs` at render() time, using that frame's clock, since
    // setSnapshot() itself carries no timestamp (spec: renderer animates by real time).
    if (snapshot.signals.length > 0) this.pendingSignals = this.pendingSignals.concat(snapshot.signals);
  }

  render(nowMs: number): void {
    if (this.pendingSignals.length > 0) {
      this.signalParticles.pool.ingest(this.pendingSignals, nowMs);
      this.pendingSignals = [];
    }
    this.signalParticles.update(nowMs);
    this.updateSelectionRing(nowMs);

    if (!this.hasValidSize) return;
    this.syncCamera();
    this.renderer.render(this.scene, this.camera);
  }

  setWorldSize(size: number): void {
    this.worldSize = size;
    this.cameraController.setWorldSize(size);
    this.setWorldBoundsGeometry(this.worldBoundsLine.geometry as THREE.BufferGeometry, size);
  }

  setSelectedBug(id: string | null): void {
    this.selectedBugId = id;
    if (this.latestSnapshot) this.bugParticles.update(this.latestSnapshot.bugs, this.selectedBugId);
  }

  fitWorld(): void {
    this.cameraController.fitWorld();
  }

  resize(): void {
    const width = Math.max(0, Math.floor(this.container.clientWidth));
    const height = Math.max(0, Math.floor(this.container.clientHeight));
    if (width === 0 || height === 0) {
      this.hasValidSize = false;
      return;
    }
    const pixelRatio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.cameraController.setViewport({ widthPx: width, heightPx: height });
    this.hasValidSize = true;
    if (!this.hasFitted) {
      this.cameraController.fitWorld();
      this.hasFitted = true;
    }
    this.syncCamera();
  }

  screenToWorld(clientX: number, clientY: number): Vec2 | null {
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    if (px < 0 || py < 0 || px > rect.width || py > rect.height) return null;
    return this.cameraController.screenToWorld(px, py);
  }

  onClick(cb: ClickCallback): () => void {
    this.clickCallbacks.add(cb);
    return () => this.clickCallbacks.delete(cb);
  }

  getWorldUnitsPerPixel(): number {
    return this.cameraController.getWorldUnitsPerPixel();
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.clickCallbacks.clear();

    this.bugParticles.dispose();
    this.predatorParticles.dispose();
    this.foodParticles.dispose();
    this.signalParticles.dispose();
    this.worldBoundsLine.geometry.dispose();
    (this.worldBoundsLine.material as THREE.Material).dispose();
    this.selectionRing.geometry.dispose();
    this.selectionRingMaterial.dispose();

    this.renderer.dispose();
    if (this.canvas.parentElement === this.container) this.container.removeChild(this.canvas);
  }

  // ---------------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------------

  private syncCamera(): void {
    this.camera.position.set(this.cameraController.centerX, this.cameraController.centerY, 10);
    const { halfWidth, halfHeight } = this.cameraController.getFrustumHalfExtents();
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();

    const ppwu = this.cameraController.pixelsPerWorldUnit;
    this.bugParticles.setScale(ppwu);
    this.predatorParticles.setScale(ppwu);
    this.foodParticles.setScale(ppwu);
    (this.selectionRingMaterial.uniforms.uScale as { value: number }).value = ppwu;
  }

  private updateSelectionRing(nowMs: number): void {
    const bug = this.selectedBugId !== null && this.latestSnapshot
      ? this.latestSnapshot.bugs.find((b) => b.id === this.selectedBugId) ?? null
      : null;
    const uniforms = this.selectionRingMaterial.uniforms;
    if (!bug) {
      (uniforms.uSize as { value: number }).value = 0;
      return;
    }
    const positionAttr = this.selectionRing.geometry.getAttribute('position') as THREE.BufferAttribute;
    positionAttr.setXYZ(0, bug.x, bug.y, 0);
    positionAttr.needsUpdate = true;

    const pulse = 1 + 0.12 * Math.sin(nowMs / 300);
    (uniforms.uSize as { value: number }).value = SIZES.selectionRing * pulse;
  }

  // -- pointer handling: pan by drag, zoom around cursor by wheel, click vs drag ------

  private toLocal(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  private isPannablePointer(e: PointerEvent): boolean {
    return e.pointerType === 'touch' || e.button === 0;
  }

  private handlePointerDown(e: PointerEvent): void {
    if (!this.isPannablePointer(e)) return;
    const { x, y } = this.toLocal(e.clientX, e.clientY);
    this.canvas.setPointerCapture(e.pointerId);
    this.activePointers.set(e.pointerId, { x, y });

    if (this.activePointers.size === 1) {
      this.dragging = true;
      this.pinching = false;
      this.dragTracker.begin(x, y, e.timeStamp);
    } else if (this.activePointers.size === 2) {
      this.dragging = false;
      this.pinching = true;
      this.pinchStartDist = this.currentPinchDistance();
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.activePointers.has(e.pointerId)) return;
    const { x, y } = this.toLocal(e.clientX, e.clientY);
    const prev = this.activePointers.get(e.pointerId)!;
    this.activePointers.set(e.pointerId, { x, y });

    if (this.pinching && this.activePointers.size === 2) {
      const dist = this.currentPinchDistance();
      if (this.pinchStartDist > 0 && dist > 0) {
        const factor = dist / this.pinchStartDist;
        const mid = this.pinchMidpoint();
        this.cameraController.zoomAt(mid.x, mid.y, factor);
      }
      this.pinchStartDist = dist;
      return;
    }

    if (this.dragging && this.activePointers.size === 1) {
      const dx = x - prev.x;
      const dy = y - prev.y;
      this.cameraController.pan(dx, dy);
      this.dragTracker.update(x, y);
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    const was = this.activePointers.get(e.pointerId);
    this.activePointers.delete(e.pointerId);
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);

    if (this.activePointers.size < 2) this.pinching = false;

    if (this.activePointers.size === 0 && this.dragging) {
      this.dragging = false;
      const isClick = this.dragTracker.end(e.timeStamp);
      if (isClick && was) {
        const world = this.cameraController.screenToWorld(was.x, was.y);
        for (const cb of this.clickCallbacks) cb(world, e);
      }
    }
  }

  private currentPinchDistance(): number {
    const pts = Array.from(this.activePointers.values());
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  private pinchMidpoint(): { x: number; y: number } {
    const pts = Array.from(this.activePointers.values());
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();
    const { x, y } = this.toLocal(e.clientX, e.clientY);
    const factor = Math.pow(1.0016, -e.deltaY);
    this.cameraController.zoomAt(x, y, factor);
  }
}

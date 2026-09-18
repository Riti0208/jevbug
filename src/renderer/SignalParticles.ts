import * as THREE from 'three';
import type { RenderSignal } from '@/simulation/types';
import { SIGNAL_COLORS } from './palette';
import { growCapacity } from './capacity';

function easeOutCubic(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return 1 - Math.pow(1 - c, 3);
}

export interface SignalWave {
  key: string;
  x: number;
  y: number;
  /** 0 = signal A, 1 = signal B. Arbitrary visual key only — no semantics (spec §9/§11/§32). */
  kind: 0 | 1;
  startMs: number;
}

export interface ActiveWave extends SignalWave {
  /** Current world-unit radius (already eased). */
  radius: number;
  /** Current opacity, 1 -> 0 over the wave's lifetime. */
  opacity: number;
}

/**
 * Pure lifecycle/animation logic for signal waves — no three.js, no DOM, fully
 * unit-testable. `SignalParticles` (below) renders whatever `getActive()` returns.
 *
 * A wave is keyed by `${bugId}:${tick}` so the same emission seen across repeated
 * `ingest()` calls (e.g. a snapshot re-delivered) is not restarted.
 */
export class SignalWavePool {
  private waves = new Map<string, SignalWave>();

  constructor(
    private lifetimeMs: number,
    private radius: number,
  ) {}

  setLifetimeMs(ms: number): void {
    this.lifetimeMs = ms;
  }

  setRadius(r: number): void {
    this.radius = r;
  }

  get size(): number {
    return this.waves.size;
  }

  clear(): void {
    this.waves.clear();
  }

  /** Register any signals not already tracked, stamping them with `nowMs`. */
  ingest(signals: readonly RenderSignal[], nowMs: number): void {
    for (const s of signals) {
      const key = `${s.id}:${s.tick}`;
      if (this.waves.has(key)) continue;
      this.waves.set(key, {
        key,
        x: s.x,
        y: s.y,
        kind: s.signal === 'B' ? 1 : 0,
        startMs: nowMs,
      });
    }
  }

  /** Drop waves whose lifetime has fully elapsed as of `nowMs`. */
  prune(nowMs: number): void {
    for (const [key, w] of this.waves) {
      if ((nowMs - w.startMs) / this.lifetimeMs >= 1) this.waves.delete(key);
    }
  }

  /** Compute current radius/opacity for every live wave (does not mutate/prune). */
  getActive(nowMs: number): ActiveWave[] {
    const out: ActiveWave[] = [];
    for (const w of this.waves.values()) {
      const t = (nowMs - w.startMs) / this.lifetimeMs;
      if (t >= 1) continue;
      out.push({
        ...w,
        radius: this.radius * easeOutCubic(t),
        opacity: 1 - t,
      });
    }
    return out;
  }
}

const VERTEX_SHADER = /* glsl */ `
attribute float aOpacity;
attribute float aKind;
varying float vOpacity;
varying float vKind;
varying vec2 vLocalPos;

void main() {
  vOpacity = aOpacity;
  vKind = aKind;
  vLocalPos = position.xy;
  vec4 mvPosition = instanceMatrix * vec4(position, 1.0);
  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;
}
`;

// Base geometry is a unit quad (-1..1). We draw the ring procedurally in the fragment
// shader so kind A/B can differ in line width and dash pattern, not only in color
// (spec §44: "never rely on color alone").
const FRAGMENT_SHADER = /* glsl */ `
precision mediump float;
uniform vec3 uColorA;
uniform vec3 uColorB;
varying float vOpacity;
varying float vKind;
varying vec2 vLocalPos;

void main() {
  float r = length(vLocalPos);
  if (r > 1.0) discard;
  float angle = atan(vLocalPos.y, vLocalPos.x);

  // Signal A: a thin ring near the outer edge.
  // Signal B: a thicker ring, additionally broken into dashes.
  float bandA = smoothstep(0.93, 0.965, r) * (1.0 - smoothstep(0.985, 1.0, r));
  float bandB = smoothstep(0.88, 0.92, r) * (1.0 - smoothstep(0.985, 1.0, r));
  float dash = step(0.0, sin(angle * 14.0));
  bandB *= mix(1.0, dash, 0.75);

  float band = mix(bandA, bandB, vKind);
  vec3 color = mix(uColorA, uColorB, vKind);
  gl_FragColor = vec4(color, band * vOpacity * 0.75);
}
`;

function hexToVec3(hex: number): THREE.Vector3 {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b);
}

/**
 * Renders active signal waves as one growable `THREE.InstancedMesh`. Positions/scale
 * come from `instanceMatrix`; per-instance opacity/kind come from instanced attributes.
 */
export class SignalParticles {
  readonly pool: SignalWavePool;
  /** Stable container to add to the scene once; the InstancedMesh inside it is swapped
   * out (as its own child) whenever capacity needs to grow. */
  readonly object: THREE.Group;

  private mesh: THREE.InstancedMesh;
  private geometry: THREE.PlaneGeometry;
  private material: THREE.ShaderMaterial;
  private aOpacity: THREE.InstancedBufferAttribute;
  private aKind: THREE.InstancedBufferAttribute;
  private capacity: number;
  private readonly dummy = new THREE.Object3D();

  constructor(signalRadius: number, signalLifetimeMs: number, initialCapacity = 512) {
    this.pool = new SignalWavePool(signalLifetimeMs, signalRadius);
    this.object = new THREE.Group();
    this.capacity = Math.max(initialCapacity, 1);
    this.geometry = new THREE.PlaneGeometry(2, 2);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uColorA: { value: hexToVec3(SIGNAL_COLORS.A) },
        uColorB: { value: hexToVec3(SIGNAL_COLORS.B) },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.aOpacity = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1);
    this.aKind = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1);
    this.aOpacity.setUsage(THREE.DynamicDrawUsage);
    this.aKind.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aOpacity', this.aOpacity);
    this.geometry.setAttribute('aKind', this.aKind);
    this.object.add(this.mesh);
  }

  private ensureCapacity(needed: number): void {
    const next = growCapacity(this.capacity, needed);
    if (next === this.capacity) return;
    this.capacity = next;

    const oldMesh = this.mesh;
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.capacity);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;

    this.aOpacity = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1);
    this.aKind = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1);
    this.aOpacity.setUsage(THREE.DynamicDrawUsage);
    this.aKind.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aOpacity', this.aOpacity);
    this.geometry.setAttribute('aKind', this.aKind);

    this.object.remove(oldMesh);
    this.object.add(this.mesh);
    oldMesh.dispose(); // InstancedMesh.dispose() releases only its own instance buffers, not the shared geometry/material
  }

  /** Advance the wave pool and refresh the instanced buffers. Call every render frame. */
  update(nowMs: number): void {
    this.pool.prune(nowMs);
    const active = this.pool.getActive(nowMs);
    this.ensureCapacity(active.length);

    for (let i = 0; i < active.length; i++) {
      const w = active[i];
      this.dummy.position.set(w.x, w.y, 0);
      this.dummy.scale.setScalar(Math.max(w.radius, 1e-4));
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.aOpacity.setX(i, w.opacity);
      this.aKind.setX(i, w.kind);
    }
    this.mesh.count = active.length;
    if (active.length > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.aOpacity.needsUpdate = true;
      this.aKind.needsUpdate = true;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
    this.object.clear();
  }
}

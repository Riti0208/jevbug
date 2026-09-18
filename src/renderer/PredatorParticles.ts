import * as THREE from 'three';
import type { RenderPredator } from '@/simulation/types';
import { COLORS, SIZES } from './palette';
import { growCapacity } from './capacity';

const VERTEX_SHADER = /* glsl */ `
uniform float uScale;    // screen pixels per world unit
uniform float uBaseSize; // world units

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uBaseSize * uScale;
  gl_Position = projectionMatrix * mvPosition;
}
`;

// Bigger, slower-reading blob: a darker core inside a soft cool-white/magenta glow
// (spec §21/§43-44: predators must read as "a big, slow thing").
const FRAGMENT_SHADER = /* glsl */ `
precision mediump float;
uniform vec3 uGlowColor;
uniform vec3 uCoreColor;

void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv) * 2.0;
  float glow = smoothstep(1.0, 0.0, d);
  float core = smoothstep(0.42, 0.0, d);
  vec3 color = mix(uGlowColor, uCoreColor, core * 0.75);
  float alpha = pow(glow, 1.2);
  gl_FragColor = vec4(color, alpha);
}
`;

function hexToVec3(hex: number): THREE.Vector3 {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b);
}

/** One `THREE.Points` cloud for all predators. Same growable-buffer pattern as
 * `BugParticles`, but without per-vertex behavioral attributes — predators are visually
 * uniform (larger, slower-looking) by design. */
export class PredatorParticles {
  readonly points: THREE.Points;

  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private capacity = 0;
  private count = 0;
  private position!: THREE.BufferAttribute;

  constructor(initialCapacity = 8) {
    this.geometry = new THREE.BufferGeometry();
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uScale: { value: 1 },
        uBaseSize: { value: SIZES.predator },
        uGlowColor: { value: hexToVec3(COLORS.predatorGlow) },
        uCoreColor: { value: hexToVec3(COLORS.predatorCore) },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.allocate(Math.max(initialCapacity, 1));
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  private allocate(capacity: number): void {
    this.capacity = capacity;
    const position = new Float32Array(capacity * 3);
    if (this.position) position.set(this.position.array as Float32Array);
    this.position = new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.position);
  }

  setScale(pixelsPerWorldUnit: number): void {
    (this.material.uniforms.uScale as { value: number }).value = pixelsPerWorldUnit;
  }

  update(predators: readonly RenderPredator[]): void {
    const needed = predators.length;
    if (needed > this.capacity) this.allocate(growCapacity(this.capacity, needed));
    this.count = needed;

    const pos = this.position.array as Float32Array;
    for (let i = 0; i < needed; i++) {
      const p = predators[i];
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = 0;
    }
    this.position.needsUpdate = true;
    this.geometry.setDrawRange(0, this.count);
    this.geometry.computeBoundingSphere();
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

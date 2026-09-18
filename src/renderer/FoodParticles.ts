import * as THREE from 'three';
import type { RenderFood } from '@/simulation/types';
import { COLORS, SIZES } from './palette';
import { growCapacity } from './capacity';

const VERTEX_SHADER = /* glsl */ `
uniform float uScale;
uniform float uBaseSize;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uBaseSize * uScale;
  gl_Position = projectionMatrix * mvPosition;
}
`;

// Tiny, dim green-ish points (spec §21/§43: food is even smaller and dimmer than bugs).
const FRAGMENT_SHADER = /* glsl */ `
precision mediump float;
uniform vec3 uColor;

void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv) * 2.0;
  float alpha = smoothstep(1.0, 0.0, d);
  alpha = pow(alpha, 2.0) * 0.55; // dim relative to bugs/predators
  gl_FragColor = vec4(uColor, alpha);
}
`;

function hexToVec3(hex: number): THREE.Vector3 {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b);
}

/** One `THREE.Points` cloud for all food items. Same growable-buffer pattern as
 * `BugParticles`/`PredatorParticles`. */
export class FoodParticles {
  readonly points: THREE.Points;

  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private capacity = 0;
  private count = 0;
  private position!: THREE.BufferAttribute;

  constructor(initialCapacity = 128) {
    this.geometry = new THREE.BufferGeometry();
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uScale: { value: 1 },
        uBaseSize: { value: SIZES.food },
        uColor: { value: hexToVec3(COLORS.food) },
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

  update(foods: readonly RenderFood[]): void {
    const needed = foods.length;
    if (needed > this.capacity) this.allocate(growCapacity(this.capacity, needed));
    this.count = needed;

    const pos = this.position.array as Float32Array;
    for (let i = 0; i < needed; i++) {
      const f = foods[i];
      pos[i * 3] = f.x;
      pos[i * 3 + 1] = f.y;
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

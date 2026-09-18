import * as THREE from 'three';
import type { RenderBug } from '@/simulation/types';
import { COLORS, SIZES } from './palette';
import { growCapacity } from './capacity';

const VERTEX_SHADER = /* glsl */ `
uniform float uScale;    // screen pixels per world unit
uniform float uBaseSize; // world units, at energy = 1

attribute float aEnergy;
attribute float aGeneration;
attribute float aSelected;
attribute float aFear;

varying vec3 vColor;
varying float vSelected;

// cheap HSL -> RGB (h,s,l in 0..1)
vec3 hsl2rgb(vec3 c) {
  vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
}

void main() {
  float energy = clamp(aEnergy, 0.0, 1.0);
  float fear = clamp(aFear, 0.0, 1.0);

  // spec §43: hue drifts slowly with generation; dim/desaturate when starving or afraid.
  float hue = mod(${COLORS.bugHueBase.toFixed(4)} + aGeneration * ${COLORS.bugHuePerGeneration.toFixed(4)}, 1.0);
  float sat = ${COLORS.bugSaturation.toFixed(4)} * (1.0 - 0.5 * fear);
  float light = mix(0.22, 0.62, energy);
  vColor = hsl2rgb(vec3(hue, sat, light));
  vSelected = aSelected;

  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float sizeWorld = uBaseSize * mix(0.5, 1.15, energy);
  gl_PointSize = sizeWorld * uScale;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision mediump float;
varying vec3 vColor;
varying float vSelected;

void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv) * 2.0;
  float alpha = smoothstep(1.0, 0.0, d);
  alpha = pow(alpha, 1.6);
  vec3 col = vColor + vSelected * 0.15; // a faint extra glow on the selected bug itself
  gl_FragColor = vec4(col, alpha);
}
`;

/**
 * One `THREE.Points` cloud for all living bugs (spec §41-43: "small glowing particles").
 * Buffers grow to the next power of two only when the live count exceeds capacity;
 * `drawRange` is set to the live count every update so unused slots never render.
 */
export class BugParticles {
  readonly points: THREE.Points;

  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private capacity = 0;
  private count = 0;

  private position!: THREE.BufferAttribute;
  private aEnergy!: THREE.BufferAttribute;
  private aGeneration!: THREE.BufferAttribute;
  private aSelected!: THREE.BufferAttribute;
  private aFear!: THREE.BufferAttribute;

  constructor(initialCapacity = 128) {
    this.geometry = new THREE.BufferGeometry();
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uScale: { value: 1 },
        uBaseSize: { value: SIZES.bug },
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
    const aEnergy = new Float32Array(capacity);
    const aGeneration = new Float32Array(capacity);
    const aSelected = new Float32Array(capacity);
    const aFear = new Float32Array(capacity);

    // Preserve any existing data (cheap; only happens on the rare grow step).
    if (this.position) {
      position.set(this.position.array as Float32Array);
      aEnergy.set(this.aEnergy.array as Float32Array);
      aGeneration.set(this.aGeneration.array as Float32Array);
      aSelected.set(this.aSelected.array as Float32Array);
      aFear.set(this.aFear.array as Float32Array);
    }

    this.position = new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage);
    this.aEnergy = new THREE.BufferAttribute(aEnergy, 1).setUsage(THREE.DynamicDrawUsage);
    this.aGeneration = new THREE.BufferAttribute(aGeneration, 1).setUsage(THREE.DynamicDrawUsage);
    this.aSelected = new THREE.BufferAttribute(aSelected, 1).setUsage(THREE.DynamicDrawUsage);
    this.aFear = new THREE.BufferAttribute(aFear, 1).setUsage(THREE.DynamicDrawUsage);

    this.geometry.setAttribute('position', this.position);
    this.geometry.setAttribute('aEnergy', this.aEnergy);
    this.geometry.setAttribute('aGeneration', this.aGeneration);
    this.geometry.setAttribute('aSelected', this.aSelected);
    this.geometry.setAttribute('aFear', this.aFear);
  }

  setScale(pixelsPerWorldUnit: number): void {
    (this.material.uniforms.uScale as { value: number }).value = pixelsPerWorldUnit;
  }

  update(bugs: readonly RenderBug[], selectedId: string | null): void {
    const needed = bugs.length;
    if (needed > this.capacity) this.allocate(growCapacity(this.capacity, needed));
    this.count = needed;

    const pos = this.position.array as Float32Array;
    const energy = this.aEnergy.array as Float32Array;
    const generation = this.aGeneration.array as Float32Array;
    const selected = this.aSelected.array as Float32Array;
    const fear = this.aFear.array as Float32Array;

    for (let i = 0; i < needed; i++) {
      const b = bugs[i];
      pos[i * 3] = b.x;
      pos[i * 3 + 1] = b.y;
      pos[i * 3 + 2] = 0;
      energy[i] = b.energy;
      generation[i] = b.generation;
      selected[i] = selectedId !== null && b.id === selectedId ? 1 : 0;
      fear[i] = b.fear;
    }

    this.position.needsUpdate = true;
    this.aEnergy.needsUpdate = true;
    this.aGeneration.needsUpdate = true;
    this.aSelected.needsUpdate = true;
    this.aFear.needsUpdate = true;
    this.geometry.setDrawRange(0, this.count);
    this.geometry.computeBoundingSphere();
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

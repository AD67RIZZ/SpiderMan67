import * as THREE from 'three';
import type { GraphicsQuality } from '../world/types';

interface Particle {
  active: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maximumLife: number;
  color: THREE.Color;
}

export interface ParticleBurstOptions {
  position: THREE.Vector3;
  color?: THREE.ColorRepresentation;
  count?: number;
  speed?: number;
  life?: number;
  upward?: number;
}

/** A single draw-call particle pool used for shards, sparks and impacts. */
export class ParticlePool {
  readonly points: THREE.Points;

  private readonly particles: Particle[];
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;
  private cursor = 0;
  private disposed = false;

  constructor(scene: THREE.Scene, quality: GraphicsQuality = 'medium') {
    const capacity = quality === 'low' ? 96 : quality === 'medium' ? 192 : 320;
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.particles = Array.from({ length: capacity }, () => ({
      active: false,
      position: new THREE.Vector3(0, -1000, 0),
      velocity: new THREE.Vector3(),
      life: 0,
      maximumLife: 1,
      color: new THREE.Color(0xffffff),
    }));
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.material = new THREE.PointsMaterial({
      size: quality === 'high' ? 0.24 : 0.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = 'pooled-particles';
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.syncBuffers();
  }

  burst(options: ParticleBurstOptions): void {
    const count = Math.max(1, Math.min(40, Math.floor(options.count ?? 12)));
    const speed = options.speed ?? 4.5;
    const life = options.life ?? 0.7;
    const upward = options.upward ?? 1.6;
    const color = new THREE.Color(options.color ?? 0x52efff);
    for (let index = 0; index < count; index += 1) {
      const particle = this.particles[this.cursor];
      this.cursor = (this.cursor + 1) % this.particles.length;
      if (particle === undefined) {
        continue;
      }
      particle.active = true;
      particle.position.copy(options.position);
      const angle = (index / count) * Math.PI * 2 + Math.random() * 0.3;
      const radial = speed * (0.45 + Math.random() * 0.55);
      particle.velocity.set(Math.cos(angle) * radial, upward + Math.random() * speed, Math.sin(angle) * radial);
      particle.life = life * (0.75 + Math.random() * 0.35);
      particle.maximumLife = particle.life;
      particle.color.copy(color);
    }
  }

  update(dt: number): void {
    const safeDt = Math.max(0, Math.min(0.1, dt));
    for (const particle of this.particles) {
      if (!particle.active) {
        continue;
      }
      particle.life -= safeDt;
      if (particle.life <= 0) {
        particle.active = false;
        particle.position.set(0, -1000, 0);
        continue;
      }
      particle.velocity.y -= 6 * safeDt;
      particle.velocity.multiplyScalar(Math.max(0, 1 - safeDt * 1.4));
      particle.position.addScaledVector(particle.velocity, safeDt);
    }
    this.syncBuffers();
  }

  private syncBuffers(): void {
    for (let index = 0; index < this.particles.length; index += 1) {
      const particle = this.particles[index];
      if (particle === undefined) {
        continue;
      }
      const offset = index * 3;
      this.positions[offset] = particle.position.x;
      this.positions[offset + 1] = particle.position.y;
      this.positions[offset + 2] = particle.position.z;
      const alpha = particle.active ? Math.max(0, particle.life / particle.maximumLife) : 0;
      this.colors[offset] = particle.color.r * alpha;
      this.colors[offset + 1] = particle.color.g * alpha;
      this.colors[offset + 2] = particle.color.b * alpha;
    }
    const position = this.geometry.getAttribute('position');
    const color = this.geometry.getAttribute('color');
    position.needsUpdate = true;
    color.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}

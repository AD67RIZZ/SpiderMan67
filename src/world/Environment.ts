import * as THREE from 'three';
import { SeededRandom } from './SeededRandom';
import type { GraphicsQuality } from './types';

interface TrafficLane {
  mesh: THREE.Mesh;
  speed: number;
  minZ: number;
  maxZ: number;
}

export class Environment {
  readonly group = new THREE.Group();

  private readonly scene: THREE.Scene;
  private readonly previousBackground: THREE.Color | THREE.Texture | THREE.CubeTexture | null;
  private readonly previousFog: THREE.Fog | THREE.FogExp2 | null;
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly traffic: TrafficLane[] = [];
  private stars: THREE.Points | null = null;
  private city: THREE.InstancedMesh | null = null;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    seed: number,
    quality: GraphicsQuality = 'medium',
    courseDistance = 650,
  ) {
    this.scene = scene;
    this.previousBackground = scene.background;
    this.previousFog = scene.fog;
    this.group.name = 'neon-city-environment';
    scene.add(this.group);
    scene.background = new THREE.Color(0x020514);
    scene.fog = new THREE.FogExp2(0x06091c, quality === 'low' ? 0.008 : 0.006);

    const rng = new SeededRandom(seed ^ 0xa5a5f00d);
    this.createLights();
    this.createStars(rng, quality, courseDistance);
    this.createCity(rng, quality, courseDistance);
    this.createBillboards(rng, quality, courseDistance);
    this.createTraffic(rng, quality, courseDistance);
  }

  private createLights(): void {
    const hemisphere = new THREE.HemisphereLight(0x5f72ff, 0x080516, 1.45);
    hemisphere.name = 'city-hemisphere';
    const moon = new THREE.DirectionalLight(0x8aa8ff, 1.8);
    moon.name = 'city-moon';
    moon.position.set(-35, 70, -20);
    moon.castShadow = false;
    this.group.add(hemisphere, moon);
  }

  private createStars(
    rng: SeededRandom,
    quality: GraphicsQuality,
    courseDistance: number,
  ): void {
    const distanceScale = THREE.MathUtils.clamp(courseDistance / 650, 1, 2.5);
    const baseCount = quality === 'low' ? 260 : quality === 'medium' ? 520 : 820;
    const count = Math.floor(baseCount * distanceScale);
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const offset = index * 3;
      positions[offset] = rng.range(-260, 260);
      positions[offset + 1] = rng.range(70, 190);
      positions[offset + 2] = rng.range(-100, courseDistance + 180);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xbad6ff,
      size: quality === 'high' ? 0.42 : 0.34,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      toneMapped: false,
    });
    this.geometries.push(geometry);
    this.materials.push(material);
    this.stars = new THREE.Points(geometry, material);
    this.stars.name = 'stars';
    this.group.add(this.stars);
  }

  private createCity(
    rng: SeededRandom,
    quality: GraphicsQuality,
    courseDistance: number,
  ): void {
    const distanceScale = THREE.MathUtils.clamp(courseDistance / 650, 1, 4);
    const baseCount = quality === 'low' ? 90 : quality === 'medium' ? 155 : 230;
    const count = Math.floor(baseCount * distanceScale);
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({
      color: 0x07101f,
      emissive: 0x162d54,
      emissiveIntensity: 0.38,
      roughness: 0.84,
      metalness: 0.25,
      vertexColors: true,
    });
    this.geometries.push(geometry);
    this.materials.push(material);
    const city = new THREE.InstancedMesh(geometry, material, count);
    city.name = 'distant-buildings';
    city.frustumCulled = true;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const color = new THREE.Color();
    for (let index = 0; index < count; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const distance = rng.range(28, 115);
      const height = rng.range(12, 72);
      position.set(side * distance, height * 0.5 - 8, rng.range(-60, courseDistance + 160));
      scale.set(rng.range(7, 20), height, rng.range(7, 20));
      matrix.compose(position, rotation, scale);
      city.setMatrixAt(index, matrix);
      color.setHSL(rng.pick([0.52, 0.58, 0.72, 0.86]), 0.55, rng.range(0.14, 0.28));
      city.setColorAt(index, color);
    }
    city.instanceMatrix.needsUpdate = true;
    if (city.instanceColor !== null) {
      city.instanceColor.needsUpdate = true;
    }
    this.city = city;
    this.group.add(city);
  }

  private makeBillboardTexture(label: string, color: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const context = canvas.getContext('2d');
    if (context !== null) {
      context.fillStyle = '#030615';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = color;
      context.lineWidth = 6;
      context.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
      context.font = '700 32px system-ui, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = color;
      context.fillText(label, canvas.width / 2, canvas.height / 2);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(texture);
    return texture;
  }

  private createBillboards(
    rng: SeededRandom,
    quality: GraphicsQuality,
    courseDistance: number,
  ): void {
    const labels = ['SKYWAY', 'NOVA-7', 'RUN BRIGHT', 'ZENITH'];
    const spacing = quality === 'low' ? 260 : 175;
    const count = Math.max(3, Math.ceil(courseDistance / spacing));
    const geometry = new THREE.PlaneGeometry(12, 4.5);
    this.geometries.push(geometry);
    for (let index = 0; index < count; index += 1) {
      const color = index % 2 === 0 ? '#28e8ff' : '#ff4fd7';
      const material = new THREE.MeshBasicMaterial({
        map: this.makeBillboardTexture(labels[index % labels.length] ?? 'NEON', color),
        transparent: true,
        opacity: 0.78,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      });
      this.materials.push(material);
      const mesh = new THREE.Mesh(geometry, material);
      const side = index % 2 === 0 ? -1 : 1;
      mesh.position.set(
        side * rng.range(24, 42),
        rng.range(25, 55),
        55 + index * (courseDistance / Math.max(1, count)),
      );
      mesh.rotation.y = side > 0 ? -Math.PI / 2.7 : Math.PI / 2.7;
      mesh.name = `hologram-${index}`;
      this.group.add(mesh);
    }
  }

  private createTraffic(
    rng: SeededRandom,
    quality: GraphicsQuality,
    courseDistance: number,
  ): void {
    const distanceScale = THREE.MathUtils.clamp(courseDistance / 650, 1, 2.2);
    const baseCount = quality === 'low' ? 5 : quality === 'medium' ? 9 : 14;
    const count = Math.floor(baseCount * distanceScale);
    const geometry = new THREE.CapsuleGeometry(0.18, 1.4, 2, 6);
    this.geometries.push(geometry);
    const cyan = new THREE.MeshBasicMaterial({ color: 0x47eeff, toneMapped: false });
    const magenta = new THREE.MeshBasicMaterial({ color: 0xff4fd8, toneMapped: false });
    this.materials.push(cyan, magenta);
    for (let index = 0; index < count; index += 1) {
      const mesh = new THREE.Mesh(geometry, index % 2 === 0 ? cyan : magenta);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(
        rng.sign() * rng.range(20, 75),
        rng.range(12, 58),
        rng.range(-30, courseDistance + 100),
      );
      this.group.add(mesh);
      this.traffic.push({
        mesh,
        speed: rng.range(7, 19),
        minZ: -60,
        maxZ: courseDistance + 180,
      });
    }
  }

  update(dt: number, elapsed: number): void {
    if (this.stars !== null) {
      this.stars.rotation.y = elapsed * 0.003;
    }
    if (this.city !== null) {
      this.city.position.y = Math.sin(elapsed * 0.15) * 0.15;
    }
    for (const lane of this.traffic) {
      lane.mesh.position.z += lane.speed * dt;
      if (lane.mesh.position.z > lane.maxZ) {
        lane.mesh.position.z = lane.minZ;
      }
      const material = lane.mesh.material;
      if (material instanceof THREE.MeshBasicMaterial) {
        material.opacity = 0.72 + Math.sin(elapsed * 5 + lane.mesh.position.x) * 0.2;
      }
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.group.removeFromParent();
    if (this.scene.background !== this.previousBackground) {
      this.scene.background = this.previousBackground;
    }
    if (this.scene.fog !== this.previousFog) {
      this.scene.fog = this.previousFog;
    }
    for (const texture of this.textures) {
      texture.dispose();
    }
    for (const material of this.materials) {
      material.dispose();
    }
    for (const geometry of this.geometries) {
      geometry.dispose();
    }
    this.traffic.length = 0;
    this.materials.length = 0;
    this.geometries.length = 0;
    this.textures.length = 0;
  }
}

import * as THREE from "three";

interface TrafficLight {
  mesh: THREE.Mesh;
  lane: number;
  speed: number;
  phase: number;
}

/** Lightweight animated skyline used while menu panels are open. */
export class MenuBackdrop {
  private readonly root = new THREE.Group();
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly traffic: TrafficLight[] = [];
  private readonly lookTarget = new THREE.Vector3(0, 7, 28);
  private readonly starField: THREE.Points;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    this.root.name = "menu-skyline";
    scene.add(this.root);
    scene.background = new THREE.Color(0x02040e);
    scene.fog = new THREE.FogExp2(0x07102a, 0.011);

    const ambient = new THREE.HemisphereLight(0x536cff, 0x02030a, 1.2);
    const rim = new THREE.DirectionalLight(0x50efff, 1.9);
    rim.position.set(-18, 30, -10);
    this.root.add(ambient, rim);

    const buildingGeometry = new THREE.BoxGeometry(1, 1, 1);
    const buildingMaterial = new THREE.MeshStandardMaterial({
      color: 0x071025,
      emissive: 0x091b3d,
      emissiveIntensity: 0.55,
      roughness: 0.8,
      metalness: 0.2,
    });
    const edgeGeometry = new THREE.BoxGeometry(1.02, 0.035, 1.02);
    const cyan = new THREE.MeshBasicMaterial({
      color: 0x2feaff,
      transparent: true,
      opacity: 0.68,
      toneMapped: false,
    });
    const magenta = new THREE.MeshBasicMaterial({
      color: 0xff3be5,
      transparent: true,
      opacity: 0.52,
      toneMapped: false,
    });
    this.geometries.push(buildingGeometry, edgeGeometry);
    this.materials.push(buildingMaterial, cyan, magenta);

    const count = 95;
    const buildings = new THREE.InstancedMesh(buildingGeometry, buildingMaterial, count);
    const roofLines = new THREE.InstancedMesh(edgeGeometry, [cyan, magenta], count);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    let seed = 0x51c0ffee;
    const random = (): number => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed / 0x1_0000_0000;
    };

    for (let index = 0; index < count; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const lane = Math.floor(index / 2);
      const z = lane * 6 - 28 + random() * 3;
      const width = 5 + random() * 9;
      const depth = 4 + random() * 8;
      const height = 8 + random() * 34 + Math.max(0, z) * 0.08;
      position.set(side * (13 + random() * 35), height / 2 - 4, z);
      scale.set(width, height, depth);
      matrix.compose(position, quaternion, scale);
      buildings.setMatrixAt(index, matrix);
      buildings.setColorAt(index, new THREE.Color().setHSL(0.61 + random() * 0.06, 0.45, 0.09 + random() * 0.06));

      position.y = height - 4;
      scale.set(width, 1, depth);
      matrix.compose(position, quaternion, scale);
      roofLines.setMatrixAt(index, matrix);
      roofLines.setColorAt(index, index % 3 === 0 ? new THREE.Color(0xff3be5) : new THREE.Color(0x2feaff));
    }
    buildings.instanceMatrix.needsUpdate = true;
    roofLines.instanceMatrix.needsUpdate = true;
    this.root.add(buildings, roofLines);

    const roadGeometry = new THREE.PlaneGeometry(20, 220);
    const roadMaterial = new THREE.MeshStandardMaterial({
      color: 0x030713,
      roughness: 0.32,
      metalness: 0.75,
    });
    const road = new THREE.Mesh(roadGeometry, roadMaterial);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, -3.9, 45);
    this.geometries.push(roadGeometry);
    this.materials.push(roadMaterial);
    this.root.add(road);

    const starGeometry = new THREE.BufferGeometry();
    const starPositions = new Float32Array(360 * 3);
    for (let index = 0; index < starPositions.length; index += 3) {
      starPositions[index] = (random() - 0.5) * 260;
      starPositions[index + 1] = 24 + random() * 90;
      starPositions[index + 2] = (random() - 0.5) * 220;
    }
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const starMaterial = new THREE.PointsMaterial({
      color: 0xb5eaff,
      size: 0.28,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      toneMapped: false,
    });
    this.starField = new THREE.Points(starGeometry, starMaterial);
    this.geometries.push(starGeometry);
    this.materials.push(starMaterial);
    this.root.add(this.starField);

    const trafficGeometry = new THREE.CapsuleGeometry(0.08, 1.35, 2, 5);
    this.geometries.push(trafficGeometry);
    for (let index = 0; index < 12; index += 1) {
      const material = index % 3 === 0 ? magenta : cyan;
      const mesh = new THREE.Mesh(trafficGeometry, material);
      mesh.rotation.x = Math.PI / 2;
      this.root.add(mesh);
      this.traffic.push({
        mesh,
        lane: (index % 4) - 1.5,
        speed: 8 + (index % 5) * 2.2,
        phase: (index / 12) * 180,
      });
    }
  }

  update(elapsed: number, reducedMotion = false): void {
    const motionScale = reducedMotion ? 0.18 : 1;
    this.starField.rotation.y = elapsed * 0.004 * motionScale;
    for (const light of this.traffic) {
      const z = ((light.phase + elapsed * light.speed * motionScale + 60) % 180) - 60;
      light.mesh.position.set(light.lane * 3.2, 1.5 + Math.sin(elapsed + light.phase) * 0.5, z);
    }
    const orbit = elapsed * 0.045 * motionScale;
    this.camera.position.set(Math.sin(orbit) * 7.5, 11 + Math.sin(elapsed * 0.13) * motionScale, -18 + Math.cos(orbit) * 3);
    this.lookTarget.x = Math.sin(elapsed * 0.055) * 3 * motionScale;
    this.camera.lookAt(this.lookTarget);
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.traffic.length = 0;
  }
}

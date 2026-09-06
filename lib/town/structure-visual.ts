import * as THREE from 'three';
import { cellShape, type WallPattern } from './structure.ts';
import type { TownSimulation } from './simulation';

function geometryFor(pattern: WallPattern, index: number) {
  const shape = cellShape(pattern, index),
    n = pattern.cells[index].polygon.length;
  const indices: number[] = [],
    colors: number[] = [];
  const tri = (a: number, b: number, c: number, interior = false) => {
    indices.push(a, b, c);
    for (let j = 0; j < 3; j++)
      colors.push(...(interior ? [0.78, 0.74, 0.65] : [1, 1, 1]));
  };
  for (let i = 1; i < n - 1; i++) {
    tri(n, n + i, n + i + 1);
    tri(0, i + 1, i);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tri(i, j, n + j, true);
    tri(i, n + j, n + i, true);
  }
  if (pattern.axis === 2)
    for (let i = 0; i < indices.length; i += 3)
      [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(shape.vertices, 3),
  );
  geo.setIndex(indices);
  const flat = geo.toNonIndexed();
  geo.dispose();
  flat.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  flat.computeVertexNormals();
  return flat;
}
export class StructureVisuals {
  sim: TownSimulation;
  scene: THREE.Scene;
  meshes = new Map<string, THREE.InstancedMesh>();
  shapes = new Map<string, ReturnType<typeof cellShape>>();
  byId: Map<string, TownSimulation['pieces'][number]>;
  colors = new Map<string, THREE.Color>();
  matrix = new THREE.Matrix4();
  position = new THREE.Vector3();
  q = new THREE.Quaternion();
  scale = new THREE.Vector3();
  constructor(sim: TownSimulation, scene: THREE.Scene) {
    this.sim = sim;
    this.scene = scene;
    this.byId = new Map(sim.pieces.map((p) => [p.definition.id, p]));
    for (const [name, pattern] of Object.entries(sim.patterns))
      for (let i = 0; i < pattern.cells.length; i++)
        this.shapes.set(`${name}:${i}`, cellShape(pattern, i));
  }
  register(id: string, mesh: THREE.Mesh) {
    const attribute = mesh.geometry.getAttribute('color');
    this.colors.set(
      id,
      attribute
        ? new THREE.Color().fromBufferAttribute(attribute, 0)
        : new THREE.Color('#ffd45e'),
    );
  }
  draw(
    id: string,
    patternName: string,
    index: number,
    position: THREE.Vector3,
    q: THREE.Quaternion,
    scale = 1,
  ) {
    const key = `${patternName}:${index}`;
    let mesh = this.meshes.get(key);
    if (!mesh) {
      mesh = new THREE.InstancedMesh(
        geometryFor(this.sim.patterns[patternName], index),
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 }),
        512,
      );
      mesh.name = `wall-cells-${key}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.meshes.set(key, mesh);
      this.scene.add(mesh);
    }
    if (mesh.count >= 512) return;
    this.matrix.compose(position, q, this.scale.setScalar(scale));
    mesh.setMatrixAt(mesh.count, this.matrix);
    mesh.setColorAt(mesh.count++, this.colors.get(id)!);
  }
  render(alpha: number) {
    for (const m of this.meshes.values()) m.count = 0;
    for (const piece of this.sim.pieces) {
      if (!piece.cells || !['damaged', 'collapsing'].includes(piece.state))
        continue;
      const patternName = piece.definition.fracture!;
      const p = piece.body.translation(),
        q = piece.body.rotation();
      this.q.set(q.x, q.y, q.z, q.w);
      for (const cell of piece.cells)
        if (cell.intact) {
          this.position
            .copy(this.shapes.get(`${patternName}:${cell.index}`)!.center)
            .applyQuaternion(this.q)
            .add(p);
          this.draw(
            piece.definition.id,
            patternName,
            cell.index,
            this.position,
            this.q,
          );
        }
    }
    for (const c of this.sim.motion.chunks)
      if (c.active && c.cellIndex !== undefined) {
        const piece = this.byId.get(c.source.id)!;
        this.position.lerpVectors(c.previous, c.position, alpha);
        this.q.slerpQuaternions(c.previousQ, c.rotation, alpha);
        this.draw(
          c.source.id,
          piece.definition.fracture!,
          c.cellIndex,
          this.position,
          this.q,
          Math.min(1, (c.life - c.age) / 0.45),
        );
      }
    for (const mesh of this.meshes.values()) {
      mesh.visible = mesh.count > 0;
      if (mesh.visible) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor!.needsUpdate = true;
      }
    }
  }
  dispose() {
    for (const m of this.meshes.values()) {
      m.removeFromParent();
      m.dispose();
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.meshes.clear();
  }
}

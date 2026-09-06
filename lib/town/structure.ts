import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { BreakSource, Vec } from './simulation';

export type WallPattern = {
  axis: 0 | 2;
  width: number;
  height: number;
  depth: number;
  cells: Array<{ polygon: number[][] }>;
};
export type WallCell = {
  index: number;
  intact: boolean;
  collider: RAPIER.Collider;
};
export type StructuralChunk = {
  source: BreakSource;
  cellIndex?: number;
  body?: RAPIER.RigidBody;
  collider?: RAPIER.Collider;
  position: THREE.Vector3;
  previous: THREE.Vector3;
  rotation: THREE.Quaternion;
  previousQ: THREE.Quaternion;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  age: number;
  life: number;
  landed: boolean;
  active: boolean;
};
export const STRUCTURE = {
  maxBodies: 20,
  maxChunks: 128,
  collapseDelay: 0.2,
  roofDelay: 0.38,
};
export const rotate = (
  v: Vec,
  q: { x: number; y: number; z: number; w: number },
) =>
  new THREE.Vector3(v.x, v.y, v.z).applyQuaternion(
    new THREE.Quaternion(q.x, q.y, q.z, q.w),
  );
export const localPoint = (
  point: Vec,
  position: Vec,
  q: { x: number; y: number; z: number; w: number },
) =>
  new THREE.Vector3(
    point.x - position.x,
    point.y - position.y,
    point.z - position.z,
  ).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w).invert());
export function cellShape(pattern: WallPattern, index: number) {
  const polygon = pattern.cells[index].polygon;
  const min = [
    Math.min(...polygon.map((p) => p[0])),
    Math.min(...polygon.map((p) => p[1])),
  ];
  const max = [
    Math.max(...polygon.map((p) => p[0])),
    Math.max(...polygon.map((p) => p[1])),
  ];
  const center = new THREE.Vector3();
  center.setComponent(pattern.axis, (min[0] + max[0]) / 2);
  center.y = (min[1] + max[1]) / 2;
  const half = new THREE.Vector3(
    pattern.depth / 2,
    (max[1] - min[1]) / 2,
    pattern.depth / 2,
  );
  half.setComponent(pattern.axis, (max[0] - min[0]) / 2);
  const vertices: number[] = [];
  for (const depth of [-pattern.depth / 2, pattern.depth / 2])
    for (const [u, y] of polygon) {
      const v = new THREE.Vector3();
      v.setComponent(pattern.axis, u);
      v.y = y;
      v.setComponent(pattern.axis === 0 ? 2 : 0, depth);
      v.sub(center);
      vertices.push(v.x, v.y, v.z);
    }
  return { center, half, vertices };
}
export function polygonDistance(polygon: number[][], u: number, y: number) {
  let inside = false,
    distance = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j],
      b = polygon[i];
    if (
      a[1] > y !== b[1] > y &&
      u < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      t = Math.max(
        0,
        Math.min(1, ((u - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)),
      );
    distance = Math.min(
      distance,
      Math.hypot(u - a[0] - t * dx, y - a[1] - t * dy),
    );
  }
  return inside ? 0 : distance;
}

export class StructureMotion {
  rotationTemp = new THREE.Quaternion();
  eulerTemp = new THREE.Euler();
  matrixTemp = new THREE.Matrix4();
  world: RAPIER.World;
  floor: (z: number) => number;
  chunks: StructuralChunk[] = [];
  slots: Array<{
    body: RAPIER.RigidBody;
    collider: RAPIER.Collider;
    chunk?: StructuralChunk;
  }> = [];
  constructor(world: RAPIER.World, floor: (z: number) => number) {
    this.world = world;
    this.floor = floor;
    for (let i = 0; i < STRUCTURE.maxBodies; i++) {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setCcdEnabled(true)
          .setLinearDamping(0.6)
          .setAngularDamping(0.9),
      );
      const collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.2, 0.2, 0.2)
          .setMass(0.35)
          .setFriction(0.7)
          .setRestitution(0.15)
          .setCollisionGroups((8 << 16) | 1),
        body,
      );
      body.setEnabled(false);
      this.slots.push({ body, collider });
    }
  }
  releaseBody(chunk: StructuralChunk) {
    const slot = this.slots.find((s) => s.chunk === chunk);
    if (slot) {
      slot.body.setEnabled(false);
      slot.chunk = undefined;
    }
    chunk.body = undefined;
    chunk.collider = undefined;
  }
  retire(chunk: StructuralChunk) {
    this.releaseBody(chunk);
    chunk.active = false;
  }
  spawn(
    source: BreakSource,
    velocity: Vec,
    mode: 'impact' | 'collapse' | 'landing',
    cellIndex?: number,
    vertices?: number[],
  ) {
    if (this.chunks.length >= STRUCTURE.maxChunks) {
      const oldest = [...this.chunks].sort(
        (a, b) => Number(b.landed) - Number(a.landed) || b.age - a.age,
      )[0];
      this.retire(oldest);
      this.chunks = this.chunks.filter((c) => c.active);
    }
    const n = this.chunks.length,
      side = n % 2 ? 1 : -1;
    const horizontal = Math.hypot(velocity.x, velocity.z) || 1;
    const dx = velocity.x / horizontal,
      dz = velocity.z / horizontal;
    const chunk: StructuralChunk = {
      source,
      cellIndex,
      position: new THREE.Vector3(
        source.position.x,
        source.position.y,
        source.position.z,
      ),
      previous: new THREE.Vector3(),
      rotation: new THREE.Quaternion(
        source.rotation.x,
        source.rotation.y,
        source.rotation.z,
        source.rotation.w,
      ),
      previousQ: new THREE.Quaternion(),
      velocity: new THREE.Vector3(),
      spin: new THREE.Vector3(),
      age: 0,
      life: cellIndex === undefined ? 4.4 : 3.0,
      landed: false,
      active: true,
    };
    const push =
      mode === 'impact'
        ? Math.min(8, 2 + horizontal * 0.23)
        : mode === 'landing'
          ? 2.4
          : 0.55;
    chunk.velocity.set(
      dx * push - dz * side * (mode === 'impact' ? 2.6 : 1),
      mode === 'impact' ? 1.2 : mode === 'landing' ? 1.7 : -0.7,
      dz * push + dx * side * (mode === 'impact' ? 2.6 : 1),
    );
    chunk.spin.set(
      dz * (mode === 'impact' ? 2.6 : 1.4) + side * 0.3,
      side * 0.65,
      -dx * (mode === 'impact' ? 2.6 : 1.4),
    );
    chunk.previous.copy(chunk.position);
    chunk.previousQ.copy(chunk.rotation);
    let slot = this.slots.find((s) => !s.chunk);
    if (!slot && cellIndex === undefined) {
      slot = this.slots.find((s) => s.chunk?.cellIndex !== undefined);
      if (slot?.chunk) this.releaseBody(slot.chunk);
    }
    if (slot) {
      slot.chunk = chunk;
      chunk.body = slot.body;
      chunk.collider = slot.collider;
      slot.collider.setShape(
        vertices
          ? new RAPIER.ConvexPolyhedron(new Float32Array(vertices))
          : new RAPIER.Cuboid(source.half.x, source.half.y, source.half.z),
      );
      slot.collider.setMass(0.35);
      // Roofs and broad slabs cannot turn a successful breach into a roadblock.
      slot.collider.setCollisionGroups((8 << 16) | 1);
      slot.body.setTranslation(chunk.position, true);
      slot.body.setRotation(chunk.rotation, true);
      slot.body.setLinvel(chunk.velocity, true);
      slot.body.setAngvel(chunk.spin, true);
      slot.body.setEnabled(true);
    }
    this.chunks.push(chunk);
    return chunk;
  }
  beginStep() {
    for (const c of this.chunks) {
      c.previous.copy(c.position);
      c.previousQ.copy(c.rotation);
    }
  }
  afterStep(dt: number) {
    const landings: Array<{ chunk: StructuralChunk; speed: number }> = [];
    for (const c of this.chunks) {
      if (!c.active) continue;
      c.age += dt;
      if (c.age >= c.life) {
        this.retire(c);
        continue;
      }
      const vy = c.velocity.y;
      if (c.body) {
        c.position.copy(c.body.translation());
        c.rotation.copy(c.body.rotation());
        c.velocity.copy(c.body.linvel());
        if (c.cellIndex !== undefined && c.age > 0.2)
          c.collider!.setCollisionGroups((8 << 16) | (1 | 2));
      } else {
        c.velocity.y -= 24 * dt;
        c.velocity.x *= Math.exp(-0.6 * dt);
        c.velocity.z *= Math.exp(-0.6 * dt);
        c.position.addScaledVector(c.velocity, dt);
        c.rotation.multiply(
          this.rotationTemp.setFromEuler(
            this.eulerTemp.set(c.spin.x * dt, c.spin.y * dt, c.spin.z * dt),
          ),
        );
        const m = this.matrixTemp.makeRotationFromQuaternion(
            c.rotation,
          ).elements,
          h = c.source.half;
        const extent =
          Math.abs(m[1]) * h.x + Math.abs(m[5]) * h.y + Math.abs(m[9]) * h.z;
        if (c.position.y < this.floor(c.position.z) + extent) {
          c.position.y = this.floor(c.position.z) + extent;
          c.velocity.y = c.landed ? 0 : Math.abs(vy) * 0.13;
          c.velocity.x *= 0.65;
          c.velocity.z *= 0.65;
          c.spin.multiplyScalar(0.55);
        }
      }
      if (!c.landed && vy < -2.5 && c.velocity.y > vy * 0.35) {
        c.landed = true;
        landings.push({ chunk: c, speed: -vy });
      }
    }
    this.chunks = this.chunks.filter((c) => c.active);
    return landings;
  }
  reset() {
    for (const c of this.chunks) this.retire(c);
    this.chunks = [];
  }
  dispose() {
    this.reset();
    for (const s of this.slots) this.world.removeRigidBody(s.body);
  }
}

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { BreakBurst, BreakSource } from './simulation';

export const FRAGMENTS = {
  capacity: 384,
  physicsBodies: 24,
  burstWindow: 0.24,
};
type Family = 'masonry' | 'wood' | 'metal' | 'foliage';
type Tier = 'small' | 'medium' | 'large';
type BodySlot = {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  used: boolean;
};
type Fragment = {
  active: boolean;
  tier: Tier;
  family: Family;
  age: number;
  life: number;
  position: THREE.Vector3;
  previous: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: THREE.Quaternion;
  previousQ: THREE.Quaternion;
  spin: THREE.Vector3;
  size: THREE.Vector3;
  color: THREE.Color;
  body?: BodySlot;
  bounced: boolean;
  previousVy: number;
};
type Swatch = { color: THREE.Color; weight: number };
type Appearance = { kind: string; palette: Swatch[] };
const families: Family[] = ['masonry', 'wood', 'metal', 'foliage'];
const tiers: Tier[] = ['large', 'medium', 'small'];

function shardGeometry(family: Family) {
  if (family === 'foliage') return new THREE.OctahedronGeometry(0.58, 0);
  // A chipped wedge, rather than the intact object's rectangular panel.
  const geometry = new THREE.BufferGeometry();
  const masonry = family === 'masonry';
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      masonry
        ? [
            -0.5, -0.45, -0.5, 0.5, -0.35, -0.38, -0.18, 0.5, -0.32, -0.42,
            -0.5, 0.5, 0.4, -0.32, 0.4, -0.12, 0.36, 0.5,
          ]
        : [
            -0.5, -0.5, -0.4, 0.45, -0.4, -0.5, 0.5, 0.45, -0.32, -0.35, 0.5,
            -0.5, -0.42, -0.35, 0.5, 0.5, -0.5, 0.3, 0.25, 0.5, 0.5, -0.5, 0.28,
            0.38,
          ],
      3,
    ),
  );
  geometry.setIndex(
    masonry
      ? [0, 2, 1, 3, 4, 5, 0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 2, 0, 3, 2, 3, 5]
      : [
          0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6,
          2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5,
        ],
  );
  const flat = geometry.toNonIndexed();
  geometry.dispose();
  flat.computeVertexNormals();
  return flat;
}

export class FractureEffects {
  world: RAPIER.World;
  scene: THREE.Scene;
  floorHeight: (z: number) => number;
  fragments: Fragment[] = [];
  bodies: BodySlot[] = [];
  meshes = new Map<Family, THREE.InstancedMesh>();
  appearances = new Map<string, Appearance>();
  geometryPalettes = new WeakMap<THREE.BufferGeometry, Swatch[]>();
  budgets = new Map<
    string,
    { until: number; small: number; medium: number; large: number }
  >();
  time = 0;
  seed = 0x726f6c6c;
  matrix = new THREE.Matrix4();
  temp = new THREE.Vector3();
  sizeTemp = new THREE.Vector3();
  qtemp = new THREE.Quaternion();
  spinQ = new THREE.Quaternion();
  spinEuler = new THREE.Euler();
  fallback = [{ color: new THREE.Color('#e8be78'), weight: 1 }];

  constructor(
    world: RAPIER.World,
    scene: THREE.Scene,
    floorHeight: (z: number) => number,
  ) {
    this.world = world;
    this.scene = scene;
    this.floorHeight = floorHeight;
    for (const family of families) {
      const mesh = new THREE.InstancedMesh(
        shardGeometry(family),
        new THREE.MeshLambertMaterial({ flatShading: true }),
        FRAGMENTS.capacity,
      );
      mesh.name = `fracture-${family}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color());
      mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.meshes.set(family, mesh);
    }
    for (let i = 0; i < FRAGMENTS.capacity; i++)
      this.fragments.push({
        active: false,
        tier: 'small',
        family: 'masonry',
        age: 0,
        life: 1,
        position: new THREE.Vector3(),
        previous: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        rotation: new THREE.Quaternion(),
        previousQ: new THREE.Quaternion(),
        spin: new THREE.Vector3(),
        size: new THREE.Vector3(),
        color: new THREE.Color(),
        bounced: false,
        previousVy: 0,
      });
    for (let i = 0; i < FRAGMENTS.physicsBodies; i++) {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setCcdEnabled(true)
          .setLinearDamping(0.5)
          .setAngularDamping(0.65),
      );
      const collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.2, 0.2, 0.2)
          .setMass(0.35)
          .setFriction(0.62)
          .setRestitution(0.22)
          .setCollisionGroups((8 << 16) | (1 | 2)),
        body,
      );
      body.setEnabled(false);
      this.bodies.push({ body, collider, used: false });
    }
  }
  random() {
    this.seed ^= this.seed << 13;
    this.seed ^= this.seed >>> 17;
    this.seed ^= this.seed << 5;
    return (this.seed >>> 0) / 4294967296;
  }
  registerSource(id: string, kind: string, object: THREE.Object3D) {
    const palette: Swatch[] = [];
    object.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      let colors = this.geometryPalettes.get(o.geometry);
      const attribute = o.geometry.getAttribute('color');
      if (!colors && attribute) {
        const weights = new Map<string, Swatch>();
        const positions = o.geometry.getAttribute('position');
        const indices = o.geometry.index;
        const a = new THREE.Vector3(),
          b = new THREE.Vector3(),
          c = new THREE.Vector3();
        for (let i = 0; i < (indices?.count ?? positions.count); i += 3) {
          const vertex = indices ? indices.getX(i) : i;
          a.fromBufferAttribute(positions, vertex);
          b.fromBufferAttribute(
            positions,
            indices ? indices.getX(i + 1) : i + 1,
          );
          c.fromBufferAttribute(
            positions,
            indices ? indices.getX(i + 2) : i + 2,
          );
          const weight = b.sub(a).cross(c.sub(a)).length();
          const color = new THREE.Color().fromBufferAttribute(
            attribute,
            vertex,
          );
          const key = color.getHexString();
          const existing = weights.get(key);
          if (existing) existing.weight += weight;
          else weights.set(key, { color, weight });
        }
        colors = [...weights.values()]
          .sort((a, b) => b.weight - a.weight)
          .slice(0, 4);
        this.geometryPalettes.set(o.geometry, colors);
      }
      const material = Array.isArray(o.material) ? o.material[0] : o.material;
      const tint: THREE.Color = material.color ?? new THREE.Color();
      if (colors?.length)
        palette.push(
          ...colors.map((s) => ({
            color: s.color.clone().multiply(tint),
            weight: s.weight,
          })),
        );
      else palette.push({ color: tint.clone(), weight: 1 });
    });
    this.appearances.set(id, {
      kind,
      palette: palette.length ? palette : this.fallback,
    });
  }
  colorFor(source: BreakSource) {
    const palette = this.appearances.get(source.id)?.palette ?? this.fallback;
    let pick = this.random() * palette.reduce((n, s) => n + s.weight, 0);
    for (const swatch of palette) {
      pick -= swatch.weight;
      if (pick <= 0) return swatch.color;
    }
    return palette[0].color;
  }
  familyFor(kind: string, color: THREE.Color): Family {
    if (kind === 'tree') return color.g > color.r * 0.8 ? 'foliage' : 'wood';
    if (kind === 'hedge') return 'foliage';
    if (['crate', 'bench'].includes(kind)) return 'wood';
    if (['car', 'bin', 'lamp', 'tower'].includes(kind)) return 'metal';
    return 'masonry';
  }
  retire(f: Fragment) {
    f.active = false;
    if (f.body) {
      f.body.body.setEnabled(false);
      f.body.used = false;
      f.body = undefined;
    }
  }
  acquire(tier: Tier) {
    let f = this.fragments.find((f) => !f.active);
    if (!f) {
      // Saturation sheds the oldest fine chips first, preserving the heavy beats.
      f = this.fragments.reduce((a, b) => {
        const rank = (f: Fragment) =>
          (f.tier === 'small' ? 10 : f.tier === 'medium' ? 5 : 0) +
          f.age / f.life;
        return rank(b) > rank(a) ? b : a;
      });
      this.retire(f);
    }
    f.active = true;
    f.tier = tier;
    f.age = 0;
    f.bounced = false;
    return f;
  }
  spawn(source: BreakSource, burst: BreakBurst, tier: Tier, index: number) {
    const f = this.acquire(tier),
      collapse = burst.mode === 'collapse';
    const color = this.colorFor(source);
    f.color.copy(color).multiplyScalar(0.9 + this.random() * 0.18);
    f.family = this.familyFor(source.kind, color);
    const edge =
      tier === 'small'
        ? 0.09 + this.random() * 0.1
        : tier === 'medium'
          ? 0.25 + this.random() * 0.22
          : 0.55 + this.random() * 0.4;
    f.size.set(
      edge * (0.85 + this.random() * 0.5),
      edge * (0.7 + this.random() * 0.45),
      edge,
    );
    if (f.family === 'wood')
      f.size.multiply(new THREE.Vector3(1.65, 0.42, 0.46));
    if (f.family === 'metal')
      f.size.multiply(new THREE.Vector3(1.3, 0.18, 1.0));
    if (f.family === 'foliage') f.size.multiplyScalar(0.85);
    // Keep recognisable thin materials thin, without emitting full original panels.
    if (f.family === 'masonry')
      f.size.z = Math.min(f.size.z, Math.max(0.09, source.half.z * 1.5));
    f.rotation.set(
      source.rotation.x,
      source.rotation.y,
      source.rotation.z,
      source.rotation.w,
    );
    f.position
      .set(
        (this.random() - 0.5) * source.half.x * 1.65,
        (this.random() - 0.5) * source.half.y * 1.65,
        (this.random() - 0.5) * source.half.z * 1.65,
      )
      .applyQuaternion(f.rotation);
    f.position.add(
      this.temp.set(source.position.x, source.position.y, source.position.z),
    );
    const speed = Math.hypot(burst.velocity.x, burst.velocity.z);
    let dx = burst.velocity.x,
      dz = burst.velocity.z;
    if (speed < 0.1) {
      dx = source.position.x - burst.origin.x;
      dz = source.position.z - burst.origin.z;
    }
    const length = Math.hypot(dx, dz) || 1;
    dx /= length;
    dz /= length;
    const side = index % 2 ? 1 : -1;
    const angle =
      side *
      (tier === 'small'
        ? 0.25 + this.random() * 1.15
        : 0.65 + this.random() * 0.8);
    const forward = collapse
      ? 0.4 + this.random() * 1.7
      : (tier === 'small' ? 10 : tier === 'medium' ? 6.5 : 3.2) *
        (0.7 + this.random() * 0.6) *
        Math.min(1.4, 0.7 + speed / 35);
    f.velocity.set(
      (dx * Math.cos(angle) - dz * Math.sin(angle)) * forward,
      collapse
        ? -0.5 - this.random() * 2
        : tier === 'small'
          ? 3 + this.random() * 6
          : tier === 'medium'
            ? 3 + this.random() * 4
            : 1.5 + this.random() * 2,
      (dz * Math.cos(angle) + dx * Math.sin(angle)) * forward,
    );
    const spin = tier === 'small' ? 22 : tier === 'medium' ? 14 : 6;
    f.spin.set(
      (this.random() - 0.5) * spin,
      (this.random() - 0.5) * spin,
      (this.random() - 0.5) * spin,
    );
    f.life =
      tier === 'small'
        ? 0.48 + this.random() * 0.3
        : tier === 'medium'
          ? 1.25 + this.random() * 0.65
          : 2.5 + this.random() * 0.65;
    f.position.y = Math.max(
      f.position.y,
      this.floorHeight(f.position.z) + f.size.y * 0.5,
    );
    f.previous.copy(f.position);
    f.previousQ.copy(f.rotation);
    f.previousVy = f.velocity.y;
    if (tier === 'large') {
      const slot = this.bodies.find((b) => !b.used);
      if (slot) {
        f.body = slot;
        slot.used = true;
        slot.collider.setHalfExtents({
          x: f.size.x * 0.5,
          y: f.size.y * 0.5,
          z: f.size.z * 0.5,
        });
        slot.body.setTranslation(f.position, true);
        slot.body.setRotation(f.rotation, true);
        slot.body.setLinvel(f.velocity, true);
        slot.body.setAngvel(f.spin, true);
        slot.body.setEnabled(true);
      }
    }
    return f;
  }
  emit(burst: BreakBurst) {
    if (!burst.sources.length) return;
    const key = `${burst.group}:${burst.mode}:${burst.wave}`;
    let budget = this.budgets.get(key);
    if (!budget || budget.until <= this.time) {
      budget = {
        until: this.time + FRAGMENTS.burstWindow,
        large: 4,
        medium: 16,
        small: 36,
      };
      this.budgets.set(key, budget);
    }
    const counts =
      burst.mode === 'impact'
        ? { large: 3, medium: 10, small: 22 }
        : { large: 4, medium: 16, small: 16 };
    for (const tier of tiers) {
      const count = Math.min(counts[tier], budget[tier]);
      budget[tier] -= count;
      for (let i = 0; i < count; i++) {
        // Sample across the broken structure; never multiply a full burst by every wall panel.
        const source =
          burst.sources[
            Math.min(
              burst.sources.length - 1,
              Math.floor(((i + this.random()) * burst.sources.length) / count),
            )
          ];
        this.spawn(source, burst, tier, i);
      }
    }
  }
  beginStep() {
    for (const f of this.fragments)
      if (f.active) {
        f.previous.copy(f.position);
        f.previousQ.copy(f.rotation);
        f.previousVy = f.velocity.y;
      }
  }
  afterStep(dt: number, bursts: BreakBurst[]) {
    this.time += dt;
    let landingChips = 0;
    const landings: Array<{
      position: THREE.Vector3;
      color: THREE.Color;
      family: Family;
    }> = [];
    for (const f of this.fragments) {
      if (!f.active) continue;
      f.age += dt;
      if (f.age >= f.life) {
        this.retire(f);
        continue;
      }
      if (f.body) {
        f.position.copy(f.body.body.translation());
        f.rotation.copy(f.body.body.rotation());
        f.velocity.copy(f.body.body.linvel());
      } else {
        const drag = Math.exp(-(f.tier === 'small' ? 5.2 : 1.1) * dt);
        f.velocity.x *= drag;
        f.velocity.z *= drag;
        f.velocity.y -= 24 * dt;
        f.position.addScaledVector(f.velocity, dt);
        this.spinEuler.set(f.spin.x * dt, f.spin.y * dt, f.spin.z * dt);
        f.rotation.multiply(this.spinQ.setFromEuler(this.spinEuler));
        const floor = this.floorHeight(f.position.z) + f.size.y * 0.35;
        if (f.position.y < floor) {
          f.position.y = floor;
          f.velocity.y =
            !f.bounced && f.tier !== 'small'
              ? Math.abs(f.velocity.y) * 0.32
              : 0;
          f.velocity.x *= 0.65;
          f.velocity.z *= 0.65;
          f.spin.multiplyScalar(0.6);
          f.bounced = true;
        }
      }
      if (
        f.body &&
        !f.bounced &&
        f.previousVy < -3 &&
        f.velocity.y > f.previousVy * 0.3 &&
        landingChips < 12
      ) {
        f.bounced = true;
        landingChips += 4;
        landings.push({
          position: f.position.clone(),
          color: f.color.clone(),
          family: f.family,
        });
      }
    }
    for (const landing of landings)
      for (let i = 0; i < 4; i++) {
        const f = this.acquire('small');
        f.family = landing.family;
        f.color.copy(landing.color);
        f.size.setScalar(0.075 + this.random() * 0.06);
        f.position.copy(landing.position);
        f.previous.copy(f.position);
        f.rotation.identity();
        f.previousQ.identity();
        f.spin.set(9, 5, 7);
        const angle = this.random() * Math.PI * 2;
        f.velocity.set(
          Math.sin(angle) * 3.8,
          1.5 + this.random() * 2,
          Math.cos(angle) * 3.8,
        );
        f.life = 0.35 + this.random() * 0.15;
      }
    for (const burst of bursts) this.emit(burst);
    for (const [key, budget] of this.budgets)
      if (budget.until <= this.time) this.budgets.delete(key);
  }
  render(alpha: number) {
    for (const mesh of this.meshes.values()) mesh.count = 0;
    for (const f of this.fragments)
      if (f.active) {
        const mesh = this.meshes.get(f.family)!;
        const shrink = Math.min(
          1,
          (f.life - f.age) / (f.tier === 'large' ? 0.4 : 0.2),
        );
        this.temp.lerpVectors(f.previous, f.position, alpha);
        this.qtemp.slerpQuaternions(f.previousQ, f.rotation, alpha);
        this.matrix.compose(
          this.temp,
          this.qtemp,
          this.sizeTemp.copy(f.size).multiplyScalar(shrink),
        );
        mesh.setMatrixAt(mesh.count, this.matrix);
        mesh.setColorAt(mesh.count++, f.color);
      }
    for (const mesh of this.meshes.values()) {
      mesh.visible = mesh.count > 0;
      if (mesh.visible) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor!.needsUpdate = true;
      }
    }
  }
  getStats() {
    const result = {
      small: 0,
      medium: 0,
      large: 0,
      physicsBodies: 0,
      capacity: FRAGMENTS.capacity,
    };
    for (const f of this.fragments) if (f.active) result[f.tier]++;
    result.physicsBodies = this.bodies.filter((b) => b.used).length;
    return result;
  }
  reset() {
    for (const f of this.fragments) if (f.active) this.retire(f);
    this.budgets.clear();
    this.time = 0;
    this.seed = 0x726f6c6c;
    this.render(1);
  }
  dispose() {
    this.reset();
    for (const slot of this.bodies) this.world.removeRigidBody(slot.body);
    for (const mesh of this.meshes.values()) {
      mesh.removeFromParent();
      mesh.dispose();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.appearances.clear();
  }
}

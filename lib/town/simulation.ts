import RAPIER from '@dimforge/rapier3d-compat';

export type Vec = { x: number; y: number; z: number };
export type PieceDefinition = {
  id: string;
  group: string;
  kind: string;
  level: number;
  section: string;
  position: number[];
  half: number[];
  rotation: number[];
  strength: number;
  hidden?: boolean;
};
export type Piece = {
  definition: PieceDefinition;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  state: 'intact' | 'debris' | 'gone';
  age: number;
};
type Prop = {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  type: string;
  spawn: number[];
  broken: boolean;
  fragments: Piece[];
};
export const DESTRUCTION = { maxDebris: 80, lifetime: 7, shrinkTime: 1 };
const INTACT_GROUPS = (4 << 16) | 2;
const DEBRIS_GROUPS = (8 << 16) | (1 | 2);
export type Layout = {
  colliders: Array<{
    kind: string;
    position?: number[];
    half?: number[];
    vertices?: number[][];
    faces?: number[][];
    xs?: number[];
    zs?: number[];
  }>;
  props: Array<{ type: string; position: number[] }>;
  houseCount: number;
  pieces?: PieceDefinition[];
};
export const TUNING = {
  radius: 0.72,
  gravity: -24,
  acceleration: 22,
  airControl: 0.28,
  topSpeed: 25,
  jumpSpeed: 9.3,
  brake: 8,
  step: 1 / 60,
  coyote: 0.1,
  jumpBuffer: 0.14,
};
export const groundHeight = (z: number) =>
  Math.max(0, Math.min(7, (-z - 10) * 0.18));
export class TownSimulation {
  world: RAPIER.World;
  ball: RAPIER.RigidBody;
  ballCollider: RAPIER.Collider;
  props: Prop[] = [];
  pieces: Piece[] = [];
  debris: Piece[] = [];
  groups = new Map<string, Piece[]>();
  breakableColliders = new Map<number, Piece | Prop>();
  events = new RAPIER.EventQueue(true);
  brokenCount = 0;
  lastImpact: Vec = { x: 0, y: 0, z: 0 };
  impactSerial = 0;
  grounded = false;
  groundGrace = 0;
  jumpQueued = 0;
  distance = 0;
  jumps = 0;
  lastPosition: Vec;
  disposed = false;
  constructor(layout: Layout) {
    this.world = new RAPIER.World({ x: 0, y: TUNING.gravity, z: 0 });
    this.world.timestep = TUNING.step;
    this.world.integrationParameters.maxCcdSubsteps = 2;
    for (const c of layout.colliders) {
      if (c.kind === 'box' && c.half && c.position) {
        this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(c.half[0], c.half[1], c.half[2])
            .setTranslation(c.position[0], c.position[1], c.position[2])
            .setFriction(0.45),
        );
      } else if (c.kind === 'terrain' && c.xs && c.zs) {
        const vertices: number[] = [];
        const indices: number[] = [];
        for (const z of c.zs)
          for (const x of c.xs) vertices.push(x, groundHeight(z), z);
        for (let i = 0; i < c.zs.length - 1; i++) {
          const a = i * 2;
          indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
        this.world.createCollider(
          RAPIER.ColliderDesc.trimesh(
            new Float32Array(vertices),
            new Uint32Array(indices),
          ).setFriction(0.3),
        );
      } else if (c.kind === 'ramp' && c.vertices && c.faces) {
        const idx: number[] = [];
        for (const f of c.faces)
          for (let i = 1; i < f.length - 1; i++) idx.push(f[0], f[i], f[i + 1]);
        this.world.createCollider(
          RAPIER.ColliderDesc.trimesh(
            new Float32Array(c.vertices.flat()),
            new Uint32Array(idx),
          ).setFriction(0.35),
        );
      }
    }
    // Soft invisible boundary is outside the dressed neighborhood and distant scenery.
    for (const [x, z, hx, hz] of [
      [-79, 0, 0.5, 75],
      [79, 0, 0.5, 75],
      [0, -70, 80, 0.5],
      [0, 70, 80, 0.5],
    ]) {
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, 15, hz)
          .setTranslation(x, 10, z)
          .setRestitution(0.3),
      );
    }
    this.ball = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, groundHeight(-37) + TUNING.radius + 0.14, -37)
        .setLinearDamping(0.16)
        .setAngularDamping(0.6)
        .setCcdEnabled(true)
        .setCanSleep(false),
    );
    this.ballCollider = this.world.createCollider(
      RAPIER.ColliderDesc.ball(TUNING.radius)
        .setDensity(4)
        .setFriction(0.42)
        .setRestitution(0.1)
        .setCollisionGroups((2 << 16) | (1 | 4 | 8))
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(80),
      this.ball,
    );
    for (const definition of layout.pieces ?? []) this.addPiece(definition);
    for (const p of layout.props) {
      const b = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(p.position[0], p.position[1], p.position[2])
          .setLinearDamping(0.6)
          .setAngularDamping(0.8)
          .setCcdEnabled(true),
      );
      const shape =
        p.type === 'cone'
          ? RAPIER.ColliderDesc.cone(0.36, 0.28)
          : RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5);
      const collider = this.world.createCollider(
        shape
          .setDensity(0.65)
          .setFriction(0.55)
          .setRestitution(0.15)
          .setCollisionGroups((4 << 16) | (1 | 2)),
        b,
      );
      const prop: Prop = {
        body: b,
        collider,
        type: p.type,
        spawn: p.position,
        broken: false,
        fragments: [],
      };
      if (p.type === 'crate') {
        for (let i = 0; i < 6; i++) {
          prop.fragments.push(
            this.addPiece({
              id: `crate_${this.props.length}_${i}`,
              group: `crate_${this.props.length}`,
              kind: 'crate',
              level: 0,
              section: '',
              hidden: true,
              position: p.position,
              half: [0.48, 0.085, 0.22],
              rotation: [0, 0, 0, 1],
              strength: 6,
            }),
          );
        }
        this.breakableColliders.set(collider.handle, prop);
      }
      this.props.push(prop);
    }
    this.lastPosition = this.ball.translation();
  }
  queueJump() {
    this.jumpQueued = TUNING.jumpBuffer;
  }
  addPiece(definition: PieceDefinition) {
    const [x, y, z] = definition.position;
    const [qx, qy, qz, qw] = definition.rotation;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(x, y, z)
        .setRotation({ x: qx, y: qy, z: qz, w: qw })
        .setLinearDamping(0.45)
        .setAngularDamping(0.7)
        .setCcdEnabled(true),
    );
    const h = definition.half;
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(h[0], h[1], h[2])
        .setMass(Math.min(1.8, Math.max(0.18, h[0] * h[1] * h[2] * 0.4)))
        .setFriction(0.55)
        .setRestitution(0.16)
        .setCollisionGroups(INTACT_GROUPS),
      body,
    );
    const piece: Piece = {
      definition,
      body,
      collider,
      state: definition.hidden ? 'gone' : 'intact',
      age: 0,
    };
    if (definition.hidden) body.setEnabled(false);
    this.pieces.push(piece);
    const siblings = this.groups.get(definition.group) ?? [];
    siblings.push(piece);
    this.groups.set(definition.group, siblings);
    this.breakableColliders.set(collider.handle, piece);
    return piece;
  }
  retire(piece: Piece) {
    piece.state = 'gone';
    piece.body.setEnabled(false);
  }
  detach(piece: Piece, velocity: Vec, origin: Vec) {
    if (piece.state === 'debris') return;
    if (piece.state === 'gone' && !piece.definition.hidden) return;
    while (this.debris.length >= DESTRUCTION.maxDebris)
      this.retire(this.debris.shift()!);
    piece.state = 'debris';
    piece.age = 0;
    piece.body.setEnabled(true);
    piece.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    piece.collider.setCollisionGroups(DEBRIS_GROUPS);
    const p = piece.body.translation();
    const angle = this.brokenCount * 2.39996;
    const dx = p.x - origin.x,
      dz = p.z - origin.z;
    const length = Math.hypot(dx, dz) || 1;
    piece.body.setLinvel(
      {
        x: velocity.x * 0.45 + (dx / length) * 2 + Math.sin(angle),
        y: 3.2 + Math.min(3, Math.abs(velocity.y) * 0.25),
        z: velocity.z * 0.45 + (dz / length) * 2 + Math.cos(angle),
      },
      true,
    );
    piece.body.setAngvel(
      { x: Math.cos(angle) * 3, y: Math.sin(angle) * 2, z: 2 },
      true,
    );
    this.debris.push(piece);
    this.brokenCount++;
  }
  breakPiece(piece: Piece, velocity: Vec, origin: Vec) {
    if (piece.state !== 'intact') return;
    this.detach(piece, velocity, origin);
    const d = piece.definition;
    const siblings = this.groups.get(d.group)!;
    if (d.kind === 'wall') {
      // A breached ground-floor panel takes only its matching upper panel with it.
      // The rest of a house falls when enough of its supporting walls are gone.
      if (d.level === 0) {
        for (const p of siblings)
          if (
            p.state === 'intact' &&
            p.definition.kind === 'wall' &&
            p.definition.level === 1 &&
            p.definition.section === d.section
          )
            this.detach(p, velocity, origin);
      }
      const supports = siblings.filter(
        (p) => p.definition.kind === 'wall' && p.definition.level === 0,
      );
      if (
        supports.filter((p) => p.state !== 'intact').length >=
        Math.ceil(supports.length * 0.35)
      ) {
        for (const p of siblings)
          if (p.state === 'intact') this.detach(p, velocity, origin);
      }
    } else if (
      ['tree', 'lamp', 'bin', 'pot', 'bench', 'car', 'tower'].includes(d.kind)
    ) {
      for (const p of siblings)
        if (p.state === 'intact') this.detach(p, velocity, origin);
    }
  }
  handleImpacts(velocity: Vec, origin: Vec) {
    const impacts = new Map<Piece | Prop, number>();
    this.events.drainContactForceEvents((event) => {
      const a = event.collider1(),
        b = event.collider2();
      const handle =
        a === this.ballCollider.handle
          ? b
          : b === this.ballCollider.handle
            ? a
            : null;
      if (handle === null) return;
      const target = this.breakableColliders.get(handle);
      if (target)
        impacts.set(
          target,
          Math.max(
            impacts.get(target) ?? 0,
            event.totalForceMagnitude() * TUNING.step,
          ),
        );
    });
    const count = this.brokenCount;
    for (const [target, impulse] of impacts) {
      if ('definition' in target) {
        if (target.state === 'intact' && impulse >= target.definition.strength)
          this.breakPiece(target, velocity, origin);
      } else if (!target.broken && impulse >= 5) {
        target.broken = true;
        const p = target.body.translation();
        const q = target.body.rotation();
        target.body.setEnabled(false);
        target.fragments.forEach((piece, i) => {
          piece.body.setTranslation(
            { x: p.x, y: p.y + (i - 2.5) * 0.17, z: p.z },
            true,
          );
          piece.body.setRotation(q, true);
          this.detach(piece, velocity, origin);
        });
      }
    }
    if (this.brokenCount > count) {
      this.lastImpact = { ...origin };
      this.impactSerial++;
      // Preserve the strike's momentum so breaking a facade feels like punching through it.
      const current = this.ball.linvel();
      this.ball.setLinvel(
        { x: velocity.x * 0.86, y: current.y, z: velocity.z * 0.86 },
        true,
      );
    }
  }
  step(x: number, z: number, brake = false) {
    const dt = TUNING.step,
      p = this.ball.translation(),
      v = this.ball.linvel();
    const hit = this.world.castRayAndGetNormal(
      new RAPIER.Ray(p, { x: 0, y: -1, z: 0 }),
      TUNING.radius + 0.18,
      true,
      undefined,
      undefined,
      undefined,
      this.ball,
    );
    this.grounded =
      !!hit &&
      hit.timeOfImpact < TUNING.radius + 0.13 &&
      hit.normal.y > 0.45 &&
      v.y < 3;
    this.groundGrace = this.grounded
      ? TUNING.coyote
      : Math.max(0, this.groundGrace - dt);
    this.jumpQueued = Math.max(0, this.jumpQueued - dt);
    const length = Math.hypot(x, z);
    if (length > 1) {
      x /= length;
      z /= length;
    }
    if (length > 0.06) {
      const dx = x * TUNING.topSpeed - v.x,
        dz = z * TUNING.topSpeed - v.z,
        d = Math.hypot(dx, dz);
      const maxChange =
        TUNING.acceleration * (this.grounded ? 1 : TUNING.airControl) * dt;
      const k = Math.min(1, maxChange / (d || 1));
      this.ball.applyImpulse(
        { x: dx * k * this.ball.mass(), y: 0, z: dz * k * this.ball.mass() },
        true,
      );
    }
    if (brake) {
      const vv = this.ball.linvel(),
        k = Math.exp(-TUNING.brake * dt);
      this.ball.setLinvel({ x: vv.x * k, y: vv.y, z: vv.z * k }, true);
    }
    if (this.jumpQueued > 0 && this.groundGrace > 0) {
      const vv = this.ball.linvel();
      this.ball.setLinvel({ x: vv.x, y: TUNING.jumpSpeed, z: vv.z }, true);
      this.jumpQueued = 0;
      this.groundGrace = 0;
      this.grounded = false;
      this.jumps++;
    }
    const vv = this.ball.linvel(),
      speed = Math.hypot(vv.x, vv.z);
    if (speed > 32)
      this.ball.setLinvel(
        { x: (vv.x * 32) / speed, y: vv.y, z: (vv.z * 32) / speed },
        true,
      );
    // Match sphere angular speed to travel while in contact; airborne rotation remains physical.
    if (this.grounded)
      this.ball.setAngvel(
        {
          x: vv.z / TUNING.radius,
          y: this.ball.angvel().y * 0.95,
          z: -vv.x / TUNING.radius,
        },
        true,
      );
    const impactVelocity = { ...this.ball.linvel() };
    this.world.step(this.events);
    this.handleImpacts(impactVelocity, p);
    for (const piece of this.debris) {
      piece.age += dt;
      if (piece.age >= DESTRUCTION.lifetime || piece.body.translation().y < -12)
        this.retire(piece);
    }
    this.debris = this.debris.filter((p) => p.state === 'debris');
    const next = this.ball.translation();
    this.distance += Math.hypot(
      next.x - this.lastPosition.x,
      next.z - this.lastPosition.z,
    );
    this.lastPosition = { ...next };
    if (next.y < -12 || !Number.isFinite(next.x + next.y + next.z))
      this.reset();
  }
  reset() {
    const p = { x: 0, y: groundHeight(-37) + TUNING.radius + 0.14, z: -37 };
    this.ball.setTranslation(p, true);
    this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.ball.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    for (const p of this.props) {
      p.broken = false;
      p.body.setEnabled(true);
      p.body.setTranslation(
        { x: p.spawn[0], y: p.spawn[1], z: p.spawn[2] },
        true,
      );
      p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      p.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    }
    for (const piece of this.pieces) {
      const d = piece.definition;
      piece.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
      piece.body.setTranslation(
        { x: d.position[0], y: d.position[1], z: d.position[2] },
        true,
      );
      piece.body.setRotation(
        {
          x: d.rotation[0],
          y: d.rotation[1],
          z: d.rotation[2],
          w: d.rotation[3],
        },
        true,
      );
      piece.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      piece.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      piece.collider.setCollisionGroups(INTACT_GROUPS);
      piece.state = d.hidden ? 'gone' : 'intact';
      piece.age = 0;
      piece.body.setEnabled(!d.hidden);
    }
    this.debris = [];
    this.brokenCount = 0;
    this.impactSerial = 0;
    this.events.clear();
    this.lastPosition = { ...p };
    this.distance = 0;
    this.jumps = 0;
    this.jumpQueued = 0;
    this.groundGrace = 0;
    this.grounded = false;
  }
  dispose() {
    if (!this.disposed) {
      this.disposed = true;
      this.events.free();
      this.world.free();
    }
  }
}

import RAPIER from '@dimforge/rapier3d-compat';

export type Vec = { x: number; y: number; z: number };
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
  props: Array<{ body: RAPIER.RigidBody; type: string; spawn: number[] }> = [];
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
    this.world.createCollider(
      RAPIER.ColliderDesc.ball(TUNING.radius)
        .setDensity(4)
        .setFriction(0.42)
        .setRestitution(0.1),
      this.ball,
    );
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
      this.world.createCollider(
        shape.setDensity(0.65).setFriction(0.55).setRestitution(0.15),
        b,
      );
      this.props.push({ body: b, type: p.type, spawn: p.position });
    }
    this.lastPosition = this.ball.translation();
  }
  queueJump() {
    this.jumpQueued = TUNING.jumpBuffer;
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
    this.world.step();
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
      p.body.setTranslation(
        { x: p.spawn[0], y: p.spawn[1], z: p.spawn[2] },
        true,
      );
      p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      p.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    }
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
      this.world.free();
    }
  }
}

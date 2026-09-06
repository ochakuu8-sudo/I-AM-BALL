import RAPIER from '@dimforge/rapier3d-compat';
import {
  StructureMotion,
  STRUCTURE,
  cellShape,
  localPoint,
  polygonDistance,
  rotate,
  type WallPattern,
  type WallCell,
  type StructuralChunk,
} from './structure.ts';

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
  fracture?: string;
};
export type Piece = {
  definition: PieceDefinition;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  state: 'intact' | 'damaged' | 'collapsing' | 'debris' | 'gone';
  age: number;
  cells?: WallCell[];
  counted: boolean;
  motion?: StructuralChunk;
  supports: Array<{ piece: Piece; weight: number }>;
};
export type BreakSource = {
  id: string;
  kind: string;
  position: Vec;
  rotation: { x: number; y: number; z: number; w: number };
  half: Vec;
};
export type BreakBurst = {
  group: string;
  mode: 'impact' | 'collapse' | 'landing';
  wave: number;
  sources: BreakSource[];
  velocity: Vec;
  origin: Vec;
  retained?: boolean;
};
type Prop = {
  id: string;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  type: string;
  spawn: number[];
  broken: boolean;
};
export const DESTRUCTION = {
  maxBursts: 32,
};
const INTACT_GROUPS = (4 << 16) | 2;
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
  fracturePatterns?: Record<string, WallPattern>;
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
  patterns: Record<string, WallPattern>;
  motion: StructureMotion;
  chippedCells = 0;
  soundEvents: Array<{
    kind: string;
    phase: 'impact' | 'collapse' | 'landing';
    strength: number;
  }> = [];
  collapsing: Array<{
    piece: Piece;
    delay: number;
    velocity: Vec;
    origin: Vec;
    wave: number;
  }> = [];
  breakBursts: BreakBurst[] = [];
  revision = 0;
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
    this.patterns = layout.fracturePatterns ?? {};
    this.motion = new StructureMotion(this.world, groundHeight);
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
    this.buildSupports();
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
        id: `prop_${this.props.length}`,
        body: b,
        collider,
        type: p.type,
        spawn: p.position,
        broken: false,
      };
      if (p.type === 'crate') {
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
        .setRotation({ x: qx, y: qy, z: qz, w: qw }),
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
      counted: false,
      supports: [],
    };
    if (definition.hidden) body.setEnabled(false);
    this.pieces.push(piece);
    const siblings = this.groups.get(definition.group) ?? [];
    siblings.push(piece);
    this.groups.set(definition.group, siblings);
    this.breakableColliders.set(collider.handle, piece);
    return piece;
  }
  source(piece: Piece): BreakSource {
    const d = piece.definition;
    return {
      id: d.id,
      kind: d.kind,
      position: { ...piece.body.translation() },
      rotation: { ...piece.body.rotation() },
      half: { x: d.half[0], y: d.half[1], z: d.half[2] },
    };
  }
  markBroken(piece: Piece) {
    if (!piece.counted) {
      piece.counted = true;
      this.brokenCount++;
    }
  }
  integrity(piece: Piece) {
    if (piece.state === 'intact') return 1;
    if (piece.state === 'damaged' && piece.cells)
      return piece.cells.filter((c) => c.intact).length / piece.cells.length;
    return 0;
  }
  buildSupports() {
    for (const group of this.groups.values())
      for (const piece of group) {
        const d = piece.definition;
        if (!d.group.startsWith('house_') || d.kind === 'foundation') continue;
        // Ground-floor walls are anchored to the ground; the raised plinth is a cosmetic slab.
        if (d.kind === 'wall' && d.level === 0) continue;
        let candidates = group.filter(
          (p) =>
            p !== piece &&
            (d.kind === 'wall' && d.level === 0
              ? p.definition.kind === 'foundation'
              : d.kind === 'wall' || d.kind === 'floor'
                ? p.definition.kind === 'wall' && p.definition.level === 0
                : d.kind === 'detail'
                  ? p.definition.kind === 'wall' &&
                    p.definition.level === d.level
                  : p.definition.kind === 'wall' && p.definition.level === 1),
        );
        candidates = candidates.sort(
          (a, b) =>
            Math.hypot(
              a.definition.position[0] - d.position[0],
              a.definition.position[2] - d.position[2],
            ) -
            Math.hypot(
              b.definition.position[0] - d.position[0],
              b.definition.position[2] - d.position[2],
            ),
        );
        if ((d.kind === 'wall' && d.level === 1) || d.kind === 'detail') {
          const own = candidates.find(
            (p) => p.definition.section === d.section,
          );
          const others = candidates.filter((p) => p !== own).slice(0, 2);
          piece.supports = own
            ? [
                { piece: own, weight: 0.76 },
                ...others.map((piece) => ({
                  piece,
                  weight: 0.24 / others.length,
                })),
              ]
            : [];
        } else
          piece.supports = candidates
            .slice(0, d.kind === 'floor' ? 5 : d.kind === 'wall' ? 1 : 4)
            .map((piece) => ({
              piece,
              weight:
                1 /
                Math.min(
                  candidates.length,
                  d.kind === 'floor' ? 5 : d.kind === 'wall' ? 1 : 4,
                ),
            }));
      }
  }
  updateSupports(group: string, velocity: Vec, origin: Vec) {
    this.settleWallCells(group, velocity);
    // Changes propagate only through local support links, never a whole-house percentage.
    const pieces = this.groups.get(group) ?? [];
    for (let pass = 0; pass < 3; pass++)
      for (const p of pieces) {
        if (!['intact', 'damaged'].includes(p.state) || !p.supports.length)
          continue;
        if (
          p.supports.reduce(
            (sum, s) => sum + this.integrity(s.piece) * s.weight,
            0,
          ) < 0.55
        )
          this.destroy(p, velocity, origin, true);
      }
  }
  activateCells(piece: Piece) {
    if (piece.cells) return;
    const pattern = this.patterns[piece.definition.fracture!];
    piece.collider.setEnabled(false);
    piece.cells = pattern.cells.map((_, index) => {
      const shape = cellShape(pattern, index);
      const desc = RAPIER.ColliderDesc.convexHull(
        new Float32Array(shape.vertices),
      )!;
      const collider = this.world.createCollider(
        desc
          .setTranslation(shape.center.x, shape.center.y, shape.center.z)
          .setCollisionGroups(INTACT_GROUPS)
          .setFriction(0.5),
        piece.body,
      );
      this.breakableColliders.set(collider.handle, piece);
      return { index, intact: true, collider };
    });
    piece.state = 'damaged';
  }
  releaseCell(
    piece: Piece,
    index: number,
    velocity: Vec,
    mode: 'impact' | 'collapse' | 'landing',
    position?: Vec,
    rotation?: BreakSource['rotation'],
  ) {
    const pattern = this.patterns[piece.definition.fracture!],
      shape = cellShape(pattern, index);
    const source = this.source(piece);
    source.position = position ?? source.position;
    source.rotation = rotation ?? source.rotation;
    const p = rotate(shape.center, source.rotation).add(source.position);
    source.position = { x: p.x, y: p.y, z: p.z };
    source.half = { x: shape.half.x, y: shape.half.y, z: shape.half.z };
    return this.motion.spawn(source, velocity, mode, index, shape.vertices);
  }
  damageWall(piece: Piece, velocity: Vec, point: Vec, normalSpeed: number) {
    const radius =
      normalSpeed >= 7
        ? TUNING.radius + 0.08 + Math.min(0.04, normalSpeed * 0.002)
        : 0.13;
    let changed = false;
    const siblings = this.groups.get(piece.definition.group) ?? [piece];
    for (const wall of siblings) {
      if (
        wall.definition.kind !== 'wall' ||
        !['intact', 'damaged'].includes(wall.state) ||
        !wall.definition.fracture
      )
        continue;
      const pattern = this.patterns[wall.definition.fracture],
        local = localPoint(
          point,
          wall.body.translation(),
          wall.body.rotation(),
        );
      const depth = pattern.axis === 0 ? local.z : local.x;
      if (Math.abs(depth) > pattern.depth + 0.12) continue;
      const u = pattern.axis === 0 ? local.x : local.z;
      const selected = pattern.cells
        .map((cell, index) => ({
          index,
          d: polygonDistance(cell.polygon, u, local.y),
        }))
        .filter(
          (c) => c.d <= radius && (!wall.cells || wall.cells[c.index].intact),
        );
      if (!selected.length) continue;
      this.activateCells(wall);
      this.markBroken(wall);
      for (const selectedCell of selected) {
        const cell = wall.cells![selectedCell.index];
        cell.intact = false;
        cell.collider.setEnabled(false);
        this.chippedCells++;
        this.releaseCell(wall, cell.index, velocity, 'impact');
        changed = true;
      }
      this.queueBurst(
        wall.definition.group,
        this.source(wall),
        velocity,
        point,
        'impact',
        0,
        true,
      );
      // Decorations that overlap the opened patch detach with it, including their colliders.
      for (const detail of siblings.filter(
        (p) => p.definition.kind === 'detail' && p.state === 'intact',
      )) {
        const p = localPoint(
            point,
            detail.body.translation(),
            detail.body.rotation(),
          ),
          h = detail.definition.half;
        if (
          Math.hypot(
            Math.max(0, Math.abs(p.x) - h[0]),
            Math.max(0, Math.abs(p.y) - h[1]),
            Math.max(0, Math.abs(p.z) - h[2]),
          ) <
          radius + 0.05
        )
          this.destroy(detail, velocity, point);
      }
    }
    if (changed) {
      this.updateSupports(piece.definition.group, velocity, point);
    }
    return changed;
  }
  settleWallCells(group: string, velocity: Vec) {
    const walls = (this.groups.get(group) ?? []).filter(
      (p) => p.definition.kind === 'wall' && p.definition.level === 0,
    );
    for (const wall of walls) {
      if (wall.state !== 'damaged' || !wall.cells) continue;
      const pattern = this.patterns[wall.definition.fracture!],
        section = wall.definition.section.split('_'),
        index = Number(section[1]);
      const left = walls.find(
          (p) => p.definition.section === `${section[0]}_${index - 1}`,
        ),
        right = walls.find(
          (p) => p.definition.section === `${section[0]}_${index + 1}`,
        );
      const connected = new Set<number>(),
        queue: number[] = [];
      for (const c of wall.cells)
        if (
          c.intact &&
          pattern.cells[c.index].polygon.some(
            ([x, y]) =>
              y < -pattern.height / 2 + 0.00001 ||
              (x < -pattern.width / 2 + 0.00001 &&
                left &&
                this.integrity(left) > 0.5) ||
              (x > pattern.width / 2 - 0.00001 &&
                right &&
                this.integrity(right) > 0.5),
          )
        ) {
          connected.add(c.index);
          queue.push(c.index);
        }
      while (queue.length) {
        const current = queue.pop()!,
          polygon = pattern.cells[current].polygon;
        for (const c of wall.cells)
          if (
            c.intact &&
            !connected.has(c.index) &&
            pattern.cells[c.index].polygon.filter((a) =>
              polygon.some(
                (b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.00001,
              ),
            ).length >= 2
          ) {
            connected.add(c.index);
            queue.push(c.index);
          }
      }
      for (const c of wall.cells)
        if (c.intact && !connected.has(c.index)) {
          c.intact = false;
          c.collider.setEnabled(false);
          this.releaseCell(wall, c.index, velocity, 'collapse');
        }
    }
  }
  takeBreakBursts() {
    const bursts = this.breakBursts;
    this.breakBursts = [];
    return bursts;
  }
  queueBurst(
    group: string,
    source: BreakSource,
    velocity: Vec,
    origin: Vec,
    mode: BreakBurst['mode'],
    wave = 0,
    retained = false,
  ) {
    let burst = this.breakBursts.find(
      (b) =>
        b.group === group &&
        b.mode === mode &&
        b.wave === wave &&
        !!b.retained === retained,
    );
    if (!burst) {
      if (this.breakBursts.length >= DESTRUCTION.maxBursts)
        this.breakBursts.shift();
      burst = {
        group,
        mode,
        wave,
        sources: [],
        velocity: { ...velocity },
        origin: { ...origin },
        retained,
      };
      this.breakBursts.push(burst);
    }
    burst.sources.push(source);
  }
  emitPiece(
    piece: Piece,
    velocity: Vec,
    origin: Vec,
    mode: BreakBurst['mode'],
    wave = 0,
  ) {
    const d = piece.definition;
    this.queueBurst(
      d.group,
      {
        id: d.id,
        kind: d.kind,
        position: { ...piece.body.translation() },
        rotation: { ...piece.body.rotation() },
        half: { x: d.half[0], y: d.half[1], z: d.half[2] },
      },
      velocity,
      origin,
      mode,
      wave,
    );
    piece.state = 'gone';
  }
  destroy(piece: Piece, velocity: Vec, origin: Vec, collapse = false) {
    if (!['intact', 'damaged'].includes(piece.state)) return;
    // Remove the original collider immediately; small fragments cannot become invisible walls.
    piece.body.setEnabled(false);
    piece.age = 0;
    this.markBroken(piece);
    if (collapse) {
      const wave =
        piece.definition.level >= 2 || piece.definition.kind === 'roof' ? 1 : 0;
      piece.state = 'collapsing';
      this.collapsing.push({
        piece,
        velocity: { ...velocity },
        origin: { ...origin },
        wave,
        delay: wave ? STRUCTURE.roofDelay : STRUCTURE.collapseDelay,
      });
    } else this.releasePiece(piece, velocity, origin, 'impact');
  }
  releasePiece(
    piece: Piece,
    velocity: Vec,
    origin: Vec,
    mode: 'impact' | 'collapse',
  ) {
    const retained = [
      'wall',
      'roof',
      'floor',
      'balcony',
      'detail',
      'car',
      'tree',
      'lamp',
      'bench',
      'tower',
      'foundation',
    ].includes(piece.definition.kind);
    if (!retained) {
      this.emitPiece(piece, velocity, origin, mode);
      return;
    }
    piece.state = 'debris';
    if (piece.cells) {
      for (const cell of piece.cells)
        if (cell.intact) {
          cell.intact = false;
          cell.collider.setEnabled(false);
          this.releaseCell(piece, cell.index, velocity, mode);
        }
      piece.state = 'gone';
    } else piece.motion = this.motion.spawn(this.source(piece), velocity, mode);
    this.queueBurst(
      piece.definition.group,
      this.source(piece),
      velocity,
      origin,
      mode,
      piece.definition.kind === 'roof' ? 1 : 0,
      true,
    );
    if (mode === 'collapse')
      this.soundEvents.push({
        kind: piece.definition.kind,
        phase: 'collapse',
        strength: 1,
      });
  }
  breakPiece(piece: Piece, velocity: Vec, origin: Vec) {
    if (!['intact', 'damaged'].includes(piece.state)) return;
    if (piece.definition.fracture) {
      const pattern = this.patterns[piece.definition.fracture];
      const v = localPoint(
        velocity,
        { x: 0, y: 0, z: 0 },
        piece.body.rotation(),
      );
      this.damageWall(
        piece,
        velocity,
        origin,
        Math.abs(pattern.axis === 0 ? v.z : v.x),
      );
      return;
    }
    this.destroy(piece, velocity, origin);
    const d = piece.definition;
    const siblings = this.groups.get(d.group)!;
    if (
      ['tree', 'lamp', 'bin', 'pot', 'bench', 'car', 'tower'].includes(d.kind)
    ) {
      for (const p of siblings)
        if (p.state === 'intact') this.destroy(p, velocity, origin);
    }
    this.updateSupports(d.group, velocity, origin);
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
    const count = this.brokenCount + this.chippedCells;
    for (const [target, impulse] of impacts) {
      if ('definition' in target) {
        let point: Vec = { ...origin };
        let normalSpeed = Math.hypot(velocity.x, velocity.z);
        let strongest = -1;
        const contacts = target.cells
          ? target.cells.filter((c) => c.intact).map((c) => c.collider)
          : [target.collider];
        for (const c of contacts)
          this.world.contactPair(this.ballCollider, c, (manifold) => {
            for (let i = 0; i < manifold.numSolverContacts(); i++) {
              const contact = manifold.solverContactPoint(i),
                strength = manifold.numContacts()
                  ? manifold.contactImpulse(0)
                  : 0;
              if (contact && strength > strongest) {
                point = { ...contact };
                strongest = strength;
                const n = manifold.normal();
                normalSpeed = Math.abs(
                  n.x * velocity.x + n.y * velocity.y + n.z * velocity.z,
                );
              }
            }
          });
        let wall = target;
        if (target.definition.kind === 'detail')
          wall =
            (this.groups.get(target.definition.group) ?? []).find(
              (p) =>
                p.definition.kind === 'wall' &&
                p.definition.section === target.definition.section &&
                p.definition.level === target.definition.level,
            ) ?? target;
        if (target !== wall && wall.definition.fracture) {
          const pattern = this.patterns[wall.definition.fracture],
            local = localPoint(
              point,
              wall.body.translation(),
              wall.body.rotation(),
            );
          local.setComponent(pattern.axis === 0 ? 2 : 0, 0);
          point = rotate(local, wall.body.rotation()).add(
            wall.body.translation(),
          );
        }
        if (
          wall.definition.fracture &&
          ['intact', 'damaged'].includes(wall.state) &&
          impulse >= 5 &&
          Math.hypot(velocity.x, velocity.z) >= 4
        ) {
          if (this.damageWall(wall, velocity, point, normalSpeed))
            this.soundEvents.push({
              kind: 'wall',
              phase: 'impact',
              strength: Math.min(1.6, normalSpeed / 16),
            });
        } else if (
          target.state === 'intact' &&
          impulse >= target.definition.strength
        ) {
          this.breakPiece(target, velocity, point);
          this.soundEvents.push({
            kind: target.definition.kind,
            phase: 'impact',
            strength: 1,
          });
        }
      } else if (!target.broken && impulse >= 5) {
        target.broken = true;
        const p = target.body.translation();
        const q = target.body.rotation();
        target.body.setEnabled(false);
        this.brokenCount++;
        this.soundEvents.push({ kind: 'crate', phase: 'impact', strength: 1 });
        this.queueBurst(
          target.id,
          {
            id: target.id,
            kind: target.type,
            position: { ...p },
            rotation: { ...q },
            half: { x: 0.5, y: 0.5, z: 0.5 },
          },
          velocity,
          origin,
          'impact',
        );
      }
    }
    if (this.brokenCount + this.chippedCells > count) {
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
    this.motion.beginStep();
    this.world.step(this.events);
    this.handleImpacts(impactVelocity, p);
    for (let i = this.collapsing.length - 1; i >= 0; i--) {
      const pending = this.collapsing[i];
      pending.piece.age += dt;
      if (pending.piece.age >= pending.delay) {
        this.releasePiece(
          pending.piece,
          pending.velocity,
          pending.origin,
          'collapse',
        );
        this.collapsing.splice(i, 1);
      }
    }
    for (const { chunk, speed } of this.motion.afterStep(dt)) {
      const piece = this.pieces.find(
        (p) => p.definition.id === chunk.source.id,
      );
      const landingPoint = {
        x: chunk.position.x,
        y: groundHeight(chunk.position.z) + 0.09,
        z: chunk.position.z,
      };
      this.queueBurst(
        piece?.definition.group ?? chunk.source.id,
        {
          ...chunk.source,
          position: landingPoint,
          half: { x: 0.45, y: 0.09, z: 0.45 },
        },
        chunk.velocity,
        landingPoint,
        'landing',
        0,
        true,
      );
      if (chunk.cellIndex === undefined)
        this.soundEvents.push({
          kind: chunk.source.kind,
          phase: 'landing',
          strength: Math.min(1.5, speed / 9),
        });
      if (
        piece?.definition.fracture &&
        chunk.cellIndex === undefined &&
        speed > 4.5
      ) {
        const pattern = this.patterns[piece.definition.fracture];
        this.motion.retire(chunk);
        piece.state = 'gone';
        for (let i = 0; i < pattern.cells.length; i++)
          this.releaseCell(
            piece,
            i,
            { x: chunk.velocity.x, y: 0, z: chunk.velocity.z },
            'landing',
            chunk.position,
            chunk.rotation,
          );
      }
    }
    for (const piece of this.pieces)
      if (piece.state === 'debris' && !piece.motion?.active)
        piece.state = 'gone';
    if (this.soundEvents.length > 32)
      this.soundEvents.splice(0, this.soundEvents.length - 32);
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
    this.motion.reset();
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
      for (const cell of piece.cells ?? []) {
        this.breakableColliders.delete(cell.collider.handle);
        this.world.removeCollider(cell.collider, false);
      }
      piece.cells = undefined;
      piece.motion = undefined;
      piece.counted = false;
      piece.collider.setEnabled(true);
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
    this.collapsing = [];
    this.breakBursts = [];
    this.revision++;
    this.brokenCount = 0;
    this.chippedCells = 0;
    this.soundEvents = [];
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

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { TownSimulation, TUNING } from '../lib/town/simulation.ts';
import { cellShape, rotate, STRUCTURE } from '../lib/town/structure.ts';
import { FractureEffects, FRAGMENTS } from '../lib/town/fracture.ts';
import { StructureVisuals } from '../lib/town/structure-visual.ts';
await RAPIER.init();
const layout = JSON.parse(
  readFileSync(new URL('../public/models/colliders.json', import.meta.url)),
);
const results = [];
function test(name, run, fixture = layout) {
  const sim = new TownSimulation(fixture);
  try {
    const measures = run(sim);
    results.push({ test: name, status: 'pass', ...measures });
    console.log('PASS', name, JSON.stringify(measures));
  } finally {
    sim.dispose();
  }
}
const ticks = (sim, n) => {
  for (let i = 0; i < n; i++) sim.step(0, 0);
};
const single = (rotation = [0, 0, 0, 1], height = 1.5) => ({
  fracturePatterns: layout.fracturePatterns,
  colliders: [{ kind: 'box', position: [-55, -0.5, 0], half: [15, 0.5, 15] }],
  props: [],
  houseCount: 1,
  pieces: [
    {
      id: 'test-wall',
      group: 'house_test',
      kind: 'wall',
      level: 0,
      section: 'front_0',
      position: [-55, height, 0],
      half: [0.94, 1.275, 0.12],
      rotation,
      fracture: 'front',
      strength: 16,
    },
  ],
});

test(
  'Authored cells exactly cover the wall with no gaps and retain closed convex volumes',
  () => {
    for (const pattern of Object.values(layout.fracturePatterns)) {
      let area = 0;
      for (let i = 0; i < pattern.cells.length; i++) {
        const p = pattern.cells[i].polygon;
        let a = 0;
        for (let j = 0; j < p.length; j++) {
          const next = p[(j + 1) % p.length];
          a += p[j][0] * next[1] - next[0] * p[j][1];
        }
        assert.ok(a > 0);
        area += a / 2;
        const shape = cellShape(pattern, i);
        assert.ok(
          RAPIER.ColliderDesc.convexHull(new Float32Array(shape.vertices)),
        );
        assert.ok(shape.half.y > 0 && shape.half.x > 0 && shape.half.z > 0);
      }
      assert.ok(Math.abs(area - pattern.width * pattern.height) < 0.00001);
    }
    return {
      patterns: 2,
      cellsPerWall: layout.fracturePatterns.front.cells.length,
    };
  },
  single(),
);

test(
  'A central strike makes a sphere-sized hole while surrounding wall cells remain',
  (sim) => {
    const wall = sim.pieces[0];
    sim.damageWall(wall, { x: 0, y: 0, z: 20 }, { x: -55, y: 1.5, z: 0 }, 20);
    ticks(sim, 1);
    const remaining = wall.cells.filter((c) => c.intact).length;
    assert.ok(
      remaining > 0 && remaining < wall.cells.length,
      `Expected a hole with a rim: ${remaining}`,
    );
    assert.equal(wall.collider.isEnabled(), false);
    assert.equal(
      sim.world.intersectionWithShape(
        { x: -55, y: 1.5, z: 0 },
        { x: 0, y: 0, z: 0, w: 1 },
        new RAPIER.Ball(0.72),
        undefined,
        (2 << 16) | 4,
      ),
      null,
    );
    const intact = wall.cells.find((c) => c.intact),
      center = cellShape(sim.patterns.front, intact.index).center.add(
        wall.body.translation(),
      );
    assert.ok(
      sim.world.intersectionWithShape(
        center,
        { x: 0, y: 0, z: 0, w: 1 },
        new RAPIER.Ball(0.03),
        undefined,
        (2 << 16) | 4,
      ),
    );
    return { remainingCells: remaining, removedCells: sim.chippedCells };
  },
  single(),
);

test(
  'A grazing corner strike removes fewer cells; a second strike expands the damage',
  (sim) => {
    const wall = sim.pieces[0];
    sim.damageWall(wall, { x: 18, y: 0, z: 4 }, { x: -55.83, y: 2.6, z: 0 }, 4);
    const graze = sim.chippedCells;
    assert.ok(graze > 0 && graze <= 3);
    const removed = new Set(
      wall.cells.filter((c) => !c.intact).map((c) => c.index),
    );
    sim.damageWall(wall, { x: 0, y: 0, z: 22 }, { x: -55, y: 1.5, z: 0 }, 22);
    assert.ok(sim.chippedCells > graze + 2);
    assert.ok([...removed].every((i) => !wall.cells[i].intact));
    return { grazingCells: graze, totalAfterStrongHit: sim.chippedCells };
  },
  single(),
);

test(
  'Contact-local damage and hole collision work on rotated walls',
  (sim) => {
    const wall = sim.pieces[0],
      point = rotate({ x: 0, y: -0.15, z: 0 }, wall.body.rotation()).add(
        wall.body.translation(),
      );
    sim.damageWall(wall, { x: 24, y: 0, z: 0 }, point, 24);
    ticks(sim, 1);
    assert.ok(wall.cells.some((c) => c.intact));
    assert.equal(
      sim.world.intersectionWithShape(
        point,
        { x: 0, y: 0, z: 0, w: 1 },
        new RAPIER.Ball(0.7),
        undefined,
        (2 << 16) | 4,
      ),
      null,
    );
    return { rotationDegrees: 90, removedCells: sim.chippedCells };
  },
  single([0, Math.SQRT1_2, 0, Math.SQRT1_2]),
);

test('Front support damage brings down the front storey first while the rear stays intact', (sim) => {
  const house = sim.groups.get('house_00'),
    velocity = { x: -12, y: 0, z: 0 };
  for (const p of house.filter(
    (p) =>
      p.definition.kind === 'wall' &&
      p.definition.level === 0 &&
      p.definition.section.startsWith('front'),
  ))
    sim.destroy(p, velocity, p.body.translation());
  sim.updateSupports('house_00', velocity, house[0].body.translation());
  assert.ok(
    house
      .filter(
        (p) =>
          p.definition.kind === 'wall' &&
          p.definition.level === 1 &&
          p.definition.section.startsWith('front'),
      )
      .every((p) => p.state === 'collapsing'),
  );
  assert.ok(
    house
      .filter(
        (p) =>
          p.definition.kind === 'wall' &&
          p.definition.section.startsWith('back'),
      )
      .every((p) => p.state === 'intact'),
  );
  const roof = house.find(
    (p) => p.definition.kind === 'roof' && p.state === 'collapsing',
  );
  assert.ok(roof);
  ticks(sim, 14);
  assert.equal(roof.state, 'collapsing');
  ticks(sim, 11);
  assert.equal(roof.state, 'debris');
  assert.ok(roof.motion.active && roof.motion.velocity.y < 0);
  assert.ok(
    roof.motion.source.half.x * roof.motion.source.half.z > 2,
    'Roof lost its original mass',
  );
  return { rearWallsIntact: true, fallingRoof: roof.definition.section };
});

test(
  'A falling wall keeps its full mesh until landing, then breaks into its own cells once',
  (sim) => {
    const wall = sim.pieces[0];
    sim.destroy(wall, { x: 0, y: 0, z: 1 }, wall.body.translation(), true);
    ticks(sim, 14);
    const original = wall.motion;
    assert.ok(original?.active);
    assert.equal(original.cellIndex, undefined);
    let steps = 14;
    while (original.active && steps < 150) {
      ticks(sim, 1);
      steps++;
    }
    assert.equal(original.active, false);
    assert.ok(sim.motion.chunks.some((c) => c.cellIndex !== undefined));
    assert.ok(
      sim.soundEvents.some((e) => e.phase === 'landing' && e.kind === 'wall'),
    );
    ticks(sim, 300);
    assert.equal(sim.motion.chunks.length, 0);
    return { firstLandingSeconds: steps / 60, allChunksExpired: true };
  },
  single([0, 0, 0, 1], 5),
);

test('Heavy destruction respects shared physics caps and reset clears holes, debris and delayed collapse', (sim) => {
  const effects = new FractureEffects(sim.world, new THREE.Scene(), () => 0);
  const originalBodies = sim.world.bodies.len(),
    originalColliders = sim.world.colliders.len();
  try {
    for (const p of sim.pieces
      .filter((p) => p.definition.fracture)
      .slice(0, 80))
      sim.damageWall(p, { x: 15, y: 0, z: 15 }, p.body.translation(), 24);
    for (let i = 0; i < 150; i++) {
      effects.beginStep();
      sim.step(0, 0);
      effects.afterStep(TUNING.step, sim.takeBreakBursts());
      assert.ok(
        sim.motion.slots.filter((s) => s.chunk).length +
          effects.getStats().physicsBodies <=
          24,
      );
      assert.ok(sim.motion.chunks.length <= STRUCTURE.maxChunks);
      assert.ok(
        effects.fragments.filter((f) => f.active).length <= FRAGMENTS.capacity,
      );
    }
    sim.reset();
    effects.reset();
    ticks(sim, 60);
    assert.equal(sim.world.bodies.len(), originalBodies);
    assert.equal(sim.world.colliders.len(), originalColliders);
    assert.equal(sim.motion.chunks.length, 0);
    assert.equal(sim.collapsing.length, 0);
    assert.equal(sim.chippedCells, 0);
    assert.ok(
      sim.pieces.every(
        (p) => p.state === 'intact' && !p.cells && p.collider.isEnabled(),
      ),
    );
    return {
      bodyLimit: 24,
      structuralLimit: STRUCTURE.maxChunks,
      visualLimit: FRAGMENTS.capacity,
      resetLeaks: 0,
    };
  } finally {
    effects.dispose();
  }
});

test(
  'Cell rendering uses opaque geometry, draws the matching remaining cells and clears on reset',
  (sim) => {
    const scene = new THREE.Scene(),
      visuals = new StructureVisuals(sim, scene),
      wall = sim.pieces[0];
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(
        Array.from({ length: 24 }, () => [1, 0.7, 0.1]).flat(),
        3,
      ),
    );
    const material = new THREE.MeshStandardMaterial({ vertexColors: true });
    visuals.register(wall.definition.id, new THREE.Mesh(geometry, material));
    try {
      sim.damageWall(wall, { x: 0, y: 0, z: 20 }, { x: -55, y: 1.5, z: 0 }, 20);
      visuals.render(1);
      assert.equal(
        [...visuals.meshes.values()].reduce((n, m) => n + m.count, 0),
        wall.cells.length,
      );
      assert.ok(
        [...visuals.meshes.values()].every(
          (m) =>
            !m.material.transparent &&
            m.material.opacity === 1 &&
            !m.castShadow &&
            !m.receiveShadow,
        ),
      );
      sim.reset();
      visuals.render(1);
      assert.ok(
        [...visuals.meshes.values()].every((m) => m.count === 0 && !m.visible),
      );
      return { opaque: true, resetHidden: true };
    } finally {
      visuals.dispose();
      geometry.dispose();
      material.dispose();
    }
  },
  single(),
);

writeFileSync(
  new URL('../art/structure-report.json', import.meta.url),
  JSON.stringify({ tests: results }, null, 2) + '\n',
);
console.log(`${results.length} structural destruction scenarios passed.`);

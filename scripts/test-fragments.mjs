import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  TownSimulation,
  TUNING,
  groundHeight,
} from '../lib/town/simulation.ts';
import { FractureEffects, FRAGMENTS } from '../lib/town/fracture.ts';

await RAPIER.init();
const layout = JSON.parse(
  readFileSync(new URL('../public/models/colliders.json', import.meta.url)),
);
const results = [];
function test(name, run) {
  const sim = new TownSimulation(layout);
  const scene = new THREE.Scene();
  const effects = new FractureEffects(sim.world, scene, groundHeight);
  const step = (count = 1, x = 0, z = 0) => {
    for (let i = 0; i < count; i++) {
      effects.beginStep();
      sim.step(x, z);
      effects.afterStep(TUNING.step, sim.takeBreakBursts());
    }
    effects.render(1);
  };
  try {
    const measures = run({ sim, scene, effects, step });
    results.push({ test: name, status: 'pass', ...measures });
    console.log('PASS', name, JSON.stringify(measures));
  } finally {
    effects.dispose();
    sim.dispose();
  }
}
const source = {
  id: 'sample',
  kind: 'wall',
  position: { x: -55, y: 3, z: 0 },
  half: { x: 1, y: 1, z: 0.2 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
};
const burst = {
  group: 'sample',
  mode: 'impact',
  wave: 0,
  sources: [source],
  velocity: { x: 24, y: 0, z: 0 },
  origin: { x: -56, y: 1, z: 0 },
};
const active = (effects) => effects.fragments.filter((f) => f.active);

test('A strike has three distinct scales, forward motion, and a two-sided fan', ({
  effects,
  step,
}) => {
  effects.emit(burst);
  const shards = active(effects);
  assert.equal(shards.length, 35);
  for (const tier of ['small', 'medium', 'large']) {
    const selected = shards.filter((f) => f.tier === tier);
    assert.ok(selected.some((f) => f.velocity.z < -1));
    assert.ok(selected.some((f) => f.velocity.z > 1));
    assert.ok(selected.reduce((n, f) => n + f.velocity.x, 0) > 0);
  }
  const average = (tier, field) => {
    const a = shards.filter((f) => f.tier === tier);
    return a.reduce((n, f) => n + field(f), 0) / a.length;
  };
  assert.ok(
    average('small', (f) => f.velocity.length()) >
      average('medium', (f) => f.velocity.length()),
  );
  assert.ok(
    average('medium', (f) => f.size.length()) <
      average('large', (f) => f.size.length()),
  );
  const small = shards.find((f) => f.tier === 'small'),
    before = Math.hypot(small.velocity.x, small.velocity.z);
  step(12);
  assert.ok(Math.hypot(small.velocity.x, small.velocity.z) < before * 0.4);
  step(36);
  assert.equal(
    active(effects).filter((f) => f.tier === 'small' && f.life > 0.5).length,
    0,
  );
  assert.ok(active(effects).some((f) => f.tier === 'medium'));
  assert.ok(active(effects).some((f) => f.tier === 'large'));
  return { initial: 35, remainingAfter0_8Seconds: effects.getStats() };
});

test('Shards inherit vertex colors and wood splinters use slim silhouettes', ({
  effects,
}) => {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const color = new THREE.Color('#d78732');
  geometry.setAttribute(
    'color',
    new THREE.Float32BufferAttribute(
      Array.from({ length: geometry.attributes.position.count }, () =>
        color.toArray(),
      ).flat(),
      3,
    ),
  );
  const material = new THREE.MeshBasicMaterial({ vertexColors: true });
  effects.registerSource(
    source.id,
    'crate',
    new THREE.Mesh(geometry, material),
  );
  effects.emit({ ...burst, sources: [{ ...source, kind: 'crate' }] });
  assert.ok(
    active(effects).every(
      (f) => f.family === 'wood' && f.size.x > f.size.y * 2,
    ),
  );
  assert.ok(
    active(effects).every(
      (f) => Math.abs(f.color.r / f.color.g - color.r / color.g) < 0.0001,
    ),
  );
  geometry.dispose();
  material.dispose();
  return { woodenShards: active(effects).length };
});

test('Only large chunks collide; their colliders fit shards and leave a wall breach passable', ({
  sim,
  effects,
  step,
}) => {
  sim.ball.setTranslation({ x: -5, y: groundHeight(-33) + 0.74, z: -33 }, true);
  sim.ball.setLinvel({ x: -32, y: 0, z: 0 }, true);
  sim.lastPosition = sim.ball.translation();
  step(24, -1, 0);
  assert.ok(sim.brokenCount > 0);
  assert.ok(
    sim.ball.translation().x < -12.25,
    'Shards blocked the opened wall',
  );
  for (const f of active(effects)) {
    if (f.body) assert.equal(f.tier, 'large');
    if (f.body) {
      const h = f.body.collider.halfExtents();
      assert.ok(Math.abs(h.x * 2 - f.size.x) < 0.00001);
      assert.ok(Math.abs(h.y * 2 - f.size.y) < 0.00001);
      assert.ok(f.body.body.mass() < 0.5);
    }
  }
  const house = sim.groups.get('house_00');
  assert.ok(house.some((p) => p.state === 'intact'));
  assert.ok(
    house
      .filter((p) => p.state !== 'intact')
      .every(
        (p) =>
          !p.body.isEnabled() ||
          (p.state === 'damaged' && !p.collider.isEnabled()),
      ),
  );
  return { ballX: sim.ball.translation().x, fragments: effects.getStats() };
});

test('Retained walls use bounded chips while the structural simulation carries their mass', ({
  effects,
}) => {
  effects.emit({ ...burst, retained: true });
  assert.equal(active(effects).length, 25);
  assert.equal(effects.getStats().large, 0);
  effects.emit({ ...burst, retained: true, mode: 'collapse' });
  assert.equal(active(effects).length, 35);
  effects.emit({ ...burst, retained: true, mode: 'landing' });
  assert.equal(active(effects).length, 53);
  assert.equal(effects.getStats().physicsBodies, 0);
  return { impactChips: 25, collapseChips: 10, landingChips: 18 };
});

test('Repeated hits and many buildings respect global particle and rigid-body caps', ({
  effects,
  step,
  scene,
}) => {
  for (let i = 0; i < 40; i++) effects.emit(burst);
  assert.equal(
    active(effects).length,
    56,
    'Repeated panels multiplied the group burst',
  );
  for (let i = 0; i < 60; i++) effects.emit({ ...burst, group: `stress_${i}` });
  assert.equal(active(effects).length, FRAGMENTS.capacity);
  assert.equal(effects.getStats().physicsBodies, FRAGMENTS.physicsBodies);
  effects.render(1);
  assert.equal(
    [...effects.meshes.values()].reduce((n, m) => n + m.count, 0),
    FRAGMENTS.capacity,
  );
  assert.equal(scene.children.length, 4);
  for (const mesh of effects.meshes.values()) {
    assert.equal(mesh.material.transparent, false);
    assert.equal(mesh.material.opacity, 1);
    assert.equal(mesh.castShadow, false);
    assert.equal(mesh.receiveShadow, false);
  }
  step(240);
  assert.equal(active(effects).length, 0);
  assert.equal(effects.getStats().physicsBodies, 0);
  assert.ok(
    [...effects.meshes.values()].every((m) => m.count === 0 && !m.visible),
  );
  assert.ok(effects.bodies.every((b) => !b.body.isEnabled()));
  assert.equal(effects.budgets.size, 0);
  return {
    maxFragments: FRAGMENTS.capacity,
    maxBodies: FRAGMENTS.physicsBodies,
    emptyAfterSeconds: 4,
  };
});

test('Reset cancels delayed collapses and pooled bodies never create ghost debris', ({
  sim,
  effects,
  step,
}) => {
  const house = sim.groups.get('house_00');
  for (const p of house.filter(
    (p) => p.definition.kind === 'wall' && p.definition.level === 0,
  ))
    sim.destroy(p, burst.velocity, burst.origin);
  sim.updateSupports('house_00', burst.velocity, burst.origin);
  step(1);
  assert.ok(sim.collapsing.length > 0);
  sim.reset();
  effects.reset();
  step(60);
  assert.equal(active(effects).length, 0);
  assert.equal(sim.collapsing.length, 0);
  assert.equal(sim.brokenCount, 0);
  assert.ok(
    sim.pieces.every(
      (p) => p.state === 'intact' && p.body.isFixed() && p.body.isEnabled(),
    ),
  );
  effects.emit(burst);
  assert.equal(effects.getStats().physicsBodies, 3);
  assert.ok(
    active(effects).every((f) => Number.isFinite(f.position.x + f.velocity.y)),
  );
  return { restoredParts: sim.pieces.length, pooledBodiesReusable: true };
});

test('Fragment motion is identical at 30, 60, and 144 Hz rendering', () => {
  const snapshots = [];
  for (const rate of [30, 60, 144]) {
    const sim = new TownSimulation(layout),
      effects = new FractureEffects(sim.world, new THREE.Scene(), groundHeight);
    try {
      effects.emit(burst);
      let accumulator = 0,
        steps = 0;
      for (let frame = 0; frame < rate; frame++) {
        accumulator += 1 / rate;
        while (accumulator + 1e-12 >= TUNING.step) {
          effects.beginStep();
          sim.step(0, 0);
          effects.afterStep(TUNING.step, sim.takeBreakBursts());
          accumulator -= TUNING.step;
          steps++;
        }
        effects.render(Math.max(0, accumulator / TUNING.step));
      }
      assert.equal(steps, 60);
      snapshots.push(
        active(effects).map((f) => [f.tier, ...f.position.toArray()]),
      );
    } finally {
      effects.dispose();
      sim.dispose();
    }
  }
  assert.deepEqual(snapshots[0], snapshots[1]);
  assert.deepEqual(snapshots[0], snapshots[2]);
  return { renderRates: [30, 60, 144], fixedSteps: 60 };
});

writeFileSync(
  new URL('../art/fragments-report.json', import.meta.url),
  JSON.stringify({ tests: results }, null, 2) + '\n',
);
console.log(`${results.length} fragmentation scenarios passed.`);

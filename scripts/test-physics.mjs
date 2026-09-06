import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  TownSimulation,
  TUNING,
  groundHeight,
  DESTRUCTION,
} from '../lib/town/simulation.ts';

await RAPIER.init();
const layout = JSON.parse(
  readFileSync(new URL('../public/models/colliders.json', import.meta.url)),
);
const results = [];
const tick = (sim, n, x = 0, z = 0, brake = false) => {
  for (let i = 0; i < n; i++) sim.step(x, z, brake);
};
function place(sim, x, y, z, vx = 0, vy = 0, vz = 0) {
  sim.ball.setTranslation({ x, y, z }, true);
  sim.ball.setLinvel({ x: vx, y: vy, z: vz }, true);
  sim.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
  sim.lastPosition = { x, y, z };
  sim.groundGrace = 0;
  sim.jumpQueued = 0;
}
function test(name, fn) {
  const sim = new TownSimulation(layout);
  try {
    const measures = fn(sim);
    results.push({ test: name, status: 'pass', ...measures });
    console.log('PASS', name, JSON.stringify(measures));
  } finally {
    sim.dispose();
  }
}
test('Downhill ground contact stays stable for ten seconds', (sim) => {
  let minClearance = Infinity;
  for (let i = 0; i < 600; i++) {
    sim.step(0, 0);
    const p = sim.ball.translation();
    minClearance = Math.min(minClearance, p.y - groundHeight(p.z));
    assert.ok(Number.isFinite(p.x + p.y + p.z));
  }
  assert.ok(minClearance > 0.6, `Ball penetrated ground: ${minClearance}`);
  return {
    minimumClearance: Math.round(minClearance * 1000) / 1000,
    position: sim.ball.translation(),
  };
});
test('Acceleration, turning, and braking respond on flat ground', (sim) => {
  place(sim, -55, 0.9, 0);
  tick(sim, 30);
  tick(sim, 90, 0, 1);
  const velocity = sim.ball.linvel(),
    speed = Math.hypot(velocity.x, velocity.z);
  assert.ok(speed > 17 && speed < 32, `Unexpected acceleration: ${speed}`);
  tick(sim, 60, 1, 0);
  assert.ok(
    sim.ball.linvel().x > 10,
    'Steering did not change travel direction',
  );
  tick(sim, 60, 0, 0, true);
  const stopped = sim.ball.linvel();
  assert.ok(Math.hypot(stopped.x, stopped.z) < 0.1, 'Brake failed');
  return {
    speedAfter1_5Seconds: Math.round(speed * 3.6),
    speedAfterBraking: Math.hypot(stopped.x, stopped.z),
  };
});
test('Jump has useful height, cannot double-jump, and lands', (sim) => {
  place(sim, -55, 0.9, 0);
  tick(sim, 40);
  const floor = sim.ball.translation().y;
  sim.queueJump();
  let apex = floor;
  for (let i = 0; i < 110; i++) {
    if (i === 12) sim.queueJump();
    sim.step(0, 0);
    apex = Math.max(apex, sim.ball.translation().y);
  }
  assert.equal(sim.jumps, 1, 'Mid-air button press created a second jump');
  assert.ok(apex - floor > 1.5 && apex - floor < 2.2);
  assert.ok(Math.abs(sim.ball.translation().y - floor) < 0.08);
  assert.ok(sim.grounded);
  return {
    jumpHeight: Math.round((apex - floor) * 100) / 100,
    jumps: sim.jumps,
  };
});
test('Buffered jump fires just after landing', (sim) => {
  place(sim, -55, 1.1, 0, 0, -4, 0);
  sim.queueJump();
  tick(sim, 10);
  assert.equal(sim.jumps, 1);
  assert.ok(sim.ball.linvel().y > 0);
  return { jumps: sim.jumps };
});
test('A fast ball breaches separate facade panels', (sim) => {
  place(sim, -5, groundHeight(-33) + 0.74, -33, -32, 0, 0);
  for (let i = 0; i < 24; i++) {
    sim.step(-1, 0);
  }
  const house = sim.groups.get('house_00');
  const broken = house.filter((p) => p.state !== 'intact').length;
  assert.ok(broken > 0, 'Impact did not break the facade');
  assert.ok(
    broken < house.length / 2,
    'A single strike deleted the entire house',
  );
  assert.ok(
    sim.ball.translation().x < -12.25,
    'An invisible wall remained after the breach',
  );
  assert.ok(
    sim.breakBursts.some((b) => b.mode === 'impact' && b.velocity.x < -10),
  );
  assert.ok(
    house
      .filter((p) => p.state !== 'intact')
      .every(
        (p) =>
          !p.body.isEnabled() ||
          (p.state === 'damaged' && !p.collider.isEnabled()),
      ),
  );
  return {
    brokenPanels: broken,
    remainingPanels: house.length - broken,
    ballX: sim.ball.translation().x,
  };
});
test('A gentle bump moves a crate without shattering it', (sim) => {
  const crate = sim.props.find((p) => p.type === 'crate' && p.spawn[0] === 29);
  assert.ok(crate);
  tick(sim, 30);
  const before = crate.body.translation();
  place(sim, 29, 0.74, 19.5, 0, 0, 1.5);
  tick(sim, 55);
  const after = crate.body.translation(),
    moved = Math.hypot(after.x - before.x, after.z - before.z);
  assert.ok(moved > 0.02, 'Crate did not move');
  assert.equal(crate.broken, false);
  return { crateTravel: moved };
});
test('A fast crate impact replaces the crate with a wood fracture event', (sim) => {
  const crate = sim.props.find((p) => p.type === 'crate' && p.spawn[0] === 29);
  tick(sim, 30);
  place(sim, 29, 0.74, 17, 0, 0, 18);
  tick(sim, 24, 0, 1);
  assert.equal(crate.broken, true);
  assert.equal(crate.body.isEnabled(), false);
  const burst = sim.takeBreakBursts().find((b) => b.group === crate.id);
  assert.equal(burst.sources[0].kind, 'crate');
  assert.ok(burst.velocity.z > 10);
  return { replacementSources: burst.sources.length };
});

test('Unbroken walls stop a low-speed push', (sim) => {
  place(sim, -11, groundHeight(-33) + 0.75, -33, -1, 0, 0);
  tick(sim, 100, -0.08, 0);
  const house = sim.groups.get('house_00');
  assert.ok(sim.ball.translation().x > -12.7);
  assert.equal(house.filter((p) => p.state !== 'intact').length, 0);
  return { ballX: sim.ball.translation().x };
});

test('Losing supporting walls collapses upper storeys and the roof', (sim) => {
  const house = sim.groups.get('house_00');
  const supports = house.filter(
    (p) => p.definition.kind === 'wall' && p.definition.level === 0,
  );
  const velocity = { x: 12, y: 0, z: 0 },
    origin = sim.ball.translation();
  for (const p of supports) sim.destroy(p, velocity, origin);
  sim.updateSupports('house_00', velocity, origin);
  assert.ok(
    house
      .filter((p) => p.definition.kind === 'wall')
      .every((p) => p.state !== 'intact'),
  );
  assert.ok(
    house.some((p) => p.definition.kind === 'roof' && p.state === 'collapsing'),
  );
  sim.takeBreakBursts();
  tick(sim, 14);
  assert.ok(
    sim.takeBreakBursts().some((b) => b.mode === 'collapse' && b.wave === 0),
  );
  assert.ok(
    house.some((p) => p.definition.kind === 'roof' && p.state === 'collapsing'),
  );
  tick(sim, 12);
  assert.ok(
    sim.takeBreakBursts().some((b) => b.mode === 'collapse' && b.wave === 1),
  );
  assert.ok(
    house
      .filter((p) => p.definition.kind === 'roof')
      .every((p) => p.state === 'debris' && p.motion?.velocity.y < 0),
  );
  return { collapsedParts: house.length };
});

test('Break events are bounded and reset restores every original collider', (sim) => {
  const velocity = { x: 10, y: 0, z: 0 },
    origin = sim.ball.translation();
  for (const p of sim.pieces.slice(0, 200))
    if (p.state === 'intact') sim.destroy(p, velocity, origin);
  assert.ok(sim.breakBursts.length <= DESTRUCTION.maxBursts);
  assert.equal(sim.pieces.filter((p) => p.body.isDynamic()).length, 0);
  place(sim, -65, 0.74, 0);
  tick(sim, 60, 0, 0, true);
  assert.equal(sim.collapsing.length, 0);
  for (const p of sim.pieces.filter((p) => p.state === 'gone'))
    assert.equal(p.body.isEnabled(), false);
  sim.reset();
  assert.equal(sim.takeBreakBursts().length, 0);
  assert.equal(sim.brokenCount, 0);
  assert.ok(
    sim.pieces
      .filter((p) => !p.definition.hidden)
      .every(
        (p) => p.state === 'intact' && p.body.isEnabled() && p.body.isFixed(),
      ),
  );
  for (const p of sim.pieces) {
    const position = p.body.translation(),
      spawn = p.definition.position;
    assert.ok(
      Math.hypot(
        position.x - spawn[0],
        position.y - spawn[1],
        position.z - spawn[2],
      ) < 0.0001,
    );
  }
  return {
    restoredParts: sim.pieces.length,
    maxQueuedBursts: DESTRUCTION.maxBursts,
  };
});

test('Street ramp sends a rolling ball into the air', (sim) => {
  place(sim, 0, 0.75, 13, 0, 0, 22);
  let height = 0,
    airborneBeyondRamp = false;
  for (let i = 0; i < 100; i++) {
    sim.step(0, 1);
    const p = sim.ball.translation();
    height = Math.max(height, p.y - 0.72);
    if (p.z > 27 && p.y > 1.8 && !sim.grounded) airborneBeyondRamp = true;
  }
  assert.ok(airborneBeyondRamp, 'Ramp did not produce an airborne exit');
  assert.ok(height > 1.7);
  return { maxHeight: height };
});
test('Reset restores ball, counters, and movable props', (sim) => {
  tick(sim, 100, 0, 1);
  sim.queueJump();
  tick(sim, 10, 1, 0);
  sim.reset();
  assert.equal(sim.distance, 0);
  assert.equal(sim.jumps, 0);
  assert.equal(sim.ball.translation().z, -37);
  assert.equal(sim.ball.linvel().z, 0);
  for (const p of sim.props) {
    const now = p.body.translation();
    assert.ok(
      Math.abs(now.x - p.spawn[0]) < 0.00001 &&
        Math.abs(now.y - p.spawn[1]) < 0.00001 &&
        Math.abs(now.z - p.spawn[2]) < 0.00001,
    );
  }
  return { propsRestored: sim.props.length };
});
test('30, 60, and 144 Hz render schedules produce the same physics', () => {
  const positions = [];
  for (const rate of [30, 60, 144]) {
    const sim = new TownSimulation(layout);
    try {
      let accumulator = 0,
        steps = 0;
      for (let frame = 0; frame < rate * 6; frame++) {
        accumulator += 1 / rate;
        while (accumulator + 1e-12 >= TUNING.step) {
          sim.step(Math.sin(steps * 0.008) * 0.3, 1);
          accumulator -= TUNING.step;
          steps++;
        }
      }
      assert.equal(steps, 360);
      positions.push(sim.ball.translation());
    } finally {
      sim.dispose();
    }
  }
  for (const p of positions)
    assert.ok(
      Math.hypot(
        p.x - positions[0].x,
        p.y - positions[0].y,
        p.z - positions[0].z,
      ) < 0.00001,
    );
  return { rates: [30, 60, 144], position: positions[0] };
});
writeFileSync(
  new URL('../art/physics-report.json', import.meta.url),
  JSON.stringify(
    { engine: 'Rapier', fixedStep: TUNING.step, tests: results },
    null,
    2,
  ) + '\n',
);
console.log(`${results.length} physics scenarios passed.`);

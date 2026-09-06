import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { OrbitInput, screenToWorld, CAMERA } from '../lib/town/controls.ts';
import { TownSimulation } from '../lib/town/simulation.ts';

await RAPIER.init();
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.000001);
for (const [yaw, forward, right] of [
  [0, [0, 1], [-1, 0]],
  [Math.PI / 2, [1, 0], [0, 1]],
  [Math.PI, [0, -1], [1, 0]],
  [-Math.PI / 2, [-1, 0], [0, -1]],
]) {
  const f = screenToWorld(0, 1, yaw),
    r = screenToWorld(1, 0, yaw);
  near(f.x, forward[0]);
  near(f.z, forward[1]);
  near(r.x, right[0]);
  near(r.z, right[1]);
  const sim = new TownSimulation({
    colliders: [{ kind: 'terrain', xs: [-82, 82], zs: [-73, -49, -10, 74] }],
    props: [],
    houseCount: 0,
  });
  try {
    sim.ball.setTranslation({ x: -55, y: 0.8, z: 0 }, true);
    for (let i = 0; i < 30; i++) sim.step(0, 0);
    for (let i = 0; i < 60; i++) sim.step(f.x, f.z);
    const p = sim.ball.translation();
    assert.ok(
      (p.x + 55) * forward[0] + p.z * forward[1] > 6,
      'Camera-relative forward did not move the ball forward',
    );
  } finally {
    sim.dispose();
  }
}
console.log(
  'PASS steering follows all four camera headings in the real physics simulation.',
);

const orbit = new OrbitInput();
assert.ok(orbit.begin(7, 200, 200));
assert.equal(
  orbit.begin(8, 0, 0),
  false,
  'A second finger stole the camera gesture',
);
assert.equal(orbit.move(8, 100, 100, 400, 700), false);
near(orbit.yaw, 0);
orbit.end(8);
assert.equal(
  orbit.pointer.id,
  7,
  'Releasing the movement finger cancelled the camera finger',
);
orbit.move(7, 320, 200, 400, 700);
near(orbit.yaw, -Math.PI / 2);
orbit.move(7, 320, 2000, 400, 700);
near(orbit.pitch, CAMERA.minPitch);
orbit.move(7, 320, -2000, 400, 700);
near(orbit.pitch, CAMERA.maxPitch);
orbit.end(7);
assert.equal(orbit.pointer, null);
const yaw = orbit.yaw;
assert.equal(orbit.move(7, 600, 600, 400, 700), false);
near(orbit.yaw, yaw);
assert.ok(orbit.begin(19, 10, 10), 'A new touch could not acquire the camera');
orbit.cancel();
assert.equal(orbit.pointer, null);
orbit.reset();
near(orbit.yaw, 0);
near(orbit.pitch, CAMERA.pitch);
console.log(
  'PASS reversed horizontal/vertical swipes, separate pointer ownership, release, cancellation, vertical limits and camera reset.',
);

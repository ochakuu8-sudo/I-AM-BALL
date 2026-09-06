import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { OrbitInput, screenToWorld, CAMERA } from '../lib/town/controls.ts';
import { TownSimulation } from '../lib/town/simulation.ts';
import { CameraBoom, cameraFov } from '../lib/town/camera.ts';

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
near(orbit.yaw, Math.PI / 2);
orbit.move(7, 320, 2000, 400, 700);
near(orbit.pitch, CAMERA.maxPitch);
orbit.move(7, 320, -2000, 400, 700);
near(orbit.pitch, CAMERA.minPitch);
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
  'PASS separate pointer ownership, release, cancellation, vertical limits and camera reset.',
);

const cameraWorld = new RAPIER.World({ x: 0, y: 0, z: 0 });
try {
  const origin = { x: 0, y: 1.1, z: 0 };
  const behind = {
    x: 0,
    y: Math.sin(CAMERA.pitch),
    z: -Math.cos(CAMERA.pitch),
  };
  const wall = cameraWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  cameraWorld.createCollider(
    RAPIER.ColliderDesc.cuboid(5, 8, 0.2).setTranslation(0, 4, -4),
    wall,
  );
  cameraWorld.step();
  const camera = new CameraBoom();
  const close = camera.update(cameraWorld, origin, behind, 17, 1 / 60);
  assert.ok(
    close > 3 && close < 4,
    'A nearby wall must pull the camera in immediately',
  );
  const center = {
    x: origin.x + behind.x * close,
    y: origin.y + behind.y * close,
    z: origin.z + behind.z * close,
  };
  assert.equal(
    cameraWorld.intersectionWithShape(
      center,
      { x: 0, y: 0, z: 0, w: 1 },
      camera.probe,
    ),
    null,
    'Camera must stay outside the wall',
  );

  // A destroyed wall becomes a moving fragment; the camera must stop treating it as an obstruction.
  wall.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
  cameraWorld.step();
  const returning = camera.update(cameraWorld, origin, behind, 17, 1 / 60);
  assert.ok(
    returning > close && returning < 17,
    'Return after destruction must be smooth',
  );
  camera.reset();
  near(camera.update(cameraWorld, origin, behind, 17, 1 / 60), 17);

  // Returning to a solid wall after a fast swipe must never ease through it.
  wall.setBodyType(RAPIER.RigidBodyType.Fixed, true);
  cameraWorld.step();
  assert.ok(camera.update(cameraWorld, origin, behind, 17, 1 / 144) < 4);
  camera.reset();
  near(camera.update(cameraWorld, origin, { x: 1, y: 0, z: 0 }, 17, 0), 17);
  assert.ok(
    camera.update(cameraWorld, origin, behind, 17, 0) < 4,
    'Reset must respect walls even while paused',
  );

  wall.setEnabled(false);
  cameraWorld.step();
  const finalDistances = [30, 60, 144].map((rate) => {
    const boom = new CameraBoom();
    boom.distance = close;
    for (let i = 0; i < rate; i++)
      boom.update(cameraWorld, origin, behind, 17, 1 / rate);
    return boom.distance;
  });
  for (const distance of finalDistances) near(distance, finalDistances[0]);
  console.log(
    'PASS camera wall clearance, fast orbit, paused reset, ignored flying debris and frame-independent return.',
  );
} finally {
  cameraWorld.free();
}

const portraitAspect = 390 / 740;
const closeFov = cameraFov(2, portraitAspect, 0.72, 52);
const projectedBallWidth =
  0.72 / (2 * Math.tan((closeFov * Math.PI) / 360) * portraitAspect);
assert.ok(
  projectedBallWidth < 0.75,
  'Close portrait view must leave space around the ball',
);
near(cameraFov(17, portraitAspect, 0.72, 52), 52);
console.log(
  'PASS close portrait framing keeps the ball within the screen without changing the open-street view.',
);

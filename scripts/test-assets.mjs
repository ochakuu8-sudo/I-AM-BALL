import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const layout = JSON.parse(
  readFileSync(new URL('../public/models/colliders.json', import.meta.url)),
);
const bytes = readFileSync(
  new URL('../public/models/town.glb', import.meta.url),
);
const gltf = await new GLTFLoader().parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  '',
);
const definitions = new Map(layout.pieces.map((p) => [p.id, p]));
const found = new Set();
const geometry = new Set();
gltf.scene.updateMatrixWorld(true);
gltf.scene.traverse((mesh) => {
  if (!mesh.isMesh || !mesh.userData.pieceId) return;
  const d = definitions.get(mesh.userData.pieceId);
  assert.ok(d, `Missing physics part: ${mesh.name}`);
  assert.ok(!found.has(d.id), `Duplicate part ${d.id}`);
  found.add(d.id);
  geometry.add(mesh.geometry.uuid);
  const p = new THREE.Vector3(),
    q = new THREE.Quaternion(),
    s = new THREE.Vector3();
  mesh.matrixWorld.decompose(p, q, s);
  assert.ok(
    p.distanceTo(new THREE.Vector3(...d.position)) < 0.001,
    `Visual/physics position mismatch: ${d.id}`,
  );
  assert.ok(
    Math.abs(q.dot(new THREE.Quaternion(...d.rotation))) > 0.9999,
    `Rotation mismatch: ${d.id}`,
  );
  mesh.geometry.computeBoundingBox();
  const h = mesh.geometry.boundingBox
    .getSize(new THREE.Vector3())
    .multiply(s)
    .multiplyScalar(0.5);
  for (const [axis, i] of [
    ['x', 0],
    ['y', 1],
    ['z', 2],
  ])
    assert.ok(
      Math.abs(Math.max(0.045, h[axis]) - d.half[i]) < 0.001,
      `Collider size mismatch: ${d.id} ${axis}`,
    );
  assert.ok(
    mesh.geometry.getAttribute('color'),
    `Missing baked colours: ${d.id}`,
  );
});
assert.equal(found.size, definitions.size);
assert.ok(found.size > 500, 'The town is still a single scenic mesh');
assert.ok(geometry.size < 300, 'Repeated parts no longer share draw batches');
console.log(
  `PASS ${found.size} destructible meshes match their colliders; ${geometry.size} shared geometry batches.`,
);

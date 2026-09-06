import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  TownSimulation,
  TUNING,
  groundHeight,
  type Layout,
  type Piece,
} from './simulation';
import { registerGameTools } from './webmcp';
import { CAMERA, OrbitInput, screenToWorld } from './controls';
import { FractureEffects } from './fracture';
import { StructureVisuals } from './structure-visual';
export type GameStats = {
  speed: number;
  airborne: boolean;
  distance: number;
  fps: number;
  broken: number;
};
type Visual = {
  body: RAPIER.RigidBody;
  object: THREE.Object3D;
  prev: THREE.Vector3;
  prevQ: THREE.Quaternion;
  prop?: TownSimulation['props'][number];
};
type PieceVisual = {
  piece: Piece;
  mesh: THREE.InstancedMesh;
  index: number;
  scale: THREE.Vector3;
  renderedState: string;
};
export class TownGame {
  host: HTMLElement;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(52, 1, 0.12, 350);
  sun = new THREE.DirectionalLight(0xffffff, 3.0);
  sim!: TownSimulation;
  fracture!: FractureEffects;
  structureVisuals!: StructureVisuals;
  simulationRevision = 0;
  visuals: Visual[] = [];
  pieceVisuals: PieceVisual[] = [];
  orbit = new OrbitInput();
  matrix = new THREE.Matrix4();
  scaleTemp = new THREE.Vector3();
  previousImpact = 0;
  keys = new Set<string>();
  touch = { x: 0, z: 0 };
  brake = false;
  paused = false;
  muted = true;
  dead = false;
  raf = 0;
  last = 0;
  accumulator = 0;
  statsTime = 0;
  frameCount = 0;
  resizeObserver: ResizeObserver;
  audio: AudioContext | null = null;
  noise: AudioBuffer | null = null;
  soundGate = new Map<string, number>();
  soundVoices = 0;
  report: (s: GameStats) => void;
  reportPause: (v: boolean) => void;
  ballGroup = new THREE.Group();
  target = new THREE.Vector3();
  temp = new THREE.Vector3();
  qtemp = new THREE.Quaternion();
  cameraDirection = new THREE.Vector3();
  previousJump = 0;
  unregisterTools = () => {};
  onKeyDown = (e: KeyboardEvent) => {
    if (
      [
        'KeyW',
        'KeyA',
        'KeyS',
        'KeyD',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Space',
        'ShiftLeft',
        'ShiftRight',
        'KeyR',
        'KeyP',
        'KeyC',
      ].includes(e.code)
    ) {
      e.preventDefault();
      if (e.code === 'KeyP' && !e.repeat) this.setPaused(!this.paused);
      else if (e.code === 'KeyR' && !e.repeat) this.reset();
      else if (e.code === 'KeyC' && !e.repeat) this.resetCamera();
      else if (e.code === 'Space' && !e.repeat) this.jump();
      this.keys.add(e.code);
    }
  };
  onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  onBlur = () => {
    this.keys.clear();
    this.touch = { x: 0, z: 0 };
    this.brake = false;
    this.cancelOrbit();
    if (this.sim) this.setPaused(true);
  };
  onVisibility = () => {
    if (document.hidden) this.onBlur();
  };
  onContext = (e: Event) => e.preventDefault();
  onContextLost = (e: Event) => {
    e.preventDefault();
    this.setPaused(true);
  };
  onContextRestored = () => this.reset();
  onPointerDown = (e: PointerEvent) => {
    if (
      this.paused ||
      !this.sim ||
      (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2)
    )
      return;
    if (this.orbit.begin(e.pointerId, e.clientX, e.clientY)) {
      e.preventDefault();
      this.renderer.domElement.setPointerCapture(e.pointerId);
      this.renderer.domElement.style.cursor = 'grabbing';
    }
  };
  onPointerMove = (e: PointerEvent) => {
    if (
      this.orbit.move(
        e.pointerId,
        e.clientX,
        e.clientY,
        this.host.clientWidth,
        this.host.clientHeight,
      )
    )
      e.preventDefault();
  };
  onPointerUp = (e: PointerEvent) => {
    this.orbit.end(e.pointerId);
    if (this.renderer.domElement.hasPointerCapture(e.pointerId))
      this.renderer.domElement.releasePointerCapture(e.pointerId);
    if (!this.orbit.pointer) this.renderer.domElement.style.cursor = 'grab';
  };
  cancelOrbit() {
    const id = this.orbit.pointer?.id;
    this.orbit.cancel();
    if (id !== undefined && this.renderer.domElement.hasPointerCapture(id))
      this.renderer.domElement.releasePointerCapture(id);
    this.renderer.domElement.style.cursor = 'grab';
  }
  constructor(
    host: HTMLElement,
    report: (s: GameStats) => void,
    reportPause: (v: boolean) => void,
  ) {
    this.host = host;
    this.report = report;
    this.reportPause = reportPause;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(
      Math.min(
        window.devicePixelRatio,
        matchMedia('(pointer:coarse)').matches ? 1.4 : 1.8,
      ),
    );
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.host.appendChild(this.renderer.domElement);
    this.renderer.domElement.tabIndex = 0;
    this.scene.background = new THREE.Color('#68c9f5');
    this.scene.fog = new THREE.Fog('#68c9f5', 125, 260);
    this.scene.add(new THREE.HemisphereLight(0xe5f4ff, 0x568840, 1.1));
    this.sun.position.set(-35, 60, -20);
    this.scene.add(this.sun, this.sun.target);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }
  resize() {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  async init() {
    const loader = new GLTFLoader();
    const model = (file: string) =>
      `./models/${file}?v=${__TOWN_ASSET_VERSION__}`;
    const [_, gltf, layout, crate, cone] = await Promise.all([
      RAPIER.init(),
      loader.loadAsync(model('town.glb')),
      fetch(model('colliders.json')).then((r) => {
        if (!r.ok) throw Error('街のデータを読み込めませんでした');
        return r.json() as Promise<Layout>;
      }),
      loader.loadAsync(model('crate.glb')),
      loader.loadAsync(model('cone.glb')),
    ]);
    if (this.dead) return;
    this.sim = new TownSimulation(layout);
    this.fracture = new FractureEffects(
      this.sim.world,
      this.scene,
      groundHeight,
    );
    this.structureVisuals = new StructureVisuals(this.sim, this.scene);
    this.createPieceVisuals(gltf.scene);
    this.scene.add(gltf.scene);
    this.createBall();
    this.scene.add(this.ballGroup);
    this.addVisual(this.sim.ball, this.ballGroup);
    for (const p of this.sim.props) {
      const object = (p.type === 'cone' ? cone : crate).scene.clone(true);
      this.fracture.registerSource(p.id, p.type, object);
      this.scene.add(object);
      this.addVisual(p.body, object);
      this.visuals[this.visuals.length - 1].prop = p;
    }
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.host.addEventListener('contextmenu', this.onContext);
    const canvas = this.renderer.domElement;
    canvas.style.cursor = 'grab';
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('lostpointercapture', this.onPointerUp);
    this.renderer.domElement.addEventListener(
      'webglcontextlost',
      this.onContextLost,
    );
    this.renderer.domElement.addEventListener(
      'webglcontextrestored',
      this.onContextRestored,
    );
    this.reset();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    this.unregisterTools = registerGameTools(this);
  }
  createBall() {
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(TUNING.radius, 40, 28),
      new THREE.MeshStandardMaterial({
        color: '#f64042',
        roughness: 0.3,
        metalness: 0.1,
      }),
    );
    this.ballGroup.add(sphere);
    const stripe = new THREE.MeshStandardMaterial({
      color: '#fff9e7',
      roughness: 0.35,
      metalness: 0.05,
    });
    for (const rotation of [0, Math.PI / 2]) {
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(TUNING.radius - 0.018, 0.063, 8, 72),
        stripe,
      );
      band.rotation.y = rotation;
      this.ballGroup.add(band);
    }
    const capMat = new THREE.MeshStandardMaterial({
      color: '#163956',
      roughness: 0.3,
    });
    for (const y of [-1, 1]) {
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 16, 12),
        capMat,
      );
      cap.scale.y = 0.23;
      cap.position.y = y * (TUNING.radius - 0.01);
      this.ballGroup.add(cap);
    }
  }
  createPieceVisuals(root: THREE.Object3D) {
    const byId = new Map(this.sim.pieces.map((p) => [p.definition.id, p]));
    const batches = new Map<
      string,
      Array<{ source: THREE.Mesh; piece: Piece; scale: THREE.Vector3 }>
    >();
    root.updateMatrixWorld(true);
    const sources: THREE.Mesh[] = [];
    root.traverse((o) => {
      if (o instanceof THREE.Mesh && typeof o.userData.pieceId === 'string')
        sources.push(o);
    });
    for (const source of sources) {
      const piece = byId.get(source.userData.pieceId);
      if (!piece) throw Error(`Missing collider for ${source.name}`);
      this.structureVisuals.register(piece.definition.id, source);
      this.fracture.registerSource(
        piece.definition.id,
        piece.definition.kind,
        source,
      );
      const scale = new THREE.Vector3();
      source.matrixWorld.decompose(
        new THREE.Vector3(),
        new THREE.Quaternion(),
        scale,
      );
      const key =
        source.geometry.uuid +
        (Array.isArray(source.material)
          ? source.material.map((m) => m.uuid).join()
          : source.material.uuid);
      const list = batches.get(key) ?? [];
      list.push({ source, piece, scale });
      batches.set(key, list);
      source.removeFromParent();
    }
    for (const list of batches.values()) {
      if (!list.length) continue;
      const source = list[0].source;
      const mesh = new THREE.InstancedMesh(
        source.geometry,
        source.material,
        list.length,
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = true;
      this.scene.add(mesh);
      list.forEach(({ piece, scale }, index) => {
        this.pieceVisuals.push({
          piece,
          mesh,
          index,
          scale,
          renderedState: '',
        });
      });
    }
    if (
      sources.length !==
      this.sim.pieces.filter((p) => !p.definition.hidden).length
    )
      throw Error('Some town parts have no visible mesh.');
    this.updatePieceVisuals();
  }
  updatePieceVisuals(alpha = 1) {
    const changed = new Set<THREE.InstancedMesh>();
    for (const v of this.pieceVisuals) {
      const p = v.piece;
      if (
        p.state === v.renderedState &&
        !['collapsing', 'debris'].includes(p.state)
      )
        continue;
      const position = p.body.translation(),
        rotation = p.body.rotation();
      this.temp.set(position.x, position.y, position.z);
      this.qtemp.set(rotation.x, rotation.y, rotation.z, rotation.w);
      if (p.state === 'collapsing')
        this.temp.y -= Math.min(0.22, p.age * p.age * 8);
      if (p.state === 'collapsing')
        this.qtemp.multiply(
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(p.age * 0.35, 0, p.age * 0.2),
          ),
        );
      if (p.state === 'debris' && p.motion) {
        this.temp.lerpVectors(p.motion.previous, p.motion.position, alpha);
        this.qtemp.slerpQuaternions(
          p.motion.previousQ,
          p.motion.rotation,
          alpha,
        );
      }
      const size =
        p.state === 'gone' || p.cells
          ? 0
          : p.state === 'debris' && p.motion
            ? Math.min(1, (p.motion.life - p.motion.age) / 0.6)
            : 1;
      this.matrix.compose(
        this.temp,
        this.qtemp,
        this.scaleTemp.copy(v.scale).multiplyScalar(size),
      );
      v.mesh.setMatrixAt(v.index, this.matrix);
      v.mesh.instanceMatrix.needsUpdate = true;
      changed.add(v.mesh);
      v.renderedState = p.state;
    }
    for (const mesh of changed) mesh.computeBoundingSphere();
  }
  addVisual(body: RAPIER.RigidBody, object: THREE.Object3D) {
    const p = body.translation(),
      q = body.rotation();
    object.position.set(p.x, p.y, p.z);
    object.quaternion.set(q.x, q.y, q.z, q.w);
    this.visuals.push({
      body,
      object,
      prev: object.position.clone(),
      prevQ: object.quaternion.clone(),
    });
  }
  setTouch(x: number, z: number) {
    this.touch = { x, z };
  }
  getState() {
    const p = this.sim.ball.translation(),
      v = this.sim.ball.linvel();
    return {
      paused: this.paused,
      position: { x: p.x, y: p.y, z: p.z },
      speedKmh: Math.hypot(v.x, v.z) * 3.6,
      distanceMetres: this.sim.distance,
      jumps: this.sim.jumps,
      brokenPieces: this.sim.brokenCount,
      chippedWallCells: this.sim.chippedCells,
      structuralDebris: this.sim.motion.chunks.length,
      structuralBodies: this.sim.motion.slots.filter((s) => s.chunk).length,
      activeDebris: this.fracture.fragments.filter((f) => f.active).length,
      fragments: this.fracture.getStats(),
      camera: {
        yaw: this.orbit.yaw,
        pitch: this.orbit.pitch,
        distance: CAMERA.distance,
      },
      renderer: {
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
      },
    };
  }
  setBrake(v: boolean) {
    this.brake = v;
  }
  jump() {
    if (!this.paused) this.sim?.queueJump();
  }
  setPaused(value: boolean) {
    this.paused = value;
    this.keys.clear();
    this.touch = { x: 0, z: 0 };
    this.brake = false;
    this.cancelOrbit();
    this.accumulator = 0;
    this.last = performance.now();
    this.reportPause(value);
    if (!value && this.audio?.state === 'suspended') void this.audio.resume();
  }
  setMuted(value: boolean) {
    this.muted = value;
    if (!value) {
      this.audio ??= new AudioContext();
      void this.audio.resume();
      this.tone(440, 0.05, 0.025);
    }
  }
  tone(f: number, duration: number, volume = 0.045) {
    if (this.muted || !this.audio || this.audio.state !== 'running') return;
    const t = this.audio.currentTime,
      o = this.audio.createOscillator(),
      g = this.audio.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.55, t + duration);
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    o.connect(g);
    g.connect(this.audio.destination);
    o.start(t);
    o.stop(t + duration);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }
  playDestructionSounds() {
    const events = this.sim.soundEvents.splice(0);
    if (this.muted || !this.audio || this.audio.state !== 'running') return;
    const ctx = this.audio,
      t = ctx.currentTime;
    if (!this.noise) {
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const a = this.noise.getChannelData(0);
      for (let i = 0; i < a.length; i++) a[i] = Math.random() * 2 - 1;
    }
    for (const e of events.sort((a, b) => b.strength - a.strength)) {
      const family = ['crate', 'floor', 'bench'].includes(e.kind)
        ? 'wood'
        : ['car', 'lamp', 'detail', 'tower'].includes(e.kind)
          ? 'metal'
          : 'stone';
      const key = e.phase;
      if ((this.soundGate.get(key) ?? 0) > t || this.soundVoices >= 4) continue;
      this.soundGate.set(key, t + (e.phase === 'impact' ? 0.075 : 0.15));
      this.soundVoices++;
      const landing = e.phase === 'landing',
        collapse = e.phase === 'collapse';
      const duration = landing ? 0.32 : collapse ? 0.2 : 0.18,
        gain = ctx.createGain();
      const level =
        Math.min(0.16, Math.max(0.025, e.strength * 0.09)) *
        (collapse ? 0.45 : 1);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(level, t + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      gain.connect(ctx.destination);
      const oscillator = ctx.createOscillator();
      oscillator.type = family === 'wood' ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(
        (landing ? 72 : family === 'metal' ? 180 : 115) *
          (1 + Math.random() * 0.1),
        t,
      );
      oscillator.frequency.exponentialRampToValueAtTime(
        landing ? 36 : 55,
        t + duration,
      );
      oscillator.connect(gain);
      oscillator.start(t);
      oscillator.stop(t + duration);
      const noise = ctx.createBufferSource(),
        filter = ctx.createBiquadFilter(),
        crack = ctx.createGain();
      noise.buffer = this.noise;
      filter.type = 'bandpass';
      filter.frequency.value = landing
        ? 650
        : collapse
          ? 360
          : family === 'wood'
            ? 1200
            : family === 'metal'
              ? 3200
              : 2300;
      filter.Q.value = family === 'metal' ? 2 : 0.6;
      const start = t + (landing ? 0.015 : 0.025);
      crack.gain.setValueAtTime(0.001, start);
      crack.gain.exponentialRampToValueAtTime(
        level * (landing ? 1.6 : 2.2),
        start + 0.004,
      );
      crack.gain.exponentialRampToValueAtTime(0.001, start + duration * 0.85);
      noise.connect(filter);
      filter.connect(crack);
      crack.connect(ctx.destination);
      noise.start(start, Math.random() * 0.4);
      noise.stop(start + duration);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
      noise.onended = () => {
        noise.disconnect();
        filter.disconnect();
        crack.disconnect();
        this.soundVoices--;
      };
    }
  }
  reset() {
    if (!this.sim) return;
    this.sim.reset();
    this.fracture.reset();
    this.simulationRevision = this.sim.revision;
    this.keys.clear();
    this.touch = { x: 0, z: 0 };
    this.brake = false;
    this.accumulator = 0;
    this.previousJump = 0;
    this.previousImpact = 0;
    for (const v of this.pieceVisuals) v.renderedState = '';
    this.updatePieceVisuals();
    this.structureVisuals.render(1);
    for (const v of this.visuals) {
      const p = v.body.translation(),
        q = v.body.rotation();
      v.prev.set(p.x, p.y, p.z);
      v.object.position.copy(v.prev);
      v.prevQ.set(q.x, q.y, q.z, q.w);
      v.object.quaternion.copy(v.prevQ);
      v.object.visible = true;
    }
    this.resetCamera();
    this.report({ speed: 0, airborne: false, distance: 0, fps: 0, broken: 0 });
  }
  resetCamera() {
    if (!this.sim) return;
    this.cancelOrbit();
    this.orbit.reset();
    this.updateCamera(0);
  }
  frame = (now: number) => {
    if (this.dead) return;
    this.raf = requestAnimationFrame(this.frame);
    const elapsed = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    if (!this.paused) {
      this.accumulator += elapsed;
      const x =
        (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
        (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0) +
        this.touch.x;
      const z =
        (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
        (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0) +
        this.touch.z;
      const direction = screenToWorld(x, z, this.orbit.yaw);
      while (this.accumulator >= TUNING.step) {
        for (const v of this.visuals) {
          const p = v.body.translation(),
            q = v.body.rotation();
          v.prev.set(p.x, p.y, p.z);
          v.prevQ.set(q.x, q.y, q.z, q.w);
        }
        this.fracture.beginStep();
        this.sim.step(
          direction.x,
          direction.z,
          this.brake ||
            this.keys.has('ShiftLeft') ||
            this.keys.has('ShiftRight'),
        );
        if (this.simulationRevision !== this.sim.revision) {
          this.fracture.reset();
          this.simulationRevision = this.sim.revision;
        }
        this.fracture.afterStep(TUNING.step, this.sim.takeBreakBursts());
        this.accumulator -= TUNING.step;
      }
      const alpha = this.accumulator / TUNING.step;
      for (const v of this.visuals) {
        if (v.prop) v.object.visible = !v.prop.broken;
        const p = v.body.translation(),
          q = v.body.rotation();
        v.object.position
          .copy(v.prev)
          .lerp(this.temp.set(p.x, p.y, p.z), alpha);
        v.object.quaternion
          .copy(v.prevQ)
          .slerp(this.qtemp.set(q.x, q.y, q.z, q.w), alpha);
      }
      this.playDestructionSounds();
      if (this.sim.jumps !== this.previousJump) {
        this.tone(280, 0.18);
        this.previousJump = this.sim.jumps;
      }
      this.updateCamera(elapsed);
      this.updatePieceVisuals(alpha);
      this.structureVisuals.render(alpha);
      this.fracture.render(alpha);
    }
    this.renderer.render(this.scene, this.camera);
    this.statsTime += elapsed;
    this.frameCount++;
    if (this.statsTime > 0.12) {
      const v = this.sim.ball.linvel();
      this.report({
        speed: Math.hypot(v.x, v.z) * 3.6,
        airborne: !this.sim.grounded,
        distance: this.sim.distance,
        fps: Math.round(this.frameCount / this.statsTime),
        broken: this.sim.brokenCount,
      });
      this.statsTime = 0;
      this.frameCount = 0;
    }
  };
  updateCamera(dt: number) {
    const p = this.ballGroup.position,
      v = this.sim.ball.linvel(),
      speed = Math.hypot(v.x, v.z);
    const { yaw, pitch } = this.orbit;
    this.target.set(p.x, p.y + 0.35, p.z);
    this.cameraDirection.set(
      -Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch),
    );
    this.camera.position
      .copy(this.target)
      .addScaledVector(this.cameraDirection, CAMERA.distance);
    this.camera.lookAt(this.target);
    const fov = 52 + Math.min(7, speed * 0.25);
    this.camera.fov = THREE.MathUtils.lerp(
      this.camera.fov,
      fov,
      1 - Math.exp(-3 * dt),
    );
    this.camera.updateProjectionMatrix();
  }
  dispose() {
    if (this.dead) return;
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.unregisterTools();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.host.removeEventListener('contextmenu', this.onContext);
    this.cancelOrbit();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    canvas.removeEventListener('lostpointercapture', this.onPointerUp);
    this.renderer.domElement.removeEventListener(
      'webglcontextlost',
      this.onContextLost,
    );
    this.renderer.domElement.removeEventListener(
      'webglcontextrestored',
      this.onContextRestored,
    );
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>(),
      textures = new Set<THREE.Texture>();
    this.fracture?.dispose();
    this.structureVisuals?.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        if (o instanceof THREE.InstancedMesh) o.dispose();
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          materials.add(m);
          for (const value of Object.values(m))
            if (value instanceof THREE.Texture) textures.add(value);
        }
      }
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());
    this.sim?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    void this.audio?.close();
  }
}

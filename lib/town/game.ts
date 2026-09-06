import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { TownSimulation, TUNING, type Layout } from './simulation';
import { registerGameTools } from './webmcp';
export type GameStats = {
  speed: number;
  airborne: boolean;
  distance: number;
  fps: number;
};
type Visual = {
  body: RAPIER.RigidBody;
  object: THREE.Object3D;
  prev: THREE.Vector3;
  prevQ: THREE.Quaternion;
};
export class TownGame {
  host: HTMLElement;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(52, 1, 0.12, 350);
  sun = new THREE.DirectionalLight(0xffffff, 3.0);
  sim!: TownSimulation;
  visuals: Visual[] = [];
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
  report: (s: GameStats) => void;
  reportPause: (v: boolean) => void;
  ballGroup = new THREE.Group();
  target = new THREE.Vector3();
  desiredCamera = new THREE.Vector3();
  temp = new THREE.Vector3();
  qtemp = new THREE.Quaternion();
  cameraDirection = new THREE.Vector3();
  previousJump = 0;
  unregisterTools = () => {};
  shadowMaterial: THREE.MeshBasicMaterial | null = null;
  ring: THREE.Mesh | null = null;
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
      ].includes(e.code)
    ) {
      e.preventDefault();
      if (e.code === 'KeyP' && !e.repeat) this.setPaused(!this.paused);
      else if (e.code === 'KeyR' && !e.repeat) this.reset();
      else if (e.code === 'Space' && !e.repeat) this.jump();
      this.keys.add(e.code);
    }
  };
  onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  onBlur = () => {
    this.keys.clear();
    this.touch = { x: 0, z: 0 };
    this.brake = false;
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
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.host.appendChild(this.renderer.domElement);
    this.renderer.domElement.tabIndex = 0;
    this.scene.background = new THREE.Color('#68c9f5');
    this.scene.fog = new THREE.Fog('#68c9f5', 125, 260);
    this.scene.add(new THREE.HemisphereLight(0xe5f4ff, 0x568840, 1.1));
    this.sun.position.set(-35, 60, -20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -30,
      right: 30,
      top: 32,
      bottom: -32,
      near: 1,
      far: 130,
    });
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 3;
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
    gltf.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = !/Town_(grass|asphalt|walk|white)/.test(o.name);
        o.receiveShadow = true;
      }
    });
    this.scene.add(gltf.scene);
    this.sim = new TownSimulation(layout);
    this.createBall();
    this.scene.add(this.ballGroup);
    this.addVisual(this.sim.ball, this.ballGroup);
    for (const p of this.sim.props) {
      const object = (p.type === 'cone' ? cone : crate).scene.clone(true);
      object.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      this.scene.add(object);
      this.addVisual(p.body, object);
    }
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.host.addEventListener('contextmenu', this.onContext);
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
    sphere.castShadow = true;
    sphere.receiveShadow = true;
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
      band.castShadow = true;
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
    // This soft contact cue remains readable on low-DPR mobile screens.
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!,
      gradient = ctx.createRadialGradient(32, 32, 3, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(25,40,40,0.34)');
    gradient.addColorStop(1, 'rgba(25,40,40,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(c);
    this.shadowMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });
    this.ring = new THREE.Mesh(
      new THREE.PlaneGeometry(2.7, 2.7),
      this.shadowMaterial,
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.scene.add(this.ring);
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
  }
  reset() {
    if (!this.sim) return;
    this.sim.reset();
    this.keys.clear();
    this.touch = { x: 0, z: 0 };
    this.brake = false;
    this.accumulator = 0;
    this.previousJump = 0;
    const p = this.sim.ball.translation();
    this.target.set(p.x, p.y + 1, p.z + 2.3);
    this.camera.position.set(p.x, p.y + 8.2, p.z - 13.5);
    this.camera.lookAt(this.target);
    for (const v of this.visuals) {
      const p = v.body.translation(),
        q = v.body.rotation();
      v.prev.set(p.x, p.y, p.z);
      v.object.position.copy(v.prev);
      v.prevQ.set(q.x, q.y, q.z, q.w);
      v.object.quaternion.copy(v.prevQ);
    }
    this.report({ speed: 0, airborne: false, distance: 0, fps: 0 });
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
      // Fixed camera heading makes screen-relative steering stable, including full circles.
      while (this.accumulator >= TUNING.step) {
        for (const v of this.visuals) {
          const p = v.body.translation(),
            q = v.body.rotation();
          v.prev.set(p.x, p.y, p.z);
          v.prevQ.set(q.x, q.y, q.z, q.w);
        }
        this.sim.step(
          -x,
          z,
          this.brake ||
            this.keys.has('ShiftLeft') ||
            this.keys.has('ShiftRight'),
        );
        this.accumulator -= TUNING.step;
      }
      const alpha = this.accumulator / TUNING.step;
      for (const v of this.visuals) {
        const p = v.body.translation(),
          q = v.body.rotation();
        v.object.position
          .copy(v.prev)
          .lerp(this.temp.set(p.x, p.y, p.z), alpha);
        v.object.quaternion
          .copy(v.prevQ)
          .slerp(this.qtemp.set(q.x, q.y, q.z, q.w), alpha);
      }
      if (this.sim.jumps !== this.previousJump) {
        this.tone(280, 0.18);
        this.previousJump = this.sim.jumps;
      }
      this.updateCamera(elapsed);
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
      });
      this.statsTime = 0;
      this.frameCount = 0;
    }
  };
  updateCamera(dt: number) {
    const p = this.ballGroup.position,
      v = this.sim.ball.linvel(),
      speed = Math.hypot(v.x, v.z);
    const look = this.temp.set(p.x + v.x * 0.18, p.y + 1, p.z + 2 + v.z * 0.22);
    this.target.lerp(look, 1 - Math.exp(-5 * dt));
    this.desiredCamera.set(
      p.x,
      p.y + 8.2 + speed * 0.075,
      p.z - 13.5 - speed * 0.11,
    );
    this.cameraDirection.copy(this.desiredCamera).sub(this.target);
    const distance = this.cameraDirection.length();
    this.cameraDirection.normalize();
    const hit = this.sim.world.castRay(
      new RAPIER.Ray(this.target, this.cameraDirection),
      distance,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
    );
    if (hit && hit.timeOfImpact < distance) {
      // Lift above nearby roofs; do not rotate with sphere spin or force manual camera input.
      this.desiredCamera
        .copy(this.target)
        .addScaledVector(
          this.cameraDirection,
          Math.max(2, hit.timeOfImpact - 0.9),
        );
      this.desiredCamera.y = Math.max(this.desiredCamera.y, p.y + 5.5);
    }
    this.camera.position.lerp(this.desiredCamera, 1 - Math.exp(-7 * dt));
    this.camera.lookAt(this.target);
    const fov = 52 + Math.min(7, speed * 0.25);
    this.camera.fov = THREE.MathUtils.lerp(
      this.camera.fov,
      fov,
      1 - Math.exp(-3 * dt),
    );
    this.camera.updateProjectionMatrix();
    this.sun.position.set(p.x - 35, p.y + 60, p.z - 20);
    this.sun.target.position.set(p.x, p.y, p.z);
    if (this.ring) {
      const hit = this.sim.world.castRayAndGetNormal(
        new RAPIER.Ray({ x: p.x, y: p.y, z: p.z }, { x: 0, y: -1, z: 0 }),
        12,
        true,
        undefined,
        undefined,
        undefined,
        this.sim.ball,
      );
      if (hit) {
        this.ring.visible = true;
        this.ring.position.set(p.x, p.y - hit.timeOfImpact + 0.025, p.z);
        this.ring.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
        );
        this.shadowMaterial!.opacity = Math.max(
          0.15,
          1 - (hit.timeOfImpact - 0.72) / 8,
        );
      } else this.ring.visible = false;
    }
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
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
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
    this.sun.shadow.map?.dispose();
    this.sim?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    void this.audio?.close();
  }
}

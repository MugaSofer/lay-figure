// Renderer, camera, lights and ground. The camera is a 35mm-equivalent body with a real focal length.
import {
  CircleGeometry, Color, DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial, PCFShadowMap, PerspectiveCamera, Scene,
  Vector3, WebGLRenderer, type Object3D,
} from 'three';

export const FOCAL_RANGE = [14, 200] as const;

/** Spherical orbit around a target; radius in metres, angles in radians (theta around Y from +Z). */
export interface Orbit { target: Vector3; radius: number; theta: number; phi: number }

export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(40, 1, 0.05, 100);
  readonly key = new DirectionalLight(0xffffff, 2.4);
  readonly ambient = new HemisphereLight(0xdfe6ff, 0x3a3128, 0.85);
  readonly ground: Mesh;
  readonly orbit: Orbit = { target: new Vector3(0, 0.95, 0), radius: 4.2, theta: 0.35, phi: 1.45 };
  focal = 50;
  onFrame: ((dt: number) => void)[] = [];
  private fpsEl: HTMLElement | null = null;

  constructor(readonly canvasHost: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    canvasHost.prepend(this.renderer.domElement);

    this.scene.background = new Color(0x2b2a28);
    this.key.position.set(-1.6, 3.4, 2.4);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.025;
    this.scene.add(this.key, this.key.target, this.ambient);

    this.ground = new Mesh(new CircleGeometry(6, 64), new MeshStandardMaterial({ color: 0x5a5651, roughness: 1 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    addEventListener('resize', () => this.resize());
    this.resize();
    this.updateCamera();
  }

  get canvas() { return this.renderer.domElement; }

  resize() {
    const w = this.canvasHost.clientWidth || innerWidth, h = this.canvasHost.clientHeight || innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.applyFocal();
  }

  /** Focal length on a full-frame body. three's filmGauge puts the 36mm film side along the longer
   *  screen side in either orientation, like turning a real camera to portrait. */
  setFocal(mm: number, keepFraming = true) {
    mm = Math.min(Math.max(mm, FOCAL_RANGE[0]), FOCAL_RANGE[1]);
    if (keepFraming) this.orbit.radius *= mm / this.focal; // walk back with a longer lens
    this.focal = mm;
    this.applyFocal();
    this.updateCamera();
  }

  private applyFocal() {
    this.camera.filmGauge = 36;
    this.camera.setFocalLength(this.focal);
    this.camera.updateProjectionMatrix();
  }

  updateCamera() {
    const { target, radius, theta, phi } = this.orbit;
    this.camera.position.set(
      target.x + radius * Math.sin(phi) * Math.sin(theta),
      target.y + radius * Math.cos(phi),
      target.z + radius * Math.sin(phi) * Math.cos(theta),
    );
    this.camera.lookAt(target);
  }

  /** Fit the key light's shadow camera around a subject. */
  fitShadow(subject: Object3D, pad = 0.4) {
    subject.updateMatrixWorld(true);
    const c = new Vector3();
    subject.getWorldPosition(c);
    const s = this.key.shadow.camera;
    Object.assign(s, { left: -1.2 - pad, right: 1.2 + pad, top: 1.2 + pad, bottom: -1.2 - pad, near: 0.1, far: 12 });
    this.key.target.position.set(c.x, 0.9, c.z);
    this.key.position.copy(this.key.target.position).add(new Vector3(-1.6, 3.4, 2.4));
    s.updateProjectionMatrix();
  }

  showFps(el: HTMLElement) { this.fpsEl = el; }

  start() {
    let last = performance.now(), frames = 0, acc = 0;
    this.renderer.setAnimationLoop(() => {
      const now = performance.now(), dt = (now - last) / 1000;
      last = now;
      for (const f of this.onFrame) f(dt);
      this.renderer.render(this.scene, this.camera);
      frames++;
      acc += dt;
      if (acc >= 0.5) {
        if (this.fpsEl) this.fpsEl.textContent = `${Math.round(frames / acc)} fps`;
        frames = 0;
        acc = 0;
      }
    });
  }
}

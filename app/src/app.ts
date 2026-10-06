// App state: one stage, one figure (M1), its body settings, pose controller and view. Converts the live
// state to and from SceneData for saving, loading and share links.
import { DoubleSide, FrontSide, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { loadBody, MacroLibrary } from './body/assets';
import { Figure } from './body/figure';
import { defaultMacros, RACES, SLIDERS, type MacroSettings } from './body/macros';
import { REGIONS, type Region } from './body/regions';
import {
  makePose, migrateScene, round, sceneFromHash, sceneToHash, SCENE_VERSION, validatePose, type Quat, type SceneData, type Vec3,
} from './io/scene';
import { PoseController } from './pose/controller';
import { InputRouter } from './view/input';
import { Stage } from './view/stage';

export class App {
  macros: MacroSettings = defaultMacros();
  readonly changed: (() => void)[] = [];
  private constructor(readonly stage: Stage, readonly figure: Figure, readonly pose: PoseController, readonly input: InputRouter) {
    pose.onChange = () => this.emit();
  }

  static async create(host: HTMLElement, assets: string) {
    const stage = new Stage(host);
    const data = await loadBody(assets);
    const lib = new MacroLibrary(assets, data.meta);
    const material = new MeshStandardMaterial({ color: 0xcdb8a0, roughness: 0.62 });
    const figure = new Figure(data, lib, material);
    stage.scene.add(figure.group);
    const pose = new PoseController(figure, stage);
    const input = new InputRouter(stage, pose);
    const app = new App(stage, figure, pose, input);
    await figure.setMacros(app.macros);
    stage.fitShadow(figure.group);
    // with parts hidden you can see into the body; draw back faces so it isn't see-through
    figure.onIndex.push(() => {
      material.side = figure.hidden.size ? DoubleSide : FrontSide;
      material.needsUpdate = true;
    });
    return app;
  }

  emit() { for (const f of this.changed) f(); }

  async setMacro(key: keyof Omit<MacroSettings, 'race'>, v: number) {
    this.macros[key] = v;
    await this.figure.setMacros(this.macros);
    this.emit();
  }
  async setRace(race: Record<string, number>) {
    Object.assign(this.macros.race, race);
    await this.figure.setMacros(this.macros);
    this.emit();
  }

  setHidden(regions: Iterable<Region>) {
    this.figure.setHidden(regions);
    this.emit();
  }

  // ---------- scene capture / apply ----------
  capture(): SceneData {
    const f = this.figure, s = this.stage, o = s.orbit;
    const names = f.bones.map(b => b.name);
    const joints = f.joints.map(q => [q.x, q.y, q.z, q.w] as Quat);
    const pose = makePose(names, joints, f.rootOffset.toArray() as Vec3, joints[0]);
    const macros: Record<string, number> = {};
    for (const k of SLIDERS) macros[k] = round(this.macros[k]);
    const race: Record<string, number> = {};
    for (const r of RACES) race[r] = round(this.macros.race[r]);
    const keyDir = s.key.position.clone().sub(s.key.target.position).normalize();
    return {
      version: SCENE_VERSION,
      figures: [{ body: { macros, race }, pose, hidden: [...f.hidden] }],
      props: [],
      lights: { key: { dir: keyDir.toArray().map(round) as Vec3, intensity: round(s.key.intensity) }, ambient: round(s.ambient.intensity) },
      camera: { target: o.target.toArray().map(round) as Vec3, radius: round(o.radius), theta: round(o.theta), phi: round(o.phi), focal: round(s.focal) },
      view: { mode: 'shaded', limits: this.pose.rig.limitsOn },
    };
  }

  async apply(raw: unknown, opts: { camera?: boolean } = {}) {
    const scene = migrateScene(raw);
    const fd = scene.figures[0];
    if (!fd) throw new Error('scene has no figure');
    validatePose(fd.pose);
    const before = this.pose.snapshot();
    for (const k of SLIDERS) if (typeof fd.body.macros[k] === 'number') this.macros[k] = fd.body.macros[k];
    for (const r of RACES) if (typeof fd.body.race?.[r] === 'number') this.macros.race[r] = fd.body.race[r];
    await this.figure.setMacros(this.macros);
    this.applyPose(fd.pose.joints, fd.pose.root);
    this.figure.setHidden((fd.hidden ?? []).filter((r): r is Region => (REGIONS as readonly string[]).includes(r)));
    this.pose.rig.limitsOn = scene.view?.limits ?? true;
    if (opts.camera !== false && scene.camera) {
      const c = scene.camera, o = this.stage.orbit;
      o.target.fromArray(c.target); o.radius = c.radius; o.theta = c.theta; o.phi = c.phi;
      this.stage.setFocal(c.focal, false);
      this.stage.updateCamera();
    }
    if (scene.lights?.key) {
      const k = this.stage.key;
      k.position.copy(k.target.position).add(new Vector3().fromArray(scene.lights.key.dir).multiplyScalar(4.4));
      k.intensity = scene.lights.key.intensity;
      this.stage.ambient.intensity = scene.lights.ambient;
    }
    this.pose.commit(before);
    this.emit();
  }

  applyPose(joints: Record<string, Quat>, root: { pos: Vec3; rot: Quat }) {
    const f = this.figure;
    f.joints.forEach(q => q.identity());
    for (const [name, q] of Object.entries(joints)) {
      const i = f.boneIndex.get(name);
      if (i !== undefined) f.joints[i].set(q[0], q[1], q[2], q[3]);
    }
    f.joints[0].copy(new Quaternion(...root.rot));
    f.rootOffset.fromArray(root.pos);
    f.applyPose();
  }

  // ---------- share links ----------
  async shareUrl() {
    const hash = await sceneToHash(this.capture());
    return `${location.origin}${location.pathname}#${hash}`;
  }
  async loadFromHash(hash = location.hash) {
    const scene = await sceneFromHash(hash);
    if (scene) await this.apply(scene);
    return !!scene;
  }
}

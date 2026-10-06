// The app's controls: a toolbar in thumb reach, bottom sheets for Body / View / More, a contextual bar for
// the selected joint, and the HUD. Plain DOM; no framework.
import { ageToYears, RACES, yearsToAge, type MacroSettings } from '../body/macros';
import { REGION_LABELS, REGIONS, type Region } from '../body/regions';
import type { App } from '../app';
import { FOCAL_RANGE } from '../view/stage';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { cls?: string } = {}, ...kids: (Node | string)[]) => {
  const el = document.createElement(tag);
  const { cls, ...rest } = props;
  if (cls) el.className = cls;
  Object.assign(el, rest);
  el.append(...kids);
  return el;
};

/** Run at most one async job at a time, always finishing with the latest request. */
function coalesce(fn: () => Promise<void>) {
  let running = false, again = false;
  return async () => {
    if (running) { again = true; return; }
    running = true;
    do { again = false; await fn(); } while (again);
    running = false;
  };
}

const BODY_SLIDERS: { key: keyof Omit<MacroSettings, 'race'>; label: string; ends?: [string, string] }[] = [
  { key: 'gender', label: 'Sex', ends: ['female', 'male'] },
  { key: 'height', label: 'Height', ends: ['short', 'tall'] },
  { key: 'weight', label: 'Weight', ends: ['light', 'heavy'] },
  { key: 'muscle', label: 'Muscle', ends: ['soft', 'muscular'] },
  { key: 'proportions', label: 'Proportions', ends: ['uncommon', 'idealised'] },
  { key: 'cupsize', label: 'Breast size', ends: ['small', 'large'] },
  { key: 'firmness', label: 'Breast firmness', ends: ['soft', 'firm'] },
];

export class UI {
  private sheet = h('div', { id: 'sheet', cls: 'sheet' });
  private selBar = h('div', { id: 'selbar' });
  private toolbar = h('div', { id: 'toolbar' });
  private fps = h('span', { id: 'fps' });
  private info = h('span', { id: 'info' });
  private toast = h('div', { id: 'toast' });
  private openSheet: string | null = null;
  private buttons: Record<string, HTMLButtonElement> = {};

  constructor(private app: App) {
    document.body.append(h('div', { id: 'hud' }, this.fps, this.info), this.selBar, this.toolbar, this.sheet, this.toast);
    app.stage.showFps(this.fps);
    this.buildToolbar();
    app.changed.push(() => this.refresh());
    addEventListener('keydown', e => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'z' && !e.shiftKey) { app.pose.undo(); e.preventDefault(); }
      if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { app.pose.redo(); e.preventDefault(); }
    });
    this.refresh();
  }

  private btn(id: string, label: string, title: string, onclick: () => void) {
    const b = h('button', { textContent: label, title, onclick });
    b.setAttribute('aria-label', title);
    this.buttons[id] = b;
    return b;
  }

  private buildToolbar() {
    const { pose } = this.app;
    this.toolbar.append(
      this.btn('undo', '↶', 'Undo', () => pose.undo()),
      this.btn('redo', '↷', 'Redo', () => pose.redo()),
      this.btn('mirror', '⇋', 'Mirror', () => this.toggleSheet('mirror')),
      this.btn('limits', 'Limits', 'Joint limits on/off', () => pose.setLimits(!pose.rig.limitsOn)),
      this.btn('body', 'Body', 'Body shape and hidden parts', () => this.toggleSheet('body')),
      this.btn('view', 'View', 'Lens and light', () => this.toggleSheet('view')),
      this.btn('more', '⋯', 'Save, load, share, help', () => this.toggleSheet('more')),
    );
  }

  refresh() {
    const { pose, figure } = this.app;
    this.buttons.undo.disabled = !pose.canUndo;
    this.buttons.redo.disabled = !pose.canRedo;
    this.buttons.limits.classList.toggle('on', pose.rig.limitsOn);
    for (const k of ['mirror', 'body', 'view', 'more']) this.buttons[k].classList.toggle('active', this.openSheet === k);
    const sel = pose.selected;
    this.info.textContent = sel >= 0 ? prettyBone(figure.bones[sel].name) : '';
    this.selBar.replaceChildren();
    this.selBar.style.display = sel >= 0 && !this.openSheet ? 'flex' : 'none';
    if (sel >= 0) {
      const ringsOn = pose.rings.visible;
      this.selBar.append(
        h('span', { textContent: prettyBone(figure.bones[sel].name) }),
        h('button', { textContent: ringsOn ? 'Hide rings' : 'Rotate', onclick: () => pose.select(sel, !ringsOn) }),
        h('button', { textContent: 'Reset joint', onclick: () => pose.edit(() => figure.joints[sel].identity()) }),
        h('button', { textContent: 'Done', cls: 'primary', onclick: () => pose.select(-1, false) }),
      );
    }
  }

  private toggleSheet(name: string) {
    this.openSheet = this.openSheet === name ? null : name;
    this.sheet.replaceChildren();
    this.sheet.classList.toggle('open', !!this.openSheet);
    if (this.openSheet === 'body') this.bodySheet();
    if (this.openSheet === 'view') this.viewSheet();
    if (this.openSheet === 'more') this.moreSheet();
    if (this.openSheet === 'mirror') this.mirrorSheet();
    this.refresh();
  }

  private slider(label: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void, fmt?: (v: number) => string, ends?: [string, string]) {
    const out = h('span', { cls: 'val', textContent: fmt ? fmt(value) : '' });
    const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
    input.oninput = () => { const v = +input.value; out.textContent = fmt ? fmt(v) : ''; onInput(v); };
    const row = h('label', { cls: 'slider' }, h('span', { cls: 'name', textContent: label }), out, input);
    if (ends) row.append(h('span', { cls: 'ends' }, h('span', { textContent: ends[0] }), h('span', { textContent: ends[1] })));
    return row;
  }

  private bodySheet() {
    const app = this.app, m = app.macros;
    const pending: Partial<Record<string, number>> = {};
    const flush = coalesce(async () => {
      for (const [k, v] of Object.entries(pending)) { (m as unknown as Record<string, number>)[k] = v!; delete pending[k]; }
      await app.figure.setMacros(m);
      app.emit();
    });
    const set = (k: string) => (v: number) => { pending[k] = v; void flush(); };
    this.sheet.append(h('h3', { textContent: 'Body' }));
    this.sheet.append(this.slider('Age', 1, 90, 1, Math.round(ageToYears(m.age)), v => set('age')(yearsToAge(v)), v => `${v} yrs`));
    for (const s of BODY_SLIDERS) this.sheet.append(this.slider(s.label, 0, 1, 0.01, m[s.key], set(s.key), undefined, s.ends));
    const raceFlush = coalesce(async () => { await app.figure.setMacros(m); app.emit(); });
    this.sheet.append(h('h4', { textContent: 'Ancestry mix (MakeHuman targets)' }));
    for (const r of RACES) this.sheet.append(this.slider(r[0].toUpperCase() + r.slice(1), 0, 1, 0.01, m.race[r], v => { m.race[r] = v; void raceFlush(); }));
    this.sheet.append(h('h3', { textContent: 'Hide parts' }));
    const grid = h('div', { cls: 'chips' });
    for (const r of REGIONS) {
      const chip = h('button', { textContent: REGION_LABELS[r], cls: app.figure.hidden.has(r) ? 'chip on' : 'chip' });
      chip.onclick = () => {
        const hidden = new Set(app.figure.hidden);
        if (hidden.has(r)) hidden.delete(r); else hidden.add(r as Region);
        app.setHidden(hidden);
        chip.classList.toggle('on', hidden.has(r));
      };
      grid.append(chip);
    }
    this.sheet.append(grid, h('button', { textContent: 'Show all', onclick: () => { app.setHidden([]); this.toggleSheet('body'); this.toggleSheet('body'); } }));
  }

  private viewSheet() {
    const s = this.app.stage;
    this.sheet.append(h('h3', { textContent: 'Lens' }));
    const toLog = (mm: number) => Math.log(mm), fromLog = (v: number) => Math.round(Math.exp(v));
    const lens = this.slider('Focal length', toLog(FOCAL_RANGE[0]), toLog(FOCAL_RANGE[1]), 0.001, toLog(s.focal), v => s.setFocal(fromLog(v)), v => `${fromLog(v)} mm`);
    const chips = h('div', { cls: 'chips' });
    for (const mm of [14, 24, 35, 50, 85, 135, 200]) chips.append(h('button', { cls: 'chip', textContent: `${mm}`, onclick: () => { s.setFocal(mm); this.toggleSheet('view'); this.toggleSheet('view'); } }));
    this.sheet.append(lens, chips);
    this.sheet.append(h('h3', { textContent: 'Key light' }));
    const k = s.key, t = k.target.position;
    const rel = k.position.clone().sub(t);
    let az = Math.atan2(rel.x, rel.z), el = Math.atan2(rel.y, Math.hypot(rel.x, rel.z));
    const place = () => {
      const r = 4.4;
      k.position.set(t.x + r * Math.cos(el) * Math.sin(az), t.y + r * Math.sin(el), t.z + r * Math.cos(el) * Math.cos(az));
    };
    this.sheet.append(
      this.slider('Direction', -180, 180, 1, Math.round((az * 180) / Math.PI), v => { az = (v * Math.PI) / 180; place(); }, v => `${v}°`),
      this.slider('Height', 5, 85, 1, Math.round((el * 180) / Math.PI), v => { el = (v * Math.PI) / 180; place(); }, v => `${v}°`),
      this.slider('Ambient', 0, 2, 0.05, s.ambient.intensity, v => { s.ambient.intensity = v; }),
      h('button', { textContent: 'Reset camera', onclick: () => { Object.assign(s.orbit, { radius: 4.2, theta: 0.35, phi: 1.45 }); s.orbit.target.set(0, 0.95, 0); s.setFocal(50, false); s.updateCamera(); } }),
    );
  }

  private mirrorSheet() {
    const p = this.app.pose;
    this.sheet.append(
      h('h3', { textContent: 'Mirror' }),
      h('div', { cls: 'chips' },
        h('button', { cls: 'chip', textContent: 'Flip whole pose', onclick: () => p.mirror('flip') }),
        h('button', { cls: 'chip', textContent: 'Copy left → right', onclick: () => p.mirror('l2r') }),
        h('button', { cls: 'chip', textContent: 'Copy right → left', onclick: () => p.mirror('r2l') }),
      ),
      h('p', { cls: 'hint', textContent: 'Left and right are the figure\'s own.' }),
    );
  }

  private moreSheet() {
    const app = this.app;
    const file = h('input', { type: 'file', accept: '.json,application/json' });
    file.style.display = 'none';
    file.onchange = async () => {
      const f = file.files?.[0];
      if (!f) return;
      try { await app.apply(JSON.parse(await f.text())); this.say('Loaded'); } catch (e) { this.say(`Couldn't load: ${(e as Error).message}`); }
      file.value = '';
    };
    this.sheet.append(
      h('h3', { textContent: 'Scene' }),
      h('div', { cls: 'chips' },
        h('button', { cls: 'chip', textContent: 'Save…', onclick: () => this.download() }),
        h('button', { cls: 'chip', textContent: 'Load…', onclick: () => file.click() }),
        h('button', { cls: 'chip', textContent: 'Copy share link', onclick: () => this.share() }),
        h('button', { cls: 'chip', textContent: 'Reset pose', onclick: () => app.pose.edit(() => app.figure.resetPose()) }),
      ),
      file,
      h('h3', { textContent: 'Help' }),
      h('ul', { cls: 'help' },
        h('li', { textContent: 'Tap a body part to select it. Drag it to pose: hands and feet pull the whole limb, hips move the body with feet planted.' }),
        h('li', { textContent: 'Long-press a part (or tap Rotate) for rotation rings; drag a ring to turn the joint.' }),
        h('li', { textContent: 'One finger on empty space orbits; two fingers pinch to zoom and pan. Mouse: drag empty space, wheel, right-drag.' }),
        h('li', { textContent: 'Limits keeps joints in anatomical range; turn it off for anything goes.' }),
      ),
      h('p', { cls: 'hint', innerHTML: 'Lay Figure · body: <a href="https://www.makehumancommunity.org" target="_blank" rel="noopener">MakeHuman</a> assets (CC0) · <a href="https://github.com/MugaSofer/lay-figure" target="_blank" rel="noopener">source</a>' }),
    );
  }

  private download() {
    const blob = new Blob([JSON.stringify(this.app.capture(), null, 1)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `lay-figure-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  private async share() {
    const url = await this.app.shareUrl();
    history.replaceState(null, '', url);
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ url, title: 'Lay Figure pose' });
      else { await navigator.clipboard.writeText(url); this.say('Link copied'); }
    } catch { this.say('Link is in the address bar'); }
  }

  say(text: string) {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    setTimeout(() => this.toast.classList.remove('show'), 1800);
  }
}

function prettyBone(n: string) {
  const side = n.endsWith('_l') ? ' (L)' : n.endsWith('_r') ? ' (R)' : '';
  const base = n.replace(/_[lr]$/, '').replace(/_0(\d)/, ' $1').replace('lowerarm', 'forearm').replace('upperarm', 'upper arm')
    .replace('calf', 'shin').replace('spine 1', 'lower back').replace('spine 2', 'mid back').replace('spine 3', 'chest')
    .replace('neck 1', 'neck').replace('ball', 'toes');
  return base.charAt(0).toUpperCase() + base.slice(1) + side;
}

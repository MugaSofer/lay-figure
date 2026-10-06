import { MeshStandardMaterial } from 'three';
import { loadBody, MacroLibrary } from './body/assets';
import { Figure } from './body/figure';
import { defaultMacros, SLIDERS, type MacroSettings } from './body/macros';
import { Stage } from './view/stage';

const ASSETS = './assets/body';

async function main() {
  const stage = new Stage(document.getElementById('stage')!);
  stage.showFps(document.getElementById('fps')!);
  const status = document.getElementById('status')!;
  const data = await loadBody(ASSETS);
  const lib = new MacroLibrary(ASSETS, data.meta);
  const material = new MeshStandardMaterial({ color: 0xcdb8a0, roughness: 0.62 });
  const figure = new Figure(data, lib, material);
  stage.scene.add(figure.group);
  const macros: MacroSettings = defaultMacros();
  await figure.setMacros(macros);
  stage.fitShadow(figure.group);
  status.textContent = '';
  stage.start();

  // Temporary body panel (replaced by the real UI later in M1)
  const panel = document.getElementById('panel')!;
  for (const k of SLIDERS) {
    const l = document.createElement('label');
    l.textContent = k;
    const r = Object.assign(document.createElement('input'), { type: 'range', min: '0', max: '1', step: '0.01', value: String(macros[k]) });
    r.oninput = () => { macros[k] = +r.value; void figure.setMacros(macros); };
    l.appendChild(r);
    panel.appendChild(l);
  }
  Object.assign(window, { lay: { stage, figure, macros } });
}

main().catch(e => {
  document.getElementById('status')!.textContent = `Error: ${e.message}`;
  console.error(e);
});

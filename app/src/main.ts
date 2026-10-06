import { App } from './app';
import { UI } from './ui/ui';

async function main() {
  const app = await App.create(document.getElementById('stage')!, './assets/body');
  // ?bare: no controls, for regression renders
  const bare = new URLSearchParams(location.search).has('bare');
  const ui = bare ? { say: (t: string) => console.warn(t) } : new UI(app);
  try { await app.loadFromHash(); } catch (e) { ui.say(`Couldn't open that link: ${(e as Error).message}`); }
  document.getElementById('loading')!.remove();
  if (!app.figure.data.meta.localTargets) ui.say('An update is half-installed: close and reopen the app');
  app.stage.start();
  Object.assign(window, { lay: { app, ui, stage: app.stage, figure: app.figure, pose: app.pose, macros: app.macros } });
}

main().catch(e => {
  document.getElementById('loading')!.textContent = `Couldn't start: ${e.message}`;
  console.error(e);
});

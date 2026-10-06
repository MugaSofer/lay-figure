import { App } from './app';
import { UI } from './ui/ui';

async function main() {
  const app = await App.create(document.getElementById('stage')!, './assets/body');
  const ui = new UI(app);
  try { await app.loadFromHash(); } catch (e) { ui.say(`Couldn't open that link: ${(e as Error).message}`); }
  document.getElementById('loading')!.remove();
  app.stage.start();
  Object.assign(window, { lay: { app, ui, stage: app.stage, figure: app.figure, pose: app.pose, macros: app.macros } });
}

main().catch(e => {
  document.getElementById('loading')!.textContent = `Couldn't start: ${e.message}`;
  console.error(e);
});

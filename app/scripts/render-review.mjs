// Render every regression scene (review/scenes/*.json) from three cameras into review/<milestone>/,
// then a contact sheet. Run after `pnpm build`:  node scripts/render-review.mjs m1
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from './serve.mjs';

const REVIEW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'review');
const milestone = process.argv[2] ?? 'm1';
const out = join(REVIEW, milestone);
mkdirSync(out, { recursive: true });
const CAMERAS = { front: 0, 'three-quarter': 0.75, side: Math.PI / 2 };

const { url, close } = await serve();
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 720, height: 900 } });
page.on('pageerror', e => console.error('page error:', e.message));
await page.goto(url + '?bare');
await page.waitForFunction(() => window.lay?.app !== undefined, null, { timeout: 60000 });
const scenes = readdirSync(join(REVIEW, 'scenes')).filter(f => f.endsWith('.json')).sort();
for (const file of scenes) {
  const scene = JSON.parse(readFileSync(join(REVIEW, 'scenes', file), 'utf8'));
  await page.evaluate(s => window.lay.app.apply(s), scene);
  for (const [cam, theta] of Object.entries(CAMERAS)) {
    await page.evaluate(theta => {
      const { stage, figure: f } = window.lay;
      // frame the posed figure: bounds of its joints, padded
      f.group.updateMatrixWorld(true);
      const V = f.rootOffset.constructor;
      const lo = new V(Infinity, Infinity, Infinity), hi = new V(-Infinity, -Infinity, -Infinity);
      for (const b of f.bones) { const p = b.getWorldPosition(new V()); lo.min(p); hi.max(p); }
      lo.y = Math.min(lo.y, 0);
      const size = Math.max(hi.y - lo.y, hi.x - lo.x, hi.z - lo.z) + 0.35;
      const o = stage.orbit;
      o.target.copy(lo).add(hi).multiplyScalar(0.5);
      o.theta = theta; o.phi = 1.48;
      stage.setFocal(50, false);
      o.radius = (size / 2) / Math.tan((stage.camera.fov * Math.PI) / 360) * 1.08;
      stage.updateCamera();
    }, theta);
    await page.waitForTimeout(120);
    await page.screenshot({ path: join(out, `${file.replace('.json', '')}-${cam}.png`) });
  }
  console.log('rendered', file);
}
await browser.close();
await close();

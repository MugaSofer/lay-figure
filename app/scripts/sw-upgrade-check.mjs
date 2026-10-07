// Checks that an installed PWA picks up changed body data after a deploy (it once kept the first-installed
// body.json forever). Builds a copy with stale body.json, installs it in a persistent browser profile,
// rebuilds with the real data at the same origin, reopens twice and checks the app sees the new data.
// Usage: node scripts/sw-upgrade-check.mjs   (rebuilds dist/; run pnpm build afterwards if you need it)
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';

const bodyJson = new URL('../../public/assets/body/body.json', import.meta.url);
const real = readFileSync(bodyJson, 'utf8');
const build = () => execSync('npx vite build --logLevel error', { stdio: 'inherit' });

const stale = JSON.parse(real);
delete stale.localTargets;
try { writeFileSync(bodyJson, JSON.stringify(stale)); build(); } finally { writeFileSync(bodyJson, real); }

const profile = mkdtempSync(join(tmpdir(), 'lay-sw-'));
const serve = () => preview({ preview: { port: 4199, strictPort: true }, logLevel: 'error' });
const open = async () => {
  const ctx = await chromium.launchPersistentContext(profile, { channel: 'chrome' });
  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.goto('http://localhost:4199/?bare');
  await page.waitForFunction(() => window.lay?.app !== undefined, null, { timeout: 60000 });
  // let the service worker check for an update and finish installing/activating it
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    await reg.update().catch(e => console.log(e));
    for (let i = 0; i < 100 && (reg.installing || reg.waiting); i++) await new Promise(r => setTimeout(r, 100));
    return { active: reg.active?.state, waiting: !!reg.waiting, installing: !!reg.installing };
  });
  if (process.env.DEBUG) console.log('sw', JSON.stringify(sw));
  await page.waitForTimeout(500);
  const has = await page.evaluate(() => !!window.lay.figure.data.meta.localTargets);
  if (process.env.DEBUG) console.log(await page.evaluate(async () => {
    const out = { controller: navigator.serviceWorker.controller?.scriptURL, caches: {} };
    for (const n of await caches.keys()) out.caches[n] = (await (await caches.open(n)).keys()).map(r => r.url.replace(location.origin, '')).filter(u => /body|sw|index/.test(u));
    const r = await fetch('assets/body/body.json'); out.fetched = 'localTargets' in (await r.json());
    return JSON.stringify(out, null, 1);
  }));
  await ctx.close();
  return has;
};
let server = await serve(), ok = false;
try {
  console.log('stale build, first visit: localTargets =', await open());
  build(); // "deploy" the real data (the preview server indexes files at startup, so restart it)
  server.httpServer.close(); server = await serve();
  const a = await open(), b = await open();
  console.log('after deploy, reopen 1:', a, ' reopen 2:', b);
  ok = b;
} finally {
  server.httpServer.close();
  rmSync(profile, { recursive: true, force: true });
}
console.log(ok ? 'PASS: installed app picked up the new body data' : 'FAIL: installed app is still on the old body data');
process.exit(ok ? 0 : 1);

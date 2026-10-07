// NIGHT SHIFT — headless smoke test.
// Boots the dev server, drives the game through title → intro → play → perspective
// switches → outage → generator → crisis → ending, screenshots every stage, and fails
// on page errors / console errors / stuck stages.
//
//   node tools/smoke.mjs            (default: dev server on 5174, shots in tools/shots)
//   node tools/smoke.mjs --fast     (skip the long waits)
//   node tools/smoke.mjs --url http://127.0.0.1:4173   (use an already-running server)
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const getArg = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const FAST = args.includes('--fast');
const PORT = Number(getArg('--port', '5174'));
const URL = getArg('--url', `http://127.0.0.1:${PORT}/`);
const SHOTS = resolve(getArg('--shots', 'tools/shots'));
const SEED = getArg('--seed', 'NS-SMK-001');
mkdirSync(SHOTS, { recursive: true });

const log = (...m) => console.log('[smoke]', ...m);
const failures = [];
const consoleErrors = [];
const consoleWarnings = [];

let server = null;
if (!args.includes('--url')) {
  server = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--config', 'vite.qa.config.ts', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], { cwd: resolve('.'), stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (d) => process.env.SMOKE_VERBOSE && process.stdout.write(d));
  server.stderr.on('data', (d) => process.stdout.write(String(d)));
  await waitForServer(URL, 60000);
  process.on('exit', () => { try { server?.kill(); } catch { /* already gone */ } });
}

async function waitForServer(url, timeout) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('dev server did not start');
}

const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('pageerror', (err) => {
  failures.push(`pageerror: ${err.message}`);
  console.error('[pageerror]', err.message);
});
page.on('console', (msg) => {
  const t = msg.type();
  const text = msg.text();
  if (t === 'error') {
    consoleErrors.push(text);
    console.error('[console.error]', text);
  } else if (t === 'warning') {
    consoleWarnings.push(text);
  }
});

const shot = async (name) => {
  const file = resolve(SHOTS, `${name}.png`);
  await page.screenshot({ path: file });
  log('shot', name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, FAST ? Math.min(ms, 800) : ms));
const state = () => page.evaluate(() => window.__NS?.state?.());
const waitFor = async (label, fn, timeout = 30000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (await fn()) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  failures.push(`timeout: ${label}`);
  console.error('[smoke] TIMEOUT', label);
  return false;
};

try {
  log('open', URL);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitFor('game ready', () => page.evaluate(() => Boolean(window.__NS?.ready)), 60000);
  await sleep(1500);
  await shot('01_title');
  const s0 = await state();
  log('screen', s0?.screen, 'seed', s0?.seed, 'scenario', s0?.scenario);

  // user gesture for audio policy
  await page.mouse.click(640, 360);
  // QA runs skip the first-night walkthrough (it holds the clock at 22:59 until John has learned the controls)
  // and the title narration (it ducks the title audio while it reads)
  await page.evaluate(() => window.__NS.services.store.setSettings({ tutorial: false, narration: false }));
  await page.evaluate((seed) => window.__NS.newGame(seed), SEED);
  await waitFor('intro started', async () => (await state())?.screen === 'intro', 20000);
  await sleep(2500);
  await shot('02_intro');
  await sleep(FAST ? 500 : 6000);
  await shot('03_intro_b');
  await page.evaluate(() => window.__NS.skipIntro());
  await waitFor('playing', async () => (await state())?.screen === 'playing', 30000);
  await sleep(1200);
  await shot('04_john_waiting');
  log('john view', JSON.stringify((await state())?.characters?.john?.location));

  // look around a bit via synthetic mouse movement (pointer lock may be unavailable headless)
  await page.keyboard.down('KeyW');
  await sleep(1500);
  await page.keyboard.up('KeyW');
  await shot('05_john_moved');

  for (const [view, name] of [['susie', '06_susie'], ['paul', '07_paul'], ['cctv', '08_cctv']]) {
    await page.evaluate((v) => window.__NS.switchView(v), view);
    await waitFor(`view ${view}`, async () => (await state())?.activeView === view, 15000);
    await sleep(1500);
    await shot(name);
    log('view', view, 'cam', (await state())?.activeCamera);
  }
  // cycle cameras
  await page.keyboard.press('BracketRight');
  await sleep(800);
  await shot('09_cctv_next');
  await page.evaluate(() => window.__NS.switchView('john'));
  await waitFor('back to john', async () => (await state())?.activeView === 'john', 15000);

  // advance the night
  const stages = [
    [22, '10_unease'],
    [52, '11_contradictions'],
    [77, '12_pre_outage'],
  ];
  for (const [t, name] of stages) {
    await page.evaluate((m) => window.__NS.setTime(m), t);
    await sleep(4000);
    await shot(name);
    const st = await state();
    log('t', t, 'phase', st?.phase, 'power', st?.power, 'sound', st?.sound, 'fired', st?.fired?.length);
  }
  // Outage: set time just before the boundary and let it play out in real time
  await page.evaluate(() => window.__NS.setTime(79.8));
  await waitFor('blackout', async () => (await state())?.power === 'blackout', 60000);
  await sleep(1500);
  await shot('13_blackout');
  await waitFor('generator', async () => (await state())?.power === 'generator', 90000);
  await sleep(4000);
  await shot('14_generator_john');
  await page.evaluate(() => window.__NS.switchView('paul'));
  await waitFor('paul gen', async () => (await state())?.activeView === 'paul', 15000);
  await sleep(1500);
  await shot('15_generator_paul');
  await page.evaluate(() => window.__NS.switchView('cctv'));
  await waitFor('cctv gen', async () => (await state())?.activeView === 'cctv', 15000);
  await sleep(1500);
  await shot('16_generator_cctv');
  await page.evaluate(() => window.__NS.switchView('susie'));
  await waitFor('susie gen', async () => (await state())?.activeView === 'susie', 15000);

  await page.evaluate(() => window.__NS.setTime(126));
  await sleep(5000);
  await shot('17_crisis');
  let st = await state();
  log('crisis', 'threat', st?.threat, 'danger', JSON.stringify(Object.fromEntries(Object.entries(st?.characters ?? {}).map(([k, v]) => [k, v.danger]))));

  await page.evaluate(() => window.__NS.setTime(166));
  await sleep(5000);
  await shot('18_resolution');
  await page.evaluate(() => window.__NS.setTime(178.5));
  await waitFor('ending', async () => (await state())?.screen === 'ending', 120000);
  await sleep(FAST ? 1500 : 9000);
  await shot('19_ending');
  st = await state();
  log('ending', st?.ending, 'clues', st?.clues?.length, 'choices', st?.choices?.length, 'fired', st?.fired?.length, 'missed', st?.missed?.length);

  // mobile layout sanity
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(1200);
  await shot('20_mobile_ending');
} catch (err) {
  failures.push(`exception: ${err?.stack ?? err}`);
  console.error(err);
}

const report = {
  url: URL,
  seed: SEED,
  failures,
  consoleErrors: [...new Set(consoleErrors)].slice(0, 40),
  consoleWarnings: [...new Set(consoleWarnings)].slice(0, 20),
  state: await state().catch(() => null),
};
writeFileSync(resolve(SHOTS, 'report.json'), JSON.stringify(report, null, 2));
await browser.close();
log('done.', failures.length ? `${failures.length} FAILURES` : 'OK', `${report.consoleErrors.length} distinct console errors`);
process.exit(failures.length || report.consoleErrors.length ? 1 : 0);

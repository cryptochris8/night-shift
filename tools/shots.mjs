// NIGHT SHIFT — visual QA: photograph the world from fixed poses.
//   node tools/shots.mjs [--port 5175] [--out tools/shots/qa] [--time 10] [--power normal|generator] [--css "..."] [--only name,name]
// Starts its own Vite dev server, starts a run, skips the intro, then for each pose teleports the
// active character, aims the camera and screenshots. Poses are [name, view, x, z, yaw?, lookAt?].
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const PORT = Number(arg('--port', '5175'));
const OUT = resolve(arg('--out', 'tools/shots/qa'));
const TIME = Number(arg('--time', '6'));
const POWER = arg('--power', 'normal');
const CSS = arg('--css', '');
const ONLY = arg('--only', '');
const SEED = arg('--seed', 'NS-QAQ-001');
mkdirSync(OUT, { recursive: true });

// name, view, x, z, lookAt {x,y,z}
const POSES = [
  ['wait_tv', 'john', -13.1, -4.9, { x: -14, y: 1.6, z: -9.9 }],
  ['wait_desk', 'john', -12.6, -6.4, { x: -9.4, y: 1.1, z: -2.6 }],
  ['wait_archway', 'john', -16.5, -7.5, { x: -14, y: 1.4, z: -1.6 }],
  ['wait_glass', 'john', -11, -5.2, { x: -20, y: 1.5, z: -6 }],
  ['hall_east', 'susie', -17.5, 0, { x: 10, y: 1.4, z: 0 }],
  ['hall_west', 'susie', 18.5, 0.2, { x: -10, y: 1.4, z: 0 }],
  ['station', 'susie', 0, 0.6, { x: 0, y: 1.0, z: -4 }],
  ['station_inside', 'susie', -1.5, -3.6, { x: 0.5, y: 1.0, z: -1 }],
  ['exam3', 'susie', -8.6, 2.1, { x: -7.3, y: 0.7, z: 4.6 }],
  ['triage', 'susie', -6.1, -2.1, { x: -5.5, y: 1.0, z: -4.5 }],
  ['lounge', 'susie', 6.2, -2.2, { x: 6.5, y: 1.0, z: -5.5 }],
  ['restroom', 'john', 13.6, -2.1, { x: 11.6, y: 1.5, z: -2.3 }],
  ['service', 'paul', 8.0, 7.0, { x: 18, y: 1.4, z: 7 }],
  ['service_w', 'paul', 12, 7.0, { x: -10, y: 1.4, z: 7 }],
  ['electrical', 'paul', 4, 8.9, { x: 3.7, y: 1.4, z: 11.4 }],
  ['generator', 'paul', 11.2, 9.0, { x: 14, y: 1.0, z: 11.6 }],
  ['utility', 'paul', -6, 8.9, { x: -6.5, y: 1.0, z: 10.8 }],
  ['med_room', 'susie', 0.3, 2.1, { x: -0.5, y: 1.0, z: 4.8 }],
  ['figure_john', 'john', -7.7, 0.7, { x: 17.5, y: 1.3, z: 0.3 }],
  ['figure_susie', 'susie', -7.0, 0.2, { x: 17.5, y: 1.3, z: 0.3 }],
];

// ad-hoc pose: --pose name,view,x,z,lookX,lookY,lookZ
const POSE_ARG = arg('--pose', '');
if (POSE_ARG) {
  const [n, v, x, z, lx, ly, lz] = POSE_ARG.split(',');
  POSES.push([n, v, Number(x), Number(z), { x: Number(lx), y: Number(ly), z: Number(lz) }]);
}

const server = spawn(`npx vite --config vite.qa.config.ts --port ${PORT} --host 127.0.0.1 --strictPort`, { cwd: resolve('.'), stdio: ['ignore', 'pipe', 'pipe'], shell: true });
server.stderr.on('data', (d) => process.stdout.write(String(d)));
const start = Date.now();
while (Date.now() - start < 60000) {
  try {
    if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break;
  } catch {
    /* wait */
  }
  await new Promise((r) => setTimeout(r, 400));
}

const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForFunction(() => window.__NS?.ready, null, { timeout: 60000 });
if (CSS) await page.addStyleTag({ content: CSS });
await page.mouse.click(5, 5);
await page.evaluate((seed) => window.__NS.newGame(seed), SEED);
await page.waitForFunction(() => window.__NS.state().screen === 'intro', null, { timeout: 30000 });
await sleep(1500);
await page.evaluate(() => window.__NS.skipIntro());
await page.waitForFunction(() => window.__NS.state().screen === 'playing', null, { timeout: 30000 });
if (POWER === 'generator') {
  // let the director run the real outage → generator sequence, then wait for the lights to settle
  await page.evaluate(() => window.__NS.setTime(79.95));
  await page.waitForFunction(() => window.__NS.state().power === 'generator' && window.__NS.services.lighting.seq === null, null, { timeout: 180000 });
  await sleep(3000);
  if (TIME > 83) await page.evaluate((t) => window.__NS.setTime(t), TIME);
} else {
  await page.evaluate((t) => window.__NS.setTime(t), TIME);
}
const EVAL = arg('--eval', '');
if (EVAL) {
  console.log('[shots] eval ->', await page.evaluate(`(() => { const s = window.__NS.services; return (${EVAL}); })()`));
}
if (args.includes('--nocull')) {
  await page.evaluate(() => window.__NS.services.three.scene.traverse((o) => { o.frustumCulled = false; }));
}
await sleep(1500);

const timings = {};
for (const [name, view, x, z, look] of POSES) {
  if (ONLY && !ONLY.split(',').includes(name)) continue;
  await page.evaluate((v) => window.__NS.switchView(v), view);
  await page.waitForFunction((v) => window.__NS.state().activeView === v, view, { timeout: 15000 });
  await page.evaluate(
    ({ view, x, z, look }) => {
      const s = window.__NS.services;
      const yaw = Math.atan2(-(look.x - x), -(look.z - z));
      s.characters.teleport(view, { x, y: 0, z }, yaw);
      void s.characters.lookToward(look, 0.01);
    },
    { view, x, z, look },
  );
  const AFTER = arg('--after', '');
  if (AFTER) await page.evaluate(`(() => { const s = window.__NS.services; return (${AFTER}); })()`);
  await sleep(Number(arg('--wait', '1400')));
  process.on('exit', () => { try { if (server) spawnSync('taskkill', ['/F', '/T', '/PID', String(server.pid)], { shell: true }); } catch { /* already gone */ } });
const t0 = Date.now();
  await page.screenshot({ path: resolve(OUT, `${name}.png`) });
  const fps = await page.evaluate(() => new Promise((res) => {
    let n = 0;
    const t = performance.now();
    const f = () => {
      n++;
      if (performance.now() - t < 1000) requestAnimationFrame(f);
      else res(n);
    };
    requestAnimationFrame(f);
  }));
  timings[name] = { fps, shotMs: Date.now() - t0 };
  console.log('[shots]', name, `${fps} fps (swiftshader)`);
}
const info = await page.evaluate(() => {
  const r = window.__NS.services.three.renderer.info;
  return { calls: r.render.calls, triangles: r.render.triangles, geometries: r.memory.geometries, textures: r.memory.textures };
});
writeFileSync(resolve(OUT, 'report.json'), JSON.stringify({ errors: [...new Set(errors)], timings, info }, null, 2));
console.log('[shots] renderer', JSON.stringify(info), 'errors', errors.length);
for (const e of [...new Set(errors)].slice(0, 15)) console.log('  ', e);
await browser.close();
server.kill();
process.exit(0);

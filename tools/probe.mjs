// NIGHT SHIFT — evaluate a JS expression inside a running game (debug helper).
//   node tools/probe.mjs "<expression using s = window.__NS.services>"  [--port 5176] [--play]
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const PORT = Number(arg('--port', '5176'));
const EXPR = args[0];
const server = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--config', 'vite.qa.config.ts', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], { cwd: resolve('.'), stdio: ['ignore', 'pipe', 'pipe'] });
process.on('exit', () => { try { server?.kill(); } catch { /* already gone */ } });
const t0 = Date.now();
while (Date.now() - t0 < 60000) {
  try {
    if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break;
  } catch {
    /* wait */
  }
  await new Promise((r) => setTimeout(r, 400));
}
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text().slice(0, 300));
});
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__NS?.ready, null, { timeout: 60000 });
if (args.includes('--play')) {
  await page.mouse.click(5, 5);
  // QA runs skip the first-night walkthrough (it holds the clock at 22:59 until John has learned the controls)
  await page.evaluate(() => window.__NS.services.store.setSettings({ tutorial: false, narration: false }));
  await page.evaluate(() => window.__NS.newGame('NS-PRB-001'));
  await page.waitForFunction(() => window.__NS.state().screen === 'intro', null, { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1200));
  await page.evaluate(() => window.__NS.skipIntro());
  await page.waitForFunction(() => window.__NS.state().screen === 'playing', null, { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1000));
}
const out = await page.evaluate(`(() => { const s = window.__NS.services; return (${EXPR}); })()`);
console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
await browser.close();
process.exit(0);

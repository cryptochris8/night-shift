// NIGHT SHIFT — restart flow + phone layout check (touch emulation).
//   node tools/mobile.mjs [--port 5179]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, devices } from 'playwright';

const args = process.argv.slice(2);
const PORT = Number(args.includes('--port') ? args[args.indexOf('--port') + 1] : '5179');
const OUT = resolve('tools/shots/mobile');
mkdirSync(OUT, { recursive: true });
const server = spawn(`npx vite --config vite.qa.config.ts --port ${PORT} --host 127.0.0.1 --strictPort`, { cwd: resolve('.'), stdio: ['ignore', 'pipe', 'pipe'], shell: true });
const t0 = Date.now();
while (Date.now() - t0 < 60000) {
  try {
    if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break;
  } catch {
    /* wait */
  }
  await new Promise((r) => setTimeout(r, 400));
}
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = `http://127.0.0.1:${PORT}/`;

// 1) restart flow: a reload with #seed=…&auto=1 shows the begin prompt, one tap starts that night
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}#seed=NS-RST-777&auto=1`);
  await page.waitForFunction(() => window.__NS?.ready, null, { timeout: 60000 });
  await sleep(800);
  const prompt = await page.$('.ns-autostart');
  console.log('[mobile] restart prompt shown:', Boolean(prompt), 'screen:', await page.evaluate(() => window.__NS.state().screen));
  await page.screenshot({ path: resolve(OUT, 'restart_prompt.png') });
  await page.mouse.click(640, 360);
  await page.mouse.click(640, 360); // a second click must not start a second night
  await page.waitForFunction(() => window.__NS.state().screen === 'intro', null, { timeout: 30000 });
  const st = await page.evaluate(() => ({ seed: window.__NS.state().seed, screen: window.__NS.state().screen }));
  console.log('[mobile] after tap:', JSON.stringify(st), '(expect seed NS-RST-777)');
  await page.close();
}

// 2) phone layout with touch
{
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__NS?.ready, null, { timeout: 60000 });
  await sleep(1500);
  await page.screenshot({ path: resolve(OUT, 'title.png') });
  await page.tap('body');
  await page.evaluate(() => window.__NS.newGame('NS-MOB-001'));
  await page.waitForFunction(() => window.__NS.state().screen === 'intro', null, { timeout: 30000 });
  await sleep(1200);
  await page.evaluate(() => window.__NS.skipIntro());
  await page.waitForFunction(() => window.__NS.state().screen === 'playing', null, { timeout: 30000 });
  await sleep(2500);
  await page.screenshot({ path: resolve(OUT, 'play.png') });
  await page.evaluate(() => window.__NS.services.ui.openSwitcher());
  await sleep(1500);
  await page.screenshot({ path: resolve(OUT, 'switcher.png') });
  await page.evaluate(() => window.__NS.services.ui.closeSwitcher());
  await page.evaluate(() => window.__NS.switchView('cctv'));
  await sleep(2500);
  await page.screenshot({ path: resolve(OUT, 'cctv.png') });
  const touch = await page.evaluate(() => Boolean(document.querySelector('[class*="touch"]')));
  console.log('[mobile] touch controls present:', touch);
  await ctx.close();
}
console.log('[mobile] page errors:', errors.length, errors.slice(0, 5));
await browser.close();
server.kill();
spawn('taskkill', ['/F', '/T', '/PID', String(server.pid)], { shell: true });
process.exit(0);

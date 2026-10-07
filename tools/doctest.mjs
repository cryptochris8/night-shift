// Can a document / choice be closed with the keyboard? (regression for a stuck-modal bug)
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const PORT = 5180;
const server = spawn(`npx vite --config vite.qa.config.ts --port ${PORT} --host 127.0.0.1 --strictPort`, { cwd: resolve('.'), stdio: ['ignore', 'pipe', 'pipe'], shell: true });
process.on('exit', () => { try { if (server) spawnSync('taskkill', ['/F', '/T', '/PID', String(server.pid)], { shell: true }); } catch { /* already gone */ } });
const t0 = Date.now();
while (Date.now() - t0 < 60000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 400)); }
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForFunction(() => window.__NS?.ready, null, { timeout: 60000 });
await page.mouse.click(5, 5);
await page.evaluate(() => window.__NS.newGame('NS-DOC-001'));
await page.waitForFunction(() => window.__NS.state().screen === 'intro', null, { timeout: 30000 });
await sleep(1000);
await page.evaluate(() => window.__NS.skipIntro());
await page.waitForFunction(() => window.__NS.state().screen === 'playing', null, { timeout: 30000 });
await sleep(1500);
const modal = () => page.evaluate(() => window.__NS.services.ui.modalOpen);
for (const key of ['Escape', 'KeyE', 'Enter']) {
  await page.evaluate(() => { window.__docResult = 'pending'; window.__NS.services.ui.showDocument({ kind: 'note', title: 'Test', sections: [{ lines: ['hello'] }] }).then((r) => { window.__docResult = String(r); }); });
  await sleep(600);
  const before = await modal();
  await page.keyboard.press(key);
  await sleep(800);
  console.log(`[doc] ${key.padEnd(7)} open-before=${before} open-after=${await modal()} result=${await page.evaluate(() => window.__docResult)}`);
  if (await modal()) { await page.evaluate(() => window.__NS.services.ui.showDocument && window.__NS.services.ui.closeSwitcher()); }
}
await page.evaluate(() => { window.__askResult = 'pending'; window.__NS.services.ui.showChoice('Test?', [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]).then((r) => { window.__askResult = r; }); });
await sleep(600);
await page.keyboard.press('Digit2');
await sleep(800);
console.log(`[doc] choice Digit2 -> ${await page.evaluate(() => window.__askResult)} open-after=${await modal()}`);
await browser.close();
server.kill();
process.exit(0);

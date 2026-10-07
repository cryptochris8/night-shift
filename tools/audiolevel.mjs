// NIGHT SHIFT — measure the synthesized audio output level per sound state (catches silence / clipping).
//   node tools/audiolevel.mjs [--port 5178]
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const PORT = Number(args.includes('--port') ? args[args.indexOf('--port') + 1] : '5178');
const server = spawn(`npx vite --config vite.qa.config.ts --port ${PORT} --host 127.0.0.1 --strictPort`, { cwd: resolve('.'), stdio: ['ignore', 'pipe', 'pipe'], shell: true });
process.on('exit', () => { try { if (server) spawnSync('taskkill', ['/F', '/T', '/PID', String(server.pid)], { shell: true }); } catch { /* already gone */ } });
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
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.addInitScript(() => {
  const orig = AudioNode.prototype.connect;
  // @ts-ignore
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (dest instanceof AudioDestinationNode) {
      const ctx = this.context;
      if (!window.__tap || window.__tap.context !== ctx) {
        const an = new AnalyserNode(ctx, { fftSize: 4096 });
        window.__tap = an;
      }
      orig.call(this, window.__tap);
    }
    return orig.call(this, dest, ...rest);
  };
  window.__level = (ms) =>
    new Promise((res) => {
      const an = window.__tap;
      if (!an) return res({ rms: -999, peak: -999 });
      const buf = new Float32Array(an.fftSize);
      let sum = 0;
      let n = 0;
      let peak = 0;
      const end = performance.now() + ms;
      const tick = () => {
        an.getFloatTimeDomainData(buf);
        for (let i = 0; i < buf.length; i++) {
          const v = buf[i];
          sum += v * v;
          n++;
          if (Math.abs(v) > peak) peak = Math.abs(v);
        }
        if (performance.now() < end) setTimeout(tick, 40);
        else res({ rms: 20 * Math.log10(Math.sqrt(sum / Math.max(1, n)) + 1e-9), peak: 20 * Math.log10(peak + 1e-9) });
      };
      tick();
    });
});
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForFunction(() => window.__NS?.ready, null, { timeout: 60000 });
await page.mouse.click(5, 5);
await page.evaluate(() => window.__NS.newGame('NS-AUD-001'));
await page.waitForFunction(() => window.__NS.state().screen === 'intro', null, { timeout: 30000 });
const fmt = (l) => `rms ${l.rms.toFixed(1)} dBFS  peak ${l.peak.toFixed(1)} dBFS`;
console.log('[audio] intro      ', fmt(await page.evaluate(() => window.__level(3000))));
await page.evaluate(() => window.__NS.skipIntro());
await page.waitForFunction(() => window.__NS.state().screen === 'playing', null, { timeout: 30000 });
const ctxState = await page.evaluate(() => window.__tap?.context.state);
console.log('[audio] context', ctxState);
const states = [
  ['waiting / NORMAL', 3, 'john'],
  ['corridor / UNEASY', 25, 'susie'],
  ['service / PRE_OUTAGE', 77.5, 'paul'],
  ['blackout', 80.4, 'paul'],
  ['generator', 96, 'paul'],
  ['crisis / THREAT', 130, 'susie'],
  ['cctv', 131, 'cctv'],
  ['resolution', 167, 'john'],
];
for (const [label, t, view] of states) {
  await page.evaluate(({ t, view }) => {
    window.__NS.setTime(t);
    return window.__NS.switchView(view);
  }, { t, view });
  await new Promise((r) => setTimeout(r, 2500));
  const st = await page.evaluate(() => `${window.__NS.state().sound}/${window.__NS.state().power}`);
  console.log(`[audio] ${label.padEnd(22)} (${st.padEnd(20)})`, fmt(await page.evaluate(() => window.__level(4000))));
}
await browser.close();
server.kill();
process.exit(0);

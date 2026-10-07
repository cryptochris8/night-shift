// NIGHT SHIFT — full-night integration run at accelerated game speed.
//   node tools/night.mjs [--scale 60] [--seed NS-...] [--port 5177] [--shots] [--no-switch]
// Plays the whole shift without setTime jumps (default 60 game-s per real second → ~3 min),
// cycling perspectives, auto-answering dialogue choices and closing documents. Logs every
// phase / power / sound / view change, each fired event, subtitles and errors; ends at the ending screen.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const PORT = Number(arg('--port', '5177'));
const SCALE = Number(arg('--scale', '60'));
const SEED = arg('--seed', 'NS-NGT-001');
const SHOTS = args.includes('--shots');
const SWITCH = !args.includes('--no-switch');
// --smart: behave like an attentive player — go to whoever is in danger, otherwise cycle slowly
const SMART = args.includes('--smart');
const OUT = resolve('tools/shots/night');
mkdirSync(OUT, { recursive: true });

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
const errors = [];
const warnings = new Map();
page.on('pageerror', (e) => {
  errors.push(`pageerror: ${e.message}`);
  console.log('[pageerror]', e.message);
});
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error') {
    errors.push(t);
    console.log('[console.error]', t.slice(0, 300));
  } else if (m.type() === 'warning' && !t.includes('no builder')) {
    warnings.set(t.slice(0, 160), (warnings.get(t.slice(0, 160)) ?? 0) + 1);
  }
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForFunction(() => window.__NS?.ready, null, { timeout: 60000 });
// capture subtitles / toasts / captions via the bus
await page.evaluate(() => {
  const s = window.__NS.services;
  window.__NSLOG = [];
  const push = (k, v) => window.__NSLOG.push(`${s.store.get().time.toFixed(1).padStart(6)} ${k} ${v}`);
  s.bus.on('event:fired', (p) => push('EVENT', `${p.id}${p.witnessed ? ' (witnessed via ' + p.view + ')' : ''}`));
  s.bus.on('clue:added', (p) => push('CLUE', p.clue.id));
  s.bus.on('choice:made', (p) => push('CHOICE', `${p.choice.id}=${p.choice.value}`));
  s.bus.on('phase:change', (p) => push('PHASE', p.phase));
  s.bus.on('power:change', (p) => push('POWER', p.power));
  s.bus.on('sound:change', (p) => push('SOUND', p.sound));
  s.bus.on('character:missing', (p) => push('MISSING', p.id));
  s.bus.on('ending', (p) => push('ENDING', p.ending));
  const ui = s.ui;
  const wrap = (name) => {
    const orig = ui[name].bind(ui);
    ui[name] = (...a) => {
      push(name.toUpperCase(), String(a[0]).slice(0, 110) + (a[2] ? ` [${a[2]}]` : ''));
      return orig(...a);
    };
  };
  ['subtitle', 'toast', 'caption'].forEach(wrap);
  const origChoice = ui.showChoice.bind(ui);
  ui.showChoice = (prompt, options, opts) => {
    push('ASK', `${String(prompt).slice(0, 80)} -> [${options.map((o) => o.id).join('|')}]`);
    return origChoice(prompt, options, opts);
  };
  const origDoc = ui.showDocument.bind(ui);
  ui.showDocument = (doc) => {
    push('DOC', `${doc.kind}: ${doc.title}`);
    return origDoc(doc);
  };
});
await page.mouse.click(5, 5);
await page.evaluate((seed) => window.__NS.newGame(seed), SEED);
await page.waitForFunction(() => window.__NS.state().screen === 'intro', null, { timeout: 30000 });
await sleep(1500);
await page.evaluate(() => window.__NS.skipIntro());
await page.waitForFunction(() => window.__NS.state().screen === 'playing', null, { timeout: 30000 });
const scenario = await page.evaluate(() => window.__NS.state().scenario);
console.log('[night] seed', SEED, 'scenario', scenario, 'scale', SCALE);
await page.evaluate((k) => {
  window.__NS.services.clock.timeScale = k;
}, SCALE);

const views = ['john', 'susie', 'paul', 'cctv'];
let vi = 0;
let lastLogLen = 0;
let lastSwitch = Date.now();
let shotN = 0;
const start = Date.now();
let lastT = -1;
let stuckSince = Date.now();
while (Date.now() - start < 30 * 60 * 1000) {
  await sleep(1000);
  const st = await page.evaluate(() => {
    const s = window.__NS.state();
    const ui = window.__NS.services.ui;
    return {
      screen: s.screen,
      time: s.time,
      view: s.activeView,
      modal: ui.modalOpen,
      switcher: ui.switcherOpen,
      log: window.__NSLOG.length,
      dangers: Object.values(s.characters).map((c) => `${c.id[0]}${c.danger.toFixed(2)}${c.missing ? '!' : ''}`).join(' '),
    };
  });
  const lines = await page.evaluate((from) => window.__NSLOG.slice(from), lastLogLen);
  lastLogLen += lines.length;
  for (const l of lines) console.log(l);
  if (st.screen === 'ending') {
    console.log('[night] reached ending screen at t =', st.time.toFixed(1));
    break;
  }
  if (st.time === lastT && st.screen === 'playing' && !st.modal) {
    if (Date.now() - stuckSince > 40000) {
      console.log('[night] CLOCK STALLED at', st.time, 'view', st.view);
      errors.push(`clock stalled at ${st.time}`);
      break;
    }
  } else stuckSince = Date.now();
  lastT = st.time;
  // answer choices / close documents
  if (st.modal) {
    await page.keyboard.press('Digit1');
    await sleep(300);
    const still = await page.evaluate(() => window.__NS.services.ui.modalOpen);
    if (still) {
      await page.keyboard.press('Escape');
      await sleep(200);
    }
  }
  if (SMART && st.screen === 'playing' && !st.modal) {
    const worst = await page.evaluate(() => {
      const s = window.__NS.state();
      const c = Object.values(s.characters).filter((x) => !x.missing).sort((a, b) => b.danger - a.danger)[0];
      return c && c.danger > 0.12 && s.activeView !== c.id ? c.id : null;
    });
    if (worst) {
      await page.evaluate((v) => window.__NS.switchView(v), worst).catch(() => {});
      lastSwitch = Date.now();
      console.log(`  .. t=${st.time.toFixed(1)} SMART -> ${worst}  danger: ${st.dangers}`);
      continue;
    }
  }
  if (SWITCH && Date.now() - lastSwitch > 9000 && st.screen === 'playing' && !st.modal) {
    vi = (vi + 1) % views.length;
    await page.evaluate((v) => window.__NS.switchView(v), views[vi]).catch(() => {});
    lastSwitch = Date.now();
    console.log(`  .. t=${st.time.toFixed(1)} switched to ${views[vi]}  danger: ${st.dangers}`);
  }
  if (SHOTS && Math.floor(st.time / 15) > shotN) {
    shotN = Math.floor(st.time / 15);
    await page.screenshot({ path: resolve(OUT, `t${String(Math.round(st.time)).padStart(3, '0')}_${st.view}.png`) });
  }
}
const final = await page.evaluate(() => {
  const s = window.__NS.state();
  return { ending: s.ending, clues: s.clues.map((c) => c.id), choices: s.choices.map((c) => `${c.id}=${c.value}`), fired: s.fired.length, witnessed: s.witnessed.length, missed: s.missed.length, flags: s.flags };
});
console.log('[night] FINAL', JSON.stringify(final));
if (SHOTS) await page.screenshot({ path: resolve(OUT, 'ending.png') });
console.log('[night] errors', errors.length);
for (const e of [...new Set(errors)].slice(0, 20)) console.log('   ', e.slice(0, 300));
console.log('[night] distinct warnings', warnings.size);
for (const [w, n] of [...warnings].slice(0, 15)) console.log(`   (${n}x) ${w}`);
writeFileSync(resolve(OUT, 'night.json'), JSON.stringify({ seed: SEED, scenario, final, errors, warnings: [...warnings] }, null, 2));
await browser.close();
server.kill();
process.exit(errors.length ? 1 : 0);

// NIGHT SHIFT — title briefing check (headless Chromium + SwiftShader, real clicks, keys and taps).
// The panel beside the menu, silence until the page's first gesture, the narration starting by itself,
// the text following the voice, the world ducking under it, the setting switching itself off once heard
// through, Listen/Stop, keyboard reach, New Shift fading it out, Settings re-arming it, a short window
// that scrolls, and the phone sheet. Screenshots: tools/shots/brief-*.png. Exit code 1 on any failure.
//
//   node tools/briefing.mjs                               (own no-HMR dev server on 5182)
//   node tools/briefing.mjs --url http://127.0.0.1:5173/  (an already-running server)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const getArg = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const PORT = Number(getArg('--port', '5182'));
const URL = getArg('--url', `http://127.0.0.1:${PORT}/`);
const SHOTS = resolve('tools/shots');
mkdirSync(SHOTS, { recursive: true });

const log = (...m) => console.log('[brief]', ...m);
const failures = [];
const errors = [];
const notes = [];
const check = (ok, label, detail = '') => {
  if (ok) log('ok  ', label, detail);
  else {
    failures.push(label);
    console.log('[brief] FAIL', label, detail);
  }
  return ok;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server = null;
if (!args.includes('--url')) {
  server = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--config', 'vite.qa.config.ts', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], {
    cwd: resolve('.'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => process.stdout.write(String(d)));
  process.on('exit', () => {
    try {
      server?.kill();
    } catch {
      /* already gone */
    }
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    try {
      if ((await fetch(URL)).ok) break;
    } catch {
      /* not yet */
    }
    await sleep(400);
  }
}

// No --autoplay-policy flag: the browser's real rule (sound only after a gesture) is part of the test.
const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
});

/** Everything the checks need in one round trip. */
const brief = (page) =>
  page.evaluate(() => {
    const s = window.__NS.services;
    const st = s.audio.narrationStatus();
    const rect = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return b.width && b.height ? { x: b.left, y: b.top, w: b.width, h: b.height } : null;
    };
    const live = document.querySelector('.ns-brief__line.is-live');
    const body = document.querySelector('.ns-brief__body');
    const media = s.audio.narration?.media ?? null;
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem('nightshift.settings.v1') || '{}').narration ?? null;
    } catch {
      /* none */
    }
    let liveInView = null;
    if (live && body) {
      const a = live.getBoundingClientRect();
      const b = body.getBoundingClientRect();
      liveInView = a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
    }
    return {
      state: st.state,
      time: st.time,
      duration: st.duration,
      narrating: document.querySelector('.ns-brief')?.classList.contains('is-narrating') ?? false,
      label: document.querySelector('.ns-brief__label')?.textContent ?? null,
      clock: document.querySelector('.ns-brief__time')?.textContent ?? null,
      live: live?.dataset.line ?? null,
      liveInView,
      lines: document.querySelectorAll('.ns-brief__line').length,
      endings: Array.from(document.querySelectorAll('.ns-brief__ending b')).map((b) => b.textContent),
      panel: rect(document.querySelector('.ns-brief')),
      opener: rect(document.querySelector('.ns-brief__opener')),
      menu: rect(document.querySelector('.ns-menu')),
      name: rect(document.querySelector('.ns-title__name')),
      kicker: rect(document.querySelector('.ns-title__kicker')),
      seed: rect(document.querySelector('.ns-seed')),
      sheet: document.querySelector('.ns-title')?.classList.contains('is-brief-open') ?? false,
      setting: s.store.get().settings.narration,
      saved,
      screen: s.store.get().screen,
      volume: media ? media.volume : null,
      paused: media ? media.paused : null,
      menuGain: s.audio.g ? s.audio.g.menu.gain.value : null,
      scrollTop: body ? body.scrollTop : 0,
      scrollable: body ? body.scrollHeight > body.clientHeight + 1 : false,
      focus: document.activeElement?.className ?? '',
      vw: innerWidth,
      vh: innerHeight,
    };
  });

const until = async (page, label, pred, timeout = 20000) => {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    last = await brief(page);
    if (pred(last)) return last;
    await sleep(200);
  }
  check(false, `timeout: ${label}`, JSON.stringify({ state: last?.state, time: last?.time?.toFixed(2), live: last?.live, sheet: last?.sheet, screen: last?.screen }));
  return last;
};

/** The panel against what is actually drawn in the title column (text extents, not full-width boxes). */
const layoutAt = (page) =>
  page.evaluate(() => {
    const box = (b) => (b && b.width && b.height ? { x: b.left, y: b.top, w: b.width, h: b.height } : null);
    const rect = (sel) => box(document.querySelector(sel)?.getBoundingClientRect());
    const text = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = document.createRange();
      r.selectNodeContents(el);
      return box(r.getBoundingClientRect());
    };
    const body = document.querySelector('.ns-brief__body');
    return {
      panel: rect('.ns-brief'),
      drawn: [text('.ns-title__kicker'), text('.ns-title__name'), text('.ns-title__sub'), rect('.ns-menu'), rect('.ns-seed')].filter(Boolean),
      fits: body ? body.scrollHeight <= body.clientHeight + 1 : false,
      vw: innerWidth,
      vh: innerHeight,
    };
  });

const inside = (r, vw, vh) => !!r && r.x >= 0 && r.y >= 0 && r.x + r.w <= vw + 0.5 && r.y + r.h <= vh + 0.5;
const overlaps = (a, b) => !!a && !!b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

async function openTitle(contextOpts) {
  const context = await browser.newContext(contextOpts);
  // Playwright runs page.evaluate as a user gesture, which would mark the page as activated before
  // any input. Report activation the way a browser does for a real visitor: after a click, tap or key.
  await context.addInitScript(() => {
    let active = false;
    const mark = (e) => {
      if (e.isTrusted) active = true;
    };
    for (const type of ['pointerdown', 'mousedown', 'keydown', 'touchend']) window.addEventListener(type, mark, { capture: true });
    Object.defineProperty(navigator, 'userActivation', { configurable: true, get: () => ({ hasBeenActive: active, isActive: active }) });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__NS?.ready, null, { timeout: 60000 });
  // start from a first visit (default settings, loaded at boot); low quality keeps SwiftShader's frame
  // rate up, since everything here (the fade, the highlight, the autoplay delay) runs on frames
  await page.evaluate(() => localStorage.setItem('nightshift.settings.v1', JSON.stringify({ quality: 'low' })));
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__NS?.ready && window.__NS.state().screen === 'title', null, { timeout: 60000 });
  return { context, page };
}

const shot = async (page, name) => {
  try {
    await page.screenshot({ path: `${SHOTS}/${name}.png`, timeout: 120000 });
  } catch (err) {
    notes.push(`screenshot ${name} skipped: ${String(err?.message ?? err).split('\n')[0]}`);
  }
};

const seekNear = (page, fromEnd) => page.evaluate((f) => {
  const m = window.__NS.services.audio.narration.media;
  m.currentTime = Math.max(0, m.duration - f);
}, fromEnd);
const seekTo = (page, t) => page.evaluate((x) => {
  window.__NS.services.audio.narration.media.currentTime = x;
}, t);

try {
  // -------------------------------------------------------------------------
  // 0) Desktop sizes: the whole briefing on screen, clear of the title column
  // -------------------------------------------------------------------------
  {
    const { context, page } = await openTitle({ viewport: { width: 1280, height: 720 } });
    for (const [w, h] of [
      [1024, 768],
      [1280, 720],
      [1366, 768],
      [1440, 900],
      [1920, 1080],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForFunction(([vw, vh]) => innerWidth === vw && innerHeight === vh, [w, h]);
      await sleep(300);
      const l = await layoutAt(page);
      check(inside(l.panel, l.vw, l.vh), `${w}x${h}: panel on screen`, JSON.stringify(l.panel));
      check(l.fits, `${w}x${h}: the whole briefing fits without scrolling`);
      check(!l.drawn.some((r) => overlaps(l.panel, r)), `${w}x${h}: panel clear of the title, menu and seed`, JSON.stringify({ panel: l.panel, drawn: l.drawn }));
      if (w === 1024 || w === 1920) await shot(page, `brief-00-${w}x${h}`);
    }
    await context.close();
  }

  // -------------------------------------------------------------------------
  // 1) Desktop: panel, silence until a gesture, then it reads itself
  // -------------------------------------------------------------------------
  {
    const { context, page } = await openTitle({ viewport: { width: 1280, height: 720 } });
    let b = await brief(page);
    check(b.lines === 14, 'all 14 briefing lines on the title', `lines=${b.lines}`);
    check(b.endings.join(' | ') === 'Morning Comes | A Rational Explanation | Something Came Through | Someone Missing', 'the four endings are listed', b.endings.join(' | '));
    check(inside(b.panel, b.vw, b.vh), 'panel fits on screen', JSON.stringify(b.panel));
    check(![b.menu, b.name, b.kicker, b.seed].some((r) => overlaps(b.panel, r)), 'panel clear of the title, menu and seed', JSON.stringify({ panel: b.panel, name: b.name, menu: b.menu }));
    check(b.opener === null, 'no Briefing menu item on a wide screen');
    check(b.label === 'Listen' && b.clock === '1:34', 'Listen button shows the length', `${b.label} ${b.clock}`);
    await sleep(2500);
    b = await brief(page);
    check(b.state === 'idle', 'silent until the first click or key', b.state);
    await shot(page, 'brief-01-title');

    await page.keyboard.press('ArrowDown');
    b = await until(page, 'starts by itself after the first key', (x) => x.state === 'playing');
    b = await until(page, 'button turns to Stop while it reads', (x) => x.narrating && x.label === 'Stop');
    b = await until(page, 'the recording plays', (x) => x.time > 1);
    check(b.time > 1, 'the recording plays', b.time.toFixed(2));
    b = await until(page, 'first line highlighted', (x) => x.live === 'who', 8000);
    check(b.live === 'who', 'first line highlighted', String(b.live));
    b = await until(page, 'title ambience ducks under the voice', (x) => x.menuGain !== null && Math.abs(x.menuGain - 0.14) < 0.03);
    check(Math.abs(b.menuGain - 0.14) < 0.03, 'title ambience ducks under the voice', b.menuGain.toFixed(3));
    check(b.volume !== null && Math.abs(b.volume - Math.pow(0.8, 1.5)) < 0.02, 'voice at the master level', String(b.volume?.toFixed(3)));
    b = await until(page, 'second line', (x) => x.live === 'cast', 15000);
    await shot(page, 'brief-02-narrating');

    await page.evaluate(() => window.__NS.services.store.setSettings({ masterVolume: 0.5 }));
    b = await brief(page);
    check(Math.abs(b.volume - Math.pow(0.5, 1.5)) < 0.02, 'master volume moves the voice', b.volume.toFixed(3));
    await page.evaluate(() => window.__NS.services.store.setSettings({ masterVolume: 0.8 }));

    await seekNear(page, 2.5);
    b = await until(page, 'reaches the end', (x) => x.state === 'ended', 20000);
    b = await until(page, 'heard through: the setting switches itself off', (x) => x.setting === false, 8000);
    check(b.setting === false && b.saved === false, 'heard through: Title narration switches itself off (saved)', `${b.setting} / saved ${b.saved}`);
    b = await until(page, 'back to Listen', (x) => x.label === 'Listen' && !x.narrating && x.live === null, 8000);
    check(b.label === 'Listen' && b.live === null, 'back to Listen, no highlight', `${b.label} ${b.live}`);
    b = await until(page, 'ambience comes back up', (x) => Math.abs(x.menuGain - 0.35) < 0.03, 8000);
    check(Math.abs(b.menuGain - 0.35) < 0.03, 'ambience comes back up', b.menuGain.toFixed(3));

    await page.click('.ns-brief__listen');
    b = await until(page, 'Listen replays', (x) => x.state === 'playing' && x.label === 'Stop');
    check(b.time < 3, 'replays from the top', b.time.toFixed(2));
    await page.click('.ns-brief__listen');
    b = await until(page, 'Stop', (x) => x.state === 'stopped' && x.label === 'Listen', 8000);
    check(b.state === 'stopped' && b.label === 'Listen', 'Stop', `${b.state} ${b.label}`);
    b = await until(page, 'faded out and paused', (x) => x.paused === true, 3000);
    check(b.paused === true, 'faded out and paused (within the fade + backstop)', String(b.paused));

    // keyboard: up from New Shift wraps round to Listen; Enter plays, Enter stops
    await page.hover('[data-act="new"]');
    await page.mouse.move(640, 700);
    await page.keyboard.press('ArrowUp');
    b = await until(page, 'keyboard reaches Listen', (x) => /ns-brief__listen/.test(x.focus), 5000);
    check(/ns-brief__listen/.test(b.focus), 'keyboard reaches Listen (up from New Shift)', b.focus);
    await page.keyboard.press('Enter');
    b = await until(page, 'Enter plays', (x) => x.state === 'playing');
    await page.keyboard.press('Enter');
    b = await until(page, 'Enter stops', (x) => x.state === 'stopped', 5000);
    check(b.state === 'stopped', 'Enter stops', b.state);

    // starting a shift fades the voice out under the intro
    await page.click('.ns-brief__listen');
    await until(page, 'playing before New Shift', (x) => x.state === 'playing');
    await page.click('[data-act="new"]');
    b = await until(page, 'fades under the intro', (x) => x.paused === true && x.screen !== 'title', 8000);
    check(b.state === 'stopped', 'New Shift stops the briefing', `${b.state} on ${b.screen}`);
    await context.close();
  }

  // -------------------------------------------------------------------------
  // 2) Heard once: no autoplay next visit; Settings switches it back on
  // -------------------------------------------------------------------------
  {
    const { context, page } = await openTitle({ viewport: { width: 1280, height: 720 } });
    await page.evaluate(() => window.__NS.services.store.setSettings({ narration: false }));
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__NS?.ready && window.__NS.state().screen === 'title', null, { timeout: 60000 });
    await page.keyboard.press('ArrowDown');
    await sleep(2500);
    let b = await brief(page);
    check(b.state === 'idle', 'once heard, the next visit stays quiet', b.state);
    await page.click('[data-act="settings"]');
    await page.click('.ns-row[data-key="narration"] .ns-toggle');
    b = await brief(page);
    check(b.setting === true, 'Settings → Title narration on', String(b.setting));
    await page.keyboard.press('Escape');
    // loading is enough: it started by itself again (a slow machine can take a while to begin playback)
    b = await until(page, 'reads again once switched back on', (x) => x.screen === 'title' && (x.state === 'loading' || x.state === 'playing'), 15000);
    await context.close();
  }

  // -------------------------------------------------------------------------
  // 3) A short window: the text scrolls and follows the voice
  // -------------------------------------------------------------------------
  {
    const { context, page } = await openTitle({ viewport: { width: 1280, height: 560 } });
    let b = await brief(page);
    check(inside(b.panel, b.vw, b.vh), 'short window: panel fits', JSON.stringify(b.panel));
    check(b.scrollable, 'short window: the text scrolls');
    await page.click('.ns-brief__listen');
    await until(page, 'short window: playing', (x) => x.state === 'playing');
    const cue = await page.evaluate(async () => (await import('/src/ui/briefing.cues.ts')).BRIEFING_CUES.lines.missing.start);
    await seekTo(page, cue + 0.5);
    b = await until(page, 'short window: on the last ending', (x) => x.live === 'missing', 10000);
    b = await until(page, 'short window: the spoken line scrolls into view', (x) => x.liveInView === true && x.scrollTop > 0, 10000);
    check(b.liveInView === true && b.scrollTop > 0, 'short window: the spoken line is scrolled into view', `scrollTop=${b.scrollTop}`);
    await shot(page, 'brief-03-short-window');
    await context.close();
  }

  // -------------------------------------------------------------------------
  // 4) Phones: a Briefing menu item opens the sheet, which reads itself
  // -------------------------------------------------------------------------
  for (const [name, vp] of [
    ['portrait', { width: 390, height: 844 }],
    ['landscape', { width: 844, height: 390 }],
  ]) {
    const { context, page } = await openTitle({ viewport: vp, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    let b = await brief(page);
    check(b.panel === null && b.opener !== null, `phone ${name}: Briefing in the menu, no side panel`, JSON.stringify({ panel: b.panel, opener: b.opener }));
    // the extra menu item must not push the title stack off screen or into the footer
    const stack = await page.evaluate(() => {
      const r = (sel) => {
        const e = document.querySelector(sel)?.getBoundingClientRect();
        return e && e.height ? { top: e.top, bottom: e.bottom } : null;
      };
      return { inner: r('.ns-title__inner'), seed: r('.ns-seed'), footer: r('.ns-title__footer'), vh: innerHeight };
    });
    const clear = stack.inner && stack.inner.top >= 0 && stack.inner.bottom <= stack.vh && (!stack.footer || !stack.seed || stack.seed.bottom <= stack.footer.top);
    check(clear, `phone ${name}: title stack on screen and clear of the footer`, JSON.stringify(stack));
    await shot(page, `brief-04-phone-${name}-title`);
    await page.tap('.ns-brief__opener');
    b = await until(page, `phone ${name}: sheet reads itself`, (x) => x.sheet && x.state === 'playing');
    check(inside(b.panel, b.vw, b.vh) && b.panel.h > b.vh * 0.8, `phone ${name}: sheet fills the screen`, JSON.stringify(b.panel));
    check(/ns-brief__listen/.test(b.focus), `phone ${name}: focus moves to Listen`, b.focus);
    await sleep(1200);
    await shot(page, `brief-04-phone-${name}`);
    await page.tap('[data-act="briefclose"]');
    b = await until(page, `phone ${name}: Back closes and stops`, (x) => !x.sheet && x.state === 'stopped');
    check(/ns-brief__opener/.test(b.focus), `phone ${name}: focus returns to Briefing`, b.focus);
    b = await until(page, `phone ${name}: voice faded out`, (x) => x.paused === true, 3000);
    await context.close();
  }
} catch (err) {
  failures.push(`exception: ${err?.message ?? err}`);
  console.error(err);
} finally {
  await browser.close();
}

const real = errors.filter((e) => !/favicon|AudioContext was not allowed/i.test(e));
for (const e of real.slice(0, 10)) console.log('[brief] error:', e);
for (const n of notes) console.log('[brief] note:', n);
console.log(`[brief] ${failures.length === 0 && real.length === 0 ? 'PASS' : 'FAIL'} — ${failures.length} failed checks, ${real.length} page/console errors`);
process.exit(failures.length === 0 && real.length === 0 ? 0 : 1);

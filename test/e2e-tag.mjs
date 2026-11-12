// End-to-end test of 술래잡기 (real-time tag) on the Firebase emulators: two browsers, bots, 얼음땡, host takeover.
//   npm run test:e2e   (runs inside `firebase emulators:exec`)
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import fs from 'fs';
import http from 'http';
import path from 'path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SDK_DIR = process.env.FIREBASE_SDK_DIR || path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS || path.join(ROOT, 'shots');
const NS = 'demo-hos-default-rtdb', DBURL = 'http://127.0.0.1:9000';
const VERSION = /VERSION = '([\d.]+)'/.exec(fs.readFileSync(path.join(ROOT, 'src/backend-firebase.js'), 'utf8'))[1];
fs.mkdirSync(SHOTS, { recursive: true });
const TEST_CONFIG = `window.FIREBASE_CONFIG = ${JSON.stringify({
  apiKey: 'demo-key', authDomain: 'demo-hos.firebaseapp.com', projectId: 'demo-hos', databaseURL: `https://${NS}.firebaseio.com`, appId: '1:1:web:1',
  emulator: { auth: 'http://127.0.0.1:9099', dbHost: '127.0.0.1', dbPort: 9000 },
})};`;
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (cond, msg) => { if (!cond) errors.push('FAIL ' + msg); else console.log('ok  ', msg); };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const f = p.endsWith('/') ? path.join(p, 'index.html') : p;
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://localhost:${server.address().port}/`;

async function table(room) {
  const r = await fetch(`${DBURL}/rooms/${room}/table.json?ns=${NS}`, { headers: { Authorization: 'Bearer owner' } });
  const v = await r.json();
  return v && v.j ? JSON.parse(v.j) : null;
}
async function until(fn, ms = 20000, step = 250) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(step); } }
async function newPlayer(browser, label, extra) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, ...(extra || {}) });
  await ctx.route(/^https:\/\/www\.gstatic\.com\/firebasejs\//, r => {
    const u = new URL(r.request().url()), f = path.join(SDK_DIR, path.basename(u.pathname));
    return u.pathname.includes(`/${VERSION}/`) && fs.existsSync(f) ? r.fulfill({ path: f, contentType: 'application/javascript' }) : r.abort();
  });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.route('**/firebase-config.js', r => r.fulfill({ contentType: 'application/javascript', body: TEST_CONFIG }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|fonts\./.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
  page.on('pageerror', e => errors.push(`${label} pageerror: ${e}`));
  return { ctx, page, label };
}
const roomOf = page => page.evaluate(() => location.hash.slice(1));
const shot = (p, name) => p.page.screenshot({ path: path.join(SHOTS, name + '.png') });
async function sit(p, name) {
  await p.page.locator('#gDock .sitbtn, #gStage .gplate.sit').first().click();
  await p.page.locator('#nameInput').fill(name);
  await p.page.locator('.modal .btn.primary').click();
  await p.page.locator('#gDock .gmine').waitFor({ timeout: 10000 });
}
async function createFromLobby(p, gameId) {
  await p.page.goto(BASE);
  if (await p.page.locator('#splash').isVisible()) await p.page.locator('#startBtn').click();
  await p.page.locator(`.lb-game[data-game="${gameId}"] .btn.primary`).click();
  await p.page.locator(gameId === 'holdem' ? '#app:not([hidden])' : '#gapp:not([hidden])').waitFor({ timeout: 10000 });
  return roomOf(p.page);
}
const dockBtn = (p, text) => p.page.locator(`#gDock .btn:has-text("${text}")`);


async function presence(room) {
  const r = await fetch(`${DBURL}/rooms/${room}/presence.json?ns=${NS}`, { headers: { Authorization: 'Bearer owner' } });
  const v = (await r.json()) || {};
  return Object.entries(v).map(([tab, x]) => ({ tab, by: x.by, ...(JSON.parse(x.p || '{}')) }));
}
const posOf = async (room, uid) => { const p = (await presence(room)).find(x => x.uid === uid && x.g && x.g.p); return p ? { x: p.g.p[0], y: p.g.p[1] } : null; };
async function hold(p, key, ms) { await p.page.keyboard.down(key); await sleep(ms); await p.page.keyboard.up(key); }

const browser = await chromium.launch();
try {
  const A = await newPlayer(browser, 'A'), B = await newPlayer(browser, 'B', { hasTouch: true, isMobile: true });
  const room = await createFromLobby(A, 'tag');
  ok(/^T[A-Z2-9]{6}$/.test(room), 'tag room code ' + room);
  ok(await A.page.locator('#gStage canvas').isVisible(), 'map canvas shown');
  await sleep(400); await shot(A, '30-tag-spectator');
  await sit(A, '민수');
  let t = await until(() => table(room));
  const uA = t.seats[0].uid;
  let pa = await until(() => posOf(room, uA));
  ok(!!pa, 'my runner position is published in presence: ' + JSON.stringify(pa));
  await hold(A, 'ArrowRight', 700);
  const pa2 = await until(async () => { const q = await posOf(room, uA); return q && q.x > pa.x + 60 ? q : null; }, 4000);
  ok(!!pa2, 'arrow keys move the runner: ' + JSON.stringify(pa) + ' → ' + JSON.stringify(pa2));

  await B.page.goto(BASE + '#' + room);
  await B.page.locator('#gapp:not([hidden])').waitFor({ timeout: 10000 });
  await sit(B, '지영');
  t = await until(async () => { const x = await table(room); return x && x.seats.filter(Boolean).length === 2 ? x : null; });
  const uB = t.seats.find(s => s && s.name === '지영').uid;
  ok(await until(() => B.page.evaluate(u => !!HOGames.tag.debug.rp[u], uA)), 'B receives A’s position');
  // B is on a phone: put a finger on the map and drag (floating joystick)
  const pb = await until(() => posOf(room, uB));
  const box = await B.page.locator('#gStage canvas').boundingBox();
  const cdp = await B.ctx.newCDPSession(B.page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: box.x + x, y: box.y + y }] });
  const dir = pb.y > 600 ? -1 : 1;
  await touch('touchStart', 150, 300);
  for (let k = 1; k <= 4; k++) { await touch('touchMove', 150, 300 + dir * 15 * k); await sleep(30); }
  await B.page.screenshot({ path: path.join(SHOTS, '32-tag-joystick.png') });
  await sleep(700); await touch('touchEnd');
  const pb2 = await until(async () => { const q = await posOf(room, uB); return q && (q.y - pb.y) * dir > 60 ? q : null; }, 4000);
  ok(!!pb2, 'dragging a finger on the map moves the runner: ' + JSON.stringify(pb) + ' → ' + JSON.stringify(pb2));
  const before = await posOf(room, uB);
  await B.page.locator('.tg-btn.dash').tap();
  ok(await until(() => B.page.evaluate(() => HOGames.tag.debug.me.dashReady > performance.now())), 'dash button works on touch');
  await sleep(300); await shot(A, '31-tag-wait');

  // a 30 second round
  await A.page.locator('#gDock .tg-seg button:text-is("30초")').click();
  ok(await until(async () => { const x = await table(room); return x && x.game.opt.dur === 30; }), 'round length set to 30s');
  await dockBtn(A, '게임 시작').click();
  t = await until(async () => { const x = await table(room); return x && x.game.phase === 'count' ? x : null; }, 8000, 100);
  ok(!!t, 'countdown started');
  await sleep(300); await shot(A, '33-tag-count'); await shot(B, '34-tag-count-B');
  t = await until(async () => { const x = await table(room); return x && x.game.phase === 'play' ? x : null; }, 8000, 150);
  ok(!!t, 'round is on');
  const P = { [uA]: A, [uB]: B };
  const seatOf = (x, u) => x.seats.findIndex(s => s && s.uid === u);
  // whoever is "it" walks up to the other one (teleport in the test), twice: once on each device
  for (let k = 0; k < 2; k++) {
    const x = await table(room), it = x.seats[x.game.it].uid, run = it === uA ? uB : uA;
    await sleep(Math.max(0, x.game.stun - Date.now()) + 2600);
    const target = await posOf(room, run);
    await P[it].page.evaluate(([tx, ty]) => { const m = HOGames.tag.debug.me; m.x = tx + 28; m.y = ty; }, [target.x, target.y]);
    const after = await until(async () => { const y = await table(room); return y && y.game.it === seatOf(y, run) ? y : null; }, 6000, 100);
    ok(!!after && after.game.ev.k === 'tag', `tag ${k + 1}: ${P[it].label} (${it === uA ? 'host' : 'guest'}) touches the runner and passes "it"`);
    if (k === 0) { await sleep(250); await shot(P[run], '35-tag-caught'); }
  }
  t = await until(async () => { const x = await table(room); return x && x.game.phase === 'over' ? x : null; }, 40000, 500);
  ok(t && t.game.res.length === 2 && t.game.res[0].ms <= t.game.res[1].ms, 'round ends with results: ' + (t ? t.game.res.map(r => `${r.n} ${r.ms}ms`).join(', ') : ''));
  ok(t && t.seats.some(s => s && s.w === 1), 'winner credited');
  await sleep(300); await shot(A, '36-tag-results');

  // 얼음땡 with a bot
  await A.page.locator('#gDock .botpill').click();
  ok(await until(async () => { const x = await table(room); return x && x.seats.some(s => s && s.bot); }), 'bot joined');
  await A.page.locator('#gDock .tg-seg button:has-text("얼음땡")').click();
  ok(await until(async () => { const x = await table(room); return x && x.game.opt.mode === 'ice'; }), 'mode set to 얼음땡');
  const hostBots = async () => { const x = await table(room), h = (await presence(room)).find(p => p.tab === x.hostTab); return h && h.g && h.g.b ? Object.values(h.g.b)[0] : null; };
  const b1 = await until(hostBots);
  await sleep(1500);
  const b2 = await hostBots();
  ok(b1 && b2 && (b1[0] !== b2[0] || b1[1] !== b2[1]), 'host moves the bot and publishes it: ' + JSON.stringify(b1) + ' → ' + JSON.stringify(b2));
  await dockBtn(A, '한 판 더').click().catch(() => dockBtn(A, '게임 시작').click());
  t = await until(async () => { const x = await table(room); return x && x.game.phase === 'play' && x.game.rd === 2 ? x : null; }, 15000, 150);
  ok(!!t && Object.keys(t.game.pl).length === 3, '3 runners in round 2');
  const runner = [A, B].find(p => seatOf(t, p === A ? uA : uB) !== t.game.it);
  await runner.page.keyboard.press('KeyE');
  t = await until(async () => { const x = await table(room); const s = seatOf(x, runner === A ? uA : uB); return x.game.ice[s] != null || (x.game.ev && x.game.ev.k === 'all') ? x : null; }, 5000, 100);
  ok(!!t, `${runner.label} froze with E (얼음)`);
  await sleep(250); await shot(runner, '37-tag-ice');

  // the host device leaves: the other player takes over and keeps the bot running
  const host0 = await table(room);
  await A.ctx.close();
  t = await until(async () => { const x = await table(room); return x && x.hostTab !== host0.hostTab ? x : null; }, 30000);
  ok(!!t, 'B takes over when the host leaves');
  const c1 = await until(hostBots, 8000);
  await sleep(1200);
  const c2 = await hostBots();
  ok(c1 && c2 && (c1[0] !== c2[0] || c1[1] !== c2[1]), 'the new host moves the bot');
  await sleep(300); await shot(B, '38-tag-takeover');
} finally {
  await browser.close();
  server.close();
}
console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 30).join('\n') : '\nall tag e2e checks passed');
process.exit(errors.length ? 1 : 0);

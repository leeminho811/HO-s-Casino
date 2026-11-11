// End-to-end test of the splash → lobby flow and the table games on the Firebase emulators.
//   npm run test:e2e   (runs e2e-firebase.mjs and this file inside `firebase emulators:exec`)
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
async function newPlayer(browser, label) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
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

const browser = await chromium.launch();
try {
  const A = await newPlayer(browser, 'A'), B = await newPlayer(browser, 'B');

  // ---- splash and lobby
  await A.page.goto(BASE);
  ok(await A.page.locator('#splash .sp-title').isVisible(), 'splash shows the big title');
  ok(!(await A.page.locator('#lobby').isVisible()), 'lobby hidden behind the splash');
  await shot(A, '10-splash');
  await A.page.locator('#startBtn').click();
  ok(await A.page.locator('#lobby').isVisible() && (await A.page.locator('.lb-game').count()) === 5, 'START opens the lobby with 5 games');
  ok((await A.page.locator('.lb-game .lb-body p').allInnerTexts()).every(t => t.length > 15), 'every game has a description');
  await A.page.locator('.lb-game[data-game="seotda"] .btn.ghost').click();
  ok(await A.page.locator('.lb-game[data-game="seotda"] .rules').isVisible(), '“게임 방법” expands the rules');
  await shot(A, '11-lobby');
  await A.page.evaluate(() => document.querySelector('#lobbyBody').scrollTo(0, 99999));
  await shot(A, '11-lobby-bottom');

  // ---- hold'em still works from the lobby
  let room = await createFromLobby(A, 'holdem');
  ok(/^[A-Z2-9]{6}$/.test(room), 'hold’em room code ' + room);
  await A.page.locator('.seat.tap .plate').first().click();
  await A.page.locator('#nameInput').fill('민수'); await A.page.locator('.modal .btn.primary').click();
  ok(await until(async () => { const t = await table(room); return t && t.seats.filter(Boolean).length === 1; }), 'hold’em table created from the lobby');
  await shot(A, '12-holdem');
  await A.page.locator('#menuBtn').click();
  await A.page.locator('.sheet .btn:has-text("로비로 나가기")').click();
  await A.page.locator('#lobby:not([hidden])').waitFor({ timeout: 10000 });
  ok(!(await A.page.locator('#splash').isVisible()), 'back to the lobby (no splash again)');
  ok(await A.page.locator('.lb-recent button').count() >= 1, 'recent room is listed');

  // ---- blackjack: two players against the dealer
  room = await createFromLobby(A, 'blackjack');
  ok(/^B[A-Z2-9]{6}$/.test(room), 'blackjack room code ' + room);
  await sit(A, '민수');
  // B joins by typing the code in the lobby
  await B.page.goto(BASE); await B.page.locator('#startBtn').click();
  await B.page.locator('#joinCode').fill(room.toLowerCase()); await B.page.locator('#joinBtn').click();
  await B.page.locator('#gapp:not([hidden])').waitFor({ timeout: 10000 });
  ok((await roomOf(B.page)) === room, 'joined the same room by code');
  await sit(B, '지영');
  for (const p of [A, B]) { await p.page.locator('#gDock .chipbtn.c100').click(); await p.page.locator('#gDock .chipbtn.c50').click(); await dockBtn(p, '베팅 완료').click(); }
  ok(await until(async () => { const t = await table(room); return t && t.game.phase !== 'bet' && t.game.no === 1; }), 'cards dealt once both are ready');
  await sleep(500); await shot(B, '13-blackjack-play');
  let t = await until(async () => {
    for (const p of [A, B]) { const s = dockBtn(p, '스탠드'); if (await s.count()) { const hit = dockBtn(p, '히트'); try { await (Math.random() < 0.4 ? hit : s).click({ timeout: 1000 }); } catch (e) { /* re-rendered */ } } }
    const x = await table(room); return x && x.game.phase === 'done' ? x : null;
  }, 60000, 400);
  ok(!!t, 'blackjack round finished');
  if (t) {
    const exp = t.seats.filter(Boolean).every((s, i) => { const h = t.game.hands[i]; return s.stack === 1000 - h.bet + h.pay; });
    ok(exp, 'stacks match the payouts: ' + t.seats.filter(Boolean).map((s, i) => `${s.name} ${t.game.hands[i].res} ${s.stack}`).join(', '));
    ok(t.game.dealer.length >= 2, 'dealer revealed: ' + t.game.dealer.join(' '));
  }
  await sleep(400); await shot(A, '14-blackjack-done');
  await A.page.locator('#gMenu').click(); await sleep(200); await shot(A, '15-game-menu');
  await A.page.locator('.sheet .btn.ghost:has-text("닫기")').click();

  // ---- roulette
  room = await createFromLobby(A, 'roulette');
  ok(/^R/.test(room), 'roulette room code ' + room);
  await sit(A, '민수');
  await A.page.locator('#gDock .chipbtn.c50').click();
  await A.page.locator('.rc:text-is("17")').click();
  await A.page.locator('.rc:text-is("빨강")').click();
  await A.page.locator('.rc:text-is("빨강")').click();
  ok(await until(async () => { const x = await table(room); return x && x.game.bets[0] && x.game.bets[0].red === 100 && x.game.bets[0].n17 === 50 && x.seats[0].stack === 850; }), 'roulette bets recorded and chips taken');
  await shot(A, '16-roulette-bet');
  await dockBtn(A, '베팅 완료').click();
  ok(await until(async () => { const x = await table(room); return x && x.game.phase === 'spin'; }), 'wheel spins once the only player is ready');
  t = await until(async () => { const x = await table(room); return x && x.game.phase === 'done' ? x : null; }, 15000);
  if (t) {
    const n = t.game.result, red = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(n);
    const pay = (n === 17 ? 50 * 36 : 0) + (red ? 200 : 0);
    ok(t.seats[0].stack === 850 + pay, `roulette result ${n} → stack ${t.seats[0].stack}`);
  } else ok(false, 'roulette round finished');
  await sleep(300); await shot(A, '17-roulette-done');

  // ---- baccarat
  room = await createFromLobby(A, 'baccarat');
  await sit(A, '민수');
  await A.page.locator('#gDock .chipbtn.c100').click();
  await A.page.locator('.bc-spot.b').click(); await A.page.locator('.bc-spot.t').click();
  await dockBtn(A, '베팅 완료').click();
  t = await until(async () => { const x = await table(room); return x && x.game.phase === 'done' ? x : null; }, 25000);
  if (t) {
    const w = t.game.win, pay = w === 'b' ? 195 : w === 't' ? 100 + 900 : 0;
    ok(t.seats[0].stack === 800 + pay, `baccarat ${t.game.P.join(' ')} vs ${t.game.B.join(' ')} → ${w}, stack ${t.seats[0].stack}`);
  } else ok(false, 'baccarat round finished');
  await sleep(300); await shot(A, '18-baccarat-done');

  // ---- seotda: hidden cards, betting, showdown, host takeover
  room = await createFromLobby(A, 'seotda');
  await sit(A, '민수');
  await B.page.goto(BASE + '#' + room);
  await B.page.locator('#gapp:not([hidden])').waitFor({ timeout: 10000 });
  await sit(B, '지영');
  await shot(A, '19-seotda-lobby');
  await dockBtn(A, '게임 시작').click();
  t = await until(async () => { const x = await table(room); return x && x.game.phase === 'bet' ? x : null; });
  ok(!!t, 'seotda hand dealt');
  ok(t && Object.values(t.game.enc).length === 2 && Object.values(t.game.enc).every(b => b.ct && !b.p), 'hole cards are encrypted in the shared state');
  ok(t && !JSON.stringify(t.game.shown).includes('A') && !JSON.stringify(t.game.shown).includes('B'), 'no cards shown before the showdown');
  for (const p of [A, B]) ok(await until(async () => (await p.page.locator('#gDock .hwrow.big .hw:not(.back)').count()) === 2, 8000), `${p.label} sees own two hwatu cards`);
  await shot(B, '20-seotda-bet');
  let raised = false;
  t = await until(async () => {
    for (const p of [A, B]) {
      const call = p.page.locator('#gDock .btn.call'); if (!(await call.count())) continue;
      const half = dockBtn(p, '하프');
      try { if (!raised && await half.isEnabled()) { await half.click({ timeout: 1000 }); raised = true; } else await call.click({ timeout: 1000 }); } catch (e) { /* re-rendered */ }
    }
    const x = await table(room); return x && x.game.phase === 'show' ? x : null;
  }, 40000, 400);
  ok(!!t && t.game.res.show && Object.keys(t.game.shown).length === 2, 'showdown reveals both hands: ' + (t ? Object.values(t.game.res.names).join(' vs ') : ''));
  ok(t && t.seats.filter(Boolean).reduce((a, s) => a + s.stack, 0) === 2000, 'seotda chips conserved');
  await sleep(300); await shot(A, '21-seotda-show');
  const before = await table(room);
  await A.ctx.close();
  t = await until(async () => { const x = await table(room); return x && x.hostTab !== before.hostTab ? x : null; }, 30000);
  ok(!!t, 'another player takes over when the host device leaves');
  t = await until(async () => {
    const call = B.page.locator('#gDock .btn.call'); if (await call.count()) { try { await call.click({ timeout: 1000 }); } catch (e) { /* re-rendered */ } }
    const x = await table(room); return x && x.game.no > before.game.no + 1 ? x : null;
  }, 90000, 500);
  ok(!!t, 'seotda keeps dealing after the takeover');
  const P = t ? t.seats.filter(Boolean) : [];
  const inPot = t && t.game.phase === 'bet' ? Object.values(t.game.ps).reduce((a, p) => a + p.in, 0) : 0;
  ok(P.reduce((a, s) => a + s.stack, 0) + inPot === P.reduce((a, s) => a + s.buyin, 0), 'chips still conserved after the takeover');
} finally {
  await browser.close();
  server.close();
}
console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 30).join('\n') : '\nall game e2e checks passed');
process.exit(errors.length ? 1 : 0);

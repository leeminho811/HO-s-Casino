// End-to-end test against the Firebase emulators: 3 separate browsers (separate anonymous
// users) join one room, play, react, reload, lose the dealer, and keep playing.
//   npm run test:e2e          (= firebase emulators:exec --only auth,database --project demo-hos "node test/e2e-firebase.mjs")
// Env: FIREBASE_SDK_DIR (folder of the npm "firebase" package), SHOTS (screenshot folder), PLAY_SECONDS.
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
const PLAY = Number(process.env.PLAY_SECONDS || 40) * 1000;
const NS = 'demo-hos-default-rtdb';
const DBURL = 'http://127.0.0.1:9000';
const ROOM = 'E2E' + Math.random().toString(36).slice(2, 7).toUpperCase();
const VERSION = /VERSION = '([\d.]+)'/.exec(fs.readFileSync(path.join(ROOT, 'src/backend-firebase.js'), 'utf8'))[1];
const SDK_URL = `https://www.gstatic.com/firebasejs/${VERSION}/`;
const sdkVer = JSON.parse(fs.readFileSync(path.join(SDK_DIR, 'package.json'), 'utf8')).version;
if (sdkVer !== VERSION) { console.error(`firebase SDK ${sdkVer} in ${SDK_DIR}, but the page loads ${VERSION}`); process.exit(2); }
fs.mkdirSync(SHOTS, { recursive: true });

const TEST_CONFIG = `window.FIREBASE_CONFIG = ${JSON.stringify({
  apiKey: 'demo-key', authDomain: 'demo-hos.firebaseapp.com', projectId: 'demo-hos',
  databaseURL: `https://${NS}.firebaseio.com`, appId: '1:1:web:1',
  emulator: { auth: 'http://127.0.0.1:9099', dbHost: '127.0.0.1', dbPort: 9000 },
})};`;

const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = n => Math.floor(Math.random() * n);

// ---- static file server for the repo root ----
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const f = p.endsWith('/') ? path.join(p, 'index.html') : p;
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://localhost:${server.address().port}/`;

async function readDb(p) {
  const r = await fetch(`${DBURL}/${p}.json?ns=${NS}`, { headers: { Authorization: 'Bearer owner' } });
  return r.json();
}
async function table() {
  const v = await readDb(`rooms/${ROOM}/table`);
  return v && v.j ? Object.assign(JSON.parse(v.j), { _bytes: v.j.length }) : null;
}
function check(t, tag) {
  if (!t) return;
  const seats = t.seats.filter(Boolean);
  const stacks = seats.reduce((a, s) => a + s.stack, 0), buy = seats.reduce((a, s) => a + s.buyin, 0);
  const h = t.hand;
  const inpot = h && h.phase !== 'done' ? h.ps.reduce((a, p) => a + (p ? p.total : 0), 0) : 0;
  if (stacks + inpot !== buy) errors.push(`${tag}: chip mismatch stacks=${stacks} inpot=${inpot} buyin=${buy}`);
  if (h && h.enc) for (const [k, box] of Object.entries(h.enc)) if (box.p || !box.ct) errors.push(`${tag}: seat ${k} hole cards not encrypted`);
}

async function newPlayer(browser, label, { config = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await ctx.route(/^https:\/\/www\.gstatic\.com\/firebasejs\//, r => {
    const u = new URL(r.request().url());
    const f = path.join(SDK_DIR, path.basename(u.pathname));
    if (!u.pathname.includes(`/${VERSION}/`) || !fs.existsSync(f)) return r.abort();
    return r.fulfill({ path: f, contentType: 'application/javascript' });
  });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.route('**/firebase-config.js', r => r.fulfill({ contentType: 'application/javascript', body: config ? TEST_CONFIG : 'window.FIREBASE_CONFIG = { apiKey: "여기에_붙여넣기" };' }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(4000);
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|fonts\./.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
  page.on('pageerror', e => errors.push(`${label} pageerror: ${e}`));
  return { ctx, page, label };
}

async function clickIf(page, sel) {
  const loc = page.locator(sel);
  if (await loc.count() && await loc.first().isEnabled()) { await loc.first().click({ timeout: 2000 }); return true; }
  return false;
}
async function playTurn(page) {
  if (await page.locator('.raise-panel').count()) {
    const presets = page.locator('.presets button');
    await presets.nth(rand(await presets.count())).click();
    await page.locator('.raise-panel .btn.raise').click();
    return 'raise';
  }
  const call = page.locator('.actions .btn.call');
  if (!(await call.count())) {
    if (await clickIf(page, '.actions .btn.primary:has-text("리바이")')) return 'rebuy';
    if (await clickIf(page, '.actions .btn.primary:has-text("복귀")')) return 'back';
    return null;
  }
  const r = Math.random();
  if (r < 0.15) { await page.locator('.actions .btn.fold').click(); return 'fold'; }
  if (r < 0.35 && await page.locator('.actions .btn.raise:not([disabled])').count()) { await page.locator('.actions .btn.raise').click(); return 'open-raise'; }
  await call.click();
  return 'call';
}
async function playFor(ms, players, tag, onLoop) {
  const t0 = Date.now(); let acts = 0; const hands = new Set();
  while (Date.now() - t0 < ms) {
    for (const p of players) { try { if (await playTurn(p.page)) acts++; } catch (e) { /* DOM re-rendered mid-click */ } }
    const t = await table(); check(t, tag);
    if (t && t.hand) hands.add(t.hand.no);
    if (onLoop) await onLoop(t);
    await sleep(300);
  }
  return { acts, hands: hands.size };
}
const ok = (cond, msg) => { if (!cond) errors.push('FAIL ' + msg); else console.log('ok  ', msg); };

const browser = await chromium.launch();
try {
  // 0) rules: unauthenticated REST access is refused
  const anon = await fetch(`${DBURL}/rooms/${ROOM}/table.json?ns=${NS}`);
  ok(anon.status === 401 || anon.status === 403, `unauthenticated read refused (${anon.status})`);

  // 1) three players open the same link
  const P = [];
  for (const label of ['A', 'B', 'C']) {
    const p = await newPlayer(browser, label);
    await p.page.goto(BASE + '#' + ROOM.toLowerCase());
    P.push(p);
  }
  for (const p of P) await p.page.locator('.seat.tap .plate').first().waitFor({ timeout: 15000 });
  ok((await P[0].page.evaluate(() => location.hash)) === '#' + ROOM, 'room code normalised in the URL');
  ok((await P[0].page.title()).endsWith('HO’s Casino'), 'page title');
  await P[0].page.screenshot({ path: path.join(SHOTS, '01-empty.png') });

  const names = ['민수', '지영', '도우너'];
  for (const [k, p] of P.entries()) {
    await p.page.locator('.seat.tap .plate').first().click();
    await p.page.locator('#nameInput').fill(names[k]);
    await p.page.locator('.modal .btn.primary').click();
    await sleep(1500);
  }
  await sleep(1000);
  let t = await table();
  const uids = await Promise.all(P.map(p => p.page.evaluate(async sdk => {
    const { getAuth } = await import(sdk + 'firebase-auth.js');
    return getAuth().currentUser.uid;
  }, SDK_URL)));
  ok(t && t.seats.filter(Boolean).length === 3, 'three players seated: ' + (t && t.seats.filter(Boolean).map(s => s.name).join(',')));
  ok(new Set(uids).size === 3, 'each browser has its own anonymous uid');
  ok(t && t.hostId === uids[0], 'first player is the dealer');
  const presence = await readDb(`rooms/${ROOM}/presence`);
  ok(presence && Object.keys(presence).length === 3, 'presence shows 3 tabs');
  await P[1].page.screenshot({ path: path.join(SHOTS, '02-lobby-guest.png') });
  await P[0].page.screenshot({ path: path.join(SHOTS, '02-lobby-host.png') });

  // invite modal
  await P[0].page.locator('.dock .btn:has-text("친구 초대")').click();
  const link = await P[0].page.locator('.modal .invite-link').inputValue();
  ok(link === BASE + '#' + ROOM, 'invite link ' + link);
  await P[0].page.screenshot({ path: path.join(SHOTS, '03-invite.png') });
  await P[0].page.locator('.modal .btn.ghost:has-text("닫기")').click();

  // 2) rules checks from a signed-in browser
  const rules = await P[1].page.evaluate(async ([room, sdk]) => {
    const { getApp } = await import(sdk + 'firebase-app.js');
    const D = await import(sdk + 'firebase-database.js');
    const db = D.getDatabase(getApp());
    const out = {};
    const tryW = async (k, p, v) => { try { await D.set(D.ref(db, p), v); out[k] = 'ok'; } catch (e) { out[k] = 'denied'; } };
    await tryW('otherReq', `rooms/${room}/req/someoneElse`, { j: '{}' });
    await tryW('badRoom', 'rooms/ab/table', { j: '{}' });
    await tryW('badShape', 'rooms/ZZZZ9999/table', { x: 1 });
    await tryW('rootWrite', 'rooms', { x: 1 });
    await tryW('fakePresence', `rooms/${room}/presence/tFAKE`, { by: 'someoneElse', p: '{}' });
    try { await D.get(D.ref(db, 'rooms')); out.listRooms = 'ok'; } catch (e) { out.listRooms = 'denied'; }
    return out;
  }, [ROOM, SDK_URL]);
  ok(Object.values(rules).every(v => v === 'denied'), 'security rules deny foreign writes: ' + JSON.stringify(rules));

  // 3) dealer adds a bot and starts
  await P[0].page.locator('.btn:has-text("봇 추가")').first().click();
  await sleep(600);
  await P[0].page.locator('.btn.primary:has-text("게임 시작")').click();
  await sleep(2500);
  t = await table();
  ok(t && t.hand && t.hand.phase !== 'done', 'first hand dealt');
  await P[2].page.screenshot({ path: path.join(SHOTS, '04-preflop.png') });
  const mine = await P[2].page.locator('.mycards .card:not(.back)').count();
  ok(mine === 2, 'player C sees own 2 hole cards (decrypted)');

  // reactions
  await P[1].page.locator('.react-btn').click();
  await P[1].page.locator('.reacts button').first().click();
  let bubble = false;
  for (let k = 0; k < 20 && !bubble; k++) { await sleep(150); bubble = (await P[2].page.locator('.bubble').count()) > 0; }
  ok(bubble, 'reaction from B shows up on C');

  // 4) play
  let shot = 0, maxBytes = 0;
  const r1 = await playFor(PLAY, P, 'play', async t => {
    if (t) maxBytes = Math.max(maxBytes, t._bytes);
    if (shot < 1 && t && t.hand && t.hand.phase === 'done' && t.hand.results && t.hand.results.showdown) {
      await P[2].page.screenshot({ path: path.join(SHOTS, '05-showdown.png') }); shot++;
    }
  });
  t = await table();
  console.log(`     played ${r1.hands} hands, ${r1.acts} clicks, table doc max ${maxBytes} bytes`);
  ok(r1.hands >= 3, 'several hands completed');

  // menu sheet
  await P[0].page.locator('#menuBtn').click(); await sleep(300);
  await P[0].page.screenshot({ path: path.join(SHOTS, '06-menu.png') });
  await P[0].page.locator('.sheet .invite-link').scrollIntoViewIfNeeded();
  await P[0].page.screenshot({ path: path.join(SHOTS, '06-menu-invite.png') });
  await P[0].page.locator('.sheet .btn.ghost:has-text("닫기")').click();

  // 5) reload keeps the seat (same anonymous user)
  await P[2].page.reload();
  await P[2].page.locator('.seat.me').waitFor({ timeout: 15000 });
  ok(true, 'C still seated after reload');

  // 6) dealer closes the browser → someone else takes over
  const before = await table();
  await P[0].ctx.close();
  const rest = P.slice(1);
  let took = null; const t1 = Date.now();
  const r2 = await playFor(45000, rest, 'after-takeover', async t => {
    if (t && t.hostTab !== before.hostTab && took === null) { took = ((Date.now() - t1) / 1000).toFixed(1); console.log(`     takeover after ${took}s, epoch ${t.epoch}`); }
  });
  t = await table();
  ok(took !== null && uids.slice(1).includes(t.hostId), 'a remaining player became dealer');
  ok(r2.hands >= 2, `game continued after takeover (${r2.hands} hands)`);
  await P[1].page.screenshot({ path: path.join(SHOTS, '07-after-takeover.png') });
  console.log('     log tail:', t.log.slice(-3).join(' | '));

  // 7) site without Firebase config shows the setup message instead of breaking
  const Q = await newPlayer(browser, 'Q', { config: false });
  await Q.page.goto(BASE + '#NOCONF');
  await sleep(800);
  const txt = await Q.page.locator('#banner').innerText();
  ok(/Firebase/.test(txt), 'unconfigured site explains setup: ' + txt.slice(0, 40));
  await Q.page.screenshot({ path: path.join(SHOTS, '08-not-configured.png') });
} finally {
  await browser.close();
  server.close();
}
console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 30).join('\n') : '\nall e2e checks passed');
process.exit(errors.length ? 1 : 0);

// Browser test of the solo puzzle 기사의 여행 (knight's tour). Needs no emulator — the puzzle never connects.
//   npm run test:knight      (screenshots go to shots/ like the other e2e tests)
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import fs from 'fs';
import http from 'http';
import path from 'path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env.SHOTS || path.join(ROOT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const errors = [];
const ok = (cond, msg) => { if (!cond) errors.push('FAIL ' + msg); else console.log('ok  ', msg); };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const f = p.endsWith('/') ? path.join(p, 'index.html') : p;
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|gstatic\.com\/firebasejs/, r => r.abort());
  await ctx.route('**/firebase-config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = {};' }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|fonts\./.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('pageerror', e => errors.push(`pageerror: ${e}`));
  const shot = name => page.screenshot({ path: path.join(SHOTS, name + '.png') });
  const state = () => page.evaluate(() => window.HOKnight.ui.state());
  const sq = p => page.locator(`.kn-sq[data-p="${p}"]`);

  // ---- lobby → puzzle
  await page.goto(BASE);
  await page.locator('#startBtn').click();
  ok(await page.locator('.lb-games.solo .lb-game[data-game="knight"]').isVisible(), 'lobby lists the puzzle under “혼자 하는 퍼즐”');
  ok((await page.locator('.lb-games:not(.solo) .lb-game').count()) === 6, 'the six room games are still there');
  await page.locator('.lb-game[data-game="knight"] .btn.primary').click();
  await page.locator('#solo:not([hidden])').waitFor();
  ok(await page.evaluate(() => location.hash) === '#knight-tour', 'puzzle has its own link (#knight-tour)');
  ok(await page.locator('#modalBack').isVisible() && /게임 방법/.test(await page.locator('#modal').innerText()), 'first visit shows the rules');
  await shot('40-knight-rules');
  await page.locator('#modal .btn.primary').click();
  ok((await page.locator('.kn-sq').count()) === 36, 'starts on a 6×6 board');
  await shot('41-knight-empty');

  // ---- moving
  await sq(0).click();
  let s = await state();
  ok(s.path.length === 1 && s.path[0] === 0, 'tap places the knight');
  ok((await page.locator('.kn-sq.nx').count()) === 2, 'corner knight shows its 2 moves');
  await sq(1).click();
  ok((await state()).path.length === 1, 'an illegal square is refused');
  ok(/L자/.test(await page.locator('#toast').innerText()), '… with a toast that explains the L-move');
  await sq(13).click();   // (0,0) → (2,1)
  ok((await state()).path.join() === '0,13', 'a legal L-move is taken');
  await page.locator('#kUndo').click();
  ok((await state()).path.join() === '0', 'undo takes the move back');

  // ---- hints all the way to a finished tour
  for (let i = 0; i < 40 && !(await state()).done; i++) {
    await page.locator('#kHint').click();
    await page.waitForFunction(() => document.querySelector('#kHint').textContent === '힌트');
    s = await state();
    if (s.tip && s.tip.sq != null) await sq(s.tip.sq).click();
    else break;
  }
  s = await state();
  ok(s.done && s.path.length === 36, 'following the hints finishes the 6×6 tour');
  ok(s.hints === 35, 'every hint was counted');
  await page.locator('.modal.kn-win').waitFor();
  ok(/완주/.test(await page.locator('#modal').innerText()), 'finish screen appears');
  await shot('42-knight-done');
  await page.locator('#modal .btn:has-text("7×7")').click();

  // ---- 7×7: wrong-colour start is caught, dead end → rewind hint
  ok((await page.locator('.kn-sq').count()) === 49, '“7×7 도전” switches to a 7×7 board');
  await sq(1).click();   // b-file on rank 7: minority colour on an odd board
  ok(/출발해야/.test(await page.locator('#kMsg').innerText()), 'odd board warns about a start square that can never finish');
  await page.locator('#kTipAct').click();
  ok((await state()).path.length === 0, '“다시 고르기” lifts the knight again');
  // walk into a dead end: visit both neighbours of the top-right corner (11 and 19) without the corner
  const walk = [0, 9, 4, 19, 24, 11, 2];
  for (const p of walk) await sq(p).click();
  ok((await state()).path.join() === walk.join(), 'walked 7 squares');
  await page.locator('#kHint').click();
  await page.waitForFunction(() => document.querySelector('#kHint').textContent === '힌트');
  s = await state();
  await shot('43-knight-hint');
  ok(s.tip && s.tip.sq == null && /돌아가면/.test(s.tip.text) && await page.locator('#kTipAct').isVisible(), 'dead end: hint offers to rewind');
  await page.locator('#kTipAct').click();
  s = await state();
  ok(s.path.length < walk.length && s.tip && s.tip.sq != null, 'rewind button undoes and points at the next square');
  const after = await page.evaluate(([n, p]) => window.HOKnight.logic.solve(n, p).status, [7, s.path.concat([s.tip.sq])]);
  ok(after === 'ok', 'the square it points at really leads to a full tour');

  // ---- reset, size memory, reload keeps progress
  await page.locator('#kReset').click();
  ok((await state()).path.length === 0, 'reset clears the board');
  await page.locator('.kn-size[data-n="9"]').click();
  ok((await page.locator('.kn-sq').count()) === 81, '9×9 board');
  await sq(0).click(); await sq(11).click();
  await page.locator('.kn-size[data-n="6"]').click();
  ok((await state()).done, '6×6 still shows the finished tour');
  ok(/🏆/.test(await page.locator('.kn-size[data-n="6"] small').innerText()) === false, 'a hinted finish is not a record');
  await page.locator('.kn-size[data-n="9"]').click();
  await page.reload();
  await page.locator('#solo:not([hidden])').waitFor();
  s = await state();
  ok(s.n === 9 && s.path.join() === '0,11', 'reload keeps the board size and the moves');
  ok(!(await page.locator('#modalBack').isVisible()), 'rules are not shown again');
  await page.locator('#kMoves').uncheck();
  ok((await page.locator('.kn-sq.nx').count()) === 0, 'move dots can be turned off');
  await page.locator('#kMoves').check();
  await shot('44-knight-9x9');
  await page.locator('#kBack').click();
  await page.locator('#lobby:not([hidden])').waitFor();
  ok(true, 'back button returns to the lobby');
  await shot('45-lobby-with-puzzle');
  await page.evaluate(() => document.querySelector('#lobbyBody').scrollTo(0, 99999));
  await shot('46-lobby-bottom');

  // ---- desktop size
  const big = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await big.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await big.goto(BASE + '#knight-tour');
  await big.locator('#solo:not([hidden])').waitFor();
  if (await big.locator('#modalBack').isVisible()) await big.locator('#modal .btn.primary').click();
  const box = await big.locator('#kBoard').boundingBox();
  const dock = await big.locator('.kn-dock').boundingBox();
  ok(box.y + box.height <= dock.y, 'desktop: whole board fits above the buttons');
  await big.screenshot({ path: path.join(SHOTS, '47-knight-desktop.png') });
} finally {
  await browser.close();
  server.close();
}
if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
console.log('knight e2e: all ok');

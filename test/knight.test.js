// Logic tests for the solo puzzle 기사의 여행 (knight's tour): node test/knight.test.js
const K = require('../src/knight.js').logic;
let fails = 0;
function ok(cond, name) { if (cond) console.log('ok  ', name); else { console.log('FAIL', name); fails++; } }
const isTour = (n, t) => t.length === n * n && new Set(t).size === n * n && t.every((x, i) => i === 0 || K.isJump(n, t[i - 1], x));

ok(K.nbOf(8)[0].length === 2 && K.nbOf(8)[27].length === 8, 'corner has 2 knight moves, centre has 8');
ok(K.isJump(8, 0, 10) && K.isJump(8, 0, 17) && !K.isJump(8, 0, 9) && !K.isJump(8, 7, 8), 'L-moves only, no wrapping round the edge');
ok(K.legal(6, [0, 13]).every(j => K.isJump(6, 13, j) && j !== 0), 'legal moves skip visited squares');
ok([7, 9].every(n => !K.canStart(n, 1) && K.canStart(n, 0)) && K.canStart(8, 1), 'odd boards start on the corner colour');

// a full tour from every square that can have one, quickly
for (const n of K.SIZES) {
  let all = true; const t0 = Date.now();
  for (let s = 0; s < n * n; s++) {
    const r = K.solve(n, [s]);
    if (K.canStart(n, s) ? !(r.status === 'ok' && isTour(n, r.tour) && r.tour[0] === s) : r.status !== 'dead') all = false;
  }
  ok(all, `${n}×${n}: every good start square has a tour, the others are proven impossible (${Date.now() - t0}ms)`);
}
ok(K.solve(6, []).status === 'ok', 'can also choose the start square itself');

// a stranded corner is spotted at once
const strand = [0, 9, 4, 19, 24, 11, 2];   // 7×7: both neighbours of the top-right corner used, corner skipped
ok(K.solve(7, strand).status === 'dead', 'stranded corner = dead end');
ok(K.solve(7, [0, 9, 4, 19, 24, 11, 6]).status === 'dead', 'walking into a dead-end square too early = dead end');

// hints
let h = K.hint(6, []);
ok(h.kind === 'start' && K.solve(6, [h.to]).status === 'ok', 'hint with no knight: a start square that works');
h = K.hint(8, [0]);
ok(h.kind === 'move' && K.isJump(8, 0, h.to) && K.solve(8, [0, h.to]).status === 'ok', 'hint: next move keeps a tour possible');
h = K.hint(7, strand);
const pre = strand.slice(0, strand.length - h.steps);
ok(h.kind === 'back' && h.sure && h.steps >= 1 && K.solve(7, pre.concat([h.to])).status === 'ok', `dead end: undo ${h.steps} move(s), then the suggested square leads to a tour`);
ok(K.hint(9, [1, 12]).kind === 'badStart', 'wrong-colour start on 9×9 → start over');
// follow hints to the end on every size
for (const n of K.SIZES) {
  const p = [K.hint(n, []).to];
  while (p.length < n * n) { const x = K.hint(n, p); if (x.kind !== 'move') break; p.push(x.to); }
  ok(isTour(n, p), `${n}×${n}: following hints alone completes the tour`);
}
// random dead ends always get a correct way back, within the time budget
let rng = 7; const rand = k => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng % k; };
let good = true, slow = 0;
for (let t = 0; t < 60; t++) {
  const n = K.SIZES[t % 4]; let p = [rand(n * n)];
  while (!K.canStart(n, p[0])) p = [rand(n * n)];
  for (let i = 0, k = 4 + rand(n * n - 8); i < k; i++) { const m = K.legal(n, p); if (!m.length) break; p.push(m[rand(m.length)]); }
  const t0 = Date.now(), x = K.hint(n, p); if (Date.now() - t0 > 2500) slow++;
  const base = x.kind === 'back' ? p.slice(0, p.length - x.steps) : p;
  if (!(x.kind === 'move' || x.kind === 'back') || !K.isJump(n, base[base.length - 1], x.to) || K.solve(n, base.concat([x.to])).status !== 'ok') good = false;
}
ok(good, 'random positions: every hint leads to a full tour');
ok(slow === 0, 'every hint answers within the time budget');

if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('all knight tests passed');

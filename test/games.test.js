// Logic tests for the table games: node test/games.test.js
const path = require('path');
['common', 'blackjack', 'roulette', 'baccarat', 'seotda', 'tag'].forEach(f => require(path.join(__dirname, '../src/games', f + '.js')));
const G = globalThis.HOGames;
let fails = 0;
function ok(cond, name) { if (cond) console.log('ok  ', name); else { console.log('FAIL', name); fails++; } }
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), `${name} (${JSON.stringify(a)})`);

// ---- blackjack
const bj = G.blackjack.logic;
eq(bj.handVal(['As', 'Kd']).v, 21, 'A+K = 21');
eq(bj.handVal(['As', 'Ad', '9c']).v, 21, 'A+A+9 = 21');
eq(bj.handVal(['As', '6d', 'Kc']).v, 17, 'soft hand hardens');
const hand = (cards, bet, dbl) => ({ cards, bet, dbl: !!dbl });
eq(bj.settleHand(hand(['As', 'Kd'], 100), ['9s', '8d']), { res: 'bj', pay: 250 }, 'blackjack pays 3:2');
eq(bj.settleHand(hand(['As', 'Kd'], 100), ['Ah', 'Qd']), { res: 'push', pay: 100 }, 'blackjack vs dealer blackjack pushes');
eq(bj.settleHand(hand(['9s', '9d', '3c'], 100), ['Ah', 'Qd']), { res: 'lose', pay: 0 }, '21 in three cards loses to dealer blackjack');
eq(bj.settleHand(hand(['Ts', '9d'], 100), ['Th', '6d', '9c']), { res: 'win', pay: 200 }, 'dealer bust');
eq(bj.settleHand(hand(['Ts', '9d', '5c'], 100), ['Th', '6d', '9c']), { res: 'bust', pay: 0 }, 'player bust loses even if dealer busts');
eq(bj.settleHand(hand(['Ts', '8d'], 100), ['Th', '8c']), { res: 'push', pay: 100 }, 'equal totals push');

// ---- roulette
const rl = G.roulette.logic;
eq(rl.payout({ n17: 10 }, 17), 360, 'straight number pays 35:1');
eq(rl.payout({ red: 10, odd: 10, low: 10, d1: 10, c1: 10 }, 1), 20 * 3 + 30 * 2, 'outside bets on 1');
eq(rl.payout({ red: 10, black: 10, even: 10, d1: 10, c3: 10, n0: 10 }, 0), 360, 'zero beats every outside bet');
ok(rl.WHEEL.length === 37 && new Set(rl.WHEEL).size === 37, 'wheel has 37 distinct pockets');
ok([...Array(36)].filter((_, k) => rl.color(k + 1) === 'red').length === 18, '18 red numbers');
eq([rl.color(0), rl.color(32), rl.color(15)], ['green', 'red', 'black'], 'pocket colours');

// ---- baccarat
const bc = G.baccarat.logic;
eq(bc.total(['7s', '8d']), 5, '7+8 = 5');
eq(bc.nextDraw(['9s', 'Kd'], ['2c', '3c']), null, 'natural 9 stops the coup');
eq(bc.nextDraw(['2s', '3d'], ['Kc', '7c']), 'P', 'player 5 draws');
eq(bc.nextDraw(['2s', '4d'], ['Kc', '5c']), 'B', 'player stands on 6, banker 5 draws');
eq(bc.nextDraw(['2s', '4d'], ['Kc', '6c']), null, 'both stand');
eq(bc.nextDraw(['2s', '3d', '8h'], ['Kc', '3c']), null, 'banker 3 stands against an 8');
eq(bc.nextDraw(['2s', '3d', '7h'], ['Kc', '3c']), 'B', 'banker 3 draws against a 7');
eq(bc.nextDraw(['2s', '3d', '7h'], ['Kc', '6c']), 'B', 'banker 6 draws against a 7');
eq(bc.nextDraw(['2s', '3d', '5h'], ['Kc', '6c']), null, 'banker 6 stands against a 5');
eq(bc.nextDraw(['2s', '3d', '5h'], ['Kc', '7c']), null, 'banker 7 always stands');
eq([bc.payout({ p: 100 }, 'p'), bc.payout({ b: 100 }, 'b'), bc.payout({ t: 100, p: 50 }, 't'), bc.payout({ p: 100, b: 10 }, 'b')], [200, 195, 950, 19], 'payouts');

// ---- seotda
const sd = G.seotda.logic;
const sc = (a, b) => sd.score(a, b);
const order = [['3A', '8A'], ['1A', '8A'], ['10A', '10B'], ['9A', '9B'], ['1A', '1B'], ['1B', '2A'], ['1B', '4B'], ['1B', '9B'], ['1B', '10A'], ['4B', '10A'], ['4B', '6A'], ['4B', '5A'], ['3B', '5A'], ['2A', '8B']];
ok(order.every((h, k) => k === 0 || sc(...order[k - 1]).s > sc(...h).s), 'hand ranking order: ' + order.map(h => sc(...h).name).join(' > '));
eq(sc('1A', '3A').s, sc('1A', '8A').s, '13 and 18 gwang-ttaeng tie');
eq(sc('3B', '8A').name, '1끗', 'non-gwang 3+8 is just 1 kkeut');
const win = hands => { const ps = {}, scores = {}; hands.forEach((h, i) => { ps[i] = { in: 100, folded: false }; scores[i] = sc(...h); }); return sd.splitPots(ps, scores); };
eq(win([['3A', '7A'], ['9A', '9B']]), { 0: 200 }, 'ttaeng-catcher beats 9-ttaeng');
eq(win([['3A', '7A'], ['10A', '10B']]), { 1: 200 }, 'ttaeng-catcher loses to jang-ttaeng');
eq(win([['3A', '7A'], ['2A', '9B']]), { 1: 200 }, 'ttaeng-catcher is 0 kkeut otherwise');
eq(win([['4A', '7A'], ['1A', '8A']]), { 0: 200 }, 'inspector beats 18 gwang-ttaeng');
eq(win([['4A', '7A'], ['3A', '8A']]), { 1: 200 }, 'inspector loses to 38 gwang-ttaeng');
eq(win([['5A', '6B'], ['5B', '6A']]), { 0: 100, 1: 100 }, 'equal hands split');
eq(sd.splitPots({ 0: { in: 50, folded: false }, 1: { in: 200, folded: false }, 2: { in: 200, folded: true } }, { 0: sc('3A', '8A'), 1: sc('2A', '9B') }), { 0: 150, 1: 300 }, 'all-in side pot');

// ---- full simulated rounds through the same hooks the host device uses
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const rint = n => Math.floor(rnd() * n);
async function simulate(id, players, steps, drive, invariant, bots = 0) {
  const game = G[id];
  const S = { seats: new Array(game.seats).fill(null), log: [], game: game.init() };
  for (let i = 0; i < players + bots; i++) S.seats[i] = { uid: (i < players ? 'u' : 'bot_') + i, name: 'P' + i, stack: 1000, buyin: 1000, pub: null, bot: i >= players };
  const ctx = {}; let now = 1e6, rounds = 0, lastNo = 0, bad = null;
  const api = () => ({ S, get G() { return S.game; }, ctx, now, rint, START: 1000, log: t => S.log.push(t), seal: async (i, o) => ({ p: o }), online: () => true });
  for (let k = 0; k < steps && !bad; k++) {
    now += 400;
    await game.tick(api());
    for (let i = 0; i < players + bots; i++) {
      const st = S.seats[i];
      if (st.stack === 0 && !game.busy(S.game, i) && !(S.game.bets && S.game.bets[i])) { st.stack += 1000; st.buyin += 1000; }
      const r = st.bot ? game.bot(api(), i) : drive(S, S.game, i, rnd);
      if (r) await game.onReq(api(), i, r);
      if (st.bot && S.game.enc && S.game.enc[i]) bad = 'bot cards leaked into the shared state';
    }
    if (S.game.no !== lastNo) { lastNo = S.game.no; rounds++; }
    if (S.seats.filter(Boolean).some(s => s.stack < 0 || !Number.isInteger(s.stack))) bad = 'negative or fractional stack';
    if (invariant && !bad) bad = invariant(S, S.game);
  }
  const botBet = bots && S.log.some(t => S.seats.some(s => s && s.bot && t.includes(s.name + ' ')));
  ok(!bad && rounds > 20 && (!bots || botBet), `${id}${bots ? ` + ${bots} bots` : ''}: ${rounds} simulated rounds${bad ? ' — ' + bad : ''}${bots && !botBet ? ' — bots never played' : ''}`);
}
const houseBet = keys => (S, g, i, r) => {
  if (g.phase !== 'bet' || g.ready[i]) return null;
  if (!g.bets[i] || (typeof g.bets[i] === 'object' && r() < 0.5)) { const k = keys[rint(keys.length)]; return { type: 'bet', k, add: [10, 50, 100][rint(3)] }; }
  return { type: 'ready' };
};
(async () => {
  await simulate('blackjack', 3, 4000, (S, g, i, r) => {
    if (g.phase === 'bet') return houseBet(['x'])(S, g, i, r);
    if (g.phase === 'play' && g.cur === i) return { type: ['hit', 'stand', 'stand', 'double'][rint(4)] };
    return null;
  });
  await simulate('roulette', 3, 4000, houseBet(['n0', 'n17', 'red', 'black', 'odd', 'd2', 'c3', 'high']));
  await simulate('baccarat', 3, 4000, houseBet(['p', 'b', 't']));
  await simulate('seotda', 4, 6000, (S, g, i) => {
    if (!g.started) return { type: 'start' };
    if (g.phase === 'bet' && g.cur === i) return { type: ['die', 'call', 'call', 'half'][rint(4)], hid: g.hid };
    return null;
  }, (S, g) => {
    const P = S.seats.filter(Boolean), stacks = P.reduce((a, s) => a + s.stack, 0), buy = P.reduce((a, s) => a + s.buyin, 0);
    const pot = g.phase === 'bet' ? Object.values(g.ps).reduce((a, p) => a + p.in, 0) : 0;
    return stacks + pot === buy ? null : `chips not conserved: ${stacks}+${pot} != ${buy}`;
  });
  // with bots: one person + bots
  await simulate('blackjack', 1, 3000, (S, g, i, r) => {
    if (g.phase === 'bet') return houseBet(['x'])(S, g, i, r);
    if (g.phase === 'play' && g.cur === i) return { type: ['hit', 'stand'][rint(2)] };
    return null;
  }, null, 2);
  await simulate('roulette', 1, 3000, houseBet(['red', 'n7']), null, 2);
  await simulate('baccarat', 1, 3000, houseBet(['p', 'b']), null, 2);
  await simulate('seotda', 1, 6000, (S, g, i) => {
    if (!g.started) return { type: 'start' };
    if (g.phase === 'bet' && g.cur === i) return { type: ['die', 'call', 'call', 'half'][rint(4)], hid: g.hid };
    return null;
  }, (S, g) => {
    const P = S.seats.filter(Boolean), stacks = P.reduce((a, s) => a + s.stack, 0), buy = P.reduce((a, s) => a + s.buyin, 0);
    const pot = g.phase === 'bet' ? Object.values(g.ps).reduce((a, p) => a + p.in, 0) : 0;
    return stacks + pot === buy ? null : `chips not conserved: ${stacks}+${pot} != ${buy}`;
  }, 3);
  // bots alone never start a round
  for (const id of ['blackjack', 'roulette', 'baccarat']) {
    const game = G[id], S = { seats: new Array(game.seats).fill(null), log: [], game: game.init() };
    S.seats[0] = { uid: 'u0', name: 'P0', stack: 1000, buyin: 1000 }; S.seats[1] = { uid: 'bot_1', name: '봇 1호', stack: 1000, buyin: 1000, bot: true };
    const a = { S, get G() { return S.game; }, ctx: {}, now: 1e6, rint, log: () => {}, seal: async (i, o) => ({ p: o }) };
    ok(game.bot(a, 1) === null, `${id}: bot waits until a person bets`);
  }

  // ---- 술래잡기 (tag)
  {
    const tg = G.tag, L = tg.logic, pos = {}, onl = new Set(['u0', 'u1', 'u2', 'u3']);
    L.setWhere(i => pos[i] || null);
    let clock = 5e6;
    const table = n => ({ seats: Array.from({ length: 8 }, (_, i) => (i < n ? { uid: 'u' + i, name: 'P' + i, stack: 1000, buyin: 1000 } : null)), log: [], game: tg.init() });
    const at = S => ({ S, get G() { return S.game; }, ctx: {}, now: clock, rint: () => 0, log: t => S.log.push(t), online: u => onl.has(u) });
    const req = (S, i, r) => tg.onReq(at(S), i, r);
    const tick = S => tg.tick(at(S));
    ok(L.MAPS.every(m => m.sp.every(([x, y]) => L.free(m, x, y)) && L.free(m, m.it[0], m.it[1])), 'tag: every spawn point is clear of obstacles on every map');
    ok(L.MAPS.every(m => m.sp.length >= 7), 'tag: enough spawn points for 8 players');
    const hedge = L.MAPS[0], q = L.move(hedge, { x: 350, y: 440 }, 300, 0);
    ok(q.x <= 380 - L.R + 0.01, 'tag: a fast move does not tunnel through a thin hedge (x=' + q.x.toFixed(1) + ')');
    const inside = L.push(hedge, { x: 600, y: 600 });
    ok(Math.hypot(inside.x - 600, inside.y - 600) >= 85 + L.R - 0.01, 'tag: a runner inside the fountain is pushed out');
    ok(L.push(hedge, { x: -50, y: 5000 }).x === L.R && L.push(hedge, { x: -50, y: 5000 }).y === L.H - L.R, 'tag: the fence keeps runners in');

    let S = table(1); req(S, 0, { type: 'start' });
    ok(S.game.phase === 'wait', 'tag: one player cannot start');
    S = table(3);
    req(S, 0, { type: 'opt', mode: 'constructor', dur: 45 });
    eq([S.game.opt.mode, S.game.opt.dur], ['tag', 90], 'tag: bad options are ignored');
    req(S, 0, { type: 'start' });
    const g = S.game;
    ok(g.phase === 'count' && Object.keys(g.pl).length === 3 && g.it === 0 && g.map === 1 && g.ev.k === 'start', 'tag: round starts with a countdown and an "it"');
    ok([0, 1, 2].every(i => Array.isArray(g.sp[i])) && new Set([0, 1, 2].map(i => g.sp[i].join())).size === 3, 'tag: everyone gets their own spawn point');
    ok(!L.canMove(g, 0, clock) && L.canMove(g, 1, clock), 'tag: during the countdown only the runners move');
    pos[0] = { x: 100, y: 100 }; pos[1] = { x: 100 + L.REACH + L.SLACK + 5, y: 100 }; pos[2] = { x: 900, y: 900 };
    req(S, 0, { type: 'tag', s: 1 });
    ok(g.it === 0, 'tag: no tagging during the countdown');
    clock += L.COUNT_MS; tick(S);
    ok(g.phase === 'play' && g.since === clock && g.end === clock + 90000 && g.ev.k === 'go', 'tag: countdown → play');
    clock += 4000;
    req(S, 0, { type: 'tag', s: 1 });
    ok(g.it === 0, 'tag: too far away (beyond the lag allowance) is not a tag');
    pos[1] = { x: 150, y: 100 };
    req(S, 2, { type: 'tag', s: 1 });
    ok(g.it === 0, 'tag: only "it" can tag');
    req(S, 0, { type: 'tag', s: 1 });
    ok(g.it === 1 && g.tags[0] === 1 && S.seats[0].c === 1 && g.ms[0] === 4000 && g.ev.k === 'tag' && g.ev.a === 1 && g.ev.b === 0, 'tag: touch passes "it" and counts the catch');
    ok(!L.canMove(g, 1, clock) && g.safe[0] > clock, 'tag: the new "it" waits a moment, the old one cannot be tagged straight back');
    clock += 500; req(S, 1, { type: 'tag', s: 0 });
    ok(g.it === 1, 'tag: no tagging while stunned');
    clock += L.STUN_MS; req(S, 1, { type: 'tag', s: 0 });
    ok(g.it === 1, 'tag: no tag-back while the old "it" is protected');
    pos[2] = { x: 160, y: 120 }; req(S, 1, { type: 'tag', s: 2 });
    ok(g.it === 2 && g.ms[1] === 500 + L.STUN_MS, 'tag: "it" time adds up');
    const hit = (pos[0] = { x: 170, y: 120 }, clock += L.STUN_MS, L.findContact(g, clock, () => true, L.REACH));
    ok(hit && hit.k === 'tag' && hit.a === 2 && hit.b === 0, 'tag: the host sees bodies touching');
    clock = g.end; tick(S);
    ok(g.phase === 'over' && g.res.length === 3, 'tag: time up → results');
    eq(g.res.map(r => [r.s, r.ms, r.win]), [[0, 4000, true], [1, 2000, false], [2, g.res[2].ms, false]].sort((x, y) => x[1] - y[1]).map((r, k) => [r[0], r[1], k === 0]), 'tag: ranked by time spent as "it"');
    ok(S.seats[g.res[0].s].w === 1 && !S.seats[g.res[2].s].w, 'tag: the winner gets a win');
    clock += 9000; tick(S);
    ok(g.phase === 'wait' && g.it === -1, 'tag: results → back to waiting');

    // 얼음땡
    S = table(3); const h = S.game;
    req(S, 1, { type: 'opt', mode: 'ice', dur: 30 });
    eq([h.opt.mode, h.opt.dur], ['ice', 30], 'ice: mode and length can be changed while waiting');
    req(S, 0, { type: 'start' }); clock += L.COUNT_MS; tick(S);
    pos[0] = { x: 100, y: 100 }; pos[1] = { x: 130, y: 100 }; pos[2] = { x: 900, y: 900 };
    req(S, 0, { type: 'ice' });
    ok(h.ice[0] == null, 'ice: "it" cannot freeze');
    req(S, 1, { type: 'ice' });
    ok(h.ice[1] === clock && h.ev.k === 'ice', 'ice: a runner freezes');
    ok(!L.canMove(h, 1, clock), 'ice: frozen runners cannot move');
    req(S, 0, { type: 'tag', s: 1 });
    ok(h.it === 0, 'ice: frozen runners cannot be tagged');
    req(S, 2, { type: 'thaw', s: 1 });
    ok(h.ice[1] != null, 'ice: thawing needs a touch');
    pos[2] = { x: 150, y: 130 }; req(S, 2, { type: 'thaw', s: 1 });
    ok(h.ice[1] == null && h.ev.k === 'thaw', 'ice: a free runner thaws a frozen one (땡)');
    req(S, 1, { type: 'ice' }); clock += 100; req(S, 2, { type: 'ice' });
    ok(h.it === 2 && Object.keys(h.ice).length === 0 && h.ev.k === 'all' && h.ev.b === 0, 'ice: all frozen → the last to freeze is "it" and everyone thaws');

    // leaving and dropping out
    S = table(3); const k = S.game;
    req(S, 0, { type: 'start' }); clock += L.COUNT_MS; tick(S);
    const leave = i => { tg.onLeave(at(S), i); S.seats[i] = null; };
    leave(0);
    ok(k.it !== 0 && k.pl[k.it] && k.ev.k === 'pass' && k.phase === 'play', '"it" leaving passes it on');
    leave(k.it);
    ok(k.phase === 'over' && k.res.length === 1, 'fewer than two left → the round ends');
    S = table(3); const o = S.game;
    req(S, 0, { type: 'start' }); clock += L.COUNT_MS; tick(S);
    onl.delete('u0'); tick(S);
    ok(o.it === 0, 'a short drop-out keeps "it" for a moment');
    clock += 3500; tick(S);
    ok(o.it !== 0 && o.ev.k === 'pass', '"it" whose device is gone hands over');
    onl.add('u0');
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();

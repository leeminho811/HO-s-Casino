// Logic tests for the table games: node test/games.test.js
const path = require('path');
['common', 'blackjack', 'roulette', 'baccarat', 'seotda'].forEach(f => require(path.join(__dirname, '../src/games', f + '.js')));
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
async function simulate(id, players, steps, drive, invariant) {
  const game = G[id];
  const S = { seats: new Array(game.seats).fill(null), log: [], game: game.init() };
  for (let i = 0; i < players; i++) S.seats[i] = { uid: 'u' + i, name: 'P' + i, stack: 1000, buyin: 1000, pub: null };
  const ctx = {}; let now = 1e6, rounds = 0, lastNo = 0, bad = null;
  const api = () => ({ S, get G() { return S.game; }, ctx, now, rint, START: 1000, log: t => S.log.push(t), seal: async (i, o) => ({ p: o }), online: () => true });
  for (let k = 0; k < steps && !bad; k++) {
    now += 400;
    await game.tick(api());
    for (let i = 0; i < players; i++) {
      const st = S.seats[i];
      if (st.stack === 0 && !game.busy(S.game, i) && !(S.game.bets && S.game.bets[i])) { st.stack += 1000; st.buyin += 1000; }
      const r = drive(S, S.game, i, rnd);
      if (r) await game.onReq(api(), i, r);
    }
    if (S.game.no !== lastNo) { lastNo = S.game.no; rounds++; }
    if (S.seats.filter(Boolean).some(s => s.stack < 0 || !Number.isInteger(s.stack))) bad = 'negative or fractional stack';
    if (invariant && !bad) bad = invariant(S, S.game);
  }
  ok(!bad && rounds > 20, `${id}: ${rounds} simulated rounds${bad ? ' — ' + bad : ''}`);
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
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();

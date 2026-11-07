const E = require('../src/engine.js');
const assert = require('assert');
let fails = 0;
function t(name, fn) { try { fn(); console.log('ok  ', name); } catch (e) { fails++; console.log('FAIL', name, '\n   ', e.message); } }
const ev = c => E.evaluate(c.split(' '));
const d = c => E.describe(ev(c));

t('royal flush', () => assert.equal(d('As Ks Qs Js Ts 2d 3c'), '로열 플러시'));
t('wheel straight', () => assert.equal(d('Ah 2d 3c 4s 5h Kd Kc'), '5 하이 스트레이트'));
t('steel wheel', () => assert.equal(d('Ah 2h 3h 4h 5h Kd Kc'), '5 하이 스트레이트 플러시'));
t('full house from two trips', () => assert.equal(d('Kh Kd Kc 9s 9h 9d 2c'), '풀하우스 K·9'));
t('quads kicker', () => assert.ok(E.cmp(ev('7h 7d 7c 7s Ah 2d 3c'), ev('7h 7d 7c 7s Kh Qd Jc')) > 0));
t('three pairs kicker', () => assert.deepStrictEqual(ev('Ah Ad Kc Ks Qh Qd 2c'), [2, 14, 13, 12]));
t('flush beats straight', () => assert.ok(E.cmp(ev('2h 5h 9h Jh Kh 3c 4d'), ev('9c Td Jh Qs Kd 2c 3d')) > 0));
t('pair kickers', () => assert.ok(E.cmp(ev('Ah Ad Kc 9s 7h 3d 2c'), ev('Ah Ad Kc 9s 6h 3d 2c')) > 0));
t('split identical board', () => assert.equal(E.cmp(ev('2c 3d As Ks Qs Js Ts'), ev('4c 5d As Ks Qs Js Ts')), 0));

function mkState(stacks, opts = {}) {
  const S = E.newState('u0', 'tab', Object.assign({ timer: 0 }, opts));
  stacks.forEach((st, i) => { if (st != null) S.seats[i] = { uid: 'u' + i, name: 'P' + i, stack: st, buyin: st, out: false, leave: false }; });
  return S;
}
function deckFrom(holesBySeatOrder, board) {
  // build deck so that dealing order gives specific cards: caller passes explicit deck
  return null;
}
function total(S) { return S.seats.reduce((a, s) => a + (s ? s.stack : 0), 0) + (S.hand && S.hand.phase !== 'done' ? E.potTotal(S.hand) : 0); }

t('blinds + preflop order 3-handed', () => {
  const S = mkState([1000, 1000, 1000]);
  S.button = 2; // next button -> 0
  const deck = E.shuffle(E.freshDeck(), E.mathRandInt);
  const r = E.startHand(S, deck, 0);
  const h = S.hand;
  assert.equal(h.button, 0); assert.equal(h.sb, 1); assert.equal(h.bb, 2);
  assert.equal(h.cur, 0, 'UTG (button in 3-handed) acts first');
  assert.equal(S.seats[1].stack, 990); assert.equal(S.seats[2].stack, 980);
  assert.equal(r.holes[0].length, 2);
});

t('heads-up: button is SB and acts first preflop, last postflop', () => {
  const S = mkState([1000, 1000]);
  S.button = 1;
  const ctx = E.startHand(S, E.shuffle(E.freshDeck(), E.mathRandInt), 0);
  const h = S.hand;
  assert.equal(h.button, 0); assert.equal(h.sb, 0); assert.equal(h.bb, 1);
  assert.equal(h.cur, 0);
  assert.equal(E.act(S, 0, 'call', 0, 0), null); E.progress(S, ctx, 0);
  assert.equal(h.cur, 1, 'BB option');
  assert.equal(E.act(S, 1, 'check', 0, 0), null); E.progress(S, ctx, 0);
  assert.equal(h.phase, 'flop'); assert.equal(h.board.length, 3);
  assert.equal(h.cur, 1, 'BB acts first postflop heads-up');
  assert.equal(h.pot, 40);
});

t('BB gets option after limps; raise reopens', () => {
  const S = mkState([1000, 1000, 1000, 1000]);
  S.button = 3;
  const ctx = E.startHand(S, E.shuffle(E.freshDeck(), E.mathRandInt), 0);
  const h = S.hand; // btn 0, sb 1, bb 2, utg 3
  assert.equal(h.cur, 3);
  E.act(S, 3, 'call'); E.progress(S, ctx);
  E.act(S, 0, 'call'); E.progress(S, ctx);
  E.act(S, 1, 'call'); E.progress(S, ctx);
  assert.equal(h.cur, 2);
  assert.equal(E.act(S, 2, 'raise', 30), '최소 40까지 올려야 해요');
  assert.equal(E.act(S, 2, 'raise', 60), null); E.progress(S, ctx);
  assert.equal(h.cur, 3);
  E.act(S, 3, 'fold'); E.progress(S, ctx);
  E.act(S, 0, 'call'); E.progress(S, ctx);
  E.act(S, 1, 'call'); E.progress(S, ctx);
  assert.equal(h.phase, 'flop');
  assert.equal(h.pot, 20 + 60 * 3);
  assert.equal(h.cur, 1, 'SB first postflop');
});

t('everyone folds to BB', () => {
  const S = mkState([1000, 1000, 1000]);
  S.button = 2;
  const ctx = E.startHand(S, E.shuffle(E.freshDeck(), E.mathRandInt), 0);
  E.act(S, 0, 'fold'); E.progress(S, ctx);
  E.act(S, 1, 'fold'); E.progress(S, ctx);
  assert.equal(S.hand.phase, 'done');
  assert.equal(S.seats[2].stack, 1010);
  assert.equal(S.seats[1].stack, 990);
  assert.equal(S.hand.results.showdown, false);
});

t('all-in runout with side pot + uncalled return', () => {
  const S = mkState([100, 500, 1000]);
  S.button = 2; // btn 0 (100), sb 1 (500), bb 2 (1000)
  // rig deck: deal order starts left of button: 1,2,0,1,2,0
  // seat1: Kh Kd, seat2: Qh Qd, seat0: Ah Ad ; board: burn, 2c 7s 9d, burn, 3h, burn, 4s
  const deck = ['Kh', 'Qh', 'Ah', 'Kd', 'Qd', 'Ad', 'x1', '2c', '7s', '9d', 'x2', '3h', 'x3', '4s'];
  const ctx = E.startHand(S, deck, 0);
  const h = S.hand;
  assert.equal(h.cur, 0);
  E.act(S, 0, 'raise', 100); E.progress(S, ctx); // all-in 100
  assert.ok(h.ps[0].allIn);
  assert.equal(h.cur, 1);
  E.act(S, 1, 'raise', 500); E.progress(S, ctx); // all-in 500
  assert.equal(h.cur, 2);
  E.act(S, 2, 'raise', 1000); // shove 1000 -> 500 uncalled
  let r = E.progress(S, ctx);
  let guard = 0;
  while (r.again && guard++ < 5) r = E.progress(S, ctx);
  assert.equal(h.phase, 'done');
  assert.equal(h.board.join(' '), '2c 7s 9d 3h 4s');
  // main pot 300 -> seat0 (AA); side pot 800 -> seat1 (KK); seat2 gets 500 back
  assert.equal(S.seats[0].stack, 300);
  assert.equal(S.seats[1].stack, 800);
  assert.equal(S.seats[2].stack, 500);
  assert.equal(S.seats.reduce((a, s) => a + (s ? s.stack : 0), 0), 1600);
});

t('split pot with odd chip', () => {
  const S = mkState([1000, 1000, 1000], { sb: 5, bb: 10 });
  S.button = 2;
  // order 1,2,0 ; seat1: 2c 3c ; seat2: 4d 5d ; seat0: 6h 7h ; board broadway AKQJT rainbow (everyone plays the board)
  const deck = ['2c', '4d', '6h', '3c', '5d', '7h', 'x', 'As', 'Kd', 'Qh', 'x', 'Jc', 'x', 'Ts'];
  const ctx = E.startHand(S, deck, 0);
  E.act(S, 0, 'call'); E.progress(S, ctx);
  E.act(S, 1, 'fold'); E.progress(S, ctx);  // sb folds 5 → pot 25
  E.act(S, 2, 'check'); E.progress(S, ctx);
  for (const st of ['flop', 'turn', 'river']) {
    const h = S.hand; assert.equal(h.phase, st);
    E.act(S, h.cur, 'check'); E.progress(S, ctx);
    E.act(S, S.hand.cur, 'check'); E.progress(S, ctx);
  }
  assert.equal(S.hand.phase, 'done');
  assert.equal(S.seats[0].stack + S.seats[2].stack, 2005);
  assert.equal(S.seats[2].stack, 1003, 'odd chip to first left of button');
});

t('short all-in raise does not reopen raising', () => {
  const S = mkState([1000, 1000, 1000, 150]);
  S.button = 3; // btn 0, sb 1, bb 2, utg 3 (150)
  const ctx = E.startHand(S, E.shuffle(E.freshDeck(), E.mathRandInt), 0);
  const h = S.hand;
  E.act(S, 3, 'raise', 100); E.progress(S, ctx); // raise to 100 (size 80)
  E.act(S, 0, 'call'); E.progress(S, ctx);
  E.act(S, 1, 'call'); E.progress(S, ctx);
  E.act(S, 2, 'call'); E.progress(S, ctx);
  // flop: sb first
  E.act(S, h.cur, 'check'); E.progress(S, ctx); // seat1
  assert.equal(h.cur, 2);
  E.act(S, 2, 'raise', 20); E.progress(S, ctx); // bet 20
  assert.equal(h.cur, 3);
  E.act(S, 3, 'raise', 50); E.progress(S, ctx); // all-in 50 (raise of 30 >= 20 full) hmm
  // seat3 had 50 left: raise from 20 to 50 is +30 >= minRaise 20 → full raise
  assert.equal(h.ps[3].allIn, true);
  E.act(S, 0, 'call'); E.progress(S, ctx);
  E.act(S, 1, 'call'); E.progress(S, ctx);
  assert.equal(h.cur, 2);
  assert.equal(h.ps[2].acted, false, 'full raise reopened for seat2');
});

t('short all-in does not reopen', () => {
  const S = mkState([1000, 1000, 1000, 125]);
  S.button = 3;
  const ctx = E.startHand(S, E.shuffle(E.freshDeck(), E.mathRandInt), 0);
  const h = S.hand;
  E.act(S, 3, 'call'); E.progress(S, ctx); // 20, has 105
  E.act(S, 0, 'call'); E.progress(S, ctx);
  E.act(S, 1, 'call'); E.progress(S, ctx);
  E.act(S, 2, 'check'); E.progress(S, ctx);
  E.act(S, 1, 'check'); E.progress(S, ctx);
  E.act(S, 2, 'raise', 80); E.progress(S, ctx); // bet 80
  E.act(S, 3, 'raise', 105); E.progress(S, ctx); // all-in 105 (raise of 25 < 80) short
  E.act(S, 0, 'call'); E.progress(S, ctx);
  E.act(S, 1, 'call'); E.progress(S, ctx);
  assert.equal(h.cur, 2, 'seat2 must call the extra 25');
  assert.equal(h.ps[2].acted, true);
  const err = E.act(S, 2, 'raise', 400); // converted to call since cannot raise
  assert.equal(err, null);
  assert.equal(h.ps[2].bet, 105);
});

t('leave out of turn keeps current actor', () => {
  const S = mkState([1000, 1000, 1000, 1000]);
  S.button = 3;
  const ctx = E.startHand(S, E.shuffle(E.freshDeck(), E.mathRandInt), 0);
  const h = S.hand;
  assert.equal(h.cur, 3);
  const turn = h.turn;
  E.leaveSeat(S, 1, 0); E.progress(S, ctx);
  assert.equal(h.cur, 3); assert.equal(h.turn, turn);
  assert.ok(h.ps[1].folded);
});

t('void hand refunds', () => {
  const S = mkState([1000, 1000, 1000]);
  S.button = 2;
  const ctx = E.startHand(S, E.shuffle(E.freshDeck(), E.mathRandInt), 0);
  E.act(S, 0, 'raise', 300); E.progress(S, ctx);
  E.voidHand(S, 0, 'test');
  assert.deepStrictEqual(S.seats.slice(0,3).map(s => s.stack), [1000, 1000, 1000]);
});

t('random simulation conserves chips (bots)', () => {
  for (let g = 0; g < 60; g++) {
    const n = 2 + (g % 7);
    const stacks = []; for (let i = 0; i < 8; i++) stacks.push(i < n ? 200 + Math.floor(Math.random() * 1500) : null);
    const S = mkState(stacks);
    S.seats.forEach(s => { if (s) s.bot = false; });
    const start = total(S);
    for (let hand = 0; hand < 25; hand++) {
      if (E.eligible(S).length < 2) break;
      const ctx = E.startHand(S, E.shuffle(E.freshDeck(), E.mathRandInt), 0);
      let guard = 0;
      while (E.handActive(S) && guard++ < 300) {
        const h = S.hand;
        if (h.cur >= 0) {
          const r = Math.random();
          let dec;
          if (r < 0.5) dec = E.botDecide(S, h.cur, ctx.holes[h.cur]);
          else if (r < 0.65) dec = { type: 'fold' };
          else if (r < 0.85) dec = { type: 'call' };
          else dec = { type: 'raise', amount: h.curBet + Math.floor(Math.random() * 400) };
          let err = E.act(S, h.cur, dec.type, dec.amount, 0);
          if (err) err = E.act(S, h.cur, 'call', 0, 0);
          if (err) throw new Error('act failed: ' + err);
        }
        const r = E.progress(S, ctx, 0);
        if (!r.again && h.cur < 0 && E.handActive(S)) throw new Error('stuck');
        assert.equal(total(S), start, 'chips conserved mid-hand');
      }
      if (E.handActive(S)) throw new Error('hand did not finish');
      assert.equal(total(S), start, 'chips conserved after hand');
      S.seats.forEach(s => { if (s) assert.ok(s.stack >= 0); });
    }
  }
});

t('equity sanity', () => {
  const aa = E.equity(['As', 'Ad'], [], 1, 2000);
  const o72 = E.equity(['7c', '2d'], [], 1, 2000);
  assert.ok(aa > 0.8 && aa < 0.9, 'AA ' + aa);
  assert.ok(o72 > 0.28 && o72 < 0.4, '72o ' + o72);
});

console.log(fails ? `\n${fails} failing` : '\nall passed');
process.exit(fails ? 1 : 0);

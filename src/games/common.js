/* Shared helpers for the table games (pure logic, also loadable in Node for tests). */
(function (root) {
  'use strict';
  const RANKS = '23456789TJQKA', SUITS = 'shdc';
  const C = {
    CHIPS: [10, 50, 100, 500],
    // one card from an endless, freshly shuffled shoe
    draw: rint => RANKS[rint(13)] + SUITS[rint(4)],
    seated: S => S.seats.map((s, i) => (s ? i : -1)).filter(i => i >= 0),
    sum: o => Object.values(o || {}).reduce((a, b) => a + b, 0),
    // bots in house games only bet once a person has put chips down this round (no bot-only rounds)
    humanBet: (S, G) => Object.keys(G.bets).some(k => S.seats[k] && !S.seats[k].bot),
    botChip(rint, stack) { const opts = [10, 10, 10, 50, 50, 100].filter(x => x <= stack); return opts.length ? opts[rint(opts.length)] : 0; },
    // bet → (maybe one more bet) → ready
    botBets(a, i, pickKey, maxBets) {
      const { S, G, rint } = a, st = S.seats[i];
      if (G.phase !== 'bet' || G.ready[i] || !C.humanBet(S, G)) return null;
      const mine = G.bets[i], n = mine ? (typeof mine === 'object' ? Object.keys(mine).length : 1) : 0;
      if (!n || (n < maxBets && rint(3) === 0)) { const add = C.botChip(rint, st.stack); if (add) return { type: 'bet', k: pickKey(), add }; }
      return mine ? { type: 'ready' } : null;
    },
    // Betting window for house games: opens a 20s countdown at the first bet; starts early once
    // everyone who can bet has bet and pressed "done".
    shouldStart(S, G, now, hasBet) {
      const seated = C.seated(S), bettors = seated.filter(hasBet);
      if (!bettors.length) { G.deadline = 0; return false; }
      if (!G.deadline) G.deadline = now + 20000;
      if (now >= G.deadline) return true;
      return bettors.every(i => G.ready[i]) && seated.every(i => hasBet(i) || S.seats[i].stack === 0);
    },
  };
  root.HOGames = root.HOGames || {};
  root.HOGames._c = C;
})(typeof window !== 'undefined' ? window : globalThis);

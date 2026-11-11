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

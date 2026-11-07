/* Hold'em engine: pure game logic, no DOM, no network. */
(function (root) {
  'use strict';
  const RANKS = '23456789TJQKA';
  const SUITS = 'shdc';
  const MAXS = 8;
  const RNAME = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };

  function rv(c) { return RANKS.indexOf(c[0]) + 2; }
  function rankLabel(v) { const ch = RANKS[v - 2]; return RNAME[ch] || ch; }

  function freshDeck() {
    const d = [];
    for (const r of RANKS) for (const s of SUITS) d.push(r + s);
    return d;
  }
  function shuffle(deck, randInt) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }
    return deck;
  }
  function mathRandInt(n) { return Math.floor(Math.random() * n); }

  /* ---------- hand evaluation ---------- */
  function straightHigh(vals) {
    const has = new Array(15).fill(false);
    for (const v of vals) has[v] = true;
    has[1] = has[14];
    for (let h = 14; h >= 5; h--) {
      if (has[h] && has[h - 1] && has[h - 2] && has[h - 3] && has[h - 4]) return h;
    }
    return 0;
  }

  // Returns a score array; larger compares better (see cmp).
  function evaluate(cards) {
    const vals = cards.map(rv);
    const bySuit = { s: [], h: [], d: [], c: [] };
    for (const c of cards) bySuit[c[1]].push(rv(c));
    let flush = null;
    for (const s of SUITS) if (bySuit[s].length >= 5) flush = s;
    if (flush) {
      const sh = straightHigh(bySuit[flush]);
      if (sh) return [8, sh];
    }
    const cnt = new Array(15).fill(0);
    for (const v of vals) cnt[v]++;
    const groups = [];
    for (let v = 14; v >= 2; v--) if (cnt[v]) groups.push([cnt[v], v]);
    groups.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    const desc = vals.slice().sort((a, b) => b - a);
    const kick = (excl, n) => desc.filter(v => !excl.includes(v)).slice(0, n);

    if (groups[0][0] === 4) return [7, groups[0][1], ...kick([groups[0][1]], 1)];
    if (groups[0][0] === 3 && groups[1] && groups[1][0] >= 2) return [6, groups[0][1], groups[1][1]];
    if (flush) return [5, ...bySuit[flush].sort((a, b) => b - a).slice(0, 5)];
    const sh = straightHigh(vals);
    if (sh) return [4, sh];
    if (groups[0][0] === 3) return [3, groups[0][1], ...kick([groups[0][1]], 2)];
    if (groups[0][0] === 2 && groups[1] && groups[1][0] === 2) {
      const p1 = groups[0][1], p2 = groups[1][1];
      return [2, p1, p2, ...kick([p1, p2], 1)];
    }
    if (groups[0][0] === 2) return [1, groups[0][1], ...kick([groups[0][1]], 3)];
    return [0, ...desc.slice(0, 5)];
  }

  function cmp(a, b) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const x = a[i] || 0, y = b[i] || 0;
      if (x !== y) return x - y;
    }
    return 0;
  }

  const CAT = ['하이카드', '원페어', '투페어', '트리플', '스트레이트', '플러시', '풀하우스', '포카드', '스트레이트 플러시'];
  function describe(score) {
    const c = score[0], L = rankLabel;
    switch (c) {
      case 8: return score[1] === 14 ? '로열 플러시' : `${L(score[1])} 하이 스트레이트 플러시`;
      case 7: return `${L(score[1])} 포카드`;
      case 6: return `풀하우스 ${L(score[1])}·${L(score[2])}`;
      case 5: return `${L(score[1])} 하이 플러시`;
      case 4: return `${L(score[1])} 하이 스트레이트`;
      case 3: return `${L(score[1])} 트리플`;
      case 2: return `${L(score[1])}·${L(score[2])} 투페어`;
      case 1: return `${L(score[1])} 원페어`;
      default: return `${L(score[1])} 하이카드`;
    }
  }
  function catName(score) { return score[0] === 8 && score[1] === 14 ? '로열 플러시' : CAT[score[0]]; }

  /* ---------- table state ---------- */
  function newState(hostId, hostTab, settings) {
    return {
      v: 1, epoch: 1, hostId, hostTab, seq: 0, now: 0,
      settings: Object.assign({ sb: 10, bb: 20, stack: 1000, timer: 30 }, settings || {}),
      started: false, paused: false,
      seats: new Array(MAXS).fill(null),
      proc: {}, hand: null, handNo: 0, button: -1,
      log: [], nextAt: 0, notice: null,
    };
  }

  function addLog(S, text) {
    S.log.push(text);
    if (S.log.length > 40) S.log.splice(0, S.log.length - 40);
  }
  function seatOf(S, uid) {
    if (!S || !uid) return -1;
    return S.seats.findIndex(s => s && s.uid === uid);
  }
  function handActive(S) { return !!(S && S.hand && S.hand.phase !== 'done'); }
  function nm(S, i) { const s = S.seats[i]; return s ? s.name : '?'; }

  function eligible(S) {
    const out = [];
    S.seats.forEach((s, i) => { if (s && !s.out && !s.leave && s.stack > 0) out.push(i); });
    return out;
  }
  // first seat index in `list` strictly after `from`, cyclic
  function nextIn(list, from) {
    for (let k = 1; k <= MAXS; k++) {
      const i = (from + k) % MAXS;
      if (list.includes(i)) return i;
    }
    return -1;
  }

  function post(S, h, i, amt, label) {
    const st = S.seats[i], p = h.ps[i];
    const pay = Math.min(amt, st.stack);
    st.stack -= pay; p.bet += pay; p.total += pay;
    if (st.stack === 0) p.allIn = true;
    p.last = p.allIn ? '올인' : label;
  }

  function canActCount(h) {
    let n = 0;
    for (const p of h.ps) if (p && !p.folded && !p.allIn) n++;
    return n;
  }
  function needs(h, i, canAct) {
    const p = h.ps[i];
    if (!p || p.folded || p.allIn) return false;
    if (p.bet < h.curBet) return true;
    return !p.acted && canAct > 1;
  }
  function nextActor(h, from) {
    const ca = canActCount(h);
    for (let k = 1; k <= MAXS; k++) {
      const i = (from + k + MAXS) % MAXS;
      if (needs(h, i, ca)) return i;
    }
    return -1;
  }
  function minRaiseTo(S, h) {
    const floor = h.phase === 'preflop' ? h.bbAmt * 2 : h.bbAmt;
    return Math.max(h.curBet + h.minRaise, floor);
  }
  function potTotal(h) {
    let t = h.pot;
    for (const p of h.ps) if (p) t += p.bet;
    return t;
  }

  function randomId() {
    return Math.random().toString(36).slice(2, 10);
  }

  function startHand(S, deck, now) {
    const el = eligible(S);
    if (el.length < 2) return null;
    const bb = S.settings.bb, sb = S.settings.sb;
    const h = {
      no: S.handNo + 1, hid: randomId(), phase: 'preflop', board: [],
      ps: new Array(MAXS).fill(null), pot: 0, curBet: 0, minRaise: bb,
      sbAmt: sb, bbAmt: bb, cur: -1, turn: 0, deadline: 0,
      button: -1, sb: -1, bb: -1, enc: {}, epk: null,
      shown: {}, names: {}, results: null, lastAct: null,
    };
    S.handNo = h.no;
    const btn = S.button < 0 ? el[Math.floor(Math.random() * el.length)] : nextIn(el, S.button);
    S.button = btn; h.button = btn;
    let sbS, bbS;
    if (el.length === 2) { sbS = btn; bbS = nextIn(el, btn); }
    else { sbS = nextIn(el, btn); bbS = nextIn(el, sbS); }
    h.sb = sbS; h.bb = bbS;
    for (const i of el) h.ps[i] = { bet: 0, total: 0, folded: false, allIn: false, acted: false, last: '' };

    const holes = {};
    const order = [];
    for (let k = 1; k <= MAXS; k++) { const i = (btn + k) % MAXS; if (el.includes(i)) order.push(i); }
    for (let r = 0; r < 2; r++) for (const i of order) (holes[i] = holes[i] || []).push(deck.shift());

    post(S, h, sbS, sb, 'SB');
    post(S, h, bbS, bb, 'BB');
    h.curBet = Math.max(h.ps[sbS].bet, h.ps[bbS].bet);
    S.hand = h;
    h.cur = -1; h.from = bbS;
    addLog(S, `— 핸드 #${h.no} · 딜러 ${nm(S, btn)}`);
    progress(S, { deck, holes }, now);
    return { holes, deck };
  }

  // Apply a player action. Returns null on success or an error string.
  function act(S, i, type, amount, now) {
    const h = S.hand;
    if (!handActive(S) || h.cur !== i) return '차례가 아니에요';
    const p = h.ps[i], st = S.seats[i];
    const toCall = Math.max(0, h.curBet - p.bet);
    let othersCan = 0;
    h.ps.forEach((q, k) => { if (q && k !== i && !q.folded && !q.allIn) othersCan++; });
    const canRaise = !p.acted && st.stack > toCall && othersCan > 0;
    const name = nm(S, i);

    if (type === 'call' && toCall === 0) type = 'check';
    if (type === 'raise' && !canRaise) type = toCall > 0 ? 'call' : 'check';

    if (type === 'fold') {
      p.folded = true; p.last = '폴드';
      addLog(S, `${name}: 폴드`);
    } else if (type === 'check') {
      if (toCall > 0) return '체크할 수 없어요';
      p.last = '체크';
      addLog(S, `${name}: 체크`);
    } else if (type === 'call') {
      const pay = Math.min(toCall, st.stack);
      st.stack -= pay; p.bet += pay; p.total += pay;
      if (st.stack === 0) p.allIn = true;
      p.last = p.allIn ? '올인' : '콜';
      addLog(S, `${name}: ${p.allIn ? '올인 콜' : '콜'} ${pay.toLocaleString()}`);
    } else if (type === 'raise') {
      const maxTo = p.bet + st.stack;
      let to = Math.floor(Number(amount) || 0);
      if (to > maxTo) to = maxTo;
      const minTo = minRaiseTo(S, h);
      if (to <= h.curBet) return '현재 베팅보다 커야 해요';
      if (to < minTo && to < maxTo) return `최소 ${minTo.toLocaleString()}까지 올려야 해요`;
      const pay = to - p.bet;
      st.stack -= pay; p.bet = to; p.total += pay;
      if (st.stack === 0) p.allIn = true;
      const wasBet = h.curBet === 0;
      const size = to - h.curBet;
      if (size >= h.minRaise) {
        h.minRaise = size;
        h.ps.forEach((q, k) => { if (q && k !== i && !q.folded && !q.allIn) q.acted = false; });
      }
      h.curBet = to;
      p.last = p.allIn ? '올인' : (wasBet ? '벳' : '레이즈');
      addLog(S, `${name}: ${p.allIn ? '올인' : (wasBet ? '벳' : '레이즈')} ${to.toLocaleString()}`);
    } else {
      return '알 수 없는 동작';
    }
    p.acted = true;
    h.lastAct = { seat: i, type, t: now || 0 };
    return null;
  }

  // Advance the hand as far as possible. ctx: {deck, holes}. Returns {again:true}
  // when a street was dealt with no one able to act (run-out; call again later).
  function progress(S, ctx, now) {
    const h = S.hand;
    if (!handActive(S)) return {};
    const live = [];
    h.ps.forEach((p, i) => { if (p && !p.folded) live.push(i); });
    if (live.length <= 1) { finish(S, ctx, now); return { done: true }; }

    const ca = canActCount(h);
    if (h.cur >= 0 && needs(h, h.cur, ca)) return {}; // still this player's turn
    const nx = nextActor(h, h.cur >= 0 ? h.cur : h.from);
    if (nx >= 0) { setTurn(S, h, nx, now); return {}; }

    // street complete
    for (const p of h.ps) if (p) { h.pot += p.bet; p.bet = 0; p.acted = false; if (!p.allIn && !p.folded) p.last = ''; }
    h.curBet = 0; h.minRaise = h.bbAmt; h.cur = -1; h.from = h.button;
    if (h.phase === 'river') { finish(S, ctx, now); return { done: true }; }
    const deck = ctx.deck;
    deck.shift(); // burn
    if (h.phase === 'preflop') { h.board.push(deck.shift(), deck.shift(), deck.shift()); h.phase = 'flop'; }
    else if (h.phase === 'flop') { h.board.push(deck.shift()); h.phase = 'turn'; }
    else if (h.phase === 'turn') { h.board.push(deck.shift()); h.phase = 'river'; }
    if (canActCount(h) >= 2) {
      const first = nextActor(h, h.button);
      if (first >= 0) { setTurn(S, h, first, now); return {}; }
    }
    return { again: true };
  }

  function setTurn(S, h, i, now) {
    h.cur = i;
    h.turn = (h.turn || 0) + 1;
    h.deadline = (now || 0) + (S.settings.timer > 0 ? S.settings.timer * 1000 : 0);
  }

  function buildPots(contrib, liveSet) {
    const seats = Object.keys(contrib).map(Number);
    const levels = [...new Set(seats.map(s => contrib[s]).filter(a => a > 0))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const L of levels) {
      let amt = 0; const elig = [];
      for (const s of seats) {
        const a = contrib[s];
        amt += Math.max(0, Math.min(a, L) - prev);
        if (a >= L && liveSet.has(s)) elig.push(s);
      }
      if (amt > 0) {
        const last = pots[pots.length - 1];
        if (!elig.length) {
          if (last) last.amount += amt;
          else pots.push({ amount: amt, elig: [...liveSet] });
        } else if (last && last.elig.length === elig.length && last.elig.every(x => elig.includes(x))) {
          last.amount += amt;
        } else {
          pots.push({ amount: amt, elig });
        }
      }
      prev = L;
    }
    return pots;
  }

  function finish(S, ctx, now) {
    const h = S.hand;
    const contrib = {};
    h.ps.forEach((p, i) => { if (p) { h.pot += p.bet; p.bet = 0; contrib[i] = p.total; } });
    // return uncalled excess to the single top contributor
    const sorted = Object.keys(contrib).map(Number).sort((a, b) => contrib[b] - contrib[a]);
    if (sorted.length) {
      const top = sorted[0];
      const second = sorted.length > 1 ? contrib[sorted[1]] : 0;
      if (contrib[top] > second) {
        const back = contrib[top] - second;
        contrib[top] = second;
        S.seats[top].stack += back;
        h.ps[top].total -= back;
        h.pot -= back;
      }
    }
    const live = [];
    h.ps.forEach((p, i) => { if (p && !p.folded) live.push(i); });
    const won = {};
    const res = { showdown: false, winners: [], pots: [], total: h.pot };

    if (live.length === 1) {
      const w = live[0];
      won[w] = h.pot;
    } else {
      while (h.board.length < 5) { ctx.deck.shift(); h.board.push(ctx.deck.shift()); }
      res.showdown = true;
      const scores = {};
      for (const i of live) {
        const hole = ctx.holes[i];
        scores[i] = evaluate(hole.concat(h.board));
        h.shown[i] = hole.slice();
        h.names[i] = describe(scores[i]);
      }
      const pots = buildPots(contrib, new Set(live));
      // odd-chip order: left of button
      const orderAfterBtn = [];
      for (let k = 1; k <= MAXS; k++) orderAfterBtn.push((h.button + k) % MAXS);
      for (const pot of pots) {
        let best = null, ws = [];
        for (const i of pot.elig) {
          const c = best ? cmp(scores[i], best) : 1;
          if (c > 0) { best = scores[i]; ws = [i]; }
          else if (c === 0) ws.push(i);
        }
        ws.sort((a, b) => orderAfterBtn.indexOf(a) - orderAfterBtn.indexOf(b));
        const share = Math.floor(pot.amount / ws.length);
        let rem = pot.amount - share * ws.length;
        for (const w of ws) { won[w] = (won[w] || 0) + share + (rem > 0 ? 1 : 0); if (rem > 0) rem--; }
        res.pots.push({ amount: pot.amount, winners: ws });
      }
    }
    for (const k of Object.keys(won)) {
      const i = Number(k);
      S.seats[i].stack += won[k];
      res.winners.push({ seat: i, amount: won[k], name: h.names[i] || '' });
    }
    res.winners.sort((a, b) => b.amount - a.amount);
    const wtxt = res.winners.map(w => `${nm(S, w.seat)} +${w.amount.toLocaleString()}${w.name ? ' (' + w.name + ')' : ''}`).join(', ');
    addLog(S, `승리: ${wtxt}`);

    h.results = res;
    h.phase = 'done';
    h.cur = -1;
    h.pot = 0;
    // clean up seats
    S.seats.forEach((s, i) => {
      if (!s) return;
      if (s.leave) { S.seats[i] = null; return; }
      if (s.bot && s.stack === 0) { s.stack = S.settings.stack; s.buyin += S.settings.stack; }
    });
    S.nextAt = (now || 0) + (res.showdown ? 7000 : 3500);
  }

  // Cancel an in-progress hand and refund every chip committed to it.
  function voidHand(S, now, why) {
    if (!handActive(S)) return false;
    const h = S.hand;
    h.ps.forEach((p, i) => { if (p && S.seats[i]) S.seats[i].stack += p.total; });
    S.seats.forEach((s, i) => { if (s && s.leave) S.seats[i] = null; });
    S.hand = null;
    S.nextAt = (now || 0) + 3000;
    addLog(S, `핸드 #${h.no} 무효${why ? ' — ' + why : ''} (칩 반환)`);
    return true;
  }

  function autoAct(S, i, now) {
    const h = S.hand;
    const toCall = Math.max(0, h.curBet - h.ps[i].bet);
    return act(S, i, toCall > 0 ? 'fold' : 'check', 0, now);
  }

  // Player stands up. Folds them if they are live in the current hand.
  function leaveSeat(S, i, now) {
    const st = S.seats[i];
    if (!st) return;
    if (handActive(S) && S.hand.ps[i] && !S.hand.ps[i].folded) {
      const h = S.hand;
      if (h.cur === i) act(S, i, 'fold', 0, now);
      else { h.ps[i].folded = true; h.ps[i].acted = true; h.ps[i].last = '폴드'; }
      st.leave = true;
      addLog(S, `${st.name} 님이 자리를 떠났어요`);
    } else if (handActive(S) && S.hand.ps[i]) {
      st.leave = true;
    } else {
      addLog(S, `${st.name} 님이 자리를 떠났어요`);
      S.seats[i] = null;
    }
  }

  function rebuy(S, i) {
    const st = S.seats[i];
    if (!st || st.stack > 0) return false;
    if (handActive(S) && S.hand.ps[i] && !S.hand.ps[i].folded) return false;
    st.stack = S.settings.stack;
    st.buyin += S.settings.stack;
    addLog(S, `${st.name}: 리바이 +${S.settings.stack.toLocaleString()}`);
    return true;
  }

  /* ---------- bots ---------- */
  function equity(hole, board, nOpp, iters) {
    const used = new Set(hole.concat(board));
    const rest = freshDeck().filter(c => !used.has(c));
    const needBoard = 5 - board.length;
    const need = needBoard + nOpp * 2;
    let score = 0;
    const tmp = rest.slice();
    for (let it = 0; it < iters; it++) {
      for (let k = 0; k < need; k++) {
        const j = k + Math.floor(Math.random() * (tmp.length - k));
        const t = tmp[k]; tmp[k] = tmp[j]; tmp[j] = t;
      }
      const b = board.concat(tmp.slice(0, needBoard));
      const mine = evaluate(hole.concat(b));
      let lose = false, ties = 0;
      for (let o = 0; o < nOpp; o++) {
        const opp = [tmp[needBoard + o * 2], tmp[needBoard + o * 2 + 1]];
        const c = cmp(mine, evaluate(opp.concat(b)));
        if (c < 0) { lose = true; break; }
        if (c === 0) ties++;
      }
      if (!lose) score += 1 / (ties + 1);
    }
    return score / iters;
  }

  function botDecide(S, i, hole, rnd) {
    rnd = rnd || Math.random;
    const h = S.hand, p = h.ps[i], st = S.seats[i];
    let opp = 0, othersCan = 0;
    h.ps.forEach((q, k) => { if (q && k !== i && !q.folded) { opp++; if (!q.allIn) othersCan++; } });
    const e = equity(hole, h.board, Math.max(1, opp), 240);
    const rel = e * (opp + 1);
    const pot = potTotal(h);
    const toCall = Math.max(0, h.curBet - p.bet);
    const odds = toCall / (pot + toCall || 1);
    const canRaise = !p.acted && st.stack > toCall && othersCan > 0;
    const r = rnd();
    const unit = Math.max(1, h.sbAmt);
    if (canRaise && (rel > 1.9 || (rel > 1.45 && r < 0.35) || (toCall === 0 && r < 0.07))) {
      const maxTo = p.bet + st.stack;
      let to = h.curBet + Math.max(h.minRaise, Math.round(pot * (0.5 + rnd() * 0.5)));
      if (rel > 2.6 && r < 0.2) to = maxTo;
      to = Math.round(to / unit) * unit;
      to = Math.min(maxTo, Math.max(minRaiseTo(S, h), to));
      return { type: 'raise', amount: to };
    }
    if (toCall === 0) return { type: 'check' };
    if (e >= odds * 1.05 || (toCall <= h.bbAmt && rel > 0.75)) return { type: 'call' };
    return { type: 'fold' };
  }

  const E = {
    MAXS, RANKS, SUITS, rv, rankLabel, freshDeck, shuffle, mathRandInt,
    evaluate, cmp, describe, catName, newState, addLog, seatOf, handActive,
    eligible, nextIn, minRaiseTo, potTotal, startHand, act, progress, finish,
    buildPots, voidHand, autoAct, leaveSeat, rebuy, equity, botDecide, canActCount,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = E;
  else root.PokerEngine = E;
})(typeof globalThis !== 'undefined' ? globalThis : this);

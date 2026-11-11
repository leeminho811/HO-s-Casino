/* Baccarat (punto banco): bet on Player, Banker or Tie; the drawing rules are automatic. */
(function (root) {
  'use strict';
  const C = root.HOGames._c;
  const pv = c => (c[0] === 'A' ? 1 : 'TJQK'.includes(c[0]) ? 0 : Number(c[0]));
  const total = cs => cs.reduce((a, c) => a + pv(c), 0) % 10;
  // who draws next ('P' | 'B'), or null when the coup is complete
  function nextDraw(P, B) {
    if (P.length < 2 || B.length < 2) return P.length <= B.length ? 'P' : 'B';
    const p2 = total(P.slice(0, 2)), b2 = total(B.slice(0, 2));
    if (p2 >= 8 || b2 >= 8) return null;
    if (P.length === 2 && B.length === 2) return p2 <= 5 ? 'P' : (b2 <= 5 ? 'B' : null);
    if (P.length === 3 && B.length === 2) {
      const x = pv(P[2]);
      if (b2 <= 2) return 'B';
      if (b2 === 3) return x !== 8 ? 'B' : null;
      if (b2 === 4) return x >= 2 && x <= 7 ? 'B' : null;
      if (b2 === 5) return x >= 4 && x <= 7 ? 'B' : null;
      if (b2 === 6) return x === 6 || x === 7 ? 'B' : null;
    }
    return null;
  }
  const winner = (P, B) => { const p = total(P), b = total(B); return p > b ? 'p' : b > p ? 'b' : 't'; };
  // total returned (stakes included)
  function payout(bets, w) {
    const p = bets.p || 0, b = bets.b || 0, t = bets.t || 0;
    if (w === 't') return p + b + t * 9;
    if (w === 'p') return p * 2;
    return b + Math.floor(b * 0.95);
  }
  const SIDE = { p: '플레이어', b: '뱅커', t: '타이' };
  let pick = 10;

  const game = {
    id: 'baccarat', name: '바카라', seats: 8,
    logic: { total, nextDraw, winner, payout },
    rules: [
      '“플레이어”와 “뱅커” 두 패 중 합의 끝자리가 9에 가까운 쪽을 맞히는 게임이에요. 나는 어느 쪽이 이길지에만 걸면 돼요.',
      'A는 1, 2~9는 숫자 그대로, 10·J·Q·K는 0. 합이 10을 넘으면 끝자리만 봐요 (7+8=15 → 5).',
      '세 번째 카드를 받을지는 정해진 규칙대로 자동으로 진행돼요.',
      '플레이어 승: 1배 · 뱅커 승: 0.95배(수수료 5%) · 타이: 8배. 타이가 나오면 플레이어/뱅커 베팅은 돌려받아요.',
    ],
    init: () => ({ phase: 'bet', no: 0, deadline: 0, stepAt: 0, bets: {}, ready: {}, last: {}, P: [], B: [], win: null, wins: {}, hist: [] }),
    busy: (G, i) => G.phase === 'deal' && !!G.bets[i],
    botNote: '봇도 플레이어/뱅커에 걸어요. 내가 칩을 올리면 봇도 따라 베팅해요.',
    bot: (a, i) => C.botBets(a, i, () => (a.rint(12) === 0 ? 't' : a.rint(2) ? 'b' : 'p'), 1),
    onReq(a, i, r) {
      const { S, G } = a, st = S.seats[i];
      if (G.phase !== 'bet') return;
      if (r.type === 'bet') {
        const add = Math.floor(Number(r.add));
        if (!(r.k in SIDE) || !(add > 0) || add > st.stack) return;
        st.stack -= add; G.bets[i] = G.bets[i] || {}; G.bets[i][r.k] = (G.bets[i][r.k] || 0) + add; delete G.ready[i];
      } else if (r.type === 'clear' && G.bets[i]) { st.stack += C.sum(G.bets[i]); delete G.bets[i]; delete G.ready[i]; }
      else if (r.type === 'rebet' && !G.bets[i] && G.last[i] && st.stack >= C.sum(G.last[i])) { st.stack -= C.sum(G.last[i]); G.bets[i] = Object.assign({}, G.last[i]); }
      else if (r.type === 'ready' && G.bets[i]) G.ready[i] = true;
    },
    onLeave(a, i) { const { G } = a; delete G.bets[i]; delete G.ready[i]; delete G.last[i]; },
    tick(a) {
      const { S, G, now, rint } = a;
      if (G.phase === 'bet') {
        if (!C.shouldStart(S, G, now, i => !!G.bets[i])) return;
        G.no++; G.P = []; G.B = []; G.win = null; G.wins = {}; G.ready = {}; G.phase = 'deal'; G.stepAt = now + 600;
      } else if (G.phase === 'deal') {
        if (now < G.stepAt) return;
        const who = nextDraw(G.P, G.B);
        if (who) { G[who].push(C.draw(rint)); G.stepAt = now + (G.P.length + G.B.length >= 4 ? 1300 : 750); return; }
        G.win = winner(G.P, G.B);
        const parts = [];
        for (const k of Object.keys(G.bets)) {
          const st = S.seats[k], pay = payout(G.bets[k], G.win), net = pay - C.sum(G.bets[k]);
          G.wins[k] = net; G.last[k] = G.bets[k];
          if (st) { st.stack += pay; parts.push(`${st.name} ${net >= 0 ? '+' : ''}${net}`); }
        }
        G.hist.push(G.win); G.hist = G.hist.slice(-36);
        a.log(`바카라 #${G.no} · ${SIDE[G.win]} (${total(G.P)}:${total(G.B)}) · ${parts.join(', ')}`);
        G.phase = 'done'; G.deadline = now + 6000;
      } else if (now >= G.deadline) { G.phase = 'bet'; G.bets = {}; G.wins = {}; G.deadline = 0; }
    },

    /* ---------- UI ---------- */
    render(v) {
      const { G, S, el, fmt, stage, me } = v;
      stage.className = 'gstage bc';
      const felt = el('div', 'gfelt');
      const hands = el('div', 'bc-hands');
      [['P', 'p', '플레이어'], ['B', 'b', '뱅커']].forEach(([key, side, label]) => {
        const h = el('div', 'bc-hand ' + side);
        if (G.phase === 'done' && G.win === side) h.classList.add('win');
        const cs = G[key].length ? G[key] : [undefined, undefined];
        h.append(el('div', 'glabel', label), v.cards('bc' + key + G.no, cs), el('div', 'gval', G[key].length ? String(total(G[key])) : ''));
        hands.append(h);
      });
      const msg = el('div', 'gmsg');
      if (G.phase === 'bet') { if (G.deadline) msg.append('베팅 마감 ', v.countdown(G.deadline)); else msg.textContent = '칩을 고르고 이길 쪽을 눌러요'; }
      else if (G.phase === 'deal') msg.textContent = '카드를 여는 중…';
      else { msg.append(el('b', null, G.win === 't' ? '타이!' : SIDE[G.win] + ' 승')); const w = G.wins[me]; if (w != null) { msg.append(w > 0 ? ` · +${fmt(w)}` : w < 0 ? ` · −${fmt(-w)}` : ' · 본전'); if (w > 0) msg.classList.add('good'); } }
      const mine = G.bets[me] || {}, all = {};
      Object.values(G.bets).forEach(b => Object.entries(b).forEach(([k, x]) => { all[k] = (all[k] || 0) + x; }));
      const spots = el('div', 'bc-spots');
      [['p', '플레이어', '1 : 1'], ['t', '타이', '8 : 1'], ['b', '뱅커', '0.95 : 1']].forEach(([k, label, odds]) => {
        const b = el('button', 'bc-spot ' + k);
        b.append(el('b', null, label), el('small', null, odds));
        if (all[k]) b.append(el('em', mine[k] ? 'mybet' : null, (mine[k] ? '내 ' : '') + fmt(mine[k] || all[k])));
        if (G.phase === 'done' && G.win === k) b.classList.add('hit');
        b.disabled = G.phase !== 'bet' || me < 0 || !!G.ready[me];
        b.onclick = () => { const st = S.seats[me]; if (!st) return; if (st.stack < pick) { v.toast('칩이 모자라요'); return; } v.send('bet', { k, add: pick }); };
        spots.append(b);
      });
      const road = el('div', 'bc-road');
      G.hist.forEach(w => road.append(el('i', w, { p: 'P', b: 'B', t: 'T' }[w])));
      felt.append(hands, msg, spots, road);
      const seats = el('div', 'rseats');
      S.seats.forEach((st, i) => {
        if (!st) return;
        const p = el('div', 'rseat' + (i === me ? ' me' : ''));
        p.append(el('b', null, st.name), el('span', 'num', fmt(st.stack)));
        const t = G.bets[i] ? C.sum(G.bets[i]) : 0;
        if (G.phase === 'done' && G.wins[i] != null) { const w = G.wins[i]; p.append(el('em', w > 0 ? 'good' : w < 0 ? 'bad' : '', (w > 0 ? '+' : w < 0 ? '−' : '') + fmt(Math.abs(w)))); }
        else if (t) p.append(el('em', null, '베팅 ' + fmt(t) + (G.ready[i] ? ' ✓' : '')));
        seats.append(p);
      });
      if (me < 0) seats.append(v.sitButton());
      stage.append(felt, seats);
    },
    dock(v) {
      const { G, me, seat, el, fmt, dock, send } = v;
      if (G.phase !== 'bet') { dock.append(v.wait(G.phase === 'deal' ? '카드를 여는 중…' : '다음 판을 준비하는 중…')); return; }
      if (G.ready[me]) { dock.append(v.wait(`베팅 ${fmt(C.sum(G.bets[me]))} · 다른 플레이어를 기다리는 중`)); return; }
      if (pick > seat.stack && seat.stack >= 10) pick = C.CHIPS.filter(x => x <= seat.stack).pop() || 10;
      const chips = el('div', 'chips');
      C.CHIPS.forEach(x => { const b = el('button', 'chipbtn c' + x + (pick === x ? ' sel' : ''), String(x)); b.disabled = x > seat.stack; b.onclick = () => { pick = x; v.rerender(); }; chips.append(b); });
      const row = el('div', 'actions');
      const tot = G.bets[me] ? C.sum(G.bets[me]) : 0;
      const clr = el('button', 'btn ghost', '지우기'); clr.disabled = !tot; clr.onclick = () => send('clear');
      const re = el('button', 'btn', '같은 베팅'); re.disabled = !!tot || !G.last[me] || seat.stack < C.sum(G.last[me]); re.onclick = () => send('rebet');
      const ok = el('button', 'btn primary'); ok.append('베팅 완료', el('small', null, fmt(tot))); ok.disabled = !tot; ok.onclick = () => send('ready');
      row.append(clr, re, ok);
      dock.append(chips, row);
    },
  };
  root.HOGames.baccarat = game;
})(typeof window !== 'undefined' ? window : globalThis);

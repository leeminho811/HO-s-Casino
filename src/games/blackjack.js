/* Blackjack: everyone at the table plays against the house dealer. */
(function (root) {
  'use strict';
  const C = root.HOGames._c;
  const val = c => (c[0] === 'A' ? 11 : 'TJQK'.includes(c[0]) ? 10 : Number(c[0]));
  function handVal(cards) {
    let v = 0, aces = 0;
    for (const c of cards) { v += val(c); if (c[0] === 'A') aces++; }
    while (v > 21 && aces) { v -= 10; aces--; }
    return { v, soft: aces > 0 };
  }
  const isBJ = h => h.cards.length === 2 && !h.dbl && handVal(h.cards).v === 21;
  // total returned to the player (stake included) for a finished hand
  function settleHand(h, dealer) {
    const pv = handVal(h.cards).v, dv = handVal(dealer).v, dBJ = dealer.length === 2 && dv === 21;
    if (pv > 21) return { res: 'bust', pay: 0 };
    if (isBJ(h)) return dBJ ? { res: 'push', pay: h.bet } : { res: 'bj', pay: h.bet + Math.floor(h.bet * 1.5) };
    if (dBJ) return { res: 'lose', pay: 0 };
    if (dv > 21 || pv > dv) return { res: 'win', pay: h.bet * 2 };
    return pv === dv ? { res: 'push', pay: h.bet } : { res: 'lose', pay: 0 };
  }

  function nextTurn(a) {
    const { G, now } = a;
    const order = Object.keys(G.hands).map(Number).sort((x, y) => x - y);
    const nxt = order.find(i => !G.hands[i].done);
    if (nxt === undefined) { G.cur = -1; G.phase = 'dealer'; G.stepAt = now + 800; return; }
    G.cur = nxt; G.deadline = now + 25000;
  }
  function finish(a, i) { a.G.hands[i].done = true; nextTurn(a); }
  function deal(a) {
    const { S, G, rint } = a;
    G.no++; G.hands = {}; G.dealer = [C.draw(rint)];
    for (const i of C.seated(S)) {
      if (!G.bets[i]) continue;
      const h = { cards: [C.draw(rint), C.draw(rint)], bet: G.bets[i], done: false, dbl: false, res: null, pay: 0 };
      if (isBJ(h)) h.done = true;
      G.hands[i] = h; G.last[i] = G.bets[i];
    }
    G.bets = {}; G.ready = {}; G.phase = 'play';
    nextTurn(a);
  }
  function settle(a) {
    const { S, G, now } = a;
    const parts = [];
    for (const k of Object.keys(G.hands)) {
      const h = G.hands[k], st = S.seats[k];
      Object.assign(h, settleHand(h, G.dealer));
      if (st) { st.stack += h.pay; parts.push(`${st.name} ${h.pay - h.bet >= 0 ? '+' : ''}${h.pay - h.bet}`); }
    }
    a.log(`블랙잭 #${G.no} · 딜러 ${handVal(G.dealer).v} · ${parts.join(', ')}`);
    G.phase = 'done'; G.deadline = now + 6000;
  }

  const game = {
    id: 'blackjack', name: '블랙잭', seats: 5,
    logic: { handVal, settleHand, isBJ },
    rules: [
      '카드 합이 21에 가까운 쪽이 이겨요. 21을 넘으면 바로 져요(버스트).',
      'J·Q·K는 10, A는 1 또는 11로 셉니다.',
      '히트: 한 장 더 · 스탠드: 멈추기 · 더블: 베팅을 두 배로 올리고 딱 한 장만 더 받기.',
      '처음 두 장이 21이면 블랙잭 — 1.5배를 받아요. 딜러와 같으면 푸시(무승부).',
      '딜러는 17 이상이 될 때까지 무조건 카드를 받아요. 카드는 매번 새로 섞인 덱에서 나와요.',
    ],
    init: () => ({ phase: 'bet', no: 0, deadline: 0, stepAt: 0, bets: {}, ready: {}, hands: {}, dealer: [], cur: -1, last: {} }),
    busy: (G, i) => (G.phase === 'play' || G.phase === 'dealer') && !!G.hands[i],
    botNote: '봇도 각자 딜러와 대결해요. 내가 칩을 올리면 봇도 같이 베팅해요.',
    // simple basic strategy
    bot(a, i) {
      const { G, S } = a;
      if (G.phase === 'bet') return C.botBets(a, i, () => 'x', 1);
      if (G.phase !== 'play' || G.cur !== i || !G.hands[i]) return null;
      const h = G.hands[i], { v, soft } = handVal(h.cards), up = val(G.dealer[0] || 'T');
      if (h.cards.length === 2 && !soft && (v === 11 || (v === 10 && up < 10)) && S.seats[i].stack >= h.bet) return { type: 'double' };
      if (soft) return { type: v >= 19 || (v === 18 && up <= 8) ? 'stand' : 'hit' };
      if (v >= 17 || (v >= 13 && up <= 6) || (v === 12 && up >= 4 && up <= 6)) return { type: 'stand' };
      return { type: 'hit' };
    },
    onReq(a, i, r) {
      const { S, G, rint } = a, st = S.seats[i];
      if (G.phase === 'bet') {
        if (r.type === 'bet') {
          const add = Math.floor(Number(r.add));
          if (!(add > 0) || add > st.stack) return;
          st.stack -= add; G.bets[i] = (G.bets[i] || 0) + add; delete G.ready[i];
        } else if (r.type === 'clear' && G.bets[i]) { st.stack += G.bets[i]; delete G.bets[i]; delete G.ready[i]; }
        else if (r.type === 'rebet' && !G.bets[i] && G.last[i] && st.stack >= G.last[i]) { st.stack -= G.last[i]; G.bets[i] = G.last[i]; }
        else if (r.type === 'ready' && G.bets[i]) G.ready[i] = true;
        return;
      }
      if (G.phase !== 'play' || G.cur !== i) return;
      const h = G.hands[i];
      if (r.type === 'stand') finish(a, i);
      else if (r.type === 'hit') {
        h.cards.push(C.draw(rint));
        if (handVal(h.cards).v >= 21) finish(a, i); else G.deadline = a.now + 25000;
      } else if (r.type === 'double' && h.cards.length === 2 && st.stack >= h.bet) {
        st.stack -= h.bet; h.bet *= 2; h.dbl = true; h.cards.push(C.draw(rint)); finish(a, i);
      }
    },
    onLeave(a, i) {
      const { G } = a;
      delete G.bets[i]; delete G.ready[i]; delete G.last[i];
      if (G.hands[i] && G.phase === 'play') { delete G.hands[i]; if (G.cur === i) nextTurn(a); }
    },
    tick(a) {
      const { S, G, now, rint } = a;
      if (G.phase === 'bet') { if (C.shouldStart(S, G, now, i => G.bets[i] > 0)) deal(a); }
      else if (G.phase === 'play') { if (G.cur < 0 || !G.hands[G.cur]) nextTurn(a); else if (now > G.deadline) finish(a, G.cur); }
      else if (G.phase === 'dealer') {
        if (now < G.stepAt) return;
        const live = Object.values(G.hands).some(h => handVal(h.cards).v <= 21 && !isBJ(h));
        if (G.dealer.length < 2 || (live && handVal(G.dealer).v < 17)) { G.dealer.push(C.draw(rint)); G.stepAt = now + 900; }
        else settle(a);
      } else if (now >= G.deadline) { G.phase = 'bet'; G.hands = {}; G.dealer = []; G.deadline = 0; G.cur = -1; }
    },

    /* ---------- UI ---------- */
    render(v) {
      const { G, S, el, fmt, stage } = v;
      stage.className = 'gstage bj';
      const felt = el('div', 'gfelt');
      const d = el('div', 'bj-dealer');
      const dc = G.dealer.slice(); if (G.phase === 'play' && dc.length === 1) dc.push(null);
      d.append(el('div', 'glabel', '딜러'), v.cards('bjd' + G.no, dc.length ? dc : [undefined, undefined]));
      const dv = el('div', 'gval', G.dealer.length ? String(handVal(G.dealer).v) : '');
      if (G.phase === 'done' && handVal(G.dealer).v > 21) { dv.textContent = '버스트'; dv.classList.add('bad'); }
      d.append(dv);
      const msg = el('div', 'gmsg');
      if (G.phase === 'bet') { if (G.deadline) msg.append('베팅 마감까지 ', v.countdown(G.deadline)); else msg.textContent = '칩을 눌러 베팅하면 판이 시작돼요'; }
      else if (G.phase === 'play') { const s = S.seats[G.cur]; msg.append(el('b', null, G.cur === v.me ? '내' : (s ? s.name + ' 님' : '')), ' 차례 · ', v.countdown(G.deadline)); }
      else if (G.phase === 'dealer') msg.textContent = '딜러가 카드를 받는 중…';
      else msg.textContent = '다음 판을 준비하는 중…';
      const spots = el('div', 'spots');
      S.seats.forEach((st, i) => {
        const sp = v.spot(i);
        if (st) {
          const h = G.hands[i];
          if (h) {
            sp.querySelector('.spot-cards').append(v.cards('bjp' + G.no + ':' + i, h.cards));
            const hv = handVal(h.cards).v;
            const tag = el('div', 'gtag', String(hv));
            if (h.res) {
              const net = h.pay - h.bet;
              tag.textContent = { bj: '블랙잭! +' + fmt(net), win: '+' + fmt(net), push: '푸시', lose: '−' + fmt(h.bet), bust: '버스트 −' + fmt(h.bet) }[h.res];
              tag.classList.add(net > 0 ? 'good' : net < 0 ? 'bad' : 'even');
            } else if (hv > 21) { tag.textContent = '버스트'; tag.classList.add('bad'); }
            else if (isBJ(h)) { tag.textContent = '블랙잭!'; tag.classList.add('good'); }
            sp.append(tag);
            sp.append(v.chip(h.bet));
          } else if (G.bets[i]) { sp.append(v.chip(G.bets[i])); if (G.ready[i]) sp.append(el('div', 'gtag even', '준비 완료')); }
          if (G.phase === 'play' && G.cur === i) sp.classList.add('turn');
        }
        spots.append(sp);
      });
      felt.append(d, msg, spots);
      stage.append(felt);
    },
    dock(v) {
      const { G, me, seat, el, fmt, dock, send } = v;
      if (G.phase === 'bet') {
        if (G.ready[me]) { dock.append(v.wait(`베팅 ${fmt(G.bets[me])} · 다른 플레이어를 기다리는 중`)); return; }
        const chips = el('div', 'chips');
        C.CHIPS.forEach(x => { const b = el('button', 'chipbtn c' + x, String(x)); b.disabled = x > seat.stack; b.onclick = () => send('bet', { add: x }); chips.append(b); });
        const row = el('div', 'actions');
        const clr = el('button', 'btn ghost', '지우기'); clr.disabled = !G.bets[me]; clr.onclick = () => send('clear');
        const re = el('button', 'btn'); re.append('같은 금액', el('small', null, G.last[me] ? fmt(G.last[me]) : '-'));
        re.disabled = !!G.bets[me] || !G.last[me] || seat.stack < G.last[me]; re.onclick = () => send('rebet');
        const ok = el('button', 'btn primary'); ok.append('베팅 완료', el('small', null, fmt(G.bets[me] || 0)));
        ok.disabled = !G.bets[me]; ok.onclick = () => send('ready');
        row.append(clr, re, ok);
        dock.append(chips, row);
      } else if (G.phase === 'play' && G.cur === me) {
        const h = G.hands[me], row = el('div', 'actions');
        const hit = el('button', 'btn call', '히트'); hit.onclick = () => send('hit');
        const st = el('button', 'btn primary', '스탠드'); st.onclick = () => send('stand');
        const db = el('button', 'btn'); db.append('더블', el('small', null, '+' + fmt(h.bet)));
        db.disabled = h.cards.length !== 2 || seat.stack < h.bet; db.onclick = () => send('double');
        row.append(hit, st, db);
        dock.append(row);
      } else dock.append(v.wait(G.hands[me] ? (G.phase === 'done' ? '결과 확인 중…' : '다른 플레이어 차례예요') : '다음 판부터 참여할 수 있어요'));
    },
  };
  root.HOGames.blackjack = game;
})(typeof window !== 'undefined' ? window : globalThis);

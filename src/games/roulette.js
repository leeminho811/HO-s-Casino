/* European roulette (single zero). */
(function (root) {
  'use strict';
  const C = root.HOGames._c;
  const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const color = n => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black');
  const OUT = { red: '빨강', black: '검정', odd: '홀', even: '짝', low: '1–18', high: '19–36', d1: '1–12', d2: '13–24', d3: '25–36', c1: '2:1', c2: '2:1', c3: '2:1' };
  const validKey = k => (typeof k === 'string' && (k in OUT || (/^n\d{1,2}$/.test(k) && Number(k.slice(1)) <= 36)));
  const mult = k => (k[0] === 'n' ? 35 : /^[dc]\d$/.test(k) ? 2 : 1);
  function wins(k, n) {
    if (k[0] === 'n') return Number(k.slice(1)) === n;
    if (n === 0) return false;
    switch (k) {
      case 'red': return REDS.has(n);
      case 'black': return !REDS.has(n);
      case 'odd': return n % 2 === 1;
      case 'even': return n % 2 === 0;
      case 'low': return n <= 18;
      case 'high': return n >= 19;
      case 'd1': return n <= 12;
      case 'd2': return n >= 13 && n <= 24;
      case 'd3': return n >= 25;
      case 'c1': return n % 3 === 1;
      case 'c2': return n % 3 === 2;
      case 'c3': return n % 3 === 0;
      default: return false;
    }
  }
  // total returned (stakes included) for a set of bets
  const payout = (bets, n) => Object.entries(bets).reduce((a, [k, amt]) => a + (wins(k, n) ? amt * (mult(k) + 1) : 0), 0);

  let wheelEl = null, rot = 0, spunNo = -1, pick = 10;
  function buildWheel(el) {
    const w = el('div', 'rwheel');
    const seg = 360 / 37;
    const stops = WHEEL.map((n, k) => `${{ green: '#1f8f5f', red: '#b8232c', black: '#191513' }[color(n)]} ${k * seg}deg ${(k + 1) * seg}deg`).join(',');
    const disc = el('div', 'rdisc');
    disc.style.background = `conic-gradient(from ${-seg / 2}deg, ${stops})`;
    WHEEL.forEach((n, k) => { const t = el('span', null, String(n)); t.style.transform = `rotate(${k * seg}deg) translateY(calc(var(--rw) * -0.43))`; disc.append(t); });
    disc.append(el('i', 'rhub'));
    w.append(disc, el('i', 'rball'));
    return w;
  }

  const game = {
    id: 'roulette', name: '룰렛', seats: 8, keep: true,
    logic: { wins, mult, payout, color, WHEEL },
    rules: [
      '구슬이 0~36 중 어느 칸에 멈출지 맞히는 게임이에요. 칩을 고르고 판 위의 칸을 눌러 베팅해요.',
      '숫자 하나: 35배 · 1–12 / 13–24 / 25–36, 세로줄(2:1): 2배 · 빨강/검정, 홀/짝, 1–18/19–36: 1배.',
      '0이 나오면 숫자 0에 건 칩만 이겨요.',
      '첫 칩이 올라가면 20초 뒤에 구슬이 돌아요. 모두 "베팅 완료"를 누르면 바로 돌려요.',
    ],
    init: () => ({ phase: 'bet', no: 0, deadline: 0, bets: {}, ready: {}, last: {}, result: null, wins: {}, hist: [] }),
    busy: (G, i) => G.phase === 'spin' && !!G.bets[i],
    botNote: '봇도 같이 칩을 걸어요. 내가 칩을 올리면 봇도 따라 베팅해요.',
    bot(a, i) {
      const { rint } = a;
      const outside = ['red', 'black', 'odd', 'even', 'low', 'high', 'd1', 'd2', 'd3', 'c1', 'c2', 'c3'];
      return C.botBets(a, i, () => (rint(4) === 0 ? 'n' + rint(37) : outside[rint(outside.length)]), 3);
    },
    onReq(a, i, r) {
      const { S, G } = a, st = S.seats[i];
      if (G.phase !== 'bet') return;
      if (r.type === 'bet') {
        const add = Math.floor(Number(r.add));
        if (!validKey(r.k) || !(add > 0) || add > st.stack) return;
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
        G.no++; G.result = rint(37); G.wins = {}; G.ready = {}; G.phase = 'spin'; G.deadline = now + 6000;
      } else if (G.phase === 'spin') {
        if (now < G.deadline) return;
        const parts = [];
        for (const k of Object.keys(G.bets)) {
          const st = S.seats[k], pay = payout(G.bets[k], G.result), net = pay - C.sum(G.bets[k]);
          G.wins[k] = net; G.last[k] = G.bets[k];
          if (st) { st.stack += pay; parts.push(`${st.name} ${net >= 0 ? '+' : ''}${net}`); }
        }
        G.hist.unshift(G.result); G.hist = G.hist.slice(0, 14);
        a.log(`룰렛 #${G.no} · ${G.result} ${{ red: '빨강', black: '검정', green: '초록' }[color(G.result)]} · ${parts.join(', ')}`);
        G.phase = 'done'; G.deadline = now + 6000;
      } else if (now >= G.deadline) { G.phase = 'bet'; G.bets = {}; G.wins = {}; G.deadline = 0; }
    },

    /* ---------- UI ---------- */
    render(v) {
      const { G, S, el, fmt, stage, me } = v;
      stage.className = 'gstage rl';
      if (!wheelEl || !wheelEl.isConnected) {
        stage.textContent = '';
        wheelEl = buildWheel(el);
        const top = el('div', 'rtop'); top.append(wheelEl, el('div', 'rinfo'));
        stage.append(top, el('div', 'rboard'), el('div', 'rseats'));
        spunNo = -1;
      }
      // wheel
      const disc = wheelEl.firstChild, seg = 360 / 37;
      if (G.result != null && G.no !== spunNo && G.phase !== 'bet') {
        const target = 360 - WHEEL.indexOf(G.result) * seg;
        const animate = G.phase === 'spin' && spunNo !== -1 || G.phase === 'spin';
        rot = Math.ceil(rot / 360) * 360 + (animate ? 360 * 5 : 0) + target;
        disc.style.transition = animate ? 'transform 5.2s cubic-bezier(.12,.6,.12,1)' : 'none';
        disc.style.transform = `rotate(${rot}deg)`;
        spunNo = G.no;
      }
      wheelEl.classList.toggle('spinning', G.phase === 'spin');
      // info
      const info = stage.querySelector('.rinfo'); info.textContent = '';
      const big = el('div', 'rresult');
      if (G.phase === 'done') { big.textContent = String(G.result); big.classList.add(color(G.result)); }
      else if (G.phase === 'spin') big.textContent = '…';
      else big.textContent = '?';
      const msg = el('div', 'gmsg');
      if (G.phase === 'bet') { if (G.deadline) msg.append('베팅 마감 ', v.countdown(G.deadline)); else msg.textContent = '칩을 고르고 칸을 눌러요'; }
      else if (G.phase === 'spin') msg.textContent = '구슬이 도는 중…';
      else { const w = G.wins[me]; msg.textContent = w == null ? '결과 확인' : w > 0 ? `+${fmt(w)} 당첨!` : w < 0 ? `−${fmt(-w)}` : '본전'; if (w > 0) msg.classList.add('good'); }
      const hist = el('div', 'rhist');
      G.hist.forEach(n => hist.append(el('i', color(n), String(n))));
      info.append(big, msg, hist);
      // board
      const board = stage.querySelector('.rboard'); board.textContent = '';
      const mine = G.bets[me] || {}, all = {};
      Object.values(G.bets).forEach(b => Object.entries(b).forEach(([k, x]) => { all[k] = (all[k] || 0) + x; }));
      const cell = (k, label, cls) => {
        const c = el('button', 'rc ' + (cls || ''), label);
        if (G.phase === 'done' && wins(k, G.result)) c.classList.add('hit');
        if (all[k]) { const b = el('em', mine[k] ? 'mybet' : null, fmt(mine[k] || all[k])); c.append(b); }
        c.disabled = G.phase !== 'bet' || me < 0 || !!G.ready[me];
        c.onclick = () => { const st = S.seats[me]; if (!st) return; if (st.stack < pick) { v.toast('칩이 모자라요'); return; } v.send('bet', { k, add: pick }); };
        return c;
      };
      const grid = el('div', 'rgrid');
      const zero = cell('n0', '0', 'green zero'); grid.append(zero);
      for (let row = 0; row < 3; row++) for (let col = 0; col < 12; col++) {
        const n = col * 3 + (3 - row);
        const c = cell('n' + n, String(n), color(n)); c.style.gridRow = String(row + 1); c.style.gridColumn = String(col + 2); grid.append(c);
      }
      ['c3', 'c2', 'c1'].forEach((k, row) => { const c = cell(k, '2:1', 'out'); c.style.gridRow = String(row + 1); c.style.gridColumn = '14'; grid.append(c); });
      const doz = el('div', 'rrow three'); ['d1', 'd2', 'd3'].forEach(k => doz.append(cell(k, OUT[k], 'out')));
      const out = el('div', 'rrow six'); ['low', 'even', 'red', 'black', 'odd', 'high'].forEach(k => out.append(cell(k, OUT[k], 'out ' + (k === 'red' || k === 'black' ? k : ''))));
      board.append(grid, doz, out);
      // players
      const seats = stage.querySelector('.rseats'); seats.textContent = '';
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
    },
    dock(v) {
      const { G, me, seat, el, fmt, dock, send } = v;
      if (G.phase !== 'bet') { dock.append(v.wait(G.phase === 'spin' ? '구슬이 도는 중…' : '다음 판을 준비하는 중…')); return; }
      if (G.ready[me]) { dock.append(v.wait(`베팅 ${fmt(C.sum(G.bets[me]))} · 다른 플레이어를 기다리는 중`)); return; }
      if (!C.CHIPS.includes(pick) || (pick > seat.stack && seat.stack >= 10)) pick = C.CHIPS.filter(x => x <= seat.stack).pop() || 10;
      const chips = el('div', 'chips');
      C.CHIPS.forEach(x => { const b = el('button', 'chipbtn c' + x + (pick === x ? ' sel' : ''), String(x)); b.disabled = x > seat.stack; b.onclick = () => { pick = x; v.rerender(); }; chips.append(b); });
      const row = el('div', 'actions');
      const total = G.bets[me] ? C.sum(G.bets[me]) : 0;
      const clr = el('button', 'btn ghost', '지우기'); clr.disabled = !total; clr.onclick = () => send('clear');
      const re = el('button', 'btn', '같은 베팅'); re.disabled = !!total || !G.last[me] || seat.stack < C.sum(G.last[me]); re.onclick = () => send('rebet');
      const ok = el('button', 'btn primary'); ok.append('베팅 완료', el('small', null, fmt(total))); ok.disabled = !total; ok.onclick = () => send('ready');
      row.append(clr, re, ok);
      dock.append(chips, row);
    },
  };
  root.HOGames.roulette = game;
})(typeof window !== 'undefined' ? window : globalThis);

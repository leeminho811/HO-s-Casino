/* 섯다: two hwatu cards each, one betting round, best 족보 wins. */
(function (root) {
  'use strict';
  const ANTE = 10;
  const MONTH = ['', '송학', '매조', '벚꽃', '흑싸리', '난초', '모란', '홍싸리', '공산', '국진', '단풍'];
  const ICON = ['', '🌲', '🐦', '🌸', '🌿', '🪻', '🌺', '🐗', '🌕', '🍶', '🍁'];
  const mo = c => parseInt(c, 10);
  const isA = c => c.endsWith('A');
  const gwang = c => isA(c) && [1, 3, 8].includes(mo(c));
  const freshDeck = () => { const d = []; for (let m = 1; m <= 10; m++) d.push(m + 'A', m + 'B'); return d; };

  // base score of two cards + special flags
  function score(c1, c2) {
    const a = Math.min(mo(c1), mo(c2)), b = Math.max(mo(c1), mo(c2));
    const pair = (x, y) => a === x && b === y;
    if (gwang(c1) && gwang(c2)) return pair(3, 8) ? { s: 1000, name: '38광땡' } : { s: 900, name: a + '' + b + '광땡' };
    if (a === b) return { s: 800 + a, name: a === 10 ? '장땡' : a + '땡' };
    if (pair(1, 2)) return { s: 700, name: '알리' };
    if (pair(1, 4)) return { s: 690, name: '독사' };
    if (pair(1, 9)) return { s: 680, name: '구삥' };
    if (pair(1, 10)) return { s: 670, name: '장삥' };
    if (pair(4, 10)) return { s: 660, name: '장사' };
    if (pair(4, 6)) return { s: 650, name: '세륙' };
    const k = (a + b) % 10;
    const o = { s: 600 + k, name: k === 9 ? '갑오' : k === 0 ? '망통' : k + '끗' };
    if (pair(3, 7) && isA(c1) && isA(c2)) { o.catcher = true; o.name = '땡잡이'; }
    if (pair(4, 7) && isA(c1) && isA(c2)) { o.inspector = true; o.name = '암행어사'; }
    return o;
  }
  // scores as they count against a given set of opponents (specials only work against certain hands)
  function effective(list) {
    const top = Math.max(...list.map(x => x.s));
    return list.map(x => (x.catcher && top >= 801 && top <= 809 ? 809.5 : x.inspector && top === 900 ? 950 : x.s));
  }
  // ps: {seat: {in, folded}}, scores: {seat: score}; returns {seat: amount won}
  function splitPots(ps, scores) {
    const all = Object.keys(ps).map(Number), live = all.filter(i => !ps[i].folded);
    const levels = [...new Set(live.map(i => ps[i].in))].sort((x, y) => x - y);
    const won = {}; let prev = 0;
    for (const L of levels) {
      const amt = all.reduce((s, i) => s + Math.min(ps[i].in, L) - Math.min(ps[i].in, prev), 0);
      const elig = live.filter(i => ps[i].in >= L);
      const eff = effective(elig.map(i => scores[i])), best = Math.max(...eff);
      const winners = elig.filter((i, k) => eff[k] === best);
      const share = Math.floor(amt / winners.length);
      winners.forEach((i, k) => { won[i] = (won[i] || 0) + share + (k === 0 ? amt - share * winners.length : 0); });
      prev = L;
    }
    return won;
  }

  const eligible = S => S.seats.map((s, i) => (s && s.stack > 0 ? i : -1)).filter(i => i >= 0);
  const order = G => Object.keys(G.ps).map(Number).sort((x, y) => x - y);
  function nextToAct(G, from) {
    const o = order(G), n = o.length, at = o.indexOf(from);
    for (let k = 1; k <= n; k++) {
      const i = o[(at + k + n) % n], p = G.ps[i];
      if (!p.folded && !p.allin && (!p.acted || p.in < G.curBet)) return i;
    }
    return -1;
  }
  function voidHand(a, why) {
    const { S, G, now } = a;
    for (const i of order(G)) if (S.seats[i]) S.seats[i].stack += G.ps[i].in;
    a.log(`섯다 #${G.no} 무효 — ${why} (판돈 반환)`);
    G.ps = {}; G.enc = {}; G.shown = {}; G.res = null; G.cur = -1; G.phase = 'idle'; G.nextAt = now + 3000;
  }
  function finish(a) {
    const { S, G, ctx, now } = a;
    const live = order(G).filter(i => !G.ps[i].folded);
    const show = live.length > 1;
    const scores = {}, names = {};
    live.forEach(i => { const h = (ctx.hands || {})[i]; scores[i] = h ? score(h[0], h[1]) : { s: 0, name: '' }; });
    const won = splitPots(G.ps, scores);
    G.shown = {};
    if (show) live.forEach(i => { G.shown[i] = ctx.hands[i]; names[i] = scores[i].name; });
    const winners = Object.keys(won).map(Number).filter(i => won[i] > G.ps[i].in || live.length === 1)
      .map(i => ({ seat: i, net: won[i] - G.ps[i].in }));
    Object.keys(won).forEach(i => { if (S.seats[i]) S.seats[i].stack += won[i]; });
    G.res = { winners, names, show, pot: order(G).reduce((s, i) => s + G.ps[i].in, 0) };
    a.log(`섯다 #${G.no} · ${winners.map(w => `${S.seats[w.seat] ? S.seats[w.seat].name : '?'} +${w.net}${names[w.seat] ? ' (' + names[w.seat] + ')' : ''}`).join(', ')}`);
    G.phase = 'show'; G.cur = -1; G.nextAt = now + (show ? 8000 : 4000);
    ctx.hands = {}; ctx.hid = null;
  }
  function afterAct(a, i) {
    const { G, now } = a;
    const live = order(G).filter(k => !G.ps[k].folded);
    if (live.length <= 1) return finish(a);
    const nxt = nextToAct(G, i);
    if (nxt < 0) return finish(a);
    G.cur = nxt; G.deadline = now + 30000;
  }
  function act(a, i, type) {
    const { S, G } = a, p = G.ps[i], st = S.seats[i];
    const need = Math.max(0, G.curBet - p.in);
    const pay = x => { const y = Math.min(st.stack, Math.max(0, x)); st.stack -= y; p.in += y; if (st.stack === 0) p.allin = true; return y; };
    if (type === 'die') { p.folded = true; a.log(`${st.name}: 다이`); }
    else if (type === 'half' && p.raises < 2 && st.stack > need) {
      const pot = order(G).reduce((s, k) => s + G.ps[k].in, 0);
      const target = G.curBet + Math.max(ANTE, Math.ceil((pot + need) / 2 / 10) * 10);
      pay(target - p.in);
      if (p.in > G.curBet) { G.curBet = p.in; p.raises++; order(G).forEach(k => { if (k !== i) G.ps[k].acted = false; }); }
      a.log(`${st.name}: ${p.allin ? '올인' : '하프'} ${p.in}`);
    } else { pay(need); a.log(`${st.name}: ${need ? (p.allin ? '올인 콜' : '콜') : '체크'}`); }
    p.acted = true;
    afterAct(a, i);
  }
  async function startHand(a) {
    const { S, G, ctx, now, rint } = a;
    const el = eligible(S);
    if (el.length < 2) { G.phase = 'idle'; return; }
    G.no++; G.hid = G.no + '-' + Math.random().toString(36).slice(2, 8);
    G.button = el.find(i => i > G.button) ?? el[0];
    const deck = freshDeck();
    for (let k = deck.length - 1; k > 0; k--) { const j = rint(k + 1); [deck[k], deck[j]] = [deck[j], deck[k]]; }
    G.ps = {}; G.enc = {}; G.shown = {}; G.res = null;
    ctx.hid = G.hid; ctx.hands = {};
    for (const i of el) {
      const st = S.seats[i], pay = Math.min(st.stack, ANTE);
      st.stack -= pay;
      G.ps[i] = { in: pay, folded: false, allin: st.stack === 0, acted: false, raises: 0 };
      ctx.hands[i] = [deck.pop(), deck.pop()];
      G.enc[i] = await a.seal(i, { hid: G.hid, c: ctx.hands[i] });
    }
    G.curBet = ANTE; G.phase = 'bet';
    a.log(`— 섯다 #${G.no} · 선 ${S.seats[G.button].name}`);
    const first = nextToAct(G, G.button);
    if (first < 0) return finish(a);
    G.cur = first; G.deadline = now + 30000;
  }

  function hwatu(el, c, cls) {
    if (!c) return el('div', 'hw back ' + (cls || ''));
    const m = mo(c);
    const d = el('div', 'hw m' + m + ' ' + (cls || ''));
    d.append(el('span', 'hw-n', String(m)), el('span', 'hw-i', ICON[m]), el('span', 'hw-t', MONTH[m]));
    if (gwang(c)) d.append(el('span', 'hw-g', '光'));
    else if (isA(c)) d.append(el('span', 'hw-y', '열'));
    return d;
  }

  const game = {
    id: 'seotda', name: '섯다', seats: 5,
    logic: { score, effective, splitPots, freshDeck },
    rules: [
      '화투 1~10월 20장으로 하는 한국식 포커예요. 2장씩 받고, 한 번 베팅한 뒤 족보가 높은 사람이 판돈을 가져가요.',
      '족보(높은 순): 38광땡 › 광땡(13·18) › 장땡(10·10) › 9땡 … 1땡 › 알리(1·2) › 독사(1·4) › 구삥(1·9) › 장삥(1·10) › 장사(4·10) › 세륙(4·6) › 갑오(9끗) › 8끗 … 1끗 › 망통(0끗).',
      '끗은 두 장의 월을 더한 끝자리예요 (7월+8월=15 → 5끗).',
      '특수패: 땡잡이(3월·7월)는 1~9땡을 잡고, 암행어사(4월·7월)는 13·18광땡을 잡아요. 상대가 그 패가 아니면 그냥 끗으로 쳐요.',
      '다이: 포기 · 콜: 따라가기 · 하프: 판돈의 절반만큼 올리기 (한 판에 두 번까지). 매 판 기본 10칩을 내고 시작해요.',
    ],
    init: () => ({ phase: 'idle', started: false, no: 0, hid: null, button: -1, ps: {}, cur: -1, curBet: 0, deadline: 0, nextAt: 0, enc: {}, shown: {}, res: null }),
    busy: (G, i) => G.phase === 'bet' && !!G.ps[i] && !G.ps[i].folded,
    async onHost(a) {
      const { G, ctx } = a;
      if (G.phase !== 'bet') return;
      if (ctx.hid !== G.hid || !ctx.hands) return voidHand(a, '진행 기기가 바뀌었어요');
      for (const i of order(G)) if (ctx.hands[i]) G.enc[i] = await a.seal(i, { hid: G.hid, c: ctx.hands[i] });
    },
    async onKey(a, i) { const { G, ctx } = a; if (G.phase === 'bet' && ctx.hid === G.hid && ctx.hands[i]) G.enc[i] = await a.seal(i, { hid: G.hid, c: ctx.hands[i] }); },
    onReq(a, i, r) {
      const { S, G } = a;
      if (r.type === 'start') { if (!G.started && eligible(S).length >= 2) { G.started = true; G.nextAt = a.now; a.log('섯다 시작'); } return; }
      if (G.phase !== 'bet' || G.cur !== i || r.hid !== G.hid) return;
      if (['die', 'call', 'half'].includes(r.type)) act(a, i, r.type);
    },
    onLeave(a, i) {
      const { G } = a, p = G.ps[i];
      if (G.phase !== 'bet' || !p || p.folded) return;
      p.folded = true; p.acted = true;
      if (G.cur === i || order(G).filter(k => !G.ps[k].folded).length <= 1) afterAct(a, i);
    },
    async tick(a) {
      const { S, G, ctx, now } = a;
      if (G.phase === 'bet') {
        if (ctx.hid !== G.hid) return voidHand(a, '카드 정보 없음');
        if (G.cur < 0 || !G.ps[G.cur] || !S.seats[G.cur]) return afterAct(a, G.cur);
        if (now > G.deadline) act(a, G.cur, G.ps[G.cur].in >= G.curBet ? 'call' : 'die');
      } else if (G.started && now >= (G.nextAt || 0)) {
        if (eligible(S).length >= 2) await startHand(a);
        else if (G.phase === 'show') { G.phase = 'idle'; }
      }
    },

    /* ---------- UI ---------- */
    render(v) {
      const { G, S, el, fmt, stage, me } = v;
      stage.className = 'gstage sd';
      const felt = el('div', 'gfelt');
      const live = G.phase === 'bet';
      const pot = Object.values(G.ps).reduce((s, p) => s + p.in, 0);
      const winSeats = new Set(G.res ? G.res.winners.map(w => w.seat) : []);
      const spots = el('div', 'spots');
      S.seats.forEach((st, i) => {
        const sp = v.spot(i);
        const p = G.ps[i];
        if (st && p) {
          const box = sp.querySelector('.spot-cards');
          const mine = i === me && v.secret && v.secret.hid === G.hid ? v.secret.c : null;
          const cs = G.shown[i] || mine || (p.folded ? null : [null, null]);
          if (cs) { const row = el('div', 'hwrow'); cs.forEach(c => row.append(hwatu(el, c, p.folded ? 'dim' : ''))); box.append(row); }
          const tag = el('div', 'gtag');
          if (G.phase === 'show' && winSeats.has(i)) { const w = G.res.winners.find(x => x.seat === i); tag.textContent = '+' + fmt(w.net); tag.classList.add('good'); sp.classList.add('win'); }
          else if (p.folded) { tag.textContent = '다이'; tag.classList.add('bad'); }
          else if (p.allin) { tag.textContent = '올인'; tag.classList.add('good'); }
          else if (live && p.acted) tag.textContent = p.in > ANTE ? '콜' : '체크';
          if (tag.textContent) sp.append(tag);
          if (G.res && G.res.names[i]) sp.append(el('div', 'gtag even', G.res.names[i]));
          sp.append(v.chip(p.in));
          if (live && G.cur === i) sp.classList.add('turn');
        }
        if (st && G.button === i && (live || G.phase === 'show')) sp.append(el('span', 'sunbtn', '선'));
        spots.append(sp);
      });
      const mid = el('div', 'sd-mid');
      if (pot) { mid.append(el('small', null, '판돈'), el('b', 'num', fmt(G.res ? G.res.pot : pot))); }
      const msg = el('div', 'gmsg');
      if (live) { const s = S.seats[G.cur]; msg.append(el('b', null, G.cur === me ? '내' : (s ? s.name + ' 님' : '')), ' 차례 · ', v.countdown(G.deadline)); }
      else if (G.phase === 'show' && G.res) {
        const w = G.res.winners.map(x => (S.seats[x.seat] ? S.seats[x.seat].name : '?')).join(', ');
        msg.append(el('b', null, w), ' 승리' + (G.res.show && G.res.winners[0] && G.res.names[G.res.winners[0].seat] ? ' · ' + G.res.names[G.res.winners[0].seat] : ''));
      } else if (!G.started) msg.textContent = eligible(S).length >= 2 ? '누구든 “게임 시작”을 누르면 패를 돌려요' : '2명 이상 앉으면 시작할 수 있어요';
      else msg.textContent = eligible(S).length >= 2 ? '곧 다음 판을 돌려요' : '상대를 기다리는 중이에요';
      felt.append(mid, msg, spots);
      stage.append(felt);
    },
    dock(v) {
      const { G, S, me, seat, el, fmt, dock, send } = v;
      const p = G.ps[me];
      const mine = v.secret && v.secret.hid === G.hid ? v.secret.c : (G.shown[me] || null);
      if (p && (G.phase === 'bet' || G.phase === 'show')) {
        const row = el('div', 'sd-mine');
        const cs = el('div', 'hwrow big'); (mine || [null, null]).forEach(c => cs.append(hwatu(el, c, p.folded ? 'dim' : '')));
        const info = el('div', 'myinfo');
        info.append(el('div', 'l1', mine ? score(mine[0], mine[1]).name : '패를 여는 중…'), el('div', 'l2', `낸 칩 ${fmt(p.in)}`));
        row.append(cs, info); dock.append(row);
      }
      if (G.phase === 'bet' && G.cur === me) {
        const need = Math.max(0, G.curBet - p.in), row = el('div', 'actions');
        const die = el('button', 'btn fold', '다이'); die.onclick = () => send('die', { hid: G.hid });
        const call = el('button', 'btn call'); call.onclick = () => send('call', { hid: G.hid });
        if (!need) call.textContent = '체크'; else call.append(need >= seat.stack ? '올인 콜' : '콜', el('small', null, fmt(Math.min(need, seat.stack))));
        const half = el('button', 'btn raise', '하프'); half.disabled = p.raises >= 2 || seat.stack <= need; half.onclick = () => send('half', { hid: G.hid });
        row.append(die, call, half); dock.append(row);
      } else if (!G.started) {
        const row = el('div', 'actions two');
        const b = el('button', 'btn primary', '게임 시작'); const n = eligible(S).length;
        b.disabled = n < 2; if (n < 2) b.append(el('small', null, '2명 이상 필요')); b.onclick = () => send('start');
        row.append(b, v.inviteButton()); dock.append(row);
      } else dock.append(v.wait(G.phase === 'bet' ? '다른 플레이어 차례예요' : '다음 판을 기다리는 중'));
    },
  };
  root.HOGames.seotda = game;
})(typeof window !== 'undefined' ? window : globalThis);

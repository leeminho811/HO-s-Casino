/* Room kit: everything the table games (blackjack, roulette, baccarat, seotda) share.
 * Same sync model as the hold'em app (see CLAUDE.md): one device is the dealer/host and is the only
 * writer of the room state; everyone else writes requests to req/<uid>; a higher epoch takes over.
 * A game module (src/games/*.js) supplies init / onReq / tick / render / dock. */
(function () {
  'use strict';
  const START = 1000;
  const AV = ['#dcb05a', '#7fc4a4', '#e48f7a', '#9fb5e6', '#d7a6d9', '#c9d07a', '#f0c9a0', '#8fd3d3'];
  const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const $ = s => document.querySelector(s);
  function el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  const fmt = n => Math.round(n || 0).toLocaleString('ko-KR');
  const clone = o => JSON.parse(JSON.stringify(o));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const LS = {
    get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* no storage */ } },
  };
  function sess(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; } return v; }
  const rid = () => Math.random().toString(36).slice(2, 10);
  const TAB = sess('pk_tab') || sess('pk_tab', 't' + rid());
  const cleanName = s => String(s || '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').trim().slice(0, 12);

  /* ---- crypto: private cards are sealed to each player's key ---- */
  const cryptoOK = !!(window.crypto && crypto.subtle && crypto.getRandomValues && window.isSecureContext !== false);
  const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
  const b64 = u8 => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const slimPub = j => (j && typeof j.x === 'string' && typeof j.y === 'string' && j.x.length < 80 && j.y.length < 80 ? { kty: 'EC', crv: 'P-256', x: j.x, y: j.y } : null);
  async function genKP() {
    const kp = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']);
    return { pub: slimPub(await crypto.subtle.exportKey('jwk', kp.publicKey)), privJwk: await crypto.subtle.exportKey('jwk', kp.privateKey), priv: kp.privateKey };
  }
  const impPub = j => crypto.subtle.importKey('jwk', slimPub(j), ECDH, false, []);
  const impPriv = j => crypto.subtle.importKey('jwk', j, ECDH, false, ['deriveKey']);
  const derive = (priv, pub) => crypto.subtle.deriveKey({ name: 'ECDH', public: pub }, priv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  async function seal(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))));
    return { iv: b64(iv), ct: b64(ct) };
  }
  async function unseal(key, box) {
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct))));
  }
  function rint(n) {
    if (!cryptoOK) return Math.floor(Math.random() * n);
    const a = new Uint32Array(1), lim = Math.floor(4294967296 / n) * n;
    let x; do { crypto.getRandomValues(a); x = a[0]; } while (x >= lim);
    return x % n;
  }
  async function loadKeys() {
    if (!cryptoOK) return null;
    try { const s = LS.get('pk_keys'); if (s && s.pub && s.priv) return { pub: slimPub(s.pub), priv: await impPriv(s.priv) }; } catch (e) { /* regenerate */ }
    try { const k = await genKP(); LS.set('pk_keys', { pub: k.pub, priv: k.privJwk }); return { pub: k.pub, priv: k.priv }; } catch (e) { return null; }
  }

  /* ---- state ---- */
  let game = null, ROOM = '', TABLE = '', REQ = '';
  let db = null, room = null, ME = null, keys = null;
  let S = null, loaded = false, connErr = '', lastSeq = null, clockOff = 0, preview = null;
  let amHost = false, H = null, ctx = {}, ephPriv = null, hostQ = Promise.resolve(), hostSince = 0;
  let reqDocs = {}, reqUnsub = null, hostTimer = null, writing = false, dirty = false, writeFails = 0;
  let myReqN = 0, pending = [], inflight = false, pendingSince = 0, creatingJoin = null, keySynced = false;
  let secret = null, modalKind = null, toastT = 0;
  const online = { uids: new Set(), tabs: new Set(), peers: [] };
  const lastSeen = {};
  let peersReadyAt = 0, hostGoneSince = 0, seen = {};

  const V = () => (amHost ? H : S);
  const hostNow = () => Date.now() + clockOff;
  const seatOf = (st, uid) => (st && uid ? st.seats.findIndex(s => s && s.uid === uid) : -1);
  const mySeat = () => seatOf(V(), ME);
  const addLog = (st, t) => { st.log.push(t); if (st.log.length > 40) st.log.splice(0, st.log.length - 40); };
  const denied = e => !!e && (e.code === 'invalid_argument' || e.code === 'permission_denied');
  const newState = () => ({ v: 1, g: game.id, epoch: 1, hostId: ME, hostTab: TAB, seq: 0, now: 0, seats: new Array(game.seats).fill(null), proc: {}, log: [], epk: null, game: game.init() });

  /* ---- boot ---- */
  async function start(code, g) {
    game = g; ROOM = code; TABLE = 'tables/' + ROOM; REQ = TABLE + '/req';
    $('#gTitle').textContent = game.name;
    $('#gCode').textContent = ROOM;
    wire();
    preview = newState();
    render();
    const B = window.HOBackend;
    if (!B || !B.configured()) { connErr = '아직 서버(Firebase)가 연결되지 않았어요. README 안내대로 firebase-config.js를 채워 주세요.'; render(); return; }
    let c;
    try { c = await B.connect(ROOM); } catch (e) {
      connErr = e && e.code === 'auth_disabled' ? 'Firebase 익명 로그인이 꺼져 있어요. 콘솔 → Authentication → 로그인 방법에서 “익명”을 켜 주세요.' : '서버에 연결할 수 없어요. 인터넷 연결을 확인하고 새로고침해 주세요.';
      render(); return;
    }
    const user = await c.use('user');
    db = await c.use('db'); room = await c.use('room');
    ME = await user.id();
    preview = newState();
    keys = await loadKeys();
    db.doc(TABLE).onSnapshot(snap => { loaded = true; connErr = ''; onTable(snap.exists ? snap.data() : null); }, e => {
      connErr = denied(e) ? '데이터베이스 보안 규칙이 막고 있어요. README의 규칙(database.rules.json)을 게시해 주세요.' : '테이블 연결이 끊겼어요. 페이지를 다시 열어 주세요.';
      render();
    });
    room.onPeers(ch => {
      online.uids = new Set(); online.tabs = new Set(); online.peers = [];
      for (const p of ch.peers) {
        const pr = p.presence || {};
        if (typeof pr.uid === 'string') online.uids.add(pr.uid);
        if (typeof pr.tab === 'string') online.tabs.add(pr.tab);
        online.peers.push({ uid: pr.uid, tab: pr.tab });
      }
      if (!peersReadyAt) peersReadyAt = Date.now() + 3000;
      render();
    }, () => {});
    room.presence({ uid: ME, tab: TAB }).catch(() => {});
    setInterval(clientTick, 1000);
    setInterval(uiTick, 250);
    render();
  }

  function onTable(d) {
    if (d && d.g !== game.id) { connErr = '이 방 코드는 다른 게임에서 쓰고 있어요. 로비에서 새 방을 만들어 주세요.'; S = null; render(); return; }
    if (d && lastSeq !== null && d.seq !== lastSeq && d.now && !amHost) { const off = d.now - Date.now(); if (Math.abs(off) < 5 * 60 * 1000) clockOff = off; }
    if (d) lastSeq = d.seq;
    S = d;
    if (d) {
      const mine = d.hostId === ME && d.hostTab === TAB;
      if (amHost) { if (!mine) { if ((d.epoch || 0) >= H.epoch) stepDown('다른 기기가 진행을 이어받았어요'); else markDirty(); } }
      else if (mine) becomeHost(clone(d));
    } else if (amHost) markDirty();
    if (!waitingAck() && !pending.length) pendingSince = 0;
    pump(); syncKey(); openMine(); render();
  }

  /* ---- host ---- */
  function api() {
    return { S: H, get G() { return H.game; }, ctx, now: Date.now(), rint, START, log: t => addLog(H, t), seal: sealFor, online: uid => online.uids.has(uid) };
  }
  async function sealFor(i, obj) {
    const st = H.seats[i];
    if (ephPriv && st && st.pub) { try { return await seal(await derive(ephPriv, await impPub(st.pub)), obj); } catch (e) { /* fall through */ } }
    return { p: obj };
  }
  function becomeHost(st) {
    amHost = true; H = st; hostSince = Date.now(); clockOff = 0;
    const saved = LS.get('hk_ctx');
    ctx = saved && saved.room === ROOM && saved.c ? saved.c : {};
    reqDocs = {};
    if (reqUnsub) reqUnsub();
    reqUnsub = db.collection(REQ).onSnapshot(qs => { qs.docs.forEach(d => { reqDocs[d.id] = d.data(); }); hostDo(processReqs); }, () => toast('요청 수신이 끊겼어요. 새로고침해 주세요.'));
    clearInterval(hostTimer);
    hostTimer = setInterval(() => hostDo(tick), 300);
    const queued = pending; pending = [];
    hostDo(async () => {
      ephPriv = null; H.epk = null;
      if (cryptoOK) { try { const kp = await genKP(); ephPriv = kp.priv; H.epk = kp.pub; } catch (e) { /* plain fallback */ } }
      if (game.onHost) await game.onHost(api());
      for (const r of queued) await applyReq(ME, r);
    });
  }
  function stepDown(msg) {
    amHost = false; H = null; ctx = {}; ephPriv = null;
    if (reqUnsub) { reqUnsub(); reqUnsub = null; }
    clearInterval(hostTimer); hostTimer = null;
    if (msg) toast(msg);
    if (creatingJoin && S && seatOf(S, ME) < 0) { const j = creatingJoin; creatingJoin = null; send('join', j); }
    render();
  }
  function hostDo(fn) {
    hostQ = hostQ.then(async () => {
      if (!amHost) return;
      const before = JSON.stringify(H);
      await fn();
      if (amHost && JSON.stringify(H) !== before) commit();
    }).catch(e => console.error(e));
    return hostQ;
  }
  function commit() {
    H.seq = (H.seq || 0) + 1; H.now = Date.now();
    LS.set('hk_ctx', { room: ROOM, c: ctx });
    markDirty(); openMine(); render();
  }
  function markDirty() { dirty = true; flush(); }
  async function flush() {
    if (writing || !dirty || !amHost) return;
    writing = true; dirty = false;
    try { await db.doc(TABLE).set(clone(H)); writeFails = 0; }
    catch (e) {
      dirty = true; writeFails++;
      if (denied(e) && writeFails > 2) stepDown('서버에 쓸 권한이 없어요. 데이터베이스 보안 규칙을 확인해 주세요.');
      await sleep(600 * Math.min(writeFails, 6));
    }
    writing = false;
    if (dirty && amHost) flush();
  }
  async function processReqs() {
    for (const uid of Object.keys(reqDocs)) {
      const r = reqDocs[uid];
      if (!r || typeof r.n !== 'number' || r.n <= (H.proc[uid] || 0)) continue;
      H.proc[uid] = r.n;
      if (typeof r.t === 'number' && Date.now() - r.t > 10 * 60 * 1000) continue;
      try { await applyReq(uid, r); } catch (e) { console.error(e); }
    }
  }
  async function applyReq(uid, r) {
    const a = api(), i = seatOf(H, uid), st = i >= 0 ? H.seats[i] : null, name = cleanName(r.name);
    switch (r.type) {
      case 'join': {
        if (st) { if (name) st.name = name; if (r.pub) st.pub = slimPub(r.pub); break; }
        const s = Number.isInteger(r.seat) && r.seat >= 0 && r.seat < H.seats.length && !H.seats[r.seat] ? r.seat : H.seats.findIndex(x => !x);
        if (s < 0) break;
        H.seats[s] = { uid, name: name || '플레이어', stack: START, buyin: START, pub: slimPub(r.pub) };
        addLog(H, `${H.seats[s].name} 님이 앉았어요`);
        break;
      }
      case 'leave': if (st) await removeSeat(a, i); break;
      case 'addBot': if (st) addBot(); break;
      case 'kickBots': if (st) for (let k = 0; k < H.seats.length; k++) if (H.seats[k] && H.seats[k].bot) await removeSeat(a, k); break;
      case 'rebuy': if (st && st.stack === 0 && !(game.busy && game.busy(H.game, i))) { st.stack += START; st.buyin += START; addLog(H, `${st.name}: 리바이 +${fmt(START)}`); } break;
      case 'name': if (st && name) st.name = name; break;
      case 'key': if (st) { st.pub = slimPub(r.pub); if (game.onKey) await game.onKey(a, i); } break;
      default: if (st) await game.onReq(a, i, r);
    }
  }
  function addBot() {
    const s = H.seats.findIndex(x => !x);
    if (s < 0) return;
    const used = new Set(H.seats.filter(Boolean).map(x => x.name));
    let k = 1; while (used.has(`봇 ${k}호`)) k++;
    H.seats[s] = { uid: 'bot_' + Math.random().toString(36).slice(2, 10), name: `봇 ${k}호`, stack: START, buyin: START, pub: null, bot: true };
    addLog(H, `봇 ${k}호가 앉았어요`);
  }
  async function removeSeat(a, i) {
    const st = H.seats[i];
    if (game.onLeave) await game.onLeave(a, i);
    addLog(H, `${st.name} 님이 자리를 떠났어요`);
    H.seats[i] = null;
  }
  async function tick() {
    const a = api();
    // free seats of people who have been gone for 3 minutes
    if (peersReadyAt && a.now > peersReadyAt) {
      for (let i = 0; i < H.seats.length; i++) {
        const st = H.seats[i]; if (!st || st.bot) continue;
        if (online.uids.has(st.uid)) { lastSeen[st.uid] = a.now; continue; }
        if (a.now - (lastSeen[st.uid] || hostSince) > 180000 && !(game.busy && game.busy(H.game, i))) await removeSeat(a, i);
      }
    }
    await game.tick(a);
    if (game.bot) await driveBots(api());
  }
  const botAt = {};
  async function driveBots(a) {
    for (let i = 0; i < H.seats.length; i++) {
      const st = H.seats[i];
      if (!st || !st.bot) { delete botAt[i]; continue; }
      if (st.stack === 0 && !(game.busy && game.busy(H.game, i)) && !(H.game.bets && H.game.bets[i])) {
        st.stack += START; st.buyin += START; addLog(H, `${st.name}: 리바이 +${fmt(START)}`);
      }
      const want = game.bot(a, i);
      if (!want) { delete botAt[i]; continue; }
      if (!botAt[i]) { botAt[i] = a.now + 700 + rint(1500); continue; }
      if (a.now < botAt[i]) continue;
      delete botAt[i];
      await game.onReq(a, i, game.bot(a, i) || want);
    }
  }
  function takeOver() {
    if (amHost || !S) return;
    const st = clone(S);
    st.epoch = (st.epoch || 1) + 1; st.hostId = ME; st.hostTab = TAB;
    hostGoneSince = 0;
    becomeHost(st);
    commit();
  }

  /* ---- client → host requests ---- */
  function waitingAck() { return !amHost && !!S && myReqN > ((S.proc && S.proc[ME]) || 0); }
  function send(type, data) {
    const r = Object.assign({ type }, data || {});
    if (amHost) { hostDo(() => applyReq(ME, r)); return; }
    pending.push(r);
    if (!pendingSince) pendingSince = Date.now();
    pump();
  }
  async function pump() {
    if (inflight || !pending.length || !S || amHost) return;
    const proc = (S.proc && S.proc[ME]) || 0;
    if (myReqN > proc) return;
    const r = pending.shift(), n = Math.max(myReqN, proc) + 1;
    inflight = true;
    try { await db.doc(REQ + '/' + ME).set(Object.assign({}, r, { n, t: Date.now() })); myReqN = n; if (!pendingSince) pendingSince = Date.now(); }
    catch (e) { if (denied(e)) { pending = []; toast('서버에 쓸 수 없어요. 데이터베이스 보안 규칙을 확인해 주세요.'); } else { pending.unshift(r); setTimeout(pump, 1500); } }
    inflight = false;
  }
  function syncKey() {
    if (keySynced || !keys || !V()) return;
    const i = mySeat(); if (i < 0) return;
    keySynced = true;
    const pub = V().seats[i].pub;
    if (!pub || pub.x !== keys.pub.x) send('key', { pub: keys.pub });
  }
  async function openMine() {
    const v = V(), i = mySeat();
    const box = v && i >= 0 && v.game.enc ? v.game.enc[i] : null;
    if (!box) { secret = null; return; }
    const sig = box.iv || 'p' + JSON.stringify(box.p);
    if (secret && secret.sig === sig) return;
    const mine = secret = { sig, data: null };
    if (box.p) { mine.data = box.p; return; }
    try {
      if (!keys || !v.epk) throw new Error('no key');
      const d = await unseal(await derive(keys.priv, await impPub(v.epk)), box);
      if (secret === mine) { mine.data = d; render(); }
    } catch (e) { if (keys) send('key', { pub: keys.pub }); }
  }

  /* ---- takeover when the host device disappears ---- */
  function clientTick() {
    if (!S || amHost) { hostGoneSince = 0; renderBanner(); return; }
    if (peersReadyAt && Date.now() > peersReadyAt && room.connected()) {
      if (online.tabs.has(S.hostTab)) hostGoneSince = 0; else if (!hostGoneSince) hostGoneSince = Date.now();
      if (hostGoneSince && Date.now() - hostGoneSince > 4000 && successor() === TAB) takeOver();
    }
    renderBanner();
  }
  function successor() {
    const c = online.peers.filter(p => p.tab && p.uid).map(p => { const i = seatOf(S, p.uid); return { tab: p.tab, rank: i >= 0 ? i : 99 }; });
    c.sort((a, b) => a.rank - b.rank || (a.tab < b.tab ? -1 : 1));
    return c.length ? c[0].tab : null;
  }

  /* ---- rendering ---- */
  function uiTick() {
    document.querySelectorAll('#gapp .cd').forEach(e => { e.textContent = Math.max(0, Math.ceil((Number(e.dataset.until) - hostNow()) / 1000)) + '초'; });
  }
  function cardEl(c, extra) {
    if (c === undefined) return el('div', 'slot');
    if (!c) return el('div', 'card back' + (extra ? ' ' + extra : ''));
    const red = c[1] === 'h' || c[1] === 'd', r = c[0] === 'T' ? '10' : c[0];
    const d = el('div', 'card' + (red ? ' red' : '') + (extra ? ' ' + extra : ''));
    d.append(el('span', 'r', r), el('span', 's2', SUIT[c[1]]), el('span', 's', SUIT[c[1]]));
    return d;
  }
  function colorFor(uid) { let x = 0; for (const ch of String(uid)) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return AV[x % AV.length]; }
  function makeView(v) {
    const me = seatOf(v, ME);
    const view = {
      S: v, G: v.game, me, seat: me >= 0 ? v.seats[me] : null, amHost, secret: secret && secret.data,
      stage: $('#gStage'), dock: $('#gDock'), el, fmt, send, toast, rerender: render, cardEl,
      cards(key, arr) {
        const row = el('div', 'cardrow'), was = seen[key] || 0;
        arr.forEach((c, k) => { const fresh = c !== undefined && k >= was; const ce = cardEl(c, fresh ? 'deal' : ''); if (fresh) ce.style.setProperty('--d', ((k - was) * 0.12) + 's'); row.append(ce); });
        if (Object.keys(seen).length > 300) seen = {};
        seen[key] = arr.filter(c => c !== undefined).length;
        return row;
      },
      countdown(until) { const s = el('span', 'cd num'); s.dataset.until = until; s.textContent = Math.max(0, Math.ceil((until - hostNow()) / 1000)) + '초'; return s; },
      chip(amt) { const b = el('div', 'gchip'); b.append(el('i'), el('span', 'num', fmt(amt))); return b; },
      wait(t) { return el('div', 'waitline', t); },
      sitButton() { const b = el('button', 'btn primary sitbtn', '자리에 앉기'); b.disabled = !loaded || !!connErr || v.seats.every(Boolean); b.onclick = () => openJoin(-1); return b; },
      inviteButton() { const b = el('button', 'btn', '친구 초대'); b.onclick = () => openModal('invite'); return b; },
      botButton() { const b = el('button', 'btn', '봇 추가'); b.disabled = me < 0 || v.seats.every(Boolean); b.onclick = () => { send('addBot'); toast('봇을 앉혔어요'); }; return b; },
      spot(i) {
        const st = v.seats[i], sp = el('div', 'spot' + (i === me ? ' me' : '') + (st ? '' : ' empty'));
        sp.append(el('div', 'spot-cards'));
        if (!st) {
          if (me < 0 && loaded && !connErr) { const b = el('button', 'gplate sit', '+ 앉기'); b.onclick = () => openJoin(i); sp.append(b); }
          else sp.append(el('div', 'gplate', '빈 자리'));
          return sp;
        }
        const plate = el('div', 'gplate' + (st.bot ? ' bot' : '')), av = el('i', 'gav', st.bot ? '봇' : (st.name || '?').slice(0, 1));
        av.style.background = st.bot ? '#b9c2bd' : colorFor(st.uid);
        if (!st.bot && online.uids.has(st.uid)) av.classList.add('on');
        const t = el('div', 'gptxt'); t.append(el('span', 'gname', st.name), el('span', 'gstack num', fmt(st.stack)));
        plate.append(av, t); sp.append(plate);
        return sp;
      },
    };
    return view;
  }
  function render() {
    if (!game) return;
    const v = V() || preview;
    $('#gOnline').hidden = online.uids.size === 0;
    $('#gOnlineN').textContent = online.uids.size;
    renderBanner();
    const view = makeView(v);
    if (!game.keep) view.stage.textContent = '';
    game.render(view);
    const dock = view.dock; dock.textContent = '';
    if (!loaded && !connErr) { dock.append(view.wait('테이블에 연결하는 중…')); return; }
    if (connErr && !V()) { dock.append(view.wait('연결되지 않았어요')); return; }
    if (view.me < 0) {
      const row = el('div', 'actions two');
      row.append(view.sitButton(), view.inviteButton());
      dock.append(el('div', 'gintro', game.rules[0]), row);
      return;
    }
    const st = view.seat, info = el('div', 'gmine');
    const net = st.stack - st.buyin;
    info.append(el('b', null, st.name), el('span', null, '내 칩 '), el('b', 'num gold', fmt(st.stack)));
    if (net) info.append(el('span', 'num ' + (net > 0 ? 'good' : 'bad'), (net > 0 ? '+' : '−') + fmt(Math.abs(net))));
    if (v.seats.some(x => !x)) {
      const bb = el('button', 'botpill', '+ 봇 추가');
      bb.onclick = () => { send('addBot'); toast('봇을 앉혔어요'); };
      info.append(bb);
    }
    dock.append(info);
    if (st.stack === 0 && !(game.busy && game.busy(v.game, view.me)) && !Object.keys(v.game.bets && v.game.bets[view.me] ? { x: 1 } : {}).length) {
      const row = el('div', 'actions one'), b = el('button', 'btn primary');
      b.append('리바이', el('small', null, '+' + fmt(START))); b.onclick = () => send('rebuy');
      row.append(b); dock.append(row);
      return;
    }
    game.dock(view);
  }
  function renderBanner() {
    const bn = $('#gBanner'), txt = bn.firstElementChild, btn = bn.lastElementChild;
    let msg = '', action = null;
    if (connErr) msg = connErr;
    else if (!amHost && S) {
      const stuck = waitingAck() && pendingSince && Date.now() - pendingSince > 8000;
      const gone = hostGoneSince && Date.now() - hostGoneSince > 2500;
      if (stuck || gone) { msg = '게임을 진행하던 기기가 응답하지 않아요.'; action = takeOver; }
    }
    bn.hidden = !msg; txt.textContent = msg; btn.hidden = !action; btn.textContent = '내가 이어서 진행'; btn.onclick = action;
  }

  /* ---- join / invite / menu ---- */
  function openJoin(seat) { openModal('join', seat); }
  function joinAt(seat) {
    const name = cleanName($('#nameInput') && $('#nameInput').value);
    if (!name) { toast('닉네임을 입력해 주세요'); return; }
    LS.set('pk_name', name);
    closeModal();
    const r = { name, pub: keys ? keys.pub : null }; if (seat >= 0) r.seat = seat;
    if (!S) { creatingJoin = r; becomeHost(newState()); hostDo(() => applyReq(ME, Object.assign({ type: 'join' }, r))); return; }
    send('join', r);
  }
  const inviteUrl = () => location.origin + location.pathname + '#' + ROOM;
  function inviteBlock() {
    const box = el('div', 'invite'), code = el('div', 'code');
    code.append(el('small', null, '방 코드'), el('b', null, ROOM));
    const link = el('input', 'invite-link'); link.readOnly = true; link.value = inviteUrl(); link.setAttribute('aria-label', '초대 링크'); link.onfocus = () => link.select();
    const row = el('div', 'row'), cp = el('button', 'btn primary', '링크 복사');
    cp.onclick = async () => {
      try { await navigator.clipboard.writeText(inviteUrl()); toast('초대 링크를 복사했어요'); return; } catch (e) { /* fallback */ }
      try { link.focus(); link.select(); if (document.execCommand('copy')) { toast('초대 링크를 복사했어요'); return; } } catch (e) { /* fallback */ }
      toast('링크를 길게 눌러 복사해 주세요');
    };
    row.append(cp);
    if (navigator.share) { const sh = el('button', 'btn', '공유하기'); sh.onclick = () => navigator.share({ title: 'HO’s Casino', text: `HO’s Casino ${game.name} 한 판! 방 코드 ${ROOM}`, url: inviteUrl() }).catch(() => {}); row.append(sh); }
    box.append(code, link, row);
    return box;
  }
  function openModal(kind, arg) {
    modalKind = kind;
    const m = $('#modal'); m.textContent = ''; $('#modalBack').hidden = false;
    const close = el('button', 'btn ghost', kind === 'join' ? '취소' : '닫기'); close.onclick = closeModal;
    if (kind === 'join') {
      m.append(el('h2', null, `${game.name} 테이블에 앉기`), el('p', null, `칩 ${fmt(START)}개로 시작해요. 친구들이 알아볼 닉네임을 정해 주세요.`));
      const inp = el('input'); inp.id = 'nameInput'; inp.maxLength = 12; inp.placeholder = '닉네임'; inp.autocomplete = 'nickname'; inp.value = LS.get('pk_name') || '';
      inp.onkeydown = e => { if (e.key === 'Enter') joinAt(arg); };
      const row = el('div', 'row'), ok = el('button', 'btn primary', '앉기'); ok.onclick = () => joinAt(arg);
      row.append(close, ok); m.append(inp, row);
      setTimeout(() => inp.focus(), 50);
    } else if (kind === 'invite') {
      m.append(el('h2', null, '친구 초대하기'), el('p', null, '이 링크를 보내면 친구가 로그인 없이 바로 같은 방에 들어와요.'), inviteBlock(), close);
    } else if (kind === 'confirm') {
      m.append(el('h2', null, arg.title), el('p', null, arg.body));
      const row = el('div', 'row'), ok = el('button', 'btn primary', arg.ok); ok.onclick = () => { closeModal(); arg.fn(); };
      row.append(close, ok); m.append(row);
    }
  }
  function closeModal() { modalKind = null; $('#modalBack').hidden = true; }
  function openSheet() {
    const sh = $('#sheet'); sh.textContent = ''; $('#sheetBack').hidden = false;
    const v = V() || preview, me = seatOf(v, ME), st = me >= 0 ? v.seats[me] : null;
    const section = t => el('h3', null, t);
    sh.append(el('div', 'grab'), el('h2', null, game.name));
    sh.append(section('게임 방법'));
    const ul = el('ul', 'rules'); game.rules.forEach(t => ul.append(el('li', null, t))); sh.append(ul);
    if (st) {
      sh.append(section('내 자리'));
      const row = el('div', 'row');
      const rb = el('button', 'btn', `리바이 +${fmt(START)}`); rb.disabled = st.stack > 0; rb.onclick = () => { send('rebuy'); closeSheet(); };
      const lv = el('button', 'btn fold', '자리에서 일어나기');
      lv.onclick = () => { closeSheet(); openModal('confirm', { title: '자리에서 일어날까요?', body: '남은 칩과 진행 중인 베팅은 사라져요.', ok: '일어나기', fn: () => send('leave') }); };
      row.append(rb, lv); sh.append(row);
    }
    if (st) {
      const bots = v.seats.filter(x => x && x.bot).length;
      sh.append(section('봇'), el('p', null, game.botNote || '봇은 혼자서도 같이 놀 수 있게 자리를 채워 줘요.'));
      const row = el('div', 'row');
      const add = el('button', 'btn', '봇 추가'); add.disabled = v.seats.every(Boolean); add.onclick = () => { send('addBot'); toast('봇을 앉혔어요'); closeSheet(); };
      const kick = el('button', 'btn fold', `봇 모두 내보내기${bots ? ' (' + bots + ')' : ''}`); kick.disabled = !bots; kick.onclick = () => { send('kickBots'); closeSheet(); };
      row.append(add, kick); sh.append(row);
    }
    sh.append(section('친구 초대하기'), inviteBlock());
    sh.append(section('점수판'));
    const list = el('div', 'list');
    const rows = v.seats.filter(Boolean).map(s => ({ s, net: s.stack - s.buyin })).sort((a, b) => b.net - a.net);
    if (!rows.length) list.append(el('div', null, '아직 앉은 사람이 없어요'));
    rows.forEach(r => { const d = el('div'); d.append(el('span', 'grow', r.s.name + (r.s.uid === ME ? ' (나)' : '')), el('span', 'num', fmt(r.s.stack)), el('span', 'num ' + (r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : ''), (r.net > 0 ? '+' : '') + fmt(r.net))); list.append(d); });
    sh.append(list, section('최근 기록'));
    const log = el('div', 'log');
    (v.log || []).slice().reverse().forEach(t => log.append(el('div', null, t)));
    if (!(v.log || []).length) log.append(el('div', null, '아직 기록이 없어요'));
    sh.append(log);
    const lobby = el('button', 'btn', '로비로 나가기'); lobby.style.cssText = 'width:100%;margin-top:16px'; lobby.onclick = () => window.HOMain.lobby();
    const close = el('button', 'btn ghost', '닫기'); close.style.cssText = 'width:100%;margin-top:8px'; close.onclick = closeSheet;
    sh.append(lobby, close);
  }
  function closeSheet() { $('#sheetBack').hidden = true; }
  function toast(t) { const x = $('#toast'); x.textContent = t; x.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { x.hidden = true; }, 2800); }
  function wire() {
    $('#gMenu').onclick = openSheet;
    $('#gBack').onclick = () => window.HOMain.lobby();
    $('#gCode').onclick = () => openModal('invite');
    $('#sheetBack').addEventListener('click', e => { if (e.target.id === 'sheetBack') closeSheet(); });
    $('#modalBack').addEventListener('click', e => { if (e.target.id === 'modalBack') closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeSheet(); } });
  }

  window.HOKit = { start };
})();

(function () {
  'use strict';
  const E = window.PokerEngine;
  const N = E.MAXS;
  const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const REACTS = ['나이스!', 'ㅋㅋㅋ', '블러프지?', '😱', '👏', 'GG', '🔥', '한 판 더!'];
  const PHASE = { preflop: '프리플랍', flop: '플랍', turn: '턴', river: '리버', done: '결과' };
  const AV = ['#dcb05a', '#7fc4a4', '#e48f7a', '#9fb5e6', '#d7a6d9', '#c9d07a', '#f0c9a0', '#8fd3d3'];
  const SLOTS = [0, 0.125, 0.205, 0.36, 0.5, 0.64, 0.795, 0.875];

  const $ = (s, r) => (r || document).querySelector(s);
  function el(tag, cls, txt) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  const fmt = n => Math.round(n || 0).toLocaleString('ko-KR');
  const clone = o => JSON.parse(JSON.stringify(o));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const LS = {
    get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* no storage */ } },
  };
  function sess(k, v) {
    try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; }
    return v;
  }
  const rid = () => Math.random().toString(36).slice(2, 10);
  const TAB = sess('pk_tab') || sess('pk_tab', 't' + rid());
  const cleanId = s => (typeof s === 'string' && s ? s.replace(/[^A-Za-z0-9_\-.~:@+]/g, '_').slice(0, 120) : null);
  function localUid() {
    let u = LS.get('pk_uid');
    if (!u) { u = 'l_' + rid() + rid(); LS.set('pk_uid', u); }
    return u;
  }
  function cleanName(s) {
    return String(s || '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').trim().slice(0, 12);
  }

  /* ---------------- room (table) code from the URL: …/#ABC123 ---------------- */
  const HOSTED = !(window.claude && typeof window.claude.use === 'function'); // false only in the test mock
  const CODE_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const normRoom = s => { const c = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return /^[A-Z0-9]{4,12}$/.test(c) ? c : null; };
  const newRoomCode = () => Array.from({ length: 6 }, () => CODE_CH[Math.floor(Math.random() * CODE_CH.length)]).join('');
  const hashRoom = () => { try { return normRoom(decodeURIComponent(location.hash.slice(1))); } catch (e) { return null; } };
  const ROOM = (function () {
    if (!HOSTED) return 'main';
    const code = hashRoom() || normRoom(LS.get('pk_room')) || newRoomCode();
    LS.set('pk_room', code);
    if (location.hash !== '#' + code) { try { history.replaceState(null, '', location.pathname + location.search + '#' + code); } catch (e) { /* ignore */ } }
    return code;
  })();
  const TABLE = 'tables/' + ROOM;
  const REQ = TABLE + '/req';
  const denied = e => !!e && (e.code === 'invalid_argument' || e.code === 'permission_denied');

  /* ---------------- crypto (hole cards are sealed per player) ---------------- */
  const cryptoOK = !!(window.crypto && crypto.subtle && crypto.getRandomValues && window.isSecureContext !== false);
  const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
  const b64 = u8 => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  function slimPub(j) {
    return j && typeof j.x === 'string' && typeof j.y === 'string' && j.x.length < 80 && j.y.length < 80 ? { kty: 'EC', crv: 'P-256', x: j.x, y: j.y } : null;
  }
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
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  function rint(n) {
    if (!cryptoOK) return Math.floor(Math.random() * n);
    const a = new Uint32Array(1), lim = Math.floor(4294967296 / n) * n;
    let x;
    do { crypto.getRandomValues(a); x = a[0]; } while (x >= lim);
    return x % n;
  }
  async function loadKeys() {
    if (!cryptoOK) return null;
    try {
      const saved = LS.get('pk_keys');
      if (saved && saved.pub && saved.priv) return { pub: slimPub(saved.pub), priv: await impPriv(saved.priv) };
    } catch (e) { /* regenerate */ }
    try {
      const k = await genKP();
      LS.set('pk_keys', { pub: k.pub, priv: k.privJwk });
      return { pub: k.pub, priv: k.priv };
    } catch (e) { return null; }
  }

  /* ---------------- state ---------------- */
  let db = null, room = null, user = null, ME = null, canWrite = null, profileName = '';
  let S = null, loaded = false, connErr = '', offline = false, lastSeq = null;
  let amHost = false, H = null, ctx = null, reqUnsub = null, hostTimer = null, hostQ = Promise.resolve();
  let reqDocs = {}, writing = false, dirty = false, writeFails = 0, creatingJoin = null;
  let myReqN = 0, pending = [], inflight = false, pendingSince = 0, keySynced = false;
  let keys = null, myCards = null, clockOff = 0;
  const online = { uids: new Set(), tabs: new Set(), peers: [], seenUids: new Set(), seenTabs: new Set() };
  let peersReadyAt = 0, hostGoneSince = 0;
  const ui = { raise: false, raiseTo: 0, sentTurn: null, sheet: null, modal: null, reacts: {}, boardKey: '', pos: null, toastT: 0 };
  let hotData = {};

  const V = () => (amHost ? H : S);
  const hostNow = () => Date.now() + clockOff;
  const mySeat = () => E.seatOf(V(), ME);

  /* ---------------- boot ---------------- */
  async function boot(data) {
    hotData = data || {};
    buildFeltTexture();
    render();
    try { new ResizeObserver(() => { ui.pos = null; renderTable(); }).observe($('#table')); }
    catch (e) { window.addEventListener('resize', () => { ui.pos = null; renderTable(); }); }
    let c = HOSTED ? null : window.claude;
    if (HOSTED) {
      const B = window.HOBackend;
      if (!B || !B.configured()) {
        offline = true; connErr = '아직 서버(Firebase)가 연결되지 않았어요. README 안내대로 firebase-config.js를 채워 주세요.'; render(); return;
      }
      try { c = await B.connect(ROOM); } catch (e) { offline = true; connErr = backendErr(e); render(); return; }
    }
    try { [db, user, room] = await Promise.all([c.use('db'), c.use('user'), c.use('room')]); } catch (e) { /* handled below */ }
    if (!db) { offline = true; connErr = '온라인 테이블에 연결할 수 없어요. 새로고침해 주세요.'; render(); return; }
    let id = null;
    try { id = user ? await user.id() : null; } catch (e) { id = null; }
    ME = cleanId(id) || localUid();
    try { const me = user ? await user.me() : null; profileName = (me && me.name) || ''; } catch (e) { /* no name */ }
    try { canWrite = user ? await user.can('data.write') : null; } catch (e) { canWrite = null; }
    keys = await loadKeys();
    subscribeTable();
    setupRoom();
    setInterval(clientTick, 1000);
    setInterval(liveTick, 200);
    render();
  }

  function backendErr(e) {
    const code = e && e.code;
    if (code === 'auth_disabled') return 'Firebase 익명 로그인이 꺼져 있어요. 콘솔 → Authentication → 로그인 방법에서 “익명”을 켜 주세요.';
    if (code === 'sdk' || code === 'network') return '서버에 연결할 수 없어요. 인터넷 연결을 확인하고 새로고침해 주세요.';
    if (/database url/i.test((e && e.message) || '')) return 'firebase-config.js의 databaseURL이 올바르지 않아요.';
    return `서버 연결에 실패했어요 (${code || '알 수 없는 오류'}). 새로고침해 주세요.`;
  }

  function subscribeTable() {
    const t = setTimeout(() => { if (!loaded) { connErr = '테이블을 불러오는 중이에요. 연결이 느리면 잠시 후 다시 확인해 주세요.'; render(); } }, 10000);
    db.doc(TABLE).onSnapshot(snap => {
      if (!snap.metadata.fromCache) { clearTimeout(t); if (!offline) connErr = ''; }
      loaded = true;
      const d = snap.exists ? snap.data() : null;
      onTable(d && d.v ? d : null, snap.metadata);
    }, e => {
      clearTimeout(t);
      connErr = denied(e) ? '데이터베이스 보안 규칙이 막고 있어요. README의 규칙(database.rules.json)을 게시해 주세요.' : '테이블 연결이 끊겼어요. 페이지를 다시 열어 주세요.';
      render();
    });
  }

  function onTable(d, meta) {
    if (d && lastSeq !== null && d.seq !== lastSeq && !meta.fromCache && !meta.hasPendingWrites && d.now) {
      const off = d.now - Date.now();
      if (Math.abs(off) < 5 * 60 * 1000) clockOff = off;
    }
    if (d) lastSeq = d.seq;
    S = d;
    if (d) {
      const mine = d.hostId === ME && d.hostTab === TAB;
      if (amHost) {
        if (!mine) { if ((d.epoch || 0) >= H.epoch) stepDown('다른 사람이 딜러를 이어받았어요'); else markDirty(); }
        else if ((d.epoch || 0) < H.epoch) markDirty();
      } else if (mine) {
        becomeHost(clone(d));
      }
    } else if (amHost) {
      markDirty();
    }
    if (!waitingAck() && !pending.length) pendingSince = 0;
    pump();
    syncKey();
    decryptMine();
    render();
  }

  /* ---------------- host (dealer) ---------------- */
  function becomeHost(st) {
    amHost = true; H = st;
    const saved = hotData.ctx || LS.get('pk_ctx');
    ctx = E.handActive(H) && saved && saved.hid === H.hand.hid ? saved : null;
    if (!ctx) ctx = { hid: null, deck: [], holes: {}, eph: null, runoutAt: 0, botTurn: -1, botAt: 0 };
    ctx.runoutAt = 0;
    reqDocs = {};
    if (reqUnsub) reqUnsub();
    reqUnsub = db.collection(REQ).onSnapshot(qs => {
      qs.docs.forEach(doc => { if (doc.exists) reqDocs[doc.id] = doc.data(); });
      hostDo(processReqs);
    }, () => toast('요청 수신이 끊겼어요. 페이지를 다시 열어 주세요.'));
    clearInterval(hostTimer);
    hostTimer = setInterval(() => hostDo(tick), 400);
    const queued = pending; pending = [];
    hostDo(async () => {
      if (E.handActive(H) && ctx.hid !== H.hand.hid) E.voidHand(H, Date.now(), '딜러 기기에 카드 정보가 없어요');
      for (const r of queued) await applyReq(ME, r);
      await settle();
    });
  }

  function stepDown(msg) {
    amHost = false; H = null; ctx = null;
    if (reqUnsub) { reqUnsub(); reqUnsub = null; }
    clearInterval(hostTimer); hostTimer = null;
    if (msg) toast(msg);
    if (creatingJoin && S && E.seatOf(S, ME) < 0) { const j = creatingJoin; creatingJoin = null; send('join', j); }
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
    H.seq = (H.seq || 0) + 1;
    H.now = Date.now();
    saveCtx();
    markDirty();
    decryptMine();
    render();
  }
  function markDirty() { dirty = true; flush(); }
  async function flush() {
    if (writing || !dirty || !amHost) return;
    writing = true; dirty = false;
    const body = clone(H);
    try {
      await db.doc(TABLE).set(body);
      writeFails = 0;
    } catch (e) {
      dirty = true; writeFails++;
      if (denied(e) && writeFails > 2) { canWrite = false; stepDown('테이블에 쓸 권한이 없어요'); }
      else if (e && e.code === 'quota_exceeded') toast('저장 공간이 가득 찼어요');
      await sleep(600 * Math.min(writeFails, 6));
    }
    writing = false;
    if (dirty && amHost) flush();
  }
  function saveCtx() { if (amHost && ctx) LS.set('pk_ctx', ctx); }

  async function processReqs() {
    for (const uid of Object.keys(reqDocs)) {
      const r = reqDocs[uid];
      if (!r || typeof r.n !== 'number') continue;
      if (r.n <= (H.proc[uid] || 0)) continue;
      H.proc[uid] = r.n;
      if (typeof r.t === 'number' && Date.now() - r.t > 10 * 60 * 1000) continue; // stale leftover
      try { await applyReq(uid, r); } catch (e) { console.error(e); }
    }
    await settle();
  }

  async function applyReq(uid, r) {
    const now = Date.now();
    const i = E.seatOf(H, uid);
    const name = cleanName(r.name);
    const st = i >= 0 ? H.seats[i] : null;
    switch (r.type) {
      case 'join': {
        if (st) { if (name) st.name = name; if (r.pub) st.pub = slimPub(r.pub); st.leave = false; break; }
        let s = Number.isInteger(r.seat) && r.seat >= 0 && r.seat < N && !H.seats[r.seat] ? r.seat : H.seats.findIndex(x => !x);
        if (s < 0) break;
        H.seats[s] = { uid, name: name || '플레이어', stack: H.settings.stack, buyin: H.settings.stack, out: false, leave: false, bot: false, pub: slimPub(r.pub) };
        E.addLog(H, `${H.seats[s].name} 님이 앉았어요`);
        break;
      }
      case 'act': {
        const h = H.hand;
        if (!st || !E.handActive(H) || h.no !== r.hand || h.turn !== r.turn || h.cur !== i) break;
        const err = E.act(H, i, String(r.a), Number(r.amt) || 0, now);
        if (err && r.a === 'raise') E.act(H, i, 'call', 0, now);
        break;
      }
      case 'out': if (st) { st.out = true; if (E.handActive(H) && H.hand.cur === i) E.autoAct(H, i, now); } break;
      case 'back': if (st) st.out = false; break;
      case 'rebuy': if (st) E.rebuy(H, i); break;
      case 'leave': if (st) E.leaveSeat(H, i, now); break;
      case 'name': if (st && name) st.name = name; break;
      case 'key': {
        if (!st) break;
        st.pub = slimPub(r.pub);
        const h = H.hand;
        if (E.handActive(H) && ctx && ctx.hid === h.hid && ctx.holes[i]) {
          let ephPriv = null;
          try { ephPriv = ctx.eph && cryptoOK ? await impPriv(ctx.eph) : null; } catch (e) { ephPriv = null; }
          h.enc[i] = await boxFor(st, ctx.holes[i], h, ephPriv);
        }
        break;
      }
      default: break;
    }
  }

  async function settle() {
    const now = Date.now();
    for (let g = 0; g < 24; g++) {
      if (!E.handActive(H) || !ctx || ctx.hid !== H.hand.hid) break;
      if (ctx.runoutAt && ctx.runoutAt > now) break;
      const r = E.progress(H, ctx, now);
      if (r.again) { ctx.runoutAt = now + 1300; break; }
      if (!E.handActive(H)) break;
      const i = H.hand.cur;
      if (i < 0) break;
      const st = H.seats[i];
      if (st && (st.out || st.leave)) { E.autoAct(H, i, now); continue; }
      break;
    }
  }

  async function tick() {
    const now = Date.now();
    if (E.handActive(H)) {
      if (!ctx || ctx.hid !== H.hand.hid) { E.voidHand(H, now, '카드 정보 없음'); return; }
      const h = H.hand;
      if (ctx.runoutAt) { if (now >= ctx.runoutAt) { ctx.runoutAt = 0; await settle(); } return; }
      if (h.cur < 0) { await settle(); return; }
      const st = H.seats[h.cur];
      if (st && st.bot) {
        if (ctx.botTurn !== h.turn) { ctx.botTurn = h.turn; ctx.botAt = now + 900 + Math.random() * 1500; }
        else if (ctx.botAt && now >= ctx.botAt) {
          ctx.botAt = 0;
          const hole = ctx.holes[h.cur];
          const d = hole ? E.botDecide(H, h.cur, hole) : { type: 'fold' };
          if (E.act(H, h.cur, d.type, d.amount, now)) E.autoAct(H, h.cur, now);
          await settle();
        }
      } else {
        if (ctx.turnSeen !== h.turn) { ctx.turnSeen = h.turn; ctx.turnAt = now; }
        const gone = st && room && online.seenUids.has(st.uid) && !online.uids.has(st.uid) && now - ctx.turnAt > 6000;
        const late = H.settings.timer > 0 && h.deadline && now > h.deadline + 400;
        if (gone || late) {
          const i = h.cur;
          E.autoAct(H, i, now);
          if (H.seats[i]) { H.seats[i].out = true; E.addLog(H, `${H.seats[i].name}: ${gone ? '연결 끊김' : '시간 초과'} — 자리 비움`); }
          await settle();
        }
      }
    } else if (H.started && !H.paused && now >= (H.nextAt || 0) && E.eligible(H).length >= 2) {
      await deal();
    }
  }

  async function deal() {
    const deck = E.shuffle(E.freshDeck(), rint);
    const res = E.startHand(H, deck, Date.now());
    if (!res) return;
    ctx = { hid: H.hand.hid, deck: res.deck, holes: res.holes, eph: null, runoutAt: 0, botTurn: -1, botAt: 0 };
    await encryptHoles();
    await settle();
  }
  async function encryptHoles() {
    const h = H.hand;
    h.enc = {}; h.epk = null;
    let eph = null;
    if (cryptoOK) {
      try { eph = await genKP(); ctx.eph = eph.privJwk; h.epk = eph.pub; } catch (e) { eph = null; }
    }
    for (const k of Object.keys(ctx.holes)) {
      const i = Number(k), st = H.seats[i];
      if (!st || st.bot) continue;
      h.enc[i] = await boxFor(st, ctx.holes[i], h, eph ? eph.priv : null);
    }
  }
  async function boxFor(st, cards, h, ephPriv) {
    if (ephPriv && st.pub) {
      try { return await seal(await derive(ephPriv, await impPub(st.pub)), { hid: h.hid, c: cards }); } catch (e) { /* fall through */ }
    }
    return { p: cards };
  }

  // Host-only commands, applied straight to the authoritative state.
  const host = {
    start() { hostDo(async () => { H.started = true; H.paused = false; H.nextAt = Date.now(); E.addLog(H, '게임 시작'); }); },
    pause(p) { hostDo(async () => { H.paused = p; E.addLog(H, p ? '이번 핸드 후 일시정지' : '게임 재개'); if (!p) H.nextAt = Date.now() + 800; }); },
    settings(s) {
      hostDo(async () => {
        H.settings = Object.assign({}, H.settings, s);
        if (E.handActive(H) && H.hand.cur >= 0) H.hand.deadline = Date.now() + (s.timer > 0 ? s.timer * 1000 : 0);
        E.addLog(H, `설정 변경: 블라인드 ${fmt(s.sb)}/${fmt(s.bb)} · 시작 칩 ${fmt(s.stack)}`);
      });
    },
    addBot() {
      hostDo(async () => {
        const s = H.seats.findIndex(x => !x);
        if (s < 0) return;
        const used = new Set(H.seats.filter(Boolean).map(x => x.name));
        let k = 1; while (used.has(`봇 ${k}호`)) k++;
        H.seats[s] = { uid: 'bot_' + rid(), name: `봇 ${k}호`, stack: H.settings.stack, buyin: H.settings.stack, out: false, leave: false, bot: true, pub: null };
        E.addLog(H, `봇 ${k}호가 앉았어요`);
      });
    },
    kick(i) { hostDo(async () => { if (H.seats[i]) E.leaveSeat(H, i, Date.now()); await settle(); }); },
    setOut(i, v) { hostDo(async () => { const st = H.seats[i]; if (!st) return; st.out = v; if (v && E.handActive(H) && H.hand.cur === i) E.autoAct(H, i, Date.now()); await settle(); }); },
    reset() {
      hostDo(async () => {
        E.voidHand(H, Date.now(), '칩 초기화');
        H.seats.forEach(s => { if (s) { s.stack = H.settings.stack; s.buyin = H.settings.stack; } });
        E.addLog(H, `모든 칩을 ${fmt(H.settings.stack)}으로 초기화했어요`);
      });
    },
  };

  async function takeOver() {
    if (amHost || !S) return;
    if (canWrite === false) { toast('쓰기 권한이 없어 딜러를 맡을 수 없어요'); return; }
    const st = clone(S);
    const saved = hotData.ctx || LS.get('pk_ctx');
    const resumable = E.handActive(st) && saved && saved.hid === st.hand.hid;
    if (!resumable && E.handActive(st)) E.voidHand(st, Date.now(), '딜러 교체');
    st.epoch = (st.epoch || 1) + 1; st.hostId = ME; st.hostTab = TAB;
    const i = E.seatOf(st, ME);
    const myName = i >= 0 ? st.seats[i].name : '새 딜러';
    st.notice = { k: 'host', name: myName, t: Date.now(), voided: !resumable };
    E.addLog(st, `${myName} 님이 딜러를 이어받았어요`);
    hostGoneSince = 0;
    becomeHost(st);
    commit();
  }

  /* ---------------- client → dealer requests ---------------- */
  function waitingAck() { return !amHost && !!S && myReqN > ((S.proc && S.proc[ME]) || 0); }
  function send(type, data) {
    const r = Object.assign({ type }, data || {});
    if (amHost) { hostDo(async () => { await applyReq(ME, r); await settle(); }); return; }
    pending.push(r);
    if (!pendingSince) pendingSince = Date.now();
    pump();
    render();
  }
  async function pump() {
    if (inflight || !pending.length || !S || amHost) return;
    const proc = (S.proc && S.proc[ME]) || 0;
    if (myReqN > proc) return;
    const r = pending.shift();
    const n = Math.max(myReqN, proc) + 1;
    inflight = true;
    try {
      await db.doc(REQ + '/' + ME).set(Object.assign({}, r, { n, t: Date.now() }));
      myReqN = n;
      if (!pendingSince) pendingSince = Date.now();
    } catch (e) {
      if (denied(e)) { canWrite = false; pending = []; toast('서버에 쓸 수 없어요. 데이터베이스 보안 규칙을 확인해 주세요.'); }
      else { pending.unshift(r); setTimeout(pump, 1500); }
    }
    inflight = false;
    render();
  }
  function syncKey() {
    if (keySynced || !keys || !S) return;
    const i = E.seatOf(V(), ME);
    if (i < 0) return;
    keySynced = true;
    const pub = V().seats[i].pub;
    if (!pub || pub.x !== keys.pub.x) send('key', { pub: keys.pub });
  }

  async function decryptMine() {
    const v = V(); const h = v && v.hand; const i = E.seatOf(v, ME);
    if (!h || i < 0 || !h.enc || !h.enc[i]) { if (!h || (myCards && myCards.hid !== h.hid)) myCards = null; return; }
    const box = h.enc[i];
    const sig = h.hid + ':' + (box.iv || 'p');
    if (myCards && myCards.sig === sig) return;
    myCards = { sig, hid: h.hid, cards: null, busy: true };
    if (box.p) { myCards = { sig, hid: h.hid, cards: box.p }; render(); return; }
    try {
      if (!keys || !h.epk) throw new Error('no key');
      const obj = await unseal(await derive(keys.priv, await impPub(h.epk)), box);
      myCards = { sig, hid: h.hid, cards: obj.hid === h.hid ? obj.c : null };
    } catch (e) {
      myCards = { sig, hid: h.hid, cards: null, err: true };
      if (keys) send('key', { pub: keys.pub });
    }
    render();
  }

  /* ---------------- room: presence + reactions ---------------- */
  function setupRoom() {
    if (!room) return;
    try {
      room.onPeers(ch => { readPeers(ch.peers); if (!peersReadyAt) peersReadyAt = Date.now() + 3000; renderTop(); renderSeats(); }, () => {});
      room.on('react', onReact, () => {});
      room.presence({ uid: ME, tab: TAB }).catch(() => {});
    } catch (e) { room = null; }
  }
  function readPeers(peers) {
    online.uids = new Set(); online.tabs = new Set(); online.peers = [];
    for (const p of peers) {
      if (p.kind !== 'viewer') continue;
      const pr = p.presence || {};
      const uid = typeof pr.uid === 'string' ? pr.uid : (p.by ? cleanId(p.by) : null);
      const tab = typeof pr.tab === 'string' ? pr.tab : null;
      if (uid) { online.uids.add(uid); online.seenUids.add(uid); }
      if (tab) { online.tabs.add(tab); online.seenTabs.add(tab); }
      online.peers.push({ uid, tab });
    }
  }
  function sendReact(k) {
    closeModal();
    if (!room) { toast('리액션은 지금 보낼 수 없어요'); return; }
    room.emit('react', { k, uid: ME }).catch(() => toast('리액션을 보낼 수 없어요'));
  }
  function onReact(msg) {
    const d = msg.data || {};
    if (!Number.isInteger(d.k) || d.k < 0 || d.k >= REACTS.length) return;
    const uid = msg.by ? cleanId(msg.by) : (typeof d.uid === 'string' ? d.uid : null);
    const i = E.seatOf(V(), uid);
    if (i < 0) return;
    ui.reacts[i] = { k: d.k, t: Date.now() };
    renderSeats();
  }
  function hostOnline(v) {
    if (!v) return false;
    if (v.hostTab) return online.tabs.has(v.hostTab);
    return online.uids.has(v.hostId);
  }

  function clientTick() {
    if (!S || amHost) { hostGoneSince = 0; renderBanner(); return; }
    if (room && peersReadyAt && Date.now() > peersReadyAt && room.connected()) {
      if (hostOnline(S)) hostGoneSince = 0;
      else if (!hostGoneSince) hostGoneSince = Date.now();
      const away = hostGoneSince ? Date.now() - hostGoneSince : 0;
      let should = false;
      if (!E.handActive(S)) should = away > 4000;
      else should = (online.seenTabs.has(S.hostTab) && away > 15000) || (away > 15000 && hostNow() - (S.now || 0) > 90000);
      if (should && canWrite !== false && successor() === TAB) takeOver();
    }
    renderBanner();
  }
  function successor() {
    const cands = online.peers.filter(p => p.tab && p.uid).map(p => {
      const i = E.seatOf(S, p.uid);
      return { tab: p.tab, rank: i >= 0 && !S.seats[i].bot ? i : 99 };
    });
    cands.sort((a, b) => a.rank - b.rank || (a.tab < b.tab ? -1 : 1));
    return cands.length ? cands[0].tab : null;
  }

  /* ---------------- player actions ---------------- */
  function doAct(a, amt) {
    const v = V(), h = v.hand;
    ui.raise = false;
    ui.sentTurn = h.no + ':' + h.turn;
    send('act', { hand: h.no, turn: h.turn, a, amt: amt || 0 });
    render();
  }
  function joinAt(seat) {
    const name = cleanName($('#nameInput') && $('#nameInput').value);
    if (!name) { toast('닉네임을 입력해 주세요'); return; }
    LS.set('pk_name', name);
    closeModal();
    const r = { seat, name, pub: keys ? keys.pub : null };
    if (!S) {
      if (canWrite === false) { toast('쓰기 권한이 없어요'); return; }
      const st = E.newState(ME, TAB);
      creatingJoin = r;
      becomeHost(st);
      hostDo(async () => { await applyReq(ME, Object.assign({ type: 'join' }, r)); });
      return;
    }
    send('join', r);
  }

  /* ---------------- rendering ---------------- */
  function render() {
    renderTop();
    renderBanner();
    renderDock();
    renderTable();
  }

  function renderTop() {
    const v = V();
    const meta = $('#meta');
    meta.textContent = '';
    if (v) {
      const b = el('b', 'num', `${fmt(v.settings.sb)}/${fmt(v.settings.bb)}`);
      meta.append('블라인드 ', b);
      if (v.handNo) meta.append(` · #${v.handNo}`);
    } else if (!loaded && !offline) meta.textContent = '연결 중…';
    const on = $('#online');
    const n = online.uids.size;
    on.hidden = !room || n === 0;
    $('#onlineN').textContent = n;
  }

  function renderBanner() {
    const bn = $('#banner'), txt = $('#bannerText'), btn = $('#bannerBtn');
    let msg = '', action = null, label = '';
    const v = V();
    if (connErr) msg = connErr;
    else if (canWrite === false && loaded) msg = '서버에 쓸 권한이 없어 관전만 할 수 있어요. 데이터베이스 보안 규칙을 확인해 주세요.';
    else if (v && v.notice && hostNow() - v.notice.t < 12000) {
      msg = `${v.notice.name} 님이 딜러를 이어받았어요.` + (v.notice.voided ? ' 진행 중이던 핸드는 무효 처리돼 칩이 돌아갔어요.' : '');
    } else if (!amHost && S && canWrite !== false) {
      const stuck = waitingAck() && pendingSince && Date.now() - pendingSince > 10000;
      const gone = hostGoneSince && Date.now() - hostGoneSince > 2500;
      if (stuck || gone) { msg = '딜러(방장)가 접속해 있지 않은 것 같아요.'; label = '내가 딜러 맡기'; action = confirmTakeOver; }
    }
    bn.hidden = !msg;
    txt.textContent = msg;
    btn.hidden = !action;
    btn.textContent = label;
    btn.onclick = action;
  }

  function stadiumPoint(W, Hh, f) {
    let segs;
    if (Hh >= W) {
      const r = W / 2, L = Hh - W;
      segs = [
        [Math.PI * r / 2, s => { const a = Math.PI / 2 + s / r; return [r * Math.cos(a), L / 2 + r * Math.sin(a)]; }],
        [L, s => [-r, L / 2 - s]],
        [Math.PI * r, s => { const a = Math.PI + s / r; return [r * Math.cos(a), -L / 2 + r * Math.sin(a)]; }],
        [L, s => [r, -L / 2 + s]],
        [Math.PI * r / 2, s => { const a = s / r; return [r * Math.cos(a), L / 2 + r * Math.sin(a)]; }],
      ];
    } else {
      const r = Hh / 2, L = W - Hh;
      segs = [
        [L / 2, s => [-s, r]],
        [Math.PI * r, s => { const a = Math.PI / 2 + s / r; return [-L / 2 + r * Math.cos(a), r * Math.sin(a)]; }],
        [L, s => [-L / 2 + s, -r]],
        [Math.PI * r, s => { const a = -Math.PI / 2 + s / r; return [L / 2 + r * Math.cos(a), r * Math.sin(a)]; }],
        [L / 2, s => [L / 2 - s, r]],
      ];
    }
    const P = segs.reduce((a, s) => a + s[0], 0);
    let t = P * f;
    for (const [len, fn] of segs) { if (t <= len) return fn(t); t -= len; }
    return segs[segs.length - 1][1](segs[segs.length - 1][0]);
  }

  function layout() {
    const box = $('#table');
    const W = box.clientWidth, Hh = box.clientHeight;
    if (ui.pos && ui.pos.W === W && ui.pos.H === Hh) return ui.pos;
    const portrait = Hh >= W;
    const fx = portrait ? 34 : 70, ftop = portrait ? 44 : 50, fbot = portrait ? 36 : 44;
    const fw = Math.max(120, W - fx * 2), fh = Math.max(120, Hh - ftop - fbot);
    const cx = W / 2, cy = ftop + fh / 2;
    const felt = $('#felt');
    Object.assign(felt.style, { left: fx + 'px', top: ftop + 'px', width: fw + 'px', height: fh + 'px' });
    const c = $('#center');
    c.style.left = cx + 'px'; c.style.top = (cy - fh * 0.02) + 'px';
    const pts = SLOTS.map(f => {
      const [x, y] = stadiumPoint(fw - 4, fh - 4, f);
      const hw = portrait ? 44 : 60;
      return { x: Math.min(W - hw, Math.max(hw, cx + x)), y: Math.min(Hh - 28, Math.max(34, cy + y)) };
    });
    ui.pos = { W, H: Hh, cx, cy, pts, portrait };
    return ui.pos;
  }

  function renderTable() {
    layout();
    renderCenter();
    renderSeats();
  }

  function cardEl(c, extra) {
    if (!c) { return el('div', 'card back' + (extra ? ' ' + extra : '')); }
    const red = c[1] === 'h' || c[1] === 'd';
    const d = el('div', 'card' + (red ? ' red' : '') + (extra ? ' ' + extra : ''));
    d.setAttribute('aria-label', E.rankLabel(E.rv(c)) + ' ' + ({ s: '스페이드', h: '하트', d: '다이아', c: '클럽' })[c[1]]);
    d.append(el('span', 'r', E.rankLabel(E.rv(c))), el('span', 's2', SUIT[c[1]]), el('span', 's', SUIT[c[1]]));
    return d;
  }

  function winningCards(v) {
    const h = v && v.hand;
    const set = new Set();
    if (!h || h.phase !== 'done' || !h.results || !h.results.showdown) return set;
    const top = h.results.winners[0];
    if (!top || !h.shown[top.seat]) return set;
    const all = h.shown[top.seat].concat(h.board);
    const best = E.evaluate(all);
    // find a 5-card combo matching best
    const idx = [0, 1, 2, 3, 4, 5, 6].slice(0, all.length);
    const combos = [];
    (function rec(start, pick) {
      if (pick.length === 5) { combos.push(pick.slice()); return; }
      for (let k = start; k < idx.length; k++) { pick.push(idx[k]); rec(k + 1, pick); pick.pop(); }
    })(0, []);
    for (const cb of combos) {
      const cs = cb.map(k => all[k]);
      if (E.cmp(E.evaluate(cs), best) === 0) { cs.forEach(x => set.add(x)); break; }
    }
    return set;
  }

  function renderCenter() {
    const v = V();
    const potEl = $('#pot'), boardEl = $('#board'), st = $('#status');
    const h = v && v.hand;
    potEl.textContent = '';
    if (h) {
      const amt = h.phase === 'done' ? (h.results ? h.results.total : 0) : E.potTotal(h);
      if (amt > 0) { potEl.append(el('small', null, h.phase === 'done' ? '팟' : 'POT')); potEl.append(document.createTextNode(fmt(amt))); }
    }
    // board
    const board = h ? h.board : [];
    const key = (h ? h.hid : '-') + ':' + board.length + ':' + (h && h.phase === 'done' ? 'd' : '');
    if (key !== ui.boardKey) {
      const prevLen = ui.boardKey.split(':')[0] === (h ? h.hid : '-') ? Number(ui.boardKey.split(':')[1]) : 0;
      ui.boardKey = key;
      const wins = winningCards(v);
      boardEl.textContent = '';
      for (let k = 0; k < 5; k++) {
        if (board[k]) {
          const fresh = k >= prevLen;
          const cls = (fresh ? 'deal' : '') + (wins.size ? (wins.has(board[k]) ? ' win' : ' dim') : '');
          const c = cardEl(board[k], cls.trim());
          if (fresh) c.style.setProperty('--d', ((k - prevLen) * 0.14) + 's');
          boardEl.append(c);
        } else boardEl.append(el('div', 'slot'));
      }
    }
    // status line
    st.textContent = '';
    if (offline) { st.textContent = '서버에 연결되지 않았어요'; return; }
    if (!loaded) { st.textContent = '테이블을 불러오는 중…'; return; }
    if (!v) { st.textContent = '빈 자리를 눌러 앉으면 테이블이 열려요. 처음 앉은 사람이 딜러를 맡아요.'; return; }
    if (h && h.phase !== 'done') {
      const cur = h.cur >= 0 && v.seats[h.cur] ? v.seats[h.cur].name : '';
      st.append(el('b', null, PHASE[h.phase]));
      if (cur) st.append(` · ${h.cur === mySeat() ? '내' : cur + ' 님'} 차례`);
      return;
    }
    if (h && h.phase === 'done' && h.results) {
      const w = h.results.winners;
      const names = w.map(x => (v.seats[x.seat] ? v.seats[x.seat].name : '?')).join(', ');
      const best = w[0] && w[0].name ? ' · ' + w[0].name : '';
      st.append(el('b', null, names), ` 승리${best}`);
      const left = Math.ceil(((v.nextAt || 0) - hostNow()) / 1000);
      if (v.started && !v.paused && left > 0 && E.eligible(v).length >= 2) st.append(el('br'), `다음 핸드 ${left}초 후`);
      else if (v.paused) st.append(el('br'), '일시정지됨');
      return;
    }
    const n = E.eligible(v).length;
    if (!v.started) st.textContent = n >= 2 ? '딜러(방장)가 시작하면 바로 카드를 돌려요' : '플레이어가 2명 이상 앉으면 시작할 수 있어요';
    else if (v.paused) st.textContent = '일시정지됨';
    else st.textContent = n >= 2 ? '곧 다음 핸드를 돌려요' : '상대를 기다리는 중이에요';
  }

  function colorFor(uid) {
    let x = 0; for (const ch of String(uid)) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
    return AV[x % AV.length];
  }

  function renderSeats() {
    const v = V();
    const pos = layout();
    const wrap = $('#seats'), bets = $('#bets');
    wrap.textContent = ''; bets.textContent = '';
    const me = mySeat();
    const base = me >= 0 ? me : 0;
    const h = v && v.hand;
    const live = h && h.phase !== 'done';
    const canSit = me < 0 && !offline && loaded && canWrite !== false;
    const wins = new Set(h && h.phase === 'done' && h.results ? h.results.winners.map(w => w.seat) : []);
    const boardRect = $('#board').getBoundingClientRect(), tRect = $('#table').getBoundingClientRect();
    const br = { l: boardRect.left - tRect.left - 6, r: boardRect.right - tRect.left + 6, t: boardRect.top - tRect.top - 30, b: boardRect.bottom - tRect.top + 26 };

    for (let i = 0; i < N; i++) {
      const k = (i - base + N) % N;
      const p = pos.pts[k];
      const st = v ? v.seats[i] : null;
      const seat = el('div', 'seat');
      seat.style.left = p.x + 'px'; seat.style.top = p.y + 'px';
      seat.dataset.seat = i;
      if (!st) {
        seat.classList.add('empty');
        const plate = el('div', 'plate');
        if (canSit) { seat.classList.add('tap'); plate.textContent = '+ 앉기'; plate.setAttribute('role', 'button'); plate.tabIndex = 0; plate.onclick = () => openJoin(i); plate.onkeydown = e => { if (e.key === 'Enter') openJoin(i); }; }
        seat.append(el('div', 'minis'), plate, el('div', 'tag'));
        wrap.append(seat);
        continue;
      }
      const ps = h && h.ps[i];
      if (i === me) seat.classList.add('me');
      if (live && h.cur === i) {
        seat.classList.add('turn');
        if (v.settings.timer > 0 && h.deadline) {
          const left = h.deadline - hostNow();
          seat.style.setProperty('--p', Math.max(0, Math.min(1, left / (v.settings.timer * 1000))).toFixed(3));
          if (left < 8000) seat.classList.add('hurry');
        }
      }
      if (ps && ps.folded) seat.classList.add('fold');
      if (st.out) seat.classList.add('out');
      if (wins.has(i)) seat.classList.add('win');

      // mini cards
      const minis = el('div', 'minis');
      if (h && ps && !ps.folded) {
        const shown = h.shown && h.shown[i];
        if (shown) { minis.classList.add('open'); shown.forEach(c => minis.append(cardEl(c))); }
        else if (i !== me && live) { minis.append(cardEl(null), cardEl(null)); }
      }
      // plate
      const plate = el('div', 'plate');
      const ring = el('div', 'ring'); ring.id = 'ring' + i;
      const av = el('div', 'av', st.bot ? '봇' : (st.name || '?').slice(0, 1));
      av.style.background = st.bot ? '#b9c2bd' : colorFor(st.uid);
      if (!st.bot && room) { const dot = el('span', 'dot' + (online.uids.has(st.uid) ? ' on' : '')); av.append(dot); }
      ring.append(av);
      const txt = el('div', 'ptxt');
      txt.append(el('span', 'pname', st.name), el('span', 'pstack', fmt(st.stack)));
      plate.append(ring, txt);
      if (h && h.button === i) plate.append(el('span', 'dbtn', 'D'));
      if (amHost && i !== me) { seat.classList.add('tap'); plate.setAttribute('role', 'button'); plate.tabIndex = 0; plate.onclick = () => openSeatMenu(i); }
      // tag
      const tag = el('div', 'tag');
      if (h && h.phase === 'done' && wins.has(i)) {
        const w = h.results.winners.find(x => x.seat === i);
        tag.textContent = '+' + fmt(w.amount); tag.classList.add('t-win');
      } else if (h && h.phase === 'done' && h.names && h.names[i]) {
        tag.textContent = h.names[i]; tag.classList.add('t-hand');
      } else if (ps && ps.allIn) { tag.textContent = '올인'; tag.classList.add('t-allin'); }
      else if (ps && ps.folded) { tag.textContent = '폴드'; tag.classList.add('t-fold'); }
      else if (ps && ps.last) tag.textContent = ps.last;
      else if (st.out) { tag.textContent = '자리 비움'; tag.classList.add('t-out'); }
      else if (st.stack === 0 && !(ps && !ps.folded)) { tag.textContent = '칩 없음'; tag.classList.add('t-out'); }
      if (h && h.phase === 'done' && wins.has(i) && h.names && h.names[i]) tag.title = h.names[i];
      seat.append(minis, plate, tag);
      // reaction bubble
      const rc = ui.reacts[i];
      if (rc && Date.now() - rc.t < 2600) seat.append(el('div', 'bubble', REACTS[rc.k]));
      wrap.append(seat);

      // bet marker
      if (live && ps && ps.bet > 0) {
        const dx = pos.cx - p.x, dy = pos.cy - p.y, d = Math.hypot(dx, dy) || 1;
        const step = Math.min(62, d * 0.45);
        let bx = p.x + dx / d * step, by = p.y + dy / d * step;
        for (let g = 0; g < 12 && bx > br.l - 34 && bx < br.r + 34 && by > br.t - 12 && by < br.b + 12; g++) by += (p.y > pos.cy ? 8 : -8);
        const b = el('div', 'bet');
        b.style.left = bx + 'px'; b.style.top = by + 'px';
        b.append(el('span', 'chip'), el('span', null, fmt(ps.bet)));
        bets.append(b);
      }
    }
  }

  function liveTick() {
    const v = V();
    const h = v && v.hand;
    if (h && h.phase !== 'done' && h.cur >= 0 && v.settings.timer > 0 && h.deadline) {
      const left = h.deadline - hostNow();
      const p = Math.max(0, Math.min(1, left / (v.settings.timer * 1000)));
      const ring = document.getElementById('ring' + h.cur);
      if (ring) {
        ring.parentElement.parentElement.style.setProperty('--p', p.toFixed(3));
        ring.parentElement.parentElement.classList.toggle('hurry', left < 8000);
      }
      const t = document.getElementById('myTimer');
      if (t) t.textContent = Math.max(0, Math.ceil(left / 1000)) + '초';
    }
    // countdown text for next hand
    if (h && h.phase === 'done') {
      const sec = Math.ceil(((v.nextAt || 0) - hostNow()) / 1000);
      if (sec !== ui.lastSec) { ui.lastSec = sec; renderCenter(); }
    }
    // expire reaction bubbles
    for (const k of Object.keys(ui.reacts)) if (Date.now() - ui.reacts[k].t > 2700) { delete ui.reacts[k]; renderSeats(); }
  }

  function myHandLabel(v, cards) {
    const h = v.hand;
    if (!cards || !h) return '';
    if (h.board.length >= 3) return E.describe(E.evaluate(cards.concat(h.board)));
    const [a, b] = cards;
    if (a[0] === b[0]) return `포켓 ${E.rankLabel(E.rv(a))}`;
    const hi = E.rv(a) >= E.rv(b) ? [a, b] : [b, a];
    return `${E.rankLabel(E.rv(hi[0]))}·${E.rankLabel(E.rv(hi[1]))}${a[1] === b[1] ? ' 수딧' : ''}`;
  }

  function renderDock() {
    const dock = $('#dock');
    dock.textContent = '';
    const v = V();
    const me = mySeat();
    const mine = el('div', 'mine');
    const info = el('div', 'myinfo');
    const reactBtn = el('button', 'icon-btn react-btn', '💬');
    reactBtn.setAttribute('aria-label', '리액션 보내기');
    reactBtn.onclick = () => openModal('react');

    if (offline || !loaded || !v || me < 0) {
      const cards = el('div', 'mycards');
      cards.append(cardEl('Ah', 'dim'), cardEl('Kh', 'dim'));
      if (offline) info.append(el('div', 'l1', '오프라인'), el('div', 'l2', connErr));
      else if (!loaded) info.append(el('div', 'l1', '테이블에 연결하는 중…'), el('div', 'l2', '잠시만 기다려 주세요'));
      else if (canWrite === false) info.append(el('div', 'l1', '관전 중'), el('div', 'l2', '서버 쓰기 권한이 없어요'));
      else info.append(el('div', 'l1', '빈 자리를 눌러 앉으세요'), el('div', 'l2', `시작 칩 ${fmt(v ? v.settings.stack : 1000)} · 최대 ${N}명`));
      mine.append(cards, info);
      dock.append(mine);
      if (amHost && v) dock.append(hostBar(v));
      return;
    }

    const st = v.seats[me], h = v.hand, live = E.handActive(v);
    const ps = h && h.ps[me];
    const shown = h && h.shown && h.shown[me];
    const cards = (myCards && myCards.hid === (h && h.hid) && myCards.cards) || shown || null;
    const cardBox = el('div', 'mycards');
    if (h && ps) {
      const fresh = cards && ui.myKey !== h.hid;
      if (cards) ui.myKey = h.hid;
      if (cards) cards.forEach((c, k) => {
        const ce = cardEl(c, (ps.folded ? 'dim' : '') + (fresh ? ' deal' : ''));
        if (fresh) ce.style.setProperty('--d', (k * 0.12) + 's');
        cardBox.append(ce);
      });
      else cardBox.append(cardEl(null), cardEl(null));
    } else cardBox.append(el('div', 'slot'), el('div', 'slot'));
    cardBox.querySelectorAll('.slot').forEach(s => { s.style.setProperty('--cw', 'clamp(42px, 12vw, 54px)'); });

    const label = h && ps && cards ? myHandLabel(v, cards) : '';
    const l1 = el('div', 'l1', label || st.name);
    const l2 = el('div', 'l2');
    l2.append('내 칩 ', el('b', 'num', fmt(st.stack)));
    if (ps && ps.bet > 0 && live) l2.append(` · 베팅 ${fmt(ps.bet)}`);
    const net = st.stack + (ps && live ? ps.total : 0) - st.buyin;
    if (net !== 0) l2.append(` · ${net > 0 ? '+' : ''}${fmt(net)}`);
    if (myCards && myCards.err) l2.textContent = '카드를 여는 중… 잠시만요';
    info.append(l1, l2);
    mine.append(cardBox, info);
    if (room) mine.append(reactBtn);
    dock.append(mine);

    const myTurn = live && h.cur === me;
    const turnKey = h ? h.no + ':' + h.turn : '';
    const sent = ui.sentTurn === turnKey && !amHost && (waitingAck() || pending.length > 0 || inflight);

    if (myTurn && !sent && !st.out) {
      dock.append(ui.raise ? raisePanel(v, me) : actionRow(v, me));
      return;
    }
    if (ui.raise) ui.raise = false;
    let line = null;
    if (myTurn && sent) line = waitLine('보내는 중…');
    else if (st.out) {
      line = el('div', 'actions one');
      const b = el('button', 'btn primary', '복귀하기'); b.onclick = () => send('back');
      line.append(b);
    } else if (st.stack === 0 && !(ps && !ps.folded && live)) {
      line = el('div', 'actions one');
      const b = el('button', 'btn primary');
      b.append('리바이', el('small', null, `+${fmt(v.settings.stack)}`));
      b.onclick = () => send('rebuy');
      line.append(b);
    } else if (live && h.cur >= 0) {
      const who = v.seats[h.cur];
      line = waitLine();
      line.append(el('b', null, who ? who.name : ''), ' 님 차례예요');
      if (v.settings.timer > 0) { const t = el('span', 'num'); t.id = 'myTimer'; line.append(' · ', t); }
    } else if (live) line = waitLine('카드를 펼치는 중…');
    else if (amHost) line = hostBar(v);
    else if (!v.started) {
      line = el('div', 'actions wait');
      line.append(waitLine('딜러가 시작하길 기다리는 중'), inviteBtn());
    }
    else line = waitLine(v.paused ? '일시정지됨' : '다음 핸드를 기다리는 중');
    dock.append(line);
  }

  function waitLine(t) { return el('div', 'waitline', t || null); }

  function hostBar(v) {
    const n = E.eligible(v).length;
    const row = el('div', 'actions two');
    if (!v.started || v.paused) {
      const b = el('button', 'btn primary', !v.started ? '게임 시작' : '다시 시작');
      b.disabled = n < 2;
      if (n < 2) b.append(el('small', null, '2명 이상 필요'));
      b.onclick = () => (v.started ? host.pause(false) : host.start());
      const bot = el('button', 'btn', '봇 추가');
      bot.disabled = v.seats.every(Boolean);
      bot.onclick = () => host.addBot();
      row.append(b, bot);
      if (!v.started && HOSTED) { row.className = 'actions three'; row.append(inviteBtn()); }
    } else {
      const w = el('div', 'waitline', n >= 2 ? '곧 다음 핸드를 돌려요' : '상대를 기다리는 중');
      const p = el('button', 'btn', '일시정지'); p.onclick = () => host.pause(true);
      row.append(w, p);
    }
    return row;
  }

  function actionCtx(v, me) {
    const h = v.hand, p = h.ps[me], st = v.seats[me];
    const toCall = Math.max(0, h.curBet - p.bet);
    let othersCan = 0;
    h.ps.forEach((q, k) => { if (q && k !== me && !q.folded && !q.allIn) othersCan++; });
    const canRaise = !p.acted && st.stack > toCall && othersCan > 0;
    const maxTo = p.bet + st.stack;
    const minTo = Math.min(maxTo, E.minRaiseTo(v, h));
    const pot = E.potTotal(h);
    return { h, p, st, toCall, canRaise, maxTo, minTo, pot };
  }

  function actionRow(v, me) {
    const a = actionCtx(v, me);
    const row = el('div', 'actions');
    const fold = el('button', 'btn fold', '폴드');
    fold.onclick = () => doAct('fold');
    const call = el('button', 'btn call');
    if (a.toCall === 0) { call.textContent = '체크'; call.onclick = () => doAct('check'); }
    else if (a.toCall >= a.st.stack) { call.append('올인 콜', el('small', null, fmt(a.st.stack))); call.onclick = () => doAct('call'); }
    else { call.append('콜', el('small', null, fmt(a.toCall))); call.onclick = () => doAct('call'); }
    const raise = el('button', 'btn raise');
    if (!a.canRaise) { raise.textContent = a.h.curBet > 0 ? '레이즈' : '벳'; raise.disabled = true; }
    else if (a.maxTo <= a.minTo) { raise.append('올인', el('small', null, fmt(a.maxTo))); raise.onclick = () => doAct('raise', a.maxTo); }
    else {
      raise.textContent = a.h.curBet > 0 ? '레이즈' : '벳';
      raise.onclick = () => { ui.raise = true; ui.raiseTo = a.minTo; renderDock(); };
    }
    row.append(fold, call, raise);
    return row;
  }

  function raisePanel(v, me) {
    const a = actionCtx(v, me);
    const unit = Math.max(1, v.settings.sb);
    const clamp = x => Math.max(a.minTo, Math.min(a.maxTo, Math.round(x / unit) * unit || a.minTo));
    ui.raiseTo = Math.max(a.minTo, Math.min(a.maxTo, ui.raiseTo || a.minTo));
    const wrap = el('div', 'raise-panel');
    const top = el('div', 'raise-top');
    const amt = el('span', 'amt', fmt(ui.raiseTo));
    top.append(el('span', 'lbl', a.h.curBet > 0 ? '레이즈 금액 (총 베팅)' : '벳 금액'), amt);
    const presets = el('div', 'presets');
    const potFor = f => a.h.curBet + f * (a.pot + a.toCall);
    const opts = [['최소', a.minTo], ['½ 팟', potFor(0.5)], ['¾ 팟', potFor(0.75)], ['팟', potFor(1)], ['올인', a.maxTo]];
    const slider = el('input');
    slider.type = 'range'; slider.id = 'raiseSlider'; slider.min = a.minTo; slider.max = a.maxTo; slider.step = unit; slider.value = ui.raiseTo;
    slider.setAttribute('aria-label', '베팅 금액');
    const set = x => { ui.raiseTo = x === a.maxTo ? a.maxTo : clamp(x); amt.textContent = fmt(ui.raiseTo); slider.value = ui.raiseTo; confirm.lastChild.textContent = fmt(ui.raiseTo); };
    opts.forEach(([t, x]) => { const b = el('button', null, t); b.onclick = () => set(x); presets.append(b); });
    slider.oninput = () => set(Number(slider.value) >= a.maxTo ? a.maxTo : Number(slider.value));
    const sr = el('div', 'slider-row');
    const minus = el('button', null, '−'); minus.setAttribute('aria-label', '줄이기');
    const plus = el('button', null, '+'); plus.setAttribute('aria-label', '늘리기');
    minus.onclick = () => set(ui.raiseTo - v.settings.bb);
    plus.onclick = () => set(ui.raiseTo + v.settings.bb);
    sr.append(minus, slider, plus);
    const row = el('div', 'actions two');
    const cancel = el('button', 'btn ghost', '취소');
    cancel.onclick = () => { ui.raise = false; renderDock(); };
    const confirm = el('button', 'btn raise');
    confirm.append(a.h.curBet > 0 ? '레이즈' : '벳', el('small', null, fmt(ui.raiseTo)));
    confirm.onclick = () => doAct('raise', ui.raiseTo);
    row.append(cancel, confirm);
    wrap.append(top, presets, sr, row);
    return wrap;
  }

  /* ---------------- modals & sheets ---------------- */
  function openModal(kind, arg) { ui.modal = { kind, arg }; renderModal(); }
  function closeModal() { ui.modal = null; $('#modalBack').hidden = true; }
  function renderModal() {
    const back = $('#modalBack'), m = $('#modal');
    m.textContent = '';
    if (!ui.modal) { back.hidden = true; return; }
    back.hidden = false;
    const { kind, arg } = ui.modal;
    if (kind === 'join') {
      m.append(el('h2', null, `${arg + 1}번 자리에 앉기`));
      m.append(el('p', null, `칩 ${fmt(V() ? V().settings.stack : 1000)}개로 시작해요. 친구들이 알아볼 닉네임을 정해 주세요.`));
      const inp = el('input'); inp.id = 'nameInput'; inp.maxLength = 12; inp.placeholder = '닉네임'; inp.autocomplete = 'nickname';
      inp.value = LS.get('pk_name') || cleanName((profileName || '').split(' ')[0]);
      inp.onkeydown = e => { if (e.key === 'Enter') joinAt(arg); };
      const row = el('div', 'row');
      const c = el('button', 'btn ghost', '취소'); c.onclick = closeModal;
      const ok = el('button', 'btn primary', '앉기'); ok.onclick = () => joinAt(arg);
      row.append(c, ok);
      m.append(inp, row);
      setTimeout(() => inp.focus(), 50);
    } else if (kind === 'confirm') {
      m.append(el('h2', null, arg.title), el('p', null, arg.body));
      const row = el('div', 'row');
      const c = el('button', 'btn ghost', '취소'); c.onclick = closeModal;
      const ok = el('button', 'btn primary', arg.ok); ok.onclick = () => { closeModal(); arg.fn(); };
      row.append(c, ok); m.append(row);
    } else if (kind === 'react') {
      m.append(el('h2', null, '리액션'));
      const g = el('div', 'reacts');
      REACTS.forEach((t, k) => { const b = el('button', null, t); b.onclick = () => sendReact(k); g.append(b); });
      const c = el('button', 'btn ghost', '닫기'); c.onclick = closeModal;
      m.append(g, c);
    } else if (kind === 'invite') {
      m.append(el('h2', null, '친구 초대하기'), el('p', null, '이 링크를 보내면 친구가 로그인 없이 바로 같은 테이블에 들어와요.'), inviteBlock());
      const c = el('button', 'btn ghost', '닫기'); c.onclick = closeModal;
      m.append(c);
    } else if (kind === 'seat') {
      const v = V(), st = v && v.seats[arg];
      if (!st) { closeModal(); return; }
      m.append(el('h2', null, st.name), el('p', null, `칩 ${fmt(st.stack)} · ${st.bot ? '봇' : (online.uids.has(st.uid) ? '접속 중' : '접속 안 함')}`));
      const row = el('div', 'row');
      const o = el('button', 'btn', st.out ? '복귀시키기' : '자리 비움 처리');
      o.onclick = () => { closeModal(); host.setOut(arg, !st.out); };
      const k = el('button', 'btn fold', '내보내기');
      k.onclick = () => { closeModal(); host.kick(arg); };
      row.append(o, k);
      const c = el('button', 'btn ghost', '닫기'); c.onclick = closeModal;
      m.append(row, c);
    }
  }
  function openJoin(i) { openModal('join', i); }
  function openSeatMenu(i) { openModal('seat', i); }
  function confirmTakeOver() {
    openModal('confirm', {
      title: '딜러 맡기',
      body: '카드를 섞고 돌리는 역할을 이 기기가 맡아요. 진행 중인 핸드가 있으면 무효가 되고 걸었던 칩은 돌아가요.',
      ok: '딜러 맡기', fn: takeOver,
    });
  }

  function openSheet(kind) { ui.sheet = kind || 'menu'; $('#sheetBack').hidden = false; renderSheet(); }
  function closeSheet() { ui.sheet = null; $('#sheetBack').hidden = true; }

  function section(title) { return el('h3', null, title); }

  function renderSheet() {
    const sh = $('#sheet');
    const keepScroll = sh.scrollTop;
    sh.textContent = '';
    sh.append(el('div', 'grab'));
    const v = V(), me = mySeat(), st = me >= 0 && v ? v.seats[me] : null;
    sh.append(el('h2', null, '테이블 메뉴'));
    if (v) {
      const p = el('p');
      const hostSeat = v.seats.find(s => s && s.uid === v.hostId);
      p.textContent = `블라인드 ${fmt(v.settings.sb)}/${fmt(v.settings.bb)} · 시작 칩 ${fmt(v.settings.stack)} · 제한 시간 ${v.settings.timer ? v.settings.timer + '초' : '없음'} · 딜러 ${amHost ? '나' : (hostSeat ? hostSeat.name : '관전자')}`;
      sh.append(p);
    }

    if (st) {
      sh.append(section('내 자리'));
      const row = el('div', 'row');
      const o = el('button', 'btn', st.out ? '복귀하기' : '자리 비우기');
      o.onclick = () => { send(st.out ? 'back' : 'out'); closeSheet(); };
      const rb = el('button', 'btn', `리바이 +${fmt(v.settings.stack)}`);
      rb.disabled = st.stack > 0;
      rb.onclick = () => { send('rebuy'); closeSheet(); };
      const lv = el('button', 'btn fold', '자리에서 일어나기');
      lv.onclick = () => { closeSheet(); openModal('confirm', { title: '자리에서 일어날까요?', body: '남은 칩은 사라지고, 진행 중인 핸드는 폴드돼요.', ok: '일어나기', fn: () => send('leave') }); };
      row.append(o, rb, lv);
      sh.append(row);
      const nr = el('div', 'row');
      const ni = el('input'); ni.id = 'renameInput'; ni.maxLength = 12; ni.value = st.name; ni.setAttribute('aria-label', '닉네임');
      ni.style.cssText = 'flex:2 1 160px;height:44px;border-radius:10px;border:1px solid var(--line);background:var(--panel-2);color:var(--text);padding:0 12px;font-size:15px;font-family:inherit';
      const nb = el('button', 'btn', '닉네임 바꾸기');
      nb.onclick = () => { const n = cleanName(ni.value); if (n) { LS.set('pk_name', n); send('name', { name: n }); toast('닉네임을 바꿨어요'); } };
      nr.style.marginTop = '8px';
      nr.append(ni, nb);
      sh.append(nr);
    }

    if (amHost && v) {
      sh.append(section('딜러(방장) 설정'));
      const f = el('div', 'form');
      const field = (id, label, val, attrs) => {
        const w = el('label', 'field'); w.htmlFor = id;
        w.append(label);
        const i = el('input'); i.id = id; i.type = 'number'; i.inputMode = 'numeric'; i.value = val; Object.assign(i, attrs || {});
        w.append(i); return w;
      };
      f.append(field('setSb', '스몰 블라인드', v.settings.sb, { min: 1 }), field('setBb', '빅 블라인드', v.settings.bb, { min: 2 }), field('setStack', '시작 칩', v.settings.stack, { min: 100, step: 100 }));
      const tw = el('label', 'field'); tw.htmlFor = 'setTimer'; tw.append('제한 시간');
      const sel = el('select'); sel.id = 'setTimer';
      [[0, '없음'], [15, '15초'], [30, '30초'], [45, '45초'], [60, '60초']].forEach(([x, t]) => { const o = el('option', null, t); o.value = x; if (v.settings.timer === x) o.selected = true; sel.append(o); });
      tw.append(sel); f.append(tw);
      sh.append(f);
      sh.append(el('p', null, '바뀐 블라인드는 다음 핸드부터 적용돼요. 시작 칩은 새로 앉거나 리바이할 때 적용돼요.'));
      const row = el('div', 'row');
      const save = el('button', 'btn primary', '설정 저장');
      save.onclick = () => {
        const sb = Math.max(1, Math.floor(Number($('#setSb').value) || 1));
        const bb = Math.max(sb, Math.floor(Number($('#setBb').value) || sb * 2));
        const stack = Math.max(bb * 10, Math.floor(Number($('#setStack').value) || 1000));
        host.settings({ sb, bb, stack, timer: Number($('#setTimer').value) || 0 });
        toast('설정을 저장했어요');
      };
      const ps = el('button', 'btn', !v.started ? '게임 시작' : (v.paused ? '다시 시작' : '일시정지'));
      ps.onclick = () => { if (!v.started) host.start(); else host.pause(!v.paused); closeSheet(); };
      const bot = el('button', 'btn', '봇 추가');
      bot.disabled = v.seats.every(Boolean);
      bot.onclick = () => host.addBot();
      const rs = el('button', 'btn fold', '칩 전체 초기화');
      rs.onclick = () => openModal('confirm', { title: '칩을 초기화할까요?', body: `모든 플레이어의 칩이 ${fmt(v.settings.stack)}으로 돌아가고 기록이 0이 돼요.`, ok: '초기화', fn: host.reset });
      row.append(save, ps, bot, rs);
      sh.append(row);
      sh.append(el('p', null, '다른 플레이어 자리를 누르면 자리 비움 처리나 내보내기를 할 수 있어요.'));
    } else if (v && st && canWrite !== false) {
      sh.append(section('딜러'));
      sh.append(el('p', null, hostOnline(v) ? '지금 딜러가 접속해 있어요. 딜러가 나가면 남은 사람 중 한 명이 자동으로 이어받아요.' : '딜러가 접속해 있지 않아요. 이 기기가 딜러를 맡을 수 있어요.'));
      const b = el('button', 'btn', '내가 딜러 맡기'); b.onclick = () => { closeSheet(); confirmTakeOver(); };
      const row = el('div', 'row'); row.append(b); sh.append(row);
    }

    if (HOSTED) {
      sh.append(section('친구 초대하기'));
      sh.append(el('p', null, '아래 링크를 카톡 등으로 보내면 친구가 로그인 없이 바로 같은 테이블에 앉을 수 있어요.'));
      sh.append(inviteBlock());
      sh.append(section('다른 테이블'));
      sh.append(el('p', null, '방 코드가 다르면 완전히 다른 테이블이에요. 친구가 보낸 방 코드를 넣거나 새 테이블을 열 수 있어요.'));
      const jr = el('div', 'row');
      const ci = el('input', 'code-input'); ci.id = 'roomInput'; ci.maxLength = 12; ci.placeholder = '방 코드'; ci.autocapitalize = 'characters'; ci.setAttribute('aria-label', '방 코드');
      ci.onkeydown = e => { if (e.key === 'Enter') gotoRoom(ci.value); };
      const go = el('button', 'btn', '이동'); go.onclick = () => gotoRoom(ci.value);
      const nw = el('button', 'btn', '새 테이블 만들기'); nw.onclick = () => gotoRoom(newRoomCode());
      jr.append(ci, go, nw);
      sh.append(jr);
    }
    if (v) {
      sh.append(section('점수판'));
      const list = el('div', 'list');
      const rows = v.seats.map((s, i) => s && { s, i, net: s.stack + (E.handActive(v) && v.hand.ps[i] ? v.hand.ps[i].total : 0) - s.buyin }).filter(Boolean).sort((a, b) => b.net - a.net);
      if (!rows.length) list.append(el('div', null, '아직 앉은 사람이 없어요'));
      rows.forEach(r => {
        const d = el('div');
        d.append(el('span', 'grow', r.s.name + (r.i === me ? ' (나)' : '')), el('span', 'num', fmt(r.s.stack)), el('span', 'num ' + (r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : ''), (r.net > 0 ? '+' : '') + fmt(r.net)));
        list.append(d);
      });
      sh.append(list);
      sh.append(section('최근 기록'));
      const log = el('div', 'log');
      (v.log || []).slice().reverse().forEach(t => log.append(el('div', null, t)));
      if (!(v.log || []).length) log.append(el('div', null, '아직 기록이 없어요'));
      sh.append(log);
    }

    sh.append(section('족보 (높은 순)'));
    const ranks = el('div', 'list ranks');
    [
      ['로열 플러시', 'As Ks Qs Js Ts', '같은 무늬 A-K-Q-J-10'],
      ['스트레이트 플러시', '9h 8h 7h 6h 5h', '같은 무늬 연속 5장'],
      ['포카드', 'Qc Qd Qh Qs 7d', '같은 숫자 4장'],
      ['풀하우스', 'Kd Kh Ks 4c 4h', '트리플 + 원페어'],
      ['플러시', 'Ad Jd 8d 6d 2d', '같은 무늬 5장'],
      ['스트레이트', 'Tc 9d 8s 7h 6c', '연속 숫자 5장 (A-2-3-4-5도 가능)'],
      ['트리플', '7s 7h 7d Kc 2s', '같은 숫자 3장'],
      ['투페어', 'Jh Js 5c 5d Ah', '페어 2개'],
      ['원페어', 'Th Tc 9s 4d 2c', '같은 숫자 2장'],
      ['하이카드', 'Ac Qd 9h 6s 3c', '아무것도 없을 때 가장 높은 카드'],
    ].forEach(([n, cs, d]) => {
      const row = el('div');
      const c = el('div', 'cards'); cs.split(' ').forEach(x => c.append(cardEl(x)));
      const t = el('div', 'grow'); t.append(el('b', null, n)); t.append(el('br')); const sm = el('span', null, d); sm.style.color = 'var(--muted)'; sm.style.fontSize = '12px'; t.append(sm);
      t.style.whiteSpace = 'normal';
      row.append(t, c); ranks.append(row);
    });
    sh.append(ranks);

    sh.append(el('p', null, '카드는 딜러(처음 앉은 사람) 기기에서 섞고, 각자 패는 본인 기기에서만 열리도록 암호화해서 보내요.'));
    const close = el('button', 'btn ghost', '닫기');
    close.style.width = '100%'; close.style.marginTop = '14px';
    close.onclick = closeSheet;
    sh.append(close);
    sh.scrollTop = keepScroll;
  }

  /* ---------------- invite / room switching ---------------- */
  function inviteUrl() { return location.origin + location.pathname + '#' + ROOM; }
  function inviteBtn() {
    const b = el('button', 'btn', '친구 초대');
    b.onclick = () => openModal('invite');
    return b;
  }
  function inviteBlock() {
    const box = el('div', 'invite');
    const code = el('div', 'code');
    code.append(el('small', null, '방 코드'), el('b', null, ROOM));
    const link = el('input', 'invite-link'); link.readOnly = true; link.value = inviteUrl(); link.setAttribute('aria-label', '초대 링크');
    link.onfocus = () => link.select();
    const row = el('div', 'row');
    const cp = el('button', 'btn primary', '링크 복사'); cp.onclick = () => copyLink(link);
    row.append(cp);
    if (navigator.share) {
      const sh = el('button', 'btn', '공유하기');
      sh.onclick = () => navigator.share({ title: 'HO’s Casino', text: `HO’s Casino 홀덤 한 판! 방 코드 ${ROOM}`, url: inviteUrl() }).catch(() => {});
      row.append(sh);
    }
    box.append(code, link, row);
    return box;
  }
  async function copyLink(input) {
    try { await navigator.clipboard.writeText(inviteUrl()); toast('초대 링크를 복사했어요'); return; } catch (e) { /* fallback */ }
    try { input.focus(); input.select(); if (document.execCommand('copy')) { toast('초대 링크를 복사했어요'); return; } } catch (e) { /* fallback */ }
    toast('링크를 길게 눌러 복사해 주세요');
  }
  function gotoRoom(v) {
    const c = normRoom(v);
    if (!c) { toast('방 코드는 영문·숫자 4~12자예요'); return; }
    if (c === ROOM) { closeSheet(); toast('지금 있는 테이블이에요'); return; }
    LS.set('pk_room', c);
    location.hash = c; // hashchange → reload into the other table
  }

  /* ---------------- misc ---------------- */
  function toast(t) {
    const x = $('#toast');
    x.textContent = t; x.hidden = false;
    clearTimeout(ui.toastT);
    ui.toastT = setTimeout(() => { x.hidden = true; }, 2800);
  }

  function buildFeltTexture() {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 160;
      const g = c.getContext('2d');
      const img = g.createImageData(160, 160);
      for (let k = 0; k < img.data.length; k += 4) {
        const n = Math.random() * 255;
        img.data[k] = img.data[k + 1] = img.data[k + 2] = n;
        img.data[k + 3] = 14;
      }
      g.putImageData(img, 0, 0);
      $('#felt').style.setProperty('--noise', `url(${c.toDataURL()})`);
    } catch (e) { /* plain felt */ }
  }

  function wire() {
    $('#menuBtn').onclick = () => openSheet('menu');
    $('#sheetBack').addEventListener('click', e => { if (e.target.id === 'sheetBack') closeSheet(); });
    $('#modalBack').addEventListener('click', e => { if (e.target.id === 'modalBack') closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeSheet(); } });
    if (HOSTED) window.addEventListener('hashchange', () => { const c = hashRoom(); if (c && c !== ROOM) location.reload(); });
  }

  wire();
  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) { try { hot.snapshot(() => ({ ctx: amHost && ctx ? clone(ctx) : null })); } catch (e) { /* ignore */ } }
  if (hot && hot.ready) hot.ready(boot); else boot((hot && hot.data) || {});
})();

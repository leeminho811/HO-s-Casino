/* Firebase backend: gives app.js the same {db, user, room} shape the claude.ai runtime had
 * (see test/mock.js), built on Firebase Anonymous Auth + Realtime Database only.
 *
 * Layout in the Realtime Database (one room = one table, room code comes from the URL hash):
 *   rooms/<CODE>/table          {j: JSON, t}   table state, written only by the dealer device
 *   rooms/<CODE>/req/<uid>      {j: JSON, t}   each player's latest request to the dealer
 *   rooms/<CODE>/presence/<tab> {by, p, t}     who is online (removed by onDisconnect)
 *   rooms/<CODE>/events/<push>  {topic, by, peer, j, t}   short-lived reactions
 * Documents are stored as JSON strings so arrays, nulls and empty objects survive unchanged
 * (the Realtime Database drops nulls / empty arrays and turns arrays into objects).
 */
(function () {
  'use strict';
  const VERSION = '12.19.0';
  const SDK = 'https://www.gstatic.com/firebasejs/' + VERSION + '/';
  const MAX_DOC = 256 * 1024;

  function cfg() { return window.FIREBASE_CONFIG || null; }
  function configured() {
    const c = cfg();
    return !!(c && typeof c.apiKey === 'string' && c.apiKey && !/여기|YOUR|PASTE/i.test(c.apiKey) && c.databaseURL);
  }

  function fail(code, message) { const e = new Error(message || code); e.code = code; return e; }
  function norm(e) {
    const raw = String((e && (e.code || e.message)) || e || '');
    if (/permission[_-]?denied/i.test(raw)) return fail('permission_denied', e && e.message);
    if (/operation-not-allowed|admin-restricted/i.test(raw)) return fail('auth_disabled', e && e.message);
    if (/network|unavailable|offline/i.test(raw)) return fail('network', e && e.message);
    return fail((e && e.code) || 'unknown', e && e.message);
  }
  function parse(s) { try { return JSON.parse(s); } catch (e) { return undefined; } }

  async function connect(room) {
    const c = cfg();
    let appM, authM, dbM;
    try {
      [appM, authM, dbM] = await Promise.all([
        import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-database.js'),
      ]);
    } catch (e) { throw fail('sdk', '서버 프로그램을 불러오지 못했어요'); }

    const app = appM.initializeApp(c);
    const auth = authM.getAuth(app);
    const rdb = dbM.getDatabase(app);
    if (c.emulator) { // local testing only (see test/e2e-firebase.mjs)
      authM.connectAuthEmulator(auth, c.emulator.auth, { disableWarnings: true });
      dbM.connectDatabaseEmulator(rdb, c.emulator.dbHost, c.emulator.dbPort);
    }
    const { ref, set, get, remove, onValue, onChildAdded, onDisconnect, push, query, limitToLast, serverTimestamp } = dbM;

    try {
      await auth.authStateReady();
      if (!auth.currentUser) await authM.signInAnonymously(auth);
    } catch (e) { throw norm(e); }
    const uid = auth.currentUser.uid;

    // app paths: tables/<room>[/req[/<uid>]]  →  rooms/<room>/table | rooms/<room>/req[/<uid>]
    function tr(path) {
      const s = String(path).split('/');
      if (s[0] !== 'tables' || !s[1]) throw fail('invalid_argument', 'bad path ' + path);
      return ['rooms', s[1]].concat(s.length === 2 ? ['table'] : s.slice(2)).join('/');
    }
    const META = Object.freeze({ fromCache: false, hasPendingWrites: false });
    function docSnap(id, val) {
      const d = val && typeof val.j === 'string' ? parse(val.j) : undefined;
      return { id, exists: d !== undefined && d !== null, data: () => d, metadata: META };
    }

    const db = {
      doc(path) {
        const r = ref(rdb, tr(path));
        const id = String(path).split('/').pop();
        return {
          path, id,
          async get() { try { return docSnap(id, (await get(r)).val()); } catch (e) { throw norm(e); } },
          async set(data) {
            const j = JSON.stringify(data);
            if (j.length > MAX_DOC) throw fail('invalid_argument', 'too big');
            try { await set(r, { j, t: serverTimestamp() }); } catch (e) { throw norm(e); }
          },
          async update(data) { const cur = (await this.get()).data() || {}; await this.set(Object.assign({}, cur, data)); },
          async delete() { try { await remove(r); } catch (e) { throw norm(e); } },
          onSnapshot(next, error) {
            return onValue(r, s => next(docSnap(id, s.val())), e => { if (error) error(norm(e)); });
          },
        };
      },
      collection(path) {
        const r = ref(rdb, tr(path));
        return {
          path,
          doc: id => db.doc(path + '/' + id),
          onSnapshot(next, error) {
            return onValue(r, s => {
              const docs = [];
              s.forEach(ch => { const d = docSnap(ch.key, ch.val()); if (d.exists) docs.push(d); });
              next({ docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: META });
            }, e => { if (error) error(norm(e)); });
          },
        };
      },
    };

    const user = {
      id: async () => uid,
      me: async () => ({ id: uid, name: '' }),
      can: async () => true,
      isOwner: async () => false,
      canEdit: async () => true,
    };

    // ---- presence + reactions ----
    const base = 'rooms/' + room;
    let tab = null, mine = {}, connected = false, offset = 0, myRef = null;
    const serverNow = () => Date.now() + offset;
    onValue(ref(rdb, '.info/serverTimeOffset'), s => { offset = Number(s.val()) || 0; });
    async function announce() {
      if (!myRef || !connected) return;
      try {
        await onDisconnect(myRef).remove();
        await set(myRef, { by: uid, p: JSON.stringify(mine), t: serverTimestamp() });
      } catch (e) { console.warn('presence', e); }
    }
    onValue(ref(rdb, '.info/connected'), s => { connected = s.val() === true; if (connected) announce(); });

    const roomApi = {
      connected: () => connected,
      async presence(patch) {
        mine = Object.assign({}, mine, patch);
        const t = typeof mine.tab === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(mine.tab) ? mine.tab : (tab || 'p' + Math.random().toString(36).slice(2, 10));
        if (t !== tab) { if (myRef) { onDisconnect(myRef).cancel().catch(() => {}); remove(myRef).catch(() => {}); } tab = t; myRef = ref(rdb, base + '/presence/' + tab); }
        await announce();
      },
      onPeers(fn, error) {
        return onValue(ref(rdb, base + '/presence'), s => {
          const peers = [];
          s.forEach(ch => {
            const v = ch.val() || {};
            peers.push({ peer: ch.key, by: v.by, kind: 'viewer', guest: false, presence: parse(v.p) || {}, updatedAt: v.t, isMe: v.by === uid, sameTab: ch.key === tab });
          });
          fn({ peers, joined: [], left: [], updated: [] });
        }, e => { if (error) error(norm(e)); });
      },
      on(topic, fn, error) {
        return onChildAdded(query(ref(rdb, base + '/events'), limitToLast(12)), ch => {
          const v = ch.val() || {};
          if (v.topic !== topic || typeof v.t !== 'number' || serverNow() - v.t > 6000) return;
          fn({ topic, data: parse(v.j), by: v.by, peer: v.peer, isMe: v.by === uid, sameTab: v.peer === tab, kind: 'viewer', guest: false });
        }, e => { if (error) error(norm(e)); });
      },
      async emit(topic, data) {
        const r = push(ref(rdb, base + '/events'));
        try {
          onDisconnect(r).remove().catch(() => {});
          await set(r, { topic: String(topic), by: uid, peer: tab || '', j: JSON.stringify(data), t: serverTimestamp() });
        } catch (e) { throw norm(e); }
        setTimeout(() => { remove(r).catch(() => {}); }, 8000);
      },
      leave() { if (myRef) remove(myRef).catch(() => {}); },
    };

    return { use: async n => (n === 'db' ? db : n === 'user' ? user : n === 'room' ? roomApi : null) };
  }

  window.HOBackend = { configured, connect, VERSION };
})();

/* 술래잡기 (tag): a real-time chase on a small map, for the room kit.
 *
 * Movement is continuous, so it does not go through the room state:
 *  - each device moves its own runner and publishes {x, y, vx, vy} in its presence record (~10×/s);
 *    the host device also moves the bots and publishes theirs in the same record;
 *  - other devices draw those runners slightly extrapolated and smoothed.
 * The room state (written only by the host, as in every kit game) holds the discrete facts:
 * phase, who is "it", who is frozen (얼음땡), the clock, spawn points and the score.
 * A tag is noticed by the chaser's own device (sent as a request; the host accepts it when the two are
 * within reach in its own view, with some slack for lag) and by the host device itself (bots, fallback). */
(function (root) {
  'use strict';
  const W = 1200, H = 1200, R = 20, REACH = 2 * R;
  const SPEED = 230, IT_SPEED = 262, DASH = 2.3, DASH_MS = 260, DASH_CD = 3500;
  const COUNT_MS = 3000, STUN_MS = 1500, SLACK = 80, OVER_MS = 9000, GONE_MS = 3000;
  const MODES = { tag: '기본 술래잡기', ice: '얼음땡' };
  const DURS = [30, 60, 90, 120];
  const COLORS = ['#f2c14e', '#6fd3a8', '#f08a6c', '#8fb0ff', '#e49ae6', '#c6d86a', '#ffb877', '#7fd8e0'];
  const SPAWNS = [[110, 110], [1090, 110], [110, 1090], [1090, 1090], [600, 90], [600, 1110], [90, 600], [1110, 600]];
  // r: walls / blocks [x, y, w, h, colour] · c: round obstacles [x, y, radius, kind] · d: decoration only
  const MAPS = [
    { name: '공원', ground: ['#1d3b2e', '#1a3529'], fence: '#5b3a24', it: [600, 420], sp: SPAWNS,
      r: [[380, 380, 120, 28], [380, 380, 28, 120], [700, 380, 120, 28], [792, 380, 28, 120],
        [380, 792, 120, 28], [380, 700, 28, 120], [700, 792, 120, 28], [792, 700, 28, 120]].map(a => a.concat('#2f6a43')),
      c: [[600, 600, 85, 'f'], [250, 250, 40, 't'], [950, 250, 40, 't'], [250, 950, 40, 't'], [950, 950, 40, 't'],
        [600, 240, 30, 't'], [600, 960, 30, 't'], [240, 600, 30, 't'], [960, 600, 30, 't']],
      d: [['ring', 600, 600, 300, 46, 'rgba(214, 196, 150, 0.09)']] },
    { name: '골목', ground: ['#262b30', '#23282c'], fence: '#4a4f55', it: [430, 600], sp: SPAWNS,
      r: [[170, 170, 250, 150, '#5a4636'], [780, 170, 250, 150, '#4b4a5e'], [170, 880, 250, 150, '#4b4a5e'], [780, 880, 250, 150, '#5a4636'],
        [500, 500, 200, 200, '#61503a'], [170, 470, 40, 260, '#3e4349'], [990, 470, 40, 260, '#3e4349'],
        [500, 200, 200, 30, '#3e4349'], [500, 970, 200, 30, '#3e4349']],
      c: [[330, 600, 26, 'p'], [870, 600, 26, 'p'], [600, 380, 22, 'p'], [600, 820, 22, 'p']],
      d: [['dash', 600, 0, 600, 1200], ['dash', 0, 600, 1200, 600]] },
    { name: '놀이터', ground: ['#3a3325', '#352f21'], fence: '#6a4329', it: [600, 440], sp: SPAWNS,
      r: [[250, 260, 70, 180, '#a3443a'], [520, 520, 160, 160, '#2f5c99'], [780, 840, 220, 30, '#a8822f'], [760, 250, 240, 24, '#6b4a2e']],
      c: [[180, 800, 34, 't'], [1020, 560, 34, 't'], [600, 200, 30, 't'], [560, 1000, 30, 't']],
      d: [['sand', 330, 900, 105], ['sand', 880, 540, 85]] },
  ];

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const sec = ms => (Math.round(ms / 100) / 10).toFixed(1) + '초';
  const mapOf = G => MAPS[G.map] || MAPS[0];

  // push a runner (circle of radius R at p) out of walls, round obstacles and the fence
  function push(m, p) {
    for (let k = 0; k < 2; k++) {
      for (const [cx, cy, cr] of m.c) {
        const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy), need = cr + R;
        if (d >= need) continue;
        if (d < 0.01) p.x = cx + need; else { p.x = cx + dx / d * need; p.y = cy + dy / d * need; }
      }
      for (const [x, y, w, h] of m.r) {
        const nx = clamp(p.x, x, x + w), ny = clamp(p.y, y, y + h), dx = p.x - nx, dy = p.y - ny, d = Math.hypot(dx, dy);
        if (d >= R) continue;
        if (d < 0.01) {
          const l = p.x - x, rr = x + w - p.x, t = p.y - y, b = y + h - p.y, mn = Math.min(l, rr, t, b);
          if (mn === l) p.x = x - R; else if (mn === rr) p.x = x + w + R; else if (mn === t) p.y = y - R; else p.y = y + h + R;
        } else { p.x = nx + dx / d * R; p.y = ny + dy / d * R; }
      }
      p.x = clamp(p.x, R, W - R); p.y = clamp(p.y, R, H - R);
    }
    return p;
  }
  // move in small steps so nothing tunnels through a thin wall
  function move(m, p, dx, dy) {
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 8));
    for (let k = 0; k < n; k++) { p.x += dx / n; p.y += dy / n; push(m, p); }
    return p;
  }
  function free(m, x, y) { const p = push(m, { x, y }); return Math.abs(p.x - x) < 0.5 && Math.abs(p.y - y) < 0.5; }
  function randomFree(m, rnd) {
    for (let k = 0; k < 60; k++) { const x = 60 + rnd() * (W - 120), y = 60 + rnd() * (H - 120); if (free(m, x, y)) return { x, y }; }
    return { x: SPAWNS[0][0], y: SPAWNS[0][1] };
  }

  /* ---------- rules (host side) ---------- */
  // where(i) → {x, y} of seat i as this device sees it now; set by the live part below (and by tests)
  let where = () => null;
  const goneAt = {};
  const parts = G => Object.keys(G.pl).map(Number);
  const playing = G => G.phase === 'count' || G.phase === 'play';
  function live(a, i) {
    const st = a.S.seats[i];
    if (!st) return false;
    if (st.bot || a.online(st.uid)) return true;
    return !goneAt[i] || a.now - goneAt[i] <= GONE_MS;
  }
  function canMove(G, i, now) {
    if (!playing(G)) return true;
    if (!G.pl[i]) return false;
    if (i === G.it && (G.phase === 'count' || now < G.stun)) return false;
    return G.ice[i] == null;
  }
  const taggable = (a, s) => a.G.phase === 'play' && !!a.G.pl[s] && s !== a.G.it && !(a.G.safe[s] > a.now) && a.G.ice[s] == null && live(a, s);
  function near(i, j, d) { const p = where(i), q = where(j); return !!p && !!q && dist(p, q) <= d; }
  function ev(G, k, x, y) { G.ev = { n: (G.ev ? G.ev.n : 0) + 1, k, a: x, b: y }; }
  function handOver(a, from, to, kind) {
    const { G, now } = a;
    if (from >= 0) G.ms[from] = (G.ms[from] || 0) + Math.max(0, now - G.since);
    G.it = to; G.since = now; G.stun = now + STUN_MS; G.safe = {};
    if (from >= 0 && from !== to) G.safe[from] = now + STUN_MS + 1200;
    delete G.ice[to];
    ev(G, kind, to, from);
  }
  function doTag(a, i, s) {
    a.G.tags[i] = (a.G.tags[i] || 0) + 1;
    const st = a.S.seats[i]; if (st) st.c = (st.c || 0) + 1;
    handOver(a, i, s, 'tag');
  }
  // 얼음땡: when every runner is frozen, the one who froze last becomes "it" and everyone thaws
  function allIce(a) {
    const { G } = a;
    if (G.opt.mode !== 'ice' || G.phase !== 'play') return false;
    const rs = parts(G).filter(i => i !== G.it && live(a, i));
    if (!rs.length || !rs.every(i => G.ice[i] != null)) return false;
    const last = rs.reduce((x, i) => (G.ice[i] > G.ice[x] ? i : x), rs[0]);
    G.tags[G.it] = (G.tags[G.it] || 0) + 1;
    G.ice = {};
    handOver(a, G.it, last, 'all');
    return true;
  }
  function startRound(a) {
    const { S, G, now, rint } = a;
    const ids = S.seats.map((st, i) => (st && (st.bot || a.online(st.uid)) ? i : -1)).filter(i => i >= 0);
    if (ids.length < 2) return false;
    G.rd++;
    G.map = (G.map + 1 + rint(MAPS.length - 1)) % MAPS.length;
    G.pl = {}; ids.forEach(i => { G.pl[i] = 1; });
    G.it = ids[rint(ids.length)];
    G.ms = {}; G.tags = {}; G.ice = {}; G.safe = {}; G.res = null; G.stun = 0; G.since = 0;
    const m = MAPS[G.map], pts = m.sp.slice();
    for (let k = pts.length - 1; k > 0; k--) { const j = rint(k + 1); const x = pts[k]; pts[k] = pts[j]; pts[j] = x; }
    G.sp = {}; G.sp[G.it] = m.it.slice();
    ids.filter(i => i !== G.it).forEach((i, k) => { G.sp[i] = pts[k % pts.length].slice(); });
    G.phase = 'count'; G.end = now + COUNT_MS;
    ev(G, 'start', G.it, -1);
    a.log(`술래잡기 #${G.rd} · ${MODES[G.opt.mode]} · ${m.name} · 술래 ${S.seats[G.it].name}`);
    for (const k of Object.keys(goneAt)) delete goneAt[k];
    return true;
  }
  function finish(a) {
    const { S, G, now } = a;
    if (G.phase === 'play' && G.it >= 0) G.ms[G.it] = (G.ms[G.it] || 0) + Math.max(0, now - G.since);
    const res = parts(G).filter(i => S.seats[i])
      .map(i => ({ s: i, n: S.seats[i].name, ms: Math.round(G.ms[i] || 0), c: G.tags[i] || 0 }))
      .sort((x, y) => x.ms - y.ms || y.c - x.c);
    if (res.length) {
      res.forEach(r => { r.win = r.ms === res[0].ms; if (r.win) S.seats[r.s].w = (S.seats[r.s].w || 0) + 1; });
      const lastR = res[res.length - 1];
      a.log(`술래잡기 #${G.rd} 끝 · 1등 ${res.filter(r => r.win).map(r => r.n).join(', ')} (술래 ${sec(res[0].ms)})` +
        (res.length > 1 && !lastR.win ? ` · 꼴찌 ${lastR.n} (${sec(lastR.ms)})` : ''));
    }
    G.res = res; G.phase = 'over'; G.end = now + OVER_MS; G.ice = {}; G.safe = {}; G.stun = 0;
  }
  // participants whose device went away: pass "it" on, end the round when fewer than two are left
  function watchGone(a) {
    const { G, now, rint } = a;
    for (const i of parts(G)) {
      const st = a.S.seats[i];
      if (!st || st.bot || a.online(st.uid)) delete goneAt[i]; else if (!goneAt[i]) goneAt[i] = now;
    }
    const ok = parts(G).filter(i => live(a, i));
    if (ok.length < 2) { a.log('사람이 모자라 판을 끝냈어요'); finish(a); return; }
    if (!ok.includes(G.it)) {
      const pool = ok.filter(i => G.ice[i] == null), pick = (pool.length ? pool : ok)[rint((pool.length ? pool : ok).length)];
      handOver(a, G.it, pick, 'pass');
    }
    allIce(a);
  }

  /* ---------- live part (browser only) ---------- */
  let cur = null, ui = null, loopOn = false, lastT = 0, lastHud = 0, lastEv = -1, seq = 0, lastPub = 0, inflight = 0, lastSent = '';
  const me = { x: 0, y: 0, vx: 0, vy: 0, fx: 0, fy: 1, set: false, rd: -1, dashUntil: 0, dashReady: 0 };
  const rp = {};     // uid → latest published sample {x, y, vx, vy, at}
  const disp = {};   // uid → smoothed drawing position
  const bots = {};   // seat → bot runner (host device only)
  const peerSeq = {}, asked = {};
  const input = { kx: 0, ky: 0, jx: 0, jy: 0, jid: null, ox: 0, oy: 0, px: 0, py: 0, dash: false, keys: {} };
  const fxs = [];
  const cam = { x: W / 2, y: H / 2, s: 0 };
  const coarse = () => !!(root.matchMedia && root.matchMedia('(pointer: coarse)').matches);

  function predict(s, t, m) {
    const dt = Math.min(Math.max(0, t - s.at) / 1000, 0.12);
    const p = push(m, { x: s.x + s.vx * dt, y: s.y + s.vy * dt });
    p.vx = s.vx; p.vy = s.vy;
    return p;
  }
  function seatPos(i, t) {
    const v = cur, st = v && v.S.seats[i];
    if (!st) return null;
    if (st.uid === v.uid) return me.set ? me : null;
    if (st.bot && v.isHost()) return bots[i] && bots[i].set ? bots[i] : null;
    const s = rp[st.uid];
    return s ? predict(s, t, mapOf(v.G)) : null;
  }
  where = i => seatPos(i, performance.now());
  // what this screen shows for seat i (smoothed) — used for the chaser's own touch check
  function shownPos(i) {
    const v = cur, st = v.S.seats[i];
    if (!st) return null;
    if (st.uid === v.uid) return me.set ? me : null;
    if (st.bot && v.isHost()) return bots[i] && bots[i].set ? bots[i] : null;
    return disp[st.uid] || null;
  }

  function sample(uid, a, t) {
    if (!Array.isArray(a) || a.length < 4 || !a.every(Number.isFinite)) return;
    rp[uid] = { x: clamp(a[0], 0, W), y: clamp(a[1], 0, H), vx: clamp(a[2], -800, 800), vy: clamp(a[3], -800, 800), at: t };
  }
  function onPeers(peers) {
    const t = performance.now(), S = cur && cur.S;
    for (const p of peers) {
      const pr = p.presence || {}, g = pr.g;
      if (!g || typeof g !== 'object' || p.sameTab || peerSeq[p.peer] === g.s) continue;
      peerSeq[p.peer] = g.s;
      if (g.p && pr.uid && (!cur || pr.uid !== cur.uid)) sample(pr.uid, g.p, t);
      if (g.b && S && pr.tab === S.hostTab && !(cur && cur.isHost())) {
        for (const k of Object.keys(g.b)) { const st = S.seats[k]; if (st && st.bot) sample(st.uid, g.b[k], t); }
      }
    }
  }

  /* bots (simulated by the host device) */
  function bestDir(m, b, score) {
    let best = null, bs = -Infinity;
    for (let k = 0; k < 16; k++) {
      const an = k * Math.PI / 8, dx = Math.cos(an), dy = Math.sin(an);
      const q = move(m, { x: b.x, y: b.y }, dx * 70, dy * 70);
      const s = score(q) + (b.dir ? (dx * b.dir.x + dy * b.dir.y) * 10 : 0);
      if (s > bs) { bs = s; best = { x: dx, y: dy }; }
    }
    return best;
  }
  const edge = q => { const e = Math.min(q.x, q.y, W - q.x, H - q.y); return e < 150 ? (150 - e) * 0.9 : 0; };
  function botThink(b, i, t, now) {
    const v = cur, G = v.G, S = v.S, m = mapOf(G);
    b.next = t + 170 + Math.random() * 110;
    const wander = pace => {
      if (!b.goal || t > b.goalT || dist(b, b.goal) < 30) { b.goal = randomFree(m, Math.random); b.goalT = t + 2500 + Math.random() * 3000; }
      b.dir = bestDir(m, b, q => -dist(q, b.goal)); b.pace = pace;
    };
    if (!playing(G) || !G.pl[i]) { wander(0.5); return; }
    if (!canMove(G, i, now)) { b.dir = null; return; }
    if (t < b.unstick) return;
    const others = parts(G).filter(j => j !== i && S.seats[j]).map(j => ({ j, p: where(j) })).filter(o => o.p);
    if (i === G.it) {
      const cands = others.filter(o => !(G.safe[o.j] > now) && G.ice[o.j] == null);
      if (!cands.length) { wander(0.8); return; }
      const nearest = cands.reduce((x, o) => (dist(b, o.p) < dist(b, x.p) ? o : x));
      let tgt = cands.find(o => o.j === b.tgt);
      if (!tgt || dist(b, nearest.p) < dist(b, tgt.p) * 0.7) tgt = nearest;
      b.tgt = tgt.j;
      const lead = { x: tgt.p.x + (tgt.p.vx || 0) * 0.25, y: tgt.p.y + (tgt.p.vy || 0) * 0.25 };
      b.dir = bestDir(m, b, q => -dist(q, lead)); b.pace = 1;
      if (dist(b, tgt.p) < 140 && t >= b.dashReady && Math.random() < 0.6) { b.dashUntil = t + DASH_MS; b.dashReady = t + DASH_CD; }
      return;
    }
    const it = G.it >= 0 ? where(G.it) : null, dIt = it ? dist(b, it) : 1e9;
    if (G.opt.mode === 'ice' && G.phase === 'play' && it && now >= G.stun) {
      if (dIt < 95 && t > b.iceTry && (t < b.dashReady || Math.random() < 0.5)) {
        b.iceTry = t + 1500;
        v.host(a => game.onReq(a, i, { type: 'ice' }));
        b.dir = null; return;
      }
      if (dIt > 260) {
        const fr = others.filter(o => G.ice[o.j] != null && dist(o.p, it) > 220);
        if (fr.length) { const f = fr.reduce((x, o) => (dist(b, o.p) < dist(b, x.p) ? o : x)); b.dir = bestDir(m, b, q => -dist(q, f.p)); b.pace = 1; return; }
      }
    }
    if (it && dIt < 460) {
      b.dir = bestDir(m, b, q => dist(q, it) - edge(q)); b.pace = 1;
      if (dIt < 85 && t >= b.dashReady && Math.random() < 0.7) { b.dashUntil = t + DASH_MS; b.dashReady = t + DASH_CD; }
    } else wander(0.6);
  }
  function runBots(t, dt, now) {
    const v = cur, G = v.G, S = v.S, m = mapOf(G);
    for (const k of Object.keys(bots)) if (!S.seats[k] || !S.seats[k].bot) delete bots[k];
    S.seats.forEach((st, i) => {
      if (!st || !st.bot) return;
      let b = bots[i];
      if (!b) {
        const s = rp[st.uid];
        b = bots[i] = { x: 0, y: 0, vx: 0, vy: 0, fx: 0, fy: 1, set: false, rd: -1, next: 0, dir: null, pace: 0, dashUntil: 0, dashReady: 0, iceTry: 0, unstick: 0, chk: 0, cx: 0, cy: 0 };
        if (s) { b.x = s.x; b.y = s.y; b.set = true; b.rd = G.rd; }
      }
      if (playing(G) && G.pl[i] && b.rd !== G.rd && G.sp[i]) { b.x = G.sp[i][0]; b.y = G.sp[i][1]; b.set = true; b.rd = G.rd; b.dir = null; }
      if (!b.set) { const p = randomFree(m, Math.random); b.x = p.x; b.y = p.y; b.set = true; }
      if (t >= b.next) botThink(b, i, t, now);
      const ok = canMove(G, i, now), d = ok && b.dir ? b.dir : null;
      const sp = (G.it === i && G.phase === 'play' ? IT_SPEED : SPEED) * (t < b.dashUntil ? DASH : 1) * (b.pace || 0);
      const ox = b.x, oy = b.y;
      if (d) move(m, b, d.x * sp * dt, d.y * sp * dt);
      if (dt > 0) { b.vx = (b.x - ox) / dt; b.vy = (b.y - oy) / dt; }
      if (d) { b.fx = d.x; b.fy = d.y; }
      // stuck behind something while chasing: take a short random detour
      if (t > b.chk) {
        if (d && b.pace > 0.9 && Math.hypot(b.x - b.cx, b.y - b.cy) < 25 && t > b.unstick) {
          const an = Math.random() * Math.PI * 2; b.dir = { x: Math.cos(an), y: Math.sin(an) }; b.unstick = t + 450;
        }
        b.chk = t + 700; b.cx = b.x; b.cy = b.y;
      }
    });
  }
  function findContact(G, now, ok, reach) {
    if (G.phase !== 'play') return null;
    const ids = parts(G).filter(ok);
    const itp = G.it >= 0 && now >= G.stun && ids.includes(G.it) ? where(G.it) : null;
    if (itp) {
      for (const s of ids) {
        if (s === G.it || G.safe[s] > now || G.ice[s] != null) continue;
        const p = where(s); if (p && dist(itp, p) < reach) return { k: 'tag', a: G.it, b: s };
      }
    }
    if (G.opt.mode === 'ice') {
      for (const i of ids) {
        if (i === G.it || G.ice[i] != null) continue;
        const p = where(i); if (!p) continue;
        for (const j of ids) { if (G.ice[j] == null) continue; const q = where(j); if (q && dist(p, q) < reach) return { k: 'thaw', a: i, b: j }; }
      }
    }
    return null;
  }
  let hostTry = 0;
  function hostContacts(t, now) {
    const v = cur, G = v.G;
    if (t - hostTry < 80 || !findContact(G, now, i => !!v.S.seats[i], REACH)) return;
    hostTry = t;
    v.host(a => {
      const h = findContact(a.G, a.now, i => live(a, i), REACH);
      if (!h) return;
      if (h.k === 'tag') { if (taggable(a, h.b)) doTag(a, h.a, h.b); }
      else { delete a.G.ice[h.b]; ev(a.G, 'thaw', h.a, h.b); }
    });
  }
  // the chaser's (or rescuer's) own screen decides it touched someone; the host double-checks
  function ask(type, s, t) {
    const key = type + s;
    if (t - (asked[key] || 0) < 600) return;
    asked[key] = t;
    cur.send(type, { s });
  }
  function clientContacts(t, now) {
    const v = cur, G = v.G, i = v.me;
    if (G.phase !== 'play' || i < 0 || !G.pl[i] || !me.set) return;
    if (i === G.it) {
      if (now < G.stun) return;
      for (const s of parts(G)) {
        if (s === i || G.safe[s] > now || G.ice[s] != null) continue;
        const q = shownPos(s); if (q && dist(me, q) < REACH) { ask('tag', s, t); return; }
      }
    } else if (G.opt.mode === 'ice' && G.ice[i] == null) {
      for (const s of parts(G)) {
        if (s === i || s === G.it || G.ice[s] == null) continue;
        const q = shownPos(s); if (q && dist(me, q) < REACH) { ask('thaw', s, t); return; }
      }
    }
  }
  function askIce() {
    const v = cur; if (!v) return;
    const G = v.G, i = v.me;
    if (G.opt.mode !== 'ice' || G.phase !== 'play' || i < 0 || !G.pl[i] || i === G.it || G.ice[i] != null) return;
    v.send('ice');
  }

  function publish(t) {
    const v = cur;
    if (t - lastPub < 100 || inflight >= 3 || !v.publish) return;
    const g = { s: 0 };
    if (v.me >= 0 && me.set) g.p = [Math.round(me.x), Math.round(me.y), Math.round(me.vx), Math.round(me.vy)];
    if (v.isHost()) {
      const b = {};
      for (const k of Object.keys(bots)) { const o = bots[k]; if (o.set) b[k] = [Math.round(o.x), Math.round(o.y), Math.round(o.vx), Math.round(o.vy)]; }
      if (Object.keys(b).length) g.b = b;
    }
    const sig = JSON.stringify(g);
    if (sig === lastSent) return;
    lastSent = sig; lastPub = t; g.s = ++seq;
    inflight++;
    Promise.resolve(v.publish(g)).catch(() => {}).then(() => { inflight--; });
  }

  function frame(t, paint) {
    const dt = clamp((t - lastT) / 1000, 0, 1);
    lastT = t;
    const v = cur;
    if (!v) return;
    const G = v.G, m = mapOf(G), now = v.now(), i = v.me;
    // my runner
    if (i >= 0) {
      if (playing(G) && G.pl[i] && G.rd !== me.rd && G.sp[i]) { me.x = G.sp[i][0]; me.y = G.sp[i][1]; me.vx = me.vy = 0; me.set = true; me.rd = G.rd; }
      if (!me.set) { const p = randomFree(m, Math.random); me.x = p.x; me.y = p.y; me.set = true; me.rd = G.rd; }
      let ix = input.kx + input.jx, iy = input.ky + input.jy;
      const l = Math.hypot(ix, iy); if (l > 1) { ix /= l; iy /= l; }
      const ok = canMove(G, i, now);
      if (input.dash) { input.dash = false; if (ok && t >= me.dashReady) { me.dashUntil = t + DASH_MS; me.dashReady = t + DASH_CD; } }
      if (!ok) { ix = 0; iy = 0; }
      const sp = (G.it === i && G.phase === 'play' ? IT_SPEED : SPEED) * (t < me.dashUntil ? DASH : 1);
      const ox = me.x, oy = me.y;
      if (ix || iy) move(m, me, ix * sp * dt, iy * sp * dt); else push(m, me);
      if (dt > 0) { me.vx = (me.x - ox) / dt; me.vy = (me.y - oy) / dt; }
      if (l > 0.1) { me.fx = ix / Math.min(1, l); me.fy = iy / Math.min(1, l); const n = Math.hypot(me.fx, me.fy) || 1; me.fx /= n; me.fy /= n; }
    } else { me.set = false; me.rd = -1; }
    // others, smoothed
    v.S.seats.forEach((st, k) => {
      if (!st || st.uid === v.uid || (st.bot && v.isHost())) return;
      const s = rp[st.uid]; if (!s) return;
      const p = predict(s, t, m);
      let d = disp[st.uid];
      if (!d || Math.hypot(d.x - p.x, d.y - p.y) > 160) d = disp[st.uid] = { x: p.x, y: p.y, fx: 0, fy: 1, sp: 0 };
      else { const f = 1 - Math.exp(-dt * 14); d.x += (p.x - d.x) * f; d.y += (p.y - d.y) * f; }
      const sv = Math.hypot(s.vx, s.vy); d.sp = sv;
      if (sv > 20) { d.fx = s.vx / sv; d.fy = s.vy / sv; }
    });
    if (v.isHost()) { runBots(t, dt, now); hostContacts(t, now); } else clientContacts(t, now);
    publish(t);
    // events → effects
    if (v.S.seq > 0 && lastEv < 0) lastEv = G.ev ? G.ev.n : 0;
    else if (lastEv >= 0 && G.ev && G.ev.n > lastEv) { lastEv = G.ev.n; effect(G.ev, t); }
    if (paint && ui) draw(t, dt);
    if (ui && t - lastHud > 200) { lastHud = t; hud(); }
  }

  /* ---------- drawing ---------- */
  const colorOf = (S, i) => (S.seats[i] && S.seats[i].bot ? '#c9d1cd' : COLORS[i % COLORS.length]);
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16), ch = s => clamp(Math.round(((n >> s) & 255) * f), 0, 255);
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
  }
  function drawMap(c, m, t) {
    c.fillStyle = m.ground[0]; c.fillRect(0, 0, W, H);
    c.fillStyle = m.ground[1];
    for (let y = 0; y < H; y += 200) c.fillRect(0, y, W, 100);
    for (const d of m.d) {
      if (d[0] === 'ring') { c.strokeStyle = d[5]; c.lineWidth = d[4]; c.beginPath(); c.arc(d[1], d[2], d[3], 0, Math.PI * 2); c.stroke(); }
      else if (d[0] === 'dash') { c.strokeStyle = 'rgba(236, 229, 211, 0.12)'; c.lineWidth = 6; c.setLineDash([34, 30]); c.beginPath(); c.moveTo(d[1], d[2]); c.lineTo(d[3], d[4]); c.stroke(); c.setLineDash([]); }
      else if (d[0] === 'sand') { c.fillStyle = 'rgba(214, 186, 120, 0.16)'; c.beginPath(); c.arc(d[1], d[2], d[3], 0, Math.PI * 2); c.fill(); c.strokeStyle = 'rgba(214, 186, 120, 0.25)'; c.lineWidth = 6; c.stroke(); }
    }
    // shadows first, then the tops
    c.fillStyle = 'rgba(0, 0, 0, 0.3)';
    for (const [x, y, w, h] of m.r) { rr(c, x + 5, y + 9, w, h, 8); c.fill(); }
    for (const [x, y, r] of m.c) { c.beginPath(); c.ellipse(x + 4, y + 9, r, r * 0.9, 0, 0, Math.PI * 2); c.fill(); }
    for (const [x, y, w, h, col] of m.r) {
      c.fillStyle = col; rr(c, x, y, w, h, 8); c.fill();
      c.fillStyle = shade(col, 1.25); rr(c, x + 4, y + 3, w - 8, Math.min(h - 6, 10), 4); c.fill();
      c.strokeStyle = 'rgba(0, 0, 0, 0.35)'; c.lineWidth = 2; rr(c, x, y, w, h, 8); c.stroke();
    }
    for (const [x, y, r, k] of m.c) {
      if (k === 't') {
        c.fillStyle = '#1f4d33'; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#2d6b45'; c.beginPath(); c.arc(x - r * 0.18, y - r * 0.2, r * 0.72, 0, Math.PI * 2); c.fill();
        c.fillStyle = 'rgba(160, 220, 150, 0.18)'; c.beginPath(); c.arc(x - r * 0.35, y - r * 0.38, r * 0.3, 0, Math.PI * 2); c.fill();
      } else if (k === 'f') {
        c.fillStyle = '#8d8676'; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#2c6c8c'; c.beginPath(); c.arc(x, y, r - 13, 0, Math.PI * 2); c.fill();
        const ph = (t / 1400) % 1;
        c.strokeStyle = `rgba(200, 235, 255, ${0.45 * (1 - ph)})`; c.lineWidth = 3;
        c.beginPath(); c.arc(x, y, 8 + ph * (r - 22), 0, Math.PI * 2); c.stroke();
        c.fillStyle = '#b9e3f5'; c.beginPath(); c.arc(x, y, 7, 0, Math.PI * 2); c.fill();
      } else {
        c.fillStyle = '#6b7178'; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#8b9299'; c.beginPath(); c.arc(x - 3, y - 4, r * 0.65, 0, Math.PI * 2); c.fill();
      }
    }
    c.strokeStyle = m.fence; c.lineWidth = 14; c.strokeRect(-7, -7, W + 14, H + 14);
    c.strokeStyle = 'rgba(255, 255, 255, 0.08)'; c.lineWidth = 2; c.strokeRect(-12, -12, W + 24, H + 24);
  }
  function drawRunner(c, e, t, sc) {
    c.save(); c.translate(e.x, e.y);
    if (e.off) c.globalAlpha = 0.35; else if (e.safe && Math.floor(t / 120) % 2) c.globalAlpha = 0.5;
    c.fillStyle = 'rgba(0, 0, 0, 0.35)'; c.beginPath(); c.ellipse(2, R * 0.75, R * 0.95, R * 0.42, 0, 0, Math.PI * 2); c.fill();
    if (e.sp > SPEED * 1.3) {
      for (let k = 1; k <= 3; k++) { c.fillStyle = e.color; c.globalAlpha = 0.14 * (4 - k) * (e.off ? 0.35 : 1); c.beginPath(); c.arc(-e.fx * 13 * k, -e.fy * 13 * k, R * (1 - k * 0.12), 0, Math.PI * 2); c.fill(); }
      c.globalAlpha = e.off ? 0.35 : 1;
    }
    if (e.it) {
      const pulse = 0.55 + 0.45 * Math.sin(t / 140);
      c.strokeStyle = `rgba(239, 68, 68, ${0.5 + 0.4 * pulse})`; c.lineWidth = 5; c.beginPath(); c.arc(0, 0, R + 6 + pulse * 3, 0, Math.PI * 2); c.stroke();
    }
    const g = c.createRadialGradient(-6, -8, 2, 0, 0, R);
    g.addColorStop(0, shade(e.color, 1.25)); g.addColorStop(1, e.color);
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.fill();
    c.lineWidth = 2.5; c.strokeStyle = 'rgba(0, 0, 0, 0.45)'; c.stroke();
    if (e.isMe) { c.lineWidth = 3; c.strokeStyle = '#fff'; c.beginPath(); c.arc(0, 0, R + 2, 0, Math.PI * 2); c.stroke(); }
    // eyes look where it is going
    const px = -e.fy, py = e.fx, ex = e.fx * 7, ey = e.fy * 7;
    for (const s of [-1, 1]) {
      const x = ex + px * 6.5 * s, y = ey + py * 6.5 * s;
      c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y, 5.2, 0, Math.PI * 2); c.fill();
      c.fillStyle = e.it ? '#7a0f12' : '#141414'; c.beginPath(); c.arc(x + e.fx * 2, y + e.fy * 2, 2.7, 0, Math.PI * 2); c.fill();
    }
    if (e.ice) {
      c.fillStyle = 'rgba(170, 220, 255, 0.55)'; rr(c, -R - 6, -R - 6, 2 * R + 12, 2 * R + 12, 9); c.fill();
      c.strokeStyle = 'rgba(235, 248, 255, 0.95)'; c.lineWidth = 2.5; c.stroke();
      c.strokeStyle = 'rgba(255, 255, 255, 0.7)'; c.lineWidth = 2; c.beginPath(); c.moveTo(-R + 2, -R + 12); c.lineTo(-R + 12, -R + 2); c.stroke();
    }
    if (e.stun > 0) {
      c.strokeStyle = 'rgba(255, 255, 255, 0.85)'; c.lineWidth = 3;
      c.beginPath(); c.arc(0, 0, R + 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * e.stun); c.stroke();
    }
    const fs = clamp(12.5 / sc, 11, 26);
    c.font = `700 ${fs}px 'IBM Plex Sans KR', system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    const tag = e.it ? '술래' : e.ice ? '얼음' : '';
    if (tag) {
      const tw = c.measureText(tag).width + fs * 0.9, y = -R - 10 - fs * 0.6;
      c.fillStyle = e.it ? '#dc2f36' : '#3d86b8'; rr(c, -tw / 2, y - fs * 0.7, tw, fs * 1.4, fs * 0.6); c.fill();
      c.fillStyle = '#fff'; c.fillText(tag, 0, y + 0.5);
    }
    const name = e.off ? e.name + ' (끊김)' : e.name;
    c.lineWidth = 3.5; c.strokeStyle = 'rgba(0, 0, 0, 0.75)'; c.strokeText(name, 0, R + 6 + fs * 0.7);
    c.fillStyle = e.isMe ? '#f6dc9a' : '#f5eedd'; c.fillText(name, 0, R + 6 + fs * 0.7);
    c.restore();
  }
  function entities(t, now) {
    const v = cur, S = v.S, G = v.G, out = [];
    S.seats.forEach((st, i) => {
      if (!st || (playing(G) && !G.pl[i])) return;
      const isMe = st.uid === v.uid;
      let p, fx = 0, fy = 1, sp = 0;
      if (isMe) { if (!me.set) return; p = me; fx = me.fx; fy = me.fy; sp = Math.hypot(me.vx, me.vy); }
      else if (st.bot && v.isHost()) { p = bots[i]; if (!p || !p.set) return; fx = p.fx; fy = p.fy; sp = Math.hypot(p.vx, p.vy); }
      else { p = disp[st.uid]; if (!p) return; fx = p.fx; fy = p.fy; sp = p.sp; }
      const it = playing(G) && G.it === i;
      out.push({
        i, x: p.x, y: p.y, fx, fy, sp, isMe, it, name: st.name, color: colorOf(S, i),
        ice: playing(G) && G.ice[i] != null, safe: G.phase === 'play' && G.safe[i] > now,
        stun: it && G.phase === 'play' && now < G.stun ? (G.stun - now) / STUN_MS : it && G.phase === 'count' ? (G.end - now) / COUNT_MS : 0,
        off: !st.bot && !isMe && !v.isOnline(st.uid),
      });
    });
    return out.sort((a, b) => a.y - b.y);
  }
  function draw(t, dt) {
    const v = cur, c = ui.ctx, cw = ui.w, ch = ui.h, dpr = ui.dpr, G = v.G, m = mapOf(G), now = v.now();
    if (!cw || !ch) return;
    const follow = v.me >= 0 && me.set && !(playing(G) && !G.pl[v.me]);
    const ts = follow ? clamp(Math.min(cw, ch) / 560, 0.45, 1.5) : Math.min(cw / (W + 80), ch / (H + 80));
    let tx = follow ? me.x : W / 2, ty = follow ? me.y : H / 2;
    const f = cam.s ? 1 - Math.exp(-dt * 9) : 1;
    cam.s += (ts - cam.s) * f;
    const hw = cw / cam.s / 2, hh = ch / cam.s / 2, mo = 24 / cam.s, mt = 96 / cam.s;
    tx = W + 2 * mo < 2 * hw ? W / 2 : clamp(tx, hw - mo, W - hw + mo);
    ty = H + mt + mo < 2 * hh ? (H + mo - mt) / 2 : clamp(ty, hh - mt, H + mo - hh);
    cam.x += (tx - cam.x) * f; cam.y += (ty - cam.y) * f;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#0a100e'; c.fillRect(0, 0, cw, ch);
    const sc = cam.s;
    c.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * (cw / 2 - cam.x * sc), dpr * (ch / 2 - cam.y * sc));
    drawMap(c, m, t);
    const ents = entities(t, now);
    for (const e of ents) drawRunner(c, e, t, sc);
    // floating words
    for (let k = fxs.length - 1; k >= 0; k--) {
      const x = fxs[k], age = (t - x.t0) / 1000;
      if (age > 1.1) { fxs.splice(k, 1); continue; }
      if (x.ring) { c.strokeStyle = `rgba(255, 255, 255, ${0.8 * (1 - age / 1.1)})`; c.lineWidth = 4; c.beginPath(); c.arc(x.x, x.y, R + age * 90, 0, Math.PI * 2); c.stroke(); }
      const fs = clamp(22 / sc, 18, 44);
      c.globalAlpha = clamp(1.4 - age * 1.3, 0, 1);
      c.font = `800 ${fs}px 'IBM Plex Sans KR', system-ui, sans-serif`; c.textAlign = 'center';
      c.lineWidth = 5; c.strokeStyle = 'rgba(0, 0, 0, 0.7)'; c.strokeText(x.text, x.x, x.y - R - 26 - age * 40);
      c.fillStyle = x.color; c.fillText(x.text, x.x, x.y - R - 26 - age * 40);
      c.globalAlpha = 1;
    }
    // where the others are when they are off screen
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (follow) {
      for (const e of ents) {
        if (e.isMe) continue;
        const sx = cw / 2 + (e.x - cam.x) * sc, sy = ch / 2 + (e.y - cam.y) * sc, mg = 16;
        if (sx > -R * sc && sx < cw + R * sc && sy > -R * sc && sy < ch + R * sc) continue;
        const ax = clamp(sx, mg, cw - mg), ay = clamp(sy, mg + 44, ch - mg), an = Math.atan2(sy - ch / 2, sx - cw / 2), s = e.it ? 12 : 8;
        c.save(); c.translate(ax, ay); c.rotate(an);
        c.fillStyle = e.it ? '#ef4444' : e.color; c.strokeStyle = 'rgba(0, 0, 0, 0.6)'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(s, 0); c.lineTo(-s * 0.8, s * 0.75); c.lineTo(-s * 0.8, -s * 0.75); c.closePath(); c.fill(); c.stroke();
        c.restore();
      }
    }
    // floating joystick
    if (input.jid != null) {
      const bx = input.ox, by = input.oy;
      c.fillStyle = 'rgba(255, 255, 255, 0.08)'; c.strokeStyle = 'rgba(255, 255, 255, 0.28)'; c.lineWidth = 2;
      c.beginPath(); c.arc(bx, by, 48, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = 'rgba(246, 220, 154, 0.55)'; c.beginPath(); c.arc(bx + input.jx * 48, by + input.jy * 48, 22, 0, Math.PI * 2); c.fill();
    }
  }
  function effect(e, t) {
    const v = cur, S = v.S, nm = i => (S.seats[i] ? S.seats[i].name : '?'), at = i => { const p = shownPos(i); return p ? { x: p.x, y: p.y } : null; };
    const pop = (i, text, color, ring) => { const p = at(i); if (p) fxs.push({ x: p.x, y: p.y, text, color, ring, t0: t }); };
    const mine = e.a === v.me;
    if (e.k === 'go') flash(v.me === v.G.it ? '잡으러 출발!' : '술래가 출발했어요!', v.me === v.G.it ? 'it' : '');
    else if (e.k === 'tag') { pop(e.a, '터치!', '#ff8a80', true); flash(mine ? '잡혔다! 이제 내가 술래' : e.b === v.me ? '잡았다! 이제 도망쳐요' : `${nm(e.a)} 님이 새 술래!`, mine ? 'it' : ''); }
    else if (e.k === 'ice') pop(e.a, '얼음!', '#bfe6ff');
    else if (e.k === 'thaw') pop(e.b, '땡!', '#f6dc9a', true);
    else if (e.k === 'all') flash(mine ? '모두 얼음! 마지막에 언 내가 술래' : `모두 얼음! ${nm(e.a)} 님이 술래`, mine ? 'it' : '');
    else if (e.k === 'pass') flash((e.b >= 0 ? `${nm(e.b)} 님 연결이 끊겨` : '술래가 나가서') + (mine ? ' 내가 술래!' : ` ${nm(e.a)} 님이 술래`), mine ? 'it' : '');
    if (mine && (e.k === 'tag' || e.k === 'all' || e.k === 'pass' || e.k === 'start') && root.navigator && navigator.vibrate) { try { navigator.vibrate(120); } catch (x) { /* ignore */ } }
  }
  function flash(text, cls) {
    if (!ui) return;
    ui.flash.textContent = '';
    const d = document.createElement('div'); d.className = 'tg-flash' + (cls ? ' ' + cls : ''); d.textContent = text;
    ui.flash.append(d);
  }

  /* ---------- overlay (DOM) ---------- */
  function hud() {
    const v = cur, G = v.G, S = v.S, i = v.me, now = v.now(), el = v.el;
    const inR = i >= 0 && playing(G) && G.pl[i];
    let role = '', rc = '';
    if (i < 0) role = '구경하는 중';
    else if (!playing(G)) role = G.phase === 'over' ? '판 끝! 결과를 확인해요' : '연습 중 · 맘껏 뛰어 봐요';
    else if (!G.pl[i]) role = '다음 판부터 같이 뛰어요';
    else if (G.it === i) { role = G.phase === 'count' ? '내가 술래! 숫자 세는 중' : now < G.stun ? '내가 술래! 잠깐 멈춤' : '내가 술래! 잡으러 가요'; rc = 'it'; }
    else if (G.ice[i] != null) { role = '얼음! 친구가 닿으면 땡'; rc = 'ice'; }
    else { role = G.phase === 'count' ? '도망쳐요!' : '안 잡히게 도망쳐요'; rc = 'run'; }
    if (ui.role.textContent !== role) ui.role.textContent = role;
    ui.role.className = 'tg-role ' + rc;
    const left = Math.max(0, G.end - now);
    const time = G.phase === 'play' ? `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}` : G.phase === 'count' ? '준비' : G.phase === 'over' ? '끝' : '대기';
    if (ui.time.textContent !== time) ui.time.textContent = time;
    ui.time.classList.toggle('hurry', G.phase === 'play' && left < 10000);
    // live board: time spent as "it" (lower is better)
    const ids = playing(G) || G.phase === 'over' ? parts(G).filter(k => S.seats[k]) : S.seats.map((s, k) => (s ? k : -1)).filter(k => k >= 0);
    const msOf = k => (G.ms[k] || 0) + (G.phase === 'play' && G.it === k ? Math.max(0, now - G.since) : 0);
    const rows = ids.map(k => ({ k, ms: msOf(k) })).sort((a, b) => (playing(G) ? a.ms - b.ms : a.k - b.k));
    ui.board.textContent = '';
    if (G.phase !== 'over') {
      for (const r of rows) {
        const st = S.seats[r.k], d = el('div', (G.it === r.k && playing(G) ? 'it' : '') + (r.k === i ? ' me' : ''));
        const dot = el('i'); dot.style.background = colorOf(S, r.k);
        d.append(dot, el('b', null, st.name));
        if (playing(G)) d.append(el('span', 'num', sec(r.ms)));
        else if (st.w) d.append(el('span', 'num', '1등 ' + st.w));
        ui.board.append(d);
      }
    }
    // centre: countdown / results / tips
    let key = G.phase + ':' + G.rd;
    if (G.phase === 'count') key += ':' + Math.ceil(left / 1000);
    if (G.phase === 'wait') key += ':' + (i >= 0) + ':' + ids.length;
    if (ui.midKey !== key) {
      ui.midKey = key; ui.mid.textContent = '';
      if (G.phase === 'count') {
        ui.mid.append(el('div', 'tg-count', String(Math.max(1, Math.ceil(left / 1000)))));
        ui.mid.append(el('div', 'tg-sub', G.it === i ? '숫자 세는 중… 곧 잡으러 가요' : `술래 ${S.seats[G.it] ? S.seats[G.it].name : ''} 님이 세는 동안 도망쳐요!`));
      } else if (G.phase === 'over' && G.res) {
        const box = el('div', 'tg-res');
        box.append(el('h3', null, `${MODES[G.opt.mode]} 결과`), el('p', null, '술래였던 시간이 짧을수록 1등'));
        G.res.forEach((r, k) => {
          const row = el('div', 'tg-row' + (r.s === i ? ' me' : '') + (r.win ? ' win' : ''));
          const badge = r.win ? '1등' : k === G.res.length - 1 && G.res.length > 1 ? '벌칙' : (k + 1) + '등';
          row.append(el('em', r.win ? 'gold' : k === G.res.length - 1 ? 'bad' : '', badge), el('b', null, r.n), el('span', 'num', '술래 ' + sec(r.ms)), el('small', 'num', '터치 ' + r.c));
          box.append(row);
        });
        ui.mid.append(box);
      } else if (G.phase === 'wait' && i >= 0 && ids.length < 2) {
        ui.mid.append(el('div', 'tg-sub', '친구를 초대하거나 봇을 넣으면 시작할 수 있어요'));
      }
    }
    // buttons
    const canAct = i >= 0 && me.set && (!playing(G) || inR);
    ui.btns.hidden = !canAct;
    const t = performance.now(), cd = me.dashReady > t ? (me.dashReady - t) / DASH_CD : 0;
    ui.dash.style.setProperty('--p', cd.toFixed(3));
    ui.dash.classList.toggle('cool', cd > 0);
    ui.ice.hidden = !(G.opt.mode === 'ice' && G.phase === 'play' && inR && G.it !== i);
    ui.ice.disabled = G.ice[i] != null;
    ui.ice.textContent = G.ice[i] != null ? '얼음 중' : '얼음';
  }
  function build(v) {
    const { el, stage } = v;
    stage.textContent = '';
    const wrap = el('div', 'tg-wrap'), cv = document.createElement('canvas');
    cv.setAttribute('aria-label', '술래잡기 맵');
    const top = el('div', 'tg-top'), role = el('div', 'tg-role'), time = el('div', 'tg-time num');
    top.append(role, time);
    const board = el('div', 'tg-board'), mid = el('div', 'tg-mid'), fl = el('div', 'tg-flashbox'), btns = el('div', 'tg-btns');
    const dash = el('button', 'tg-btn dash', '대시'), ice = el('button', 'tg-btn ice', '얼음');
    dash.type = ice.type = 'button';
    btns.append(dash, ice);
    wrap.append(cv, top, board, mid, fl, btns);
    stage.append(wrap);
    ui = { root: wrap, cv, ctx: cv.getContext('2d'), role, time, board, mid, flash: fl, btns, dash, ice, w: 0, h: 0, dpr: 1, midKey: '' };
    const fit = () => {
      const r = wrap.getBoundingClientRect(), dpr = Math.min(root.devicePixelRatio || 1, 2);
      ui.w = r.width; ui.h = r.height; ui.dpr = dpr;
      cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
    };
    fit();
    if (root.ResizeObserver) new ResizeObserver(fit).observe(wrap); else root.addEventListener('resize', fit);
    // floating joystick: put a thumb down anywhere on the map and drag
    const JR = 48;
    cv.addEventListener('pointerdown', e => {
      if (input.jid != null) return;
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      input.jid = e.pointerId; input.ox = e.clientX - r.left; input.oy = e.clientY - r.top; input.jx = input.jy = 0;
      try { cv.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    });
    cv.addEventListener('pointermove', e => {
      if (e.pointerId !== input.jid) return;
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      let dx = x - input.ox, dy = y - input.oy;
      const d = Math.hypot(dx, dy);
      if (d > JR) { input.ox = x - dx / d * JR; input.oy = y - dy / d * JR; dx = dx / d * JR; dy = dy / d * JR; }
      const mag = Math.hypot(dx, dy) / JR;
      const k = mag < 0.15 ? 0 : Math.min(1, (mag - 0.15) / 0.55) / (mag || 1);
      input.jx = dx / JR * k; input.jy = dy / JR * k;
    });
    const up = e => { if (e.pointerId === input.jid) { input.jid = null; input.jx = input.jy = 0; } };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('lostpointercapture', up);
    cv.addEventListener('contextmenu', e => e.preventDefault());
    dash.addEventListener('pointerdown', e => { e.preventDefault(); input.dash = true; });
    ice.addEventListener('pointerdown', e => { e.preventDefault(); askIce(); });
  }
  let keysOn = false;
  function keys() {
    if (keysOn) return;
    keysOn = true;
    const K = { ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd' };
    const busy = e => { const tg = e.target; return (tg && /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName)) || !document.getElementById('modalBack').hidden || !document.getElementById('sheetBack').hidden; };
    const upd = () => { const k = input.keys; input.kx = (k.r ? 1 : 0) - (k.l ? 1 : 0); input.ky = (k.d ? 1 : 0) - (k.u ? 1 : 0); };
    root.addEventListener('keydown', e => {
      if (busy(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (K[e.code]) { input.keys[K[e.code]] = true; upd(); e.preventDefault(); }
      else if ((e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat) { input.dash = true; e.preventDefault(); }
      else if ((e.code === 'KeyE' || e.code === 'KeyF') && !e.repeat) askIce();
    });
    root.addEventListener('keyup', e => { if (K[e.code]) { input.keys[K[e.code]] = false; upd(); } });
    root.addEventListener('blur', () => { input.keys = {}; upd(); });
  }
  function loop() {
    if (loopOn) return;
    loopOn = true; lastT = performance.now();
    const step = t => { frame(t, !document.hidden); requestAnimationFrame(step); };
    requestAnimationFrame(step);
    // background tabs get no animation frames: keep moving (bots, publishing) on a slow timer
    setInterval(() => { const t = performance.now(); if (t - lastT > 180) frame(t, false); }, 120);
  }

  const game = {
    id: 'tag', name: '술래잡기', seats: 8, keep: true, noChips: true,
    sitLabel: '참가하기', joinTitle: '술래잡기 참가하기', joinNote: '친구들이 알아볼 닉네임을 정해 주세요. 들어가면 바로 맵을 뛰어다닐 수 있어요.',
    leaveNote: '이 방에서 쌓은 1등 기록이 사라져요.',
    botNote: '봇도 같이 뛰어요. 술래가 되면 쫓아오고, 아니면 열심히 도망쳐요.',
    rules: [
      '술래 한 명이 나머지를 쫓아가요. 술래 몸에 닿으면 닿은 사람이 새 술래! 판이 끝날 때 술래였던 시간이 가장 짧은 사람이 1등이에요.',
      '판이 시작되면 술래는 3초 동안 숫자를 세요. 새 술래도 1.5초 동안은 못 움직여요.',
      '얼음땡: 도망자는 “얼음” 버튼으로 얼 수 있어요. 얼면 안 잡히지만 못 움직이고, 다른 도망자가 몸에 닿아야(땡!) 풀려요. 도망자가 모두 얼면 마지막으로 언 사람이 술래가 돼요.',
      '휴대폰: 화면 아무 데나 손가락을 대고 끌면 이동, 오른쪽 아래 버튼으로 대시. PC: WASD·방향키로 이동, Space 대시, E 얼음.',
    ],
    logic: {
      W, H, R, REACH, SLACK, STUN_MS, COUNT_MS, MAPS, MODES, DURS, push, move, free, canMove, findContact,
      setWhere(fn) { where = fn; }, goneAt,
    },
    debug: { me, rp, bots, step(v, t, dt) { cur = v; runBots(t, dt, v.now()); hostContacts(t, v.now()); } },  // tests / bot simulation
    init: () => ({ phase: 'wait', rd: 0, map: 0, opt: { mode: 'tag', dur: 90 }, pl: {}, it: -1, since: 0, stun: 0, end: 0, safe: {}, ice: {}, ms: {}, tags: {}, sp: {}, res: null, ev: null }),
    busy: () => false,
    onReq(a, i, r) {
      const { G, now } = a;
      const s = Number.isInteger(r.s) ? r.s : -1;
      switch (r.type) {
        case 'start': if (G.phase === 'wait' || G.phase === 'over') startRound(a); break;
        case 'opt':
          if (G.phase !== 'wait' && G.phase !== 'over') break;
          if (r.mode === 'tag' || r.mode === 'ice') G.opt.mode = r.mode;
          if (DURS.includes(r.dur)) G.opt.dur = r.dur;
          break;
        case 'tag':
          if (G.phase === 'play' && i === G.it && now >= G.stun && taggable(a, s) && near(i, s, REACH + SLACK)) doTag(a, i, s);
          break;
        case 'ice':
          if (G.opt.mode === 'ice' && G.phase === 'play' && G.pl[i] && i !== G.it && G.ice[i] == null) { G.ice[i] = now; ev(G, 'ice', i, -1); allIce(a); }
          break;
        case 'thaw':
          if (G.opt.mode === 'ice' && G.phase === 'play' && G.pl[i] && i !== G.it && G.ice[i] == null && s !== i && s !== G.it && G.ice[s] != null && near(i, s, REACH + SLACK)) {
            delete G.ice[s]; ev(G, 'thaw', i, s);
          }
          break;
      }
    },
    onLeave(a, i) {
      const { G } = a;
      if (!G.pl[i]) return;
      delete G.pl[i]; delete G.ice[i]; delete G.safe[i]; delete G.sp[i];
      if (!playing(G)) return;
      const left = parts(G);
      if (left.length < 2) {
        if (G.phase === 'play') { G.it = G.it === i ? -1 : G.it; finish(a); } else { G.phase = 'wait'; G.pl = {}; G.it = -1; G.end = 0; }
        return;
      }
      if (G.it === i) {
        const pool = left.filter(k => G.ice[k] == null), pick = (pool.length ? pool : left)[a.rint((pool.length ? pool : left).length)];
        handOver(a, -1, pick, 'pass');
        if (G.phase === 'count') G.stun = 0;
      } else allIce(a);
    },
    onHost() { for (const k of Object.keys(goneAt)) delete goneAt[k]; },
    tick(a) {
      const { G, now } = a;
      if (G.phase === 'count' && now >= G.end) { G.phase = 'play'; G.since = now; G.end = now + G.opt.dur * 1000; G.stun = 0; ev(G, 'go', G.it, -1); }
      else if (G.phase === 'play') { watchGone(a); if (G.phase === 'play' && now >= G.end) finish(a); }
      else if (G.phase === 'over' && now >= G.end) { G.phase = 'wait'; G.end = 0; G.pl = {}; G.it = -1; G.res = null; }
    },
    onPeers,
    scores(v) {
      return v.S.seats.map((s, k) => ({ s, k })).filter(x => x.s).sort((a, b) => (b.s.w || 0) - (a.s.w || 0) || (b.s.c || 0) - (a.s.c || 0))
        .map(x => ({ name: x.s.name, me: x.k === v.me, cols: ['1등 ' + (x.s.w || 0), '터치 ' + (x.s.c || 0)] }));
    },

    /* ---------- UI ---------- */
    render(v) {
      cur = v;
      v.stage.className = 'gstage tg';
      if (!ui || !ui.root.isConnected) build(v);
      keys(); loop(); hud();
    },
    dock(v) {
      const { G, S, me: i, seat, el, dock, send } = v;
      const info = el('div', 'gmine');
      info.append(el('b', null, seat.name), el('span', null, '1등'), el('b', 'num gold', (seat.w || 0) + '번'), el('span', null, '· 터치 ' + (seat.c || 0)));
      const open = G.phase === 'wait' || G.phase === 'over';
      if (open && S.seats.some(x => !x)) { const bb = el('button', 'botpill', '+ 봇 추가'); bb.onclick = () => { send('addBot'); v.toast('봇이 들어왔어요'); }; info.append(bb); }
      dock.append(info);
      if (open) {
        const seg = (items, val, pick) => {
          const box = el('div', 'tg-seg');
          items.forEach(([k, label]) => { const b = el('button', k === val ? 'on' : '', label); b.type = 'button'; b.onclick = () => { if (k !== val) send('opt', pick(k)); }; box.append(b); });
          return box;
        };
        dock.append(seg(Object.entries(MODES), G.opt.mode, k => ({ mode: k })), seg(DURS.map(d => [d, d < 60 ? d + '초' : d % 60 ? `${Math.floor(d / 60)}분 ${d % 60}초` : d / 60 + '분']), G.opt.dur, k => ({ dur: k })));
        const n = S.seats.filter(s => s && (s.bot || v.isOnline(s.uid))).length;
        const row = el('div', 'actions two');
        const go = el('button', 'btn primary'); go.append(G.phase === 'over' ? '한 판 더' : '게임 시작', el('small', null, n < 2 ? '2명부터 (봇 가능)' : `${n}명`));
        go.disabled = n < 2; go.onclick = () => send('start');
        row.append(v.inviteButton(), go);
        dock.append(row);
      } else if (!G.pl[i]) dock.append(v.wait('지금 판이 끝나면 같이 뛰어요'));
      else dock.append(el('div', 'tg-hint', coarse() ? '화면을 끌어서 이동 · 오른쪽 아래 버튼으로 대시' + (G.opt.mode === 'ice' ? '/얼음' : '') : 'WASD·방향키 이동 · Space 대시' + (G.opt.mode === 'ice' ? ' · E 얼음' : '')));
    },
  };
  root.HOGames.tag = game;
})(typeof window !== 'undefined' ? window : globalThis);

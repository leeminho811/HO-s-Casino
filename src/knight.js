/* 기사의 여행 (Knight's Tour) — a solo puzzle: move the knight so it lands on every square exactly once.
 * No room, no network: progress and best times live in this browser's localStorage.
 * The logic part (HOKnight.logic) is pure and also loads in Node for tests. */
(function (root) {
  'use strict';
  const SIZES = [6, 7, 8, 9];
  const JUMPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];

  /* ---------------- logic ---------------- */
  const NB = {};
  function nbOf(n) {                       // neighbour table: square index → squares a knight can jump to
    if (NB[n]) return NB[n];
    const t = [];
    for (let i = 0; i < n * n; i++) {
      const r = Math.floor(i / n), c = i % n, l = [];
      JUMPS.forEach(([dr, dc]) => { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < n && cc >= 0 && cc < n) l.push(rr * n + cc); });
      t.push(l);
    }
    return (NB[n] = t);
  }
  const isJump = (n, a, b) => nbOf(n)[a].includes(b);
  // On odd boards the knight alternates colours, so a tour of n² (odd) squares must start on the
  // majority colour — the colour of the corners.
  const canStart = (n, p) => n % 2 === 0 || (Math.floor(p / n) + (p % n)) % 2 === 0;
  const legal = (n, path) => { if (!path.length) return []; const seen = new Set(path); return nbOf(n)[path[path.length - 1]].filter(j => !seen.has(j)); };

  /* Depth-first search from the given partial path. Moves are tried in Warnsdorff order (fewest onward
   * moves first, ties to the square farther from the centre) and branches are cut early when an
   * unvisited square can no longer be reached, more than one square is left as a forced dead end, or
   * the colours of the squares left can't alternate. Bounded by a node count and a wall-clock deadline.
   * → { status: 'ok', tour } | { status: 'dead' } (no tour exists) | { status: 'unknown' } (ran out of budget) */
  function solve(n, path, opts) {
    opts = opts || {};
    const limit = opts.nodes || 300000, until = opts.until || Infinity;
    const N = n * n, nb = nbOf(n), vis = new Uint8Array(N), deg = new Int8Array(N);
    const c0 = (n - 1) / 2, far = [], col = [];
    for (let i = 0; i < N; i++) { far.push((Math.floor(i / n) - c0) ** 2 + (i % n - c0) ** 2); col.push((Math.floor(i / n) + i % n) % 2); }
    if (!path.length) {                    // no start yet: corners first, then everything else that can work
      const starts = [...Array(N).keys()].filter(p => canStart(n, p)).sort((a, b) => far[b] - far[a]);
      let unknown = false;
      for (const s of starts) { const r = solve(n, [s], opts); if (r.status === 'ok') return r; if (r.status === 'unknown') unknown = true; }
      return { status: unknown ? 'unknown' : 'dead' };
    }
    for (const p of path) vis[p] = 1;
    for (let i = 0; i < N; i++) { let d = 0; for (const j of nb[i]) if (!vis[j]) d++; deg[i] = d; }
    const out = path.slice(), queue = new Int16Array(N), mark = new Uint8Array(N);
    let nodes = 0, stamp = 0;
    const STOP = {};
    const visit = j => { vis[j] = 1; for (const k of nb[j]) deg[k]--; };
    const unvisit = j => { vis[j] = 0; for (const k of nb[j]) deg[k]++; };
    function feasible(cur, left) {
      if (left === 0) return true;
      let ends = 0, other = 0;
      for (let u = 0; u < N; u++) {
        if (vis[u]) continue;
        if (col[u] !== col[cur]) other++;
        const adj = isJump(n, cur, u);
        if (deg[u] === 0) { if (!(left === 1 && adj)) return false; }
        else if (deg[u] === 1 && !adj && ++ends > 1) return false;   // can be entered but never left → must be last
      }
      // colours alternate, so the rest of the path needs ⌈left/2⌉ squares of the other colour
      if (other !== Math.ceil(left / 2)) return false;
      // every unvisited square must still be reachable from the knight through unvisited squares
      stamp = (stamp + 1) & 255 || 1;
      let h = 0, t = 0, seen = 0;
      for (const j of nb[cur]) if (!vis[j] && mark[j] !== stamp) { mark[j] = stamp; queue[t++] = j; }
      while (h < t) { const u = queue[h++]; seen++; for (const k of nb[u]) if (!vis[k] && mark[k] !== stamp) { mark[k] = stamp; queue[t++] = k; } }
      return seen === left;
    }
    function dfs(cur, left) {
      if (left === 0) return true;
      if (++nodes > limit || ((nodes & 1023) === 0 && Date.now() > until)) throw STOP;
      const cand = [];
      for (const j of nb[cur]) if (!vis[j]) cand.push(j);
      cand.sort((a, b) => deg[a] - deg[b] || far[b] - far[a]);
      for (const j of cand) {
        visit(j); out.push(j);
        if (feasible(j, left - 1) && dfs(j, left - 1)) return true;
        out.pop(); unvisit(j);
      }
      return false;
    }
    const cur = path[path.length - 1], left = N - path.length;
    try {
      if (feasible(cur, left) && dfs(cur, left)) return { status: 'ok', tour: out };
      return { status: 'dead' };
    } catch (e) { if (e === STOP) return { status: 'unknown' }; throw e; }
  }

  /* Hint for the current path (spends at most about opts.ms milliseconds):
   *   { kind: 'start', to }                  no knight yet: a square a tour can start from
   *   { kind: 'move', to }                   the next square of a full tour from here
   *   { kind: 'badStart' }                   odd board, started on the wrong colour: start over
   *   { kind: 'back', steps, to, sure }      undo `steps` moves and a tour exists again (then go to `to`);
   *                                          sure = it's proven that no tour exists from the current path
   *   { kind: 'guess', to, sure }            nothing found in time: the Warnsdorff choice (or null when stuck)
   *   { kind: 'done' } */
  function hint(n, path, opts) {
    opts = opts || {};
    const N = n * n, t0 = Date.now(), ms = opts.ms || 1800, end = t0 + ms;
    if (path.length === N) return { kind: 'done' };
    if (!path.length) { const r = solve(n, [], { until: end }); return { kind: 'start', to: r.status === 'ok' ? r.tour[0] : 0 }; }
    if (!canStart(n, path[0])) return { kind: 'badStart' };
    const r = solve(n, path, { until: t0 + ms * 0.45 });
    if (r.status === 'ok') return { kind: 'move', to: r.tour[path.length] };
    const sure = r.status === 'dead';
    // Find the fewest undos after which a tour is certain. If a prefix has a tour, so does every shorter
    // one, so: try the last few moves first (mistakes are usually recent), then binary-search the rest.
    const L = path.length, tryK = (k, ms) => { const b = solve(n, path.slice(0, k), { until: Math.min(end, Date.now() + ms) }); return b.status === 'ok' ? b.tour[k] : -1; };
    const back = (k, to) => ({ kind: 'back', steps: L - k, to, sure });
    for (let k = L - 1; k >= Math.max(1, L - 3); k--) { const to = tryK(k, 150); if (to >= 0) return back(k, to); }
    let lo = 1, hi = L - 4, found = null;
    while (lo <= hi && Date.now() < end) {
      const mid = (lo + hi) >> 1, to = tryK(mid, 250);
      if (to >= 0) { found = [mid, to]; lo = mid + 1; } else hi = mid - 1;
    }
    if (found) return back(found[0], found[1]);
    const one = solve(n, path.slice(0, 1));   // a single knight on a good start square always has a tour
    if (one.status === 'ok' && L > 1) return back(1, one.tour[1]);
    const seen = new Set(path), m = legal(n, path), d = j => nbOf(n)[j].filter(k => !seen.has(k)).length;
    return { kind: 'guess', to: m.length ? m.sort((a, b) => d(a) - d(b))[0] : null, sure };
  }

  const logic = { SIZES, nbOf, isJump, canStart, legal, solve, hint };

  /* ---------------- UI ---------------- */
  const LS = {
    get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* no storage */ } },
  };
  const RULES = [
    '나이트(♞)는 체스처럼 L자로만 움직여요. 한 방향으로 두 칸, 옆으로 한 칸.',
    '원하는 칸을 눌러 출발하고, 판의 모든 칸을 딱 한 번씩 밟으면 성공이에요. 지나간 칸에는 다시 못 가요.',
    '판 크기는 6×6 · 7×7 · 8×8 · 9×9 중에서 골라요. 크기마다 진행 상황과 최고 기록이 따로 저장돼요.',
    '막히면 되돌리기, 처음부터, 힌트를 쓸 수 있어요. 힌트를 쓰지 않고 풀어야 최고 기록에 올라가요.',
    '요령: 갈 수 있는 길이 가장 적은 칸부터 먼저 가세요. 구석과 가장자리를 남겨 두면 나중에 막혀요.',
    '7×7, 9×9처럼 칸 수가 홀수인 판은 모서리와 같은 색 칸에서 출발해야만 완주할 수 있어요.',
  ];
  const fmtTime = ms => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
  const colName = c => String.fromCharCode(65 + c);   // A..I across, 1..9 up — like a chessboard
  const sqName = (n, p) => colName(p % n) + (n - Math.floor(p / n));

  function startUI(opts) {
    opts = opts || {};
    const doc = root.document, $ = s => doc.querySelector(s);
    const el = (tag, cls, txt) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
    const wrap = $('#solo');
    const saved = LS.get('ho_knight') || {};
    const best = LS.get('ho_knight_best') || {};
    const fresh = () => ({ path: [], ms: 0, hints: 0, done: false });
    const validPath = (k, p) => p.length <= k * k && new Set(p).size === p.length && p.every((x, i) => Number.isInteger(x) && x >= 0 && x < k * k && (i === 0 || isJump(k, p[i - 1], x)));
    const games = {};
    SIZES.forEach(k => {
      const g = saved.g && saved.g[k];
      games[k] = g && Array.isArray(g.path) && validPath(k, g.path)
        ? { path: g.path.slice(), ms: Math.max(0, +g.ms || 0), hints: Math.max(0, +g.hints || 0), done: g.path.length === k * k } : fresh();
    });
    let n = SIZES.includes(saved.n) ? saved.n : 6;
    let showMoves = saved.showMoves !== false, runFrom = 0, tip = null, badSq = -1, badTimer = 0, toastT = 0, busy = false;
    const G = () => games[n];

    /* ---- timer + storage ---- */
    const elapsed = () => G().ms + (runFrom ? Date.now() - runFrom : 0);
    function pause() { if (runFrom) { G().ms += Date.now() - runFrom; runFrom = 0; } }
    function resume() { if (!runFrom && G().path.length && !G().done && doc.visibilityState !== 'hidden') runFrom = Date.now(); }
    function save() {
      LS.set('ho_knight', { n, showMoves, g: Object.fromEntries(SIZES.map(k => [k, { path: games[k].path, ms: games[k].ms + (k === n && runFrom ? Date.now() - runFrom : 0), hints: games[k].hints }])) });
    }
    function toast(t) { const x = $('#toast'); if (!x) return; x.textContent = t; x.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { x.hidden = true; }, 2200); }

    /* ---- frame ---- */
    wrap.textContent = '';
    const top = el('header', 'top');
    const back = el('button', 'icon-btn', '‹'); back.id = 'kBack'; back.setAttribute('aria-label', '로비로 나가기');
    back.onclick = () => { pause(); save(); if (opts.onBack) opts.onBack(); };
    const brand = el('div', 'brand'); brand.append(el('b', null, '기사의 여행'));
    const help = el('button', 'icon-btn', '?'); help.id = 'kHelp'; help.setAttribute('aria-label', '게임 방법');
    top.append(back, brand, el('div', 'meta'), help);

    const sizes = el('div', 'kn-sizes'); sizes.setAttribute('role', 'tablist'); sizes.setAttribute('aria-label', '판 크기');
    const sizeBtns = SIZES.map(k => {
      const b = el('button', 'kn-size'); b.dataset.n = k; b.setAttribute('role', 'tab');
      b.append(el('b', null, k + '×' + k), el('small'));
      b.onclick = () => { if (k === n || busy) return; pause(); n = k; tip = null; resume(); save(); draw(); };
      sizes.append(b); return b;
    });
    const stats = el('div', 'kn-stats');
    const stat = label => { const d = el('div', 'kn-stat'), v = el('b', 'num'); d.append(el('small', null, label), v); stats.append(d); return v; };
    const vMoves = stat('밟은 칸'), vTime = stat('시간'), vHints = stat('힌트');

    const frame = el('div', 'kn-frame');
    const ranks = el('div', 'kn-ranks'), files = el('div', 'kn-files');
    const board = el('div', 'kn-board'); board.id = 'kBoard';
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(svgNS, 'svg'); svg.setAttribute('class', 'kn-path'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('preserveAspectRatio', 'none');
    const line = doc.createElementNS(svgNS, 'polyline'); svg.append(line);
    frame.append(ranks, board, el('i'), files);
    const msg = el('div', 'kn-msg'); msg.id = 'kMsg'; msg.setAttribute('aria-live', 'polite');
    const msgText = el('span'), msgBtn = el('button', 'kn-act'); msgBtn.id = 'kTipAct';
    msg.append(msgText, msgBtn);
    const stage = el('main', 'kn-stage'); stage.append(sizes, stats, frame, msg);

    const dock = el('section', 'dock kn-dock');
    const bUndo = el('button', 'btn', '↶ 되돌리기'); bUndo.id = 'kUndo';
    const bHint = el('button', 'btn primary', '힌트'); bHint.id = 'kHint';
    const bReset = el('button', 'btn', '처음부터'); bReset.id = 'kReset';
    const acts = el('div', 'kn-acts'); acts.append(bUndo, bHint, bReset);
    const opt = el('label', 'kn-opt');
    const chk = el('input'); chk.type = 'checkbox'; chk.id = 'kMoves'; chk.checked = showMoves;
    chk.onchange = () => { showMoves = chk.checked; save(); draw(); };
    opt.append(chk, el('span', null, '갈 수 있는 칸 표시'));
    dock.append(acts, opt);
    wrap.append(top, stage, dock);

    /* ---- modal (the page's shared #modalBack) ---- */
    function modal(build) {
      const mb = $('#modalBack'), m = $('#modal');
      m.textContent = ''; m.className = 'modal'; build(m); mb.hidden = false;
      mb.onclick = e => { if (e.target === mb) mb.hidden = true; };
    }
    const closeModal = () => { $('#modalBack').hidden = true; };
    function rules() {
      modal(m => {
        m.append(el('h2', null, '게임 방법'));
        const ul = el('ul', 'rules'); RULES.forEach(t => ul.append(el('li', null, t))); m.append(ul);
        const row = el('div', 'row'), ok = el('button', 'btn primary', '알겠어요'); ok.onclick = closeModal; row.append(ok); m.append(row);
      });
    }
    help.onclick = rules;
    function celebrate() {
      const g = G(), k = n, t = g.ms;
      const rec = !g.hints && (!best[k] || t < best[k]);
      if (rec) { best[k] = t; LS.set('ho_knight_best', best); }
      modal(m => {
        m.classList.add('kn-win');
        m.append(el('div', 'kn-crown', '♞'), el('h2', null, '완주했어요!'));
        const p = el('p'); p.append(`${k}×${k} 판 ${k * k}칸을 모두 밟았어요. `, el('b', null, fmtTime(t)), g.hints ? ` · 힌트 ${g.hints}번` : ' · 힌트 없이'); m.append(p);
        if (rec) m.append(el('p', 'kn-rec', '🏆 이 판의 최고 기록이에요!'));
        else if (g.hints) m.append(el('p', null, '힌트 없이 풀면 최고 기록에 올라가요.'));
        else m.append(el('p', null, '최고 기록 ' + fmtTime(best[k])));
        const row = el('div', 'row'), again = el('button', 'btn', '다시 하기'), next = el('button', 'btn primary', k < 9 ? `${k + 1}×${k + 1} 도전` : '닫기');
        again.onclick = () => { closeModal(); reset(); };
        next.onclick = () => { closeModal(); if (k < 9) sizeBtns[SIZES.indexOf(k + 1)].click(); };
        row.append(again, next); m.append(row);
      });
    }

    /* ---- actions ---- */
    function bad(p, t) {
      toast(t); badSq = p; clearTimeout(badTimer); draw();
      badTimer = setTimeout(() => { badSq = -1; draw(); }, 450);
    }
    function tap(p) {
      const g = G(), path = g.path, cur = path[path.length - 1];
      if (g.done || busy) return;
      if (path.length) {
        if (path.includes(p)) return bad(p, p === cur ? '나이트가 지금 있는 칸이에요' : '이미 지나간 칸이에요');
        if (!isJump(n, cur, p)) return bad(p, '나이트는 L자로만 움직여요');
      }
      path.push(p); tip = null;
      if (path.length === 1 && !canStart(n, p)) tip = { cls: 'bad', text: '이 칸에서는 완주할 수 없어요. 홀수 판은 모서리와 같은 색 칸에서 출발해야 해요.', act: ['다시 고르기', undo] };
      if (path.length === n * n) { pause(); g.done = true; save(); draw(); celebrate(); return; }
      resume(); save(); draw();
    }
    function undo() {
      const g = G(); if (!g.path.length || busy) return;
      g.path.pop(); g.done = false; tip = null;
      if (!g.path.length) pause(); else resume();
      save(); draw();
    }
    function reset() {
      if (busy) return;
      runFrom = 0; games[n] = fresh(); tip = null; save(); draw();
    }
    function askHint() {
      const g = G(); if (g.done || busy) return;
      busy = true; bHint.disabled = true; bHint.textContent = '생각 중…';
      setTimeout(() => {                   // let "생각 중…" paint before the search runs
        let h;
        try { h = hint(n, g.path); } catch (e) { h = { kind: 'guess', to: null }; }
        busy = false; bHint.textContent = '힌트';
        const at = p => sqName(n, p);
        if (h.kind === 'start') tip = { sq: h.to, text: `${at(h.to)} 칸(반짝이는 칸)에서 출발하면 완주할 수 있어요.` };
        else if (h.kind === 'move') { g.hints++; tip = { sq: h.to, text: `다음은 ${at(h.to)} 칸(반짝이는 칸)으로 가 보세요.` }; }
        else if (h.kind === 'badStart') tip = { cls: 'bad', text: '출발한 칸에서는 완주할 수 없어요. 홀수 판은 모서리와 같은 색 칸에서 출발해야 해요.', act: ['처음부터', reset] };
        else if (h.kind === 'back') {
          g.hints++;
          const why = !legal(n, g.path).length ? '더 갈 칸이 없어요.' : h.sure ? '지금 길로는 완주할 수 없어요.' : '지금 길로 완주하는 방법을 찾지 못했어요.';
          tip = { cls: 'bad', text: `${why} ${h.steps}수 전으로 돌아가면 ${h.sure ? '' : '확실히 '}풀 수 있어요.`, act: [`${h.steps}수 되돌리기`, () => {
            g.path.splice(g.path.length - h.steps); resume();
            tip = { sq: h.to, text: `${h.steps}수 되돌렸어요. 이제 ${at(h.to)} 칸(반짝이는 칸)으로 가 보세요.` };
            save(); draw();
          }] };
        } else if (h.kind === 'guess') {
          if (h.to == null) tip = { cls: 'bad', text: '더 갈 칸이 없어요. 되돌리기로 길을 바꿔 보세요.' };
          else { g.hints++; tip = { sq: h.to, text: `확실하진 않지만 갈 길이 가장 적은 ${at(h.to)} 칸이 좋아 보여요.` }; }
        }
        save(); draw();
      }, 40);
    }
    bUndo.onclick = undo; bReset.onclick = reset; bHint.onclick = askHint;
    msgBtn.onclick = () => { if (tip && tip.act) tip.act[1](); };
    board.addEventListener('click', e => { const b = e.target.closest('.kn-sq'); if (b) tap(+b.dataset.p); });

    /* ---- render ---- */
    let cells = [], builtN = 0;
    function build() {
      board.textContent = ''; ranks.textContent = ''; files.textContent = '';
      board.style.setProperty('--n', n); frame.style.setProperty('--n', n);
      cells = [];
      for (let p = 0; p < n * n; p++) {
        const b = el('button', 'kn-sq ' + ((Math.floor(p / n) + p % n) % 2 ? 'dk' : 'lt')); b.dataset.p = p;
        board.append(b); cells.push(b);
      }
      board.append(svg);
      svg.setAttribute('viewBox', `0 0 ${n} ${n}`);
      for (let i = 0; i < n; i++) { files.append(el('span', null, colName(i))); ranks.append(el('span', null, String(n - i))); }
      builtN = n;
    }
    function draw() {
      if (builtN !== n) build();
      const g = G(), path = g.path, N = n * n, at = new Map(path.map((p, i) => [p, i]));
      const cur = path.length ? path[path.length - 1] : -1;
      const moves = legal(n, path), next = new Set(showMoves ? moves : []);
      const stuck = path.length > 0 && !g.done && !moves.length;
      const hintSq = tip && tip.sq != null ? tip.sq : -1;
      cells.forEach((b, p) => {
        const i = at.get(p), cl = b.classList;
        cl.toggle('on', i != null); cl.toggle('cur', p === cur); cl.toggle('nx', next.has(p));
        cl.toggle('hint', p === hintSq); cl.toggle('bad', p === badSq); cl.toggle('first', i === 0 && p !== cur);
        b.textContent = p === cur ? '♞' : i != null ? String(i + 1) : '';
        b.style.setProperty('--i', i != null ? i : 0);
        b.setAttribute('aria-label', sqName(n, p) + (p === cur ? ` 나이트 ${i + 1}번째` : i != null ? ` ${i + 1}번째` : next.has(p) ? ' 갈 수 있음' : ''));
      });
      line.setAttribute('points', path.map(p => `${p % n + 0.5},${Math.floor(p / n) + 0.5}`).join(' '));
      board.classList.toggle('done', g.done); board.classList.toggle('stuck', stuck); board.classList.toggle('fresh', !path.length);
      sizeBtns.forEach((b, j) => {
        const k = SIZES[j], gg = games[k];
        b.classList.toggle('sel', k === n); b.setAttribute('aria-selected', String(k === n));
        b.lastChild.textContent = gg.path.length && !gg.done ? `${gg.path.length}/${k * k}` : best[k] ? '🏆 ' + fmtTime(best[k]) : gg.done ? '완주' : '';
      });
      vMoves.textContent = `${path.length} / ${N}`;
      vHints.textContent = g.hints + '번';
      tick();
      bUndo.disabled = !path.length; bReset.disabled = !path.length && !g.ms; bHint.disabled = g.done || busy;
      let t, cls = '';
      if (tip) { t = tip.text; cls = tip.cls || 'tip'; }
      else if (g.done) { t = `완주! ${N}칸을 모두 밟았어요 · ${fmtTime(g.ms)}` + (g.hints ? ` · 힌트 ${g.hints}번` : ''); cls = 'good'; }
      else if (!path.length) t = '출발할 칸을 눌러 나이트를 놓으세요. 어느 칸이든 괜찮아요.';
      else if (stuck) { t = `더 갈 수 있는 칸이 없어요. 남은 칸 ${N - path.length}개 — 되돌리기로 길을 바꿔 보세요.`; cls = 'bad'; }
      else t = showMoves ? `점 찍힌 칸으로 나이트를 옮기세요. 남은 칸 ${N - path.length}개.` : `나이트를 L자로 옮기세요. 남은 칸 ${N - path.length}개.`;
      msgText.textContent = t;
      msg.className = 'kn-msg ' + cls;
      msgBtn.hidden = !(tip && tip.act); if (tip && tip.act) msgBtn.textContent = tip.act[0];
    }
    function tick() { vTime.textContent = fmtTime(elapsed()); }
    setInterval(() => { if (runFrom) tick(); }, 500);
    doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') { pause(); save(); } else { resume(); tick(); } });
    root.addEventListener('pagehide', () => { pause(); save(); });
    resume();
    draw();
    let seen = null; try { seen = localStorage.getItem('ho_knight_seen'); } catch (e) { /* ignore */ }
    if (!seen) { try { localStorage.setItem('ho_knight_seen', '1'); } catch (e) { /* ignore */ } rules(); }
    // for tests / debugging
    root.HOKnight.ui = { tap, undo, reset, hint: askHint, state: () => ({ n, path: G().path.slice(), done: G().done, hints: G().hints, tip: tip && { sq: tip.sq, text: tip.text } }) };
  }

  root.HOKnight = { logic, start: startUI, RULES };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.HOKnight;
})(typeof window !== 'undefined' ? window : globalThis);

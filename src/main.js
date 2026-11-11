/* Entry point: splash → lobby → room. The room code in the URL hash (#ABC123) decides the game:
 * 6 characters (or any other length) = hold'em, 7 characters starting with a game letter = that game. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  function el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  const LS = {
    get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* no storage */ } },
  };
  function sess(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; } return v; }

  const HOLDEM_RULES = [
    '각자 카드 2장을 받고, 가운데에 깔리는 공용 카드 5장과 합쳐 가장 좋은 5장 족보를 만드는 포커예요.',
    '프리플랍 → 플랍(3장) → 턴(1장) → 리버(1장) 순서로 네 번 베팅해요.',
    '체크/콜로 따라가거나, 벳/레이즈로 올리거나, 폴드로 포기할 수 있어요. 끝까지 남은 사람 중 족보가 가장 높으면 팟을 가져가요.',
    '족보 순서는 게임 안 ☰ 메뉴에서 볼 수 있어요. 봇을 넣어 연습할 수도 있어요.',
  ];
  const GAMES = [
    { id: 'holdem', prefix: '', name: '텍사스 홀덤', mark: '♠', tone: 'green', players: '2~8명 · 봇 가능',
      desc: '내 카드 2장과 공용 카드 5장으로 족보를 겨루는 포커. 베팅과 블러프의 심리전!' },
    { id: 'blackjack', prefix: 'B', name: '블랙잭', mark: '21', tone: 'red', players: '1~5명 · 딜러와 대결',
      desc: '카드 합을 21에 가깝게 만들어 딜러를 이기는 게임. 21을 넘으면 버스트!' },
    { id: 'roulette', prefix: 'R', name: '룰렛', mark: '0', tone: 'wine', players: '1~8명',
      desc: '구슬이 멈출 숫자와 색을 맞혀요. 숫자 하나를 정확히 맞히면 35배.' },
    { id: 'baccarat', prefix: 'K', name: '바카라', mark: '9', tone: 'blue', players: '1~8명',
      desc: '플레이어와 뱅커 중 9에 더 가까울 쪽에 걸어요. 규칙은 자동, 고르기만 하면 끝.' },
    { id: 'seotda', prefix: 'S', name: '섯다', mark: '光', tone: 'hwatu', players: '2~5명 · 화투',
      desc: '화투 2장으로 겨루는 한국식 포커. 38광땡을 잡으면 판을 쓸어요.' },
  ];
  const CODE_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const normRoom = s => { const c = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return /^[A-Z0-9]{4,12}$/.test(c) ? c : null; };
  const hashRoom = () => { try { return normRoom(decodeURIComponent(location.hash.slice(1))); } catch (e) { return null; } };
  const randCode = n => Array.from({ length: n }, () => CODE_CH[Math.floor(Math.random() * CODE_CH.length)]).join('');
  const gameOf = code => (code.length === 7 && GAMES.find(g => g.prefix && g.prefix === code[0])) || GAMES[0];
  const rulesOf = g => (g.id === 'holdem' ? HOLDEM_RULES : window.HOGames[g.id].rules);
  let CURRENT = null;

  function show(id) { ['splash', 'lobby', 'app', 'gapp'].forEach(x => { $('#' + x).hidden = x !== id; }); }
  function go(code) { location.hash = code; }               // hashchange → reload into the room
  function create(g) { go(g.prefix + randCode(6)); }
  function lobby() {
    sess('ho_lobby', '1');
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; }
    location.reload();
  }
  function remember(code) {
    const list = (LS.get('ho_recent') || []).filter(x => x && x.code !== code);
    list.unshift({ code, t: Date.now() });
    LS.set('ho_recent', list.slice(0, 4));
  }
  function toast(t) { const x = $('#toast'); x.textContent = t; x.hidden = false; setTimeout(() => { x.hidden = true; }, 2600); }

  function showSplash() {
    show('splash');
    $('#startBtn').onclick = () => { sess('ho_lobby', '1'); showLobby(); };
  }
  function showLobby() {
    show('lobby');
    const root = $('#lobbyBody'); root.textContent = '';
    // join
    const join = el('section', 'lb-card lb-join');
    join.append(el('h2', null, '방 참여하기'), el('p', null, '친구가 보내 준 방 코드를 넣으면 그 방으로 바로 들어가요.'));
    const row = el('div', 'lb-row');
    const inp = el('input', 'code-input'); inp.id = 'joinCode'; inp.maxLength = 12; inp.placeholder = '방 코드'; inp.autocapitalize = 'characters'; inp.autocomplete = 'off'; inp.setAttribute('aria-label', '방 코드');
    const enter = () => { const c = normRoom(inp.value); if (!c) { toast('방 코드는 영문·숫자 4~12자예요'); return; } go(c); };
    inp.onkeydown = e => { if (e.key === 'Enter') enter(); };
    const btn = el('button', 'btn primary', '입장'); btn.id = 'joinBtn'; btn.onclick = enter;
    row.append(inp, btn); join.append(row);
    const recent = (LS.get('ho_recent') || []).filter(x => x && normRoom(x.code));
    if (recent.length) {
      const rc = el('div', 'lb-recent'); rc.append(el('small', null, '최근 방'));
      recent.forEach(x => { const b = el('button', null); b.append(el('b', null, x.code), ' ' + gameOf(x.code).name); b.onclick = () => go(x.code); rc.append(b); });
      join.append(rc);
    }
    // games
    const head = el('div', 'lb-head'); head.append(el('h2', null, '게임 고르기'), el('p', null, '게임을 골라 방을 만들고, 초대 링크를 친구에게 보내요.'));
    const list = el('div', 'lb-games');
    GAMES.forEach(g => {
      const c = el('article', 'lb-game ' + g.tone); c.dataset.game = g.id;
      const tile = el('div', 'lb-tile'); tile.append(el('span', null, g.mark));
      const body = el('div', 'lb-body');
      const title = el('div', 'lb-title'); title.append(el('h3', null, g.name), el('small', null, g.players));
      body.append(title, el('p', null, g.desc));
      const rules = el('ul', 'rules'); rules.hidden = true; rulesOf(g).forEach(t => rules.append(el('li', null, t)));
      const acts = el('div', 'lb-acts');
      const how = el('button', 'btn ghost', '게임 방법'); how.onclick = () => { rules.hidden = !rules.hidden; how.textContent = rules.hidden ? '게임 방법' : '접기'; };
      const mk = el('button', 'btn primary', '방 만들기'); mk.onclick = () => create(g);
      acts.append(how, mk);
      c.append(tile, body, rules, acts);
      list.append(c);
    });
    root.append(join, head, list, el('p', 'lb-foot', '실제 돈은 걸지 않아요. 칩은 방마다 1,000개로 시작하고, 다 잃으면 리바이할 수 있어요.'));
  }

  function boot() {
    if (window.claude && typeof window.claude.use === 'function') { show('app'); window.startHoldem('main'); return; } // test mock
    window.addEventListener('hashchange', () => { if (hashRoom() !== CURRENT) location.reload(); });
    const code = hashRoom();
    if (!code) { if (sess('ho_lobby')) showLobby(); else showSplash(); return; }
    CURRENT = code;
    if (location.hash !== '#' + code) { try { history.replaceState(null, '', location.pathname + location.search + '#' + code); } catch (e) { /* ignore */ } }
    remember(code);
    sess('ho_lobby', '1');
    const g = gameOf(code);
    document.title = g.name + ' · HO’s Casino';
    if (g.id === 'holdem') { show('app'); window.startHoldem(code); }
    else { show('gapp'); window.HOKit.start(code, window.HOGames[g.id]); }
  }
  window.HOMain = { lobby, GAMES, gameOf };
  boot();
})();

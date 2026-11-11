# HO’s Casino — 친구들과 하는 온라인 카지노

친구들이 같은 링크로 접속해 함께 노는 웹 게임 모음: 텍사스 홀덤, 블랙잭, 룰렛, 바카라, 섯다(화투).
원래 claude.ai 아티팩트(홀덤 나이트)였고, 지금은 **로그인 없이 링크만으로 들어오는 독립 웹사이트**다.
실시간 백엔드: Firebase (익명 인증 + Realtime Database, 프로젝트 `ho-casino`), 호스팅: GitHub Pages (`main` 브랜치 루트의 index.html,
https://leeminho811.github.io/HO-s-Casino/). 사용자용 안내는 README.md.

## 구조

```
src/main.js              진입점: 시작 화면(START) → 로비(게임 고르기, 방 만들기/참여) → 방. 방 코드로 게임을 정함
src/engine.js            홀덤 순수 게임 로직 (DOM·네트워크 없음). 족보 평가, 베팅 라운드, 사이드팟, 봇
src/app.js               홀덤 UI + 동기화. main.js 가 window.startHoldem(방코드) 로 시작시킴
src/kit.js               나머지 게임이 함께 쓰는 방 시스템: 호스트 권한 동기화, 자리/리바이, 초대, 메뉴, 패 암호화
src/games/common.js      공용 도우미 (칩 단위, 카드 뽑기, 베팅 마감 판단)
src/games/blackjack.js roulette.js baccarat.js seotda.js   게임 모듈 (로직 + render/dock). Node 에서도 로드됨
src/backend-firebase.js  Firebase 어댑터 — claude.ai 런타임과 같은 {db, user, room} 모양을 돌려줌
src/app.css, kit.css     스타일 (모바일 우선). kit.css = 시작 화면·로비·kit 게임들
src/shell.html           HTML 뼈대 — build.py 가 CSS/JS 를 끼워 넣음
build.py                 src/ → index.html 한 파일로 합치기 (index.html 도 커밋할 것 — Pages 가 그대로 서비스)
firebase-config.js       Firebase 설정값. 합치지 않고 index.html 이 따로 불러옴
database.rules.json      Realtime Database 보안 규칙 (사용자가 콘솔에 붙여 넣음 — 바꾸면 사용자가 다시 게시해야 함)
firebase.json            에뮬레이터 설정 (테스트용)
test/engine.test.js, games.test.js   규칙 테스트 (npm test)
test/e2e-firebase.mjs    에뮬레이터 + 브라우저 3개 홀덤 플레이 테스트
test/e2e-games.mjs       에뮬레이터 + 시작 화면/로비/블랙잭/룰렛/바카라/섯다 테스트
test/mock.js, harness.html, run.py   메모리 목(mock) 으로 하는 홀덤 시뮬레이션 (window.claude 주입)
```

빌드: `python3 build.py` · 규칙 테스트: `npm test`
E2E: `npm install && npm run test:e2e` (firebase emulators:exec — Java 필요. 테스트가 gstatic 의 SDK 요청을
node_modules/firebase 의 같은 버전 파일로 바꿔 치기하므로 package.json 의 firebase 버전 = backend-firebase.js 의 VERSION 유지).
프록시 환경에서 firebase-tools 가 localhost 에뮬레이터 요청까지 HTTPS_PROXY 로 보내면 그 프로세스에만 `HTTPS_PROXY=undefined`.
목 시뮬레이션: 프로젝트 루트에서 `python3 -m http.server 8765` 실행 후 `python3 test/run.py`

## 방 코드와 게임

- URL 해시 `#CODE` 가 방. 해시가 없으면 시작 화면 → 로비 (이번 탭에서 한 번 봤으면 sessionStorage `ho_lobby` 로 바로 로비).
- 코드가 **7자이고 첫 글자가 게임 글자**면 그 게임: `B` 블랙잭, `R` 룰렛, `K` 바카라, `S` 섯다. 그 밖의 코드(6자 등)는 홀덤.
  (보안 규칙을 안 바꾸고 게임 종류를 코드에 담기 위한 방식. 새 게임을 넣으면 main.js 의 GAMES 에 글자를 추가.)
- 방을 옮길 때는 해시를 바꾸고 페이지를 새로 읽는다 (상태를 깨끗이 버리려고).
- 칩은 방마다 따로 (1,000 시작, 0 이 되면 리바이). 게임 사이 공용 지갑은 없음.

## kit 게임 모듈 (src/games/*.js)

`HOGames[id] = { id, name, seats, rules[], init(), busy(G,i), onReq(a,i,r), tick(a), onLeave(a,i), onHost(a), onKey(a,i), render(v), dock(v) }`
- `a` (호스트 쪽): `{S, G, ctx, now, rint, log, seal(i,obj)}` — S 는 방 상태, G = S.game, ctx 는 호스트 기기에만 있는 비밀(섯다 패).
- `v` (화면 쪽): `{S, G, me, seat, secret, stage, dock, send, el, fmt, cards, countdown, spot, chip, wait, ...}`.
- 블랙잭·룰렛·바카라는 비밀이 없다 (카드는 필요할 때 무한 덱에서 뽑음) → 호스트가 바뀌어도 판이 그대로 이어짐.
  섯다는 `G.enc[seat]` 에 봉한 패를 두고, 호스트가 바뀌면 그 판은 무효(판돈 반환).
- CSS 클래스 이름이 app.css(홀덤)와 겹치지 않게 주의 (`.mine`, `.plate`, `.av` 등은 홀덤 것).

## 동기화 설계 (바꾸지 말 것)

- **딜러(호스트) 권한 모델**: 테이블 상태 문서 `tables/main` 은 딜러 기기 한 곳만 쓴다.
  딜러가 덱을 섞고, 요청을 검증해 적용하고, 타이머·봇·다음 핸드를 돌린다.
- **요청**: 다른 플레이어는 `tables/main/req/<uid>` 문서 하나에 `{n, type, ...}` 를 쓴다.
  딜러는 `state.proc[uid]` 보다 큰 `n` 만 처리한다. 행동(act)은 `hand.no`·`hand.turn` 이 맞을 때만 적용.
- **딜러 교체**: `state.epoch` + `hostId` + `hostTab`. 더 높은 epoch 를 보면 기존 딜러는 물러난다.
  딜러가 접속 목록에서 사라지면 가장 낮은 자리 번호의 접속자가 자동으로 이어받고,
  진행 중 핸드는 `voidHand` 로 무효 처리(칩 반환). 같은 브라우저면 localStorage 의 ctx 로 이어서 진행.
- **패 암호화**: 각 플레이어가 ECDH P-256 키쌍을 만들고 공개키를 자리 정보에 올린다.
  딜러가 핸드마다 임시 키로 각자 패를 AES-GCM 으로 봉해 `hand.enc[seat]` 에 넣는다.
  덱 전체와 남의 패는 딜러 기기(메모리·localStorage `pk_ctx`)에만 있다.

## 백엔드 (Firebase) — 구현됨

app.js 는 `{db, user, room}` 세 객체만 쓴다 (모양은 `test/mock.js`). `window.claude` 가 있으면(목 테스트) 그걸 쓰고
방 코드는 `main`, 없으면 `HOBackend.connect(ROOM)` (src/backend-firebase.js).

- 인증: 익명 로그인. uid 는 IndexedDB 에 남아 새로고침해도 같은 자리.
- 데이터 위치 (Realtime Database, 문서는 `{j: JSON 문자열, t}` 로 저장 — RTDB 가 null·빈 배열을 지우는 문제 회피):
  `rooms/<CODE>/table`, `rooms/<CODE>/req/<uid>`, `rooms/<CODE>/presence/<tab>` (`onDisconnect().remove()`),
  `rooms/<CODE>/events/<push>` (리액션, 8초 뒤 삭제). app 경로 `tables/<CODE>[/req/<uid>]` 를 어댑터가 바꿔 줌.
- Firestore 대신 RTDB 만 쓰는 이유: 설정할 제품이 하나 줄고, 읽기/쓰기 횟수 과금·일일 한도가 없음 (무료: 동시 100, 월 10GB).
  테이블 문서는 3KB 안팎.
- 방 코드: URL 해시 `#ABC123` (영문 대문자·숫자 4~12자, 규칙에서도 검사). 해시가 없으면 마지막 방(localStorage pk_room) 또는 새 코드.
- 오류 코드: 권한 거부는 `permission_denied` (app 의 `denied()` 가 목의 `invalid_argument` 와 함께 처리),
  익명 로그인 꺼짐 `auth_disabled`, SDK 로드 실패 `sdk`. 설정이 비어 있으면 안내 배너만 띄움.

남은 아이디어: 오래된 방 데이터 정리, 딜러 기기가 백그라운드일 때 더 빨리 넘기기.

## 사용자

- 한국어로 소통. 하노이 거주, 친구들과 재미로 칠 용도 (실제 돈 없음).
- UI 문구는 모두 한국어, 모바일 화면 기준으로 확인할 것. 사이트 제목은 “HO’s Casino”.
- 배포는 `main` 에 푸시 (사용자가 허락함). 작업 브랜치와 `main` 을 같은 커밋으로 유지.
- 아직 없는 것: 고스톱(요청 시 kit 모듈로 추가), 블랙잭 스플릿/인슈어런스, 섯다 구사(재경기).

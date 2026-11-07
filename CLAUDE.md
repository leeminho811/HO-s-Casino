# HO’s Casino — 친구들과 하는 온라인 텍사스 홀덤

친구들이 같은 링크로 접속해 함께 치는 노리밋 홀덤 웹 게임. 원래 claude.ai 아티팩트(홀덤 나이트)로 만들었고,
지금은 **로그인 없이 링크만으로 들어오는 독립 웹사이트**다.
실시간 백엔드: Firebase (익명 인증 + Realtime Database), 호스팅: GitHub Pages (저장소 루트의 index.html).
사용자용 설정 안내는 README.md.

## 구조

```
src/engine.js            순수 게임 로직 (DOM·네트워크 없음). 족보 평가, 베팅 라운드, 사이드팟, 봇
src/app.js               UI + 동기화(딜러/요청 처리, 카드 암호화, 접속 상태), 방 코드(URL 해시), 초대 링크
src/backend-firebase.js  Firebase 어댑터 — claude.ai 런타임과 같은 {db, user, room} 모양을 돌려줌
src/app.css              스타일 (모바일 우선, 한 화면 앱)
src/shell.html           HTML 뼈대 — build.py 가 CSS/JS 를 끼워 넣음
build.py                 src/ → index.html 한 파일로 합치기 (index.html 도 커밋할 것 — Pages 가 그대로 서비스)
firebase-config.js       Firebase 설정값. 합치지 않고 index.html 이 따로 불러옴 (사용자가 GitHub 웹에서 직접 수정)
database.rules.json      Realtime Database 보안 규칙 (사용자가 콘솔에 붙여 넣음)
firebase.json            에뮬레이터 설정 (테스트용)
test/engine.test.js      엔진 테스트 (node test/engine.test.js)
test/e2e-firebase.mjs    Firebase 에뮬레이터 + 브라우저 3개(각자 익명 uid) 실제 플레이 테스트
test/mock.js, harness.html, run.py   메모리 목(mock) 으로 하는 빠른 시뮬레이션 (window.claude 주입)
```

빌드: `python3 build.py` · 엔진 테스트: `node test/engine.test.js`
E2E: `npm install && npm run test:e2e` (firebase emulators:exec — Java 필요. 테스트가 gstatic 의 SDK 요청을
node_modules/firebase 의 같은 버전 파일로 바꿔 치기하므로 package.json 의 firebase 버전 = backend-firebase.js 의 VERSION 유지).
프록시 환경에서 firebase-tools 가 localhost 에뮬레이터 요청까지 HTTPS_PROXY 로 보내면 그 프로세스에만 `HTTPS_PROXY=undefined`.
목 시뮬레이션: 프로젝트 루트에서 `python3 -m http.server 8765` 실행 후 `python3 test/run.py`

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

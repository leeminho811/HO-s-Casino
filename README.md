# ♠ HO’s Casino

친구들과 **링크 하나로** 함께하는 노리밋 텍사스 홀덤. 로그인 없이 닉네임만 정하면 바로 앉을 수 있어요. (실제 돈 없음)

- 최대 8명 · 봇 추가 가능 · 리바이 · 제한 시간 · 리액션
- 방 코드(링크 끝의 `#ABC123`)마다 따로 노는 테이블
- 처음 앉은 사람 기기가 딜러가 되어 카드를 섞고, 각자 패는 본인 기기에서만 열리도록 암호화돼요
- 딜러가 나가면 남은 사람 중 한 명이 자동으로 딜러를 이어받아요

---

## 처음 한 번만: 서버 설정 (10분쯤)

게임 데이터를 주고받을 무료 서버로 **Firebase**(구글)를 써요. 방장 한 명만 하면 되고, 친구들은 아무것도 할 필요 없어요. 결제 정보도 필요 없어요.

### 1단계 — Firebase 프로젝트 만들기
1. <https://console.firebase.google.com> 에 구글 계정으로 들어가요.
2. **프로젝트 만들기** → 이름은 아무거나 (예: `hos-casino`) → Google 애널리틱스는 꺼도 돼요 → 만들기.

### 2단계 — 웹 앱 등록
1. 프로젝트 첫 화면의 **`</>`(웹)** 아이콘을 눌러요.
2. 앱 닉네임 `HO’s Casino` → **앱 등록** (Firebase 호스팅 체크는 안 해도 돼요).
3. 화면에 나오는 `const firebaseConfig = { ... }` 부분을 복사해 두세요.
   (나중에 ⚙️ 프로젝트 설정 → 일반 → 내 앱 에서도 다시 볼 수 있어요.)

### 3단계 — 익명 로그인 켜기
**빌드 → Authentication → 시작하기 → 로그인 방법** 탭 → **익명** → 사용 설정 → 저장.

### 4단계 — Realtime Database 만들기
1. **빌드 → Realtime Database → 데이터베이스 만들기**
2. 위치는 **싱가포르 (asia-southeast1)** — 하노이에서 가장 가까워요 → **잠금 모드로 시작** → 사용 설정.
3. **규칙** 탭에서 내용을 전부 지우고, 이 저장소의 [`database.rules.json`](database.rules.json) 내용을 그대로 붙여 넣은 뒤 **게시**.
4. **데이터** 탭 맨 위의 주소(`https://○○○.asia-southeast1.firebasedatabase.app`)가 `databaseURL` 이에요.
   2단계에서 복사한 설정에 `databaseURL` 이 없으면 이 주소를 넣으면 돼요.

### 5단계 — `firebase-config.js` 채우기
GitHub에서 [`firebase-config.js`](firebase-config.js) 를 열고 ✏️(편집) → 2단계에서 복사한 값으로 바꾸고 → **Commit changes**.

```js
window.FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "hos-casino.firebaseapp.com",
  databaseURL: "https://hos-casino-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "hos-casino",
  storageBucket: "hos-casino.firebasestorage.app",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef",
};
```

> 이 값들은 비밀번호가 아니에요. 웹 앱이면 원래 공개되는 값이고, 보안은 4단계의 데이터베이스 규칙이 맡아요.
> 값을 Claude에게 붙여 주면 대신 넣어 줄 수도 있어요.

### 6단계 — GitHub Pages로 사이트 공개
1. 저장소 **Settings → Pages**
2. **Source: Deploy from a branch** → Branch에서 **main** 과 **/(root)** 선택 → **Save**.
3. 1~2분 뒤 <https://leeminho811.github.io/HO-s-Casino/> 에서 열려요.

---

## 친구들이랑 치는 법

1. 사이트를 열면 주소 끝에 방 코드(`#ABC123`)가 자동으로 붙어요.
2. 빈 자리를 눌러 닉네임을 정하고 앉아요. **처음 앉은 사람이 딜러(방장)** 예요.
3. **친구 초대** 버튼 → **링크 복사** → 카톡 등으로 보내요. 친구는 링크만 누르면 같은 테이블이에요.
4. 2명 이상 앉으면 딜러가 **게임 시작**. 사람이 모자라면 **봇 추가**.

- ☰ 메뉴: 자리 비우기 · 리바이 · 닉네임 변경 · 점수판 · 기록 · 족보 · 블라인드/시작 칩/제한 시간 설정(딜러)
- 딜러 휴대폰이 꺼지거나 창을 닫으면 몇 초 뒤 다른 사람이 자동으로 딜러를 이어받아요.
  진행 중이던 핸드는 무효가 되고 걸었던 칩은 돌아가요.
- 다른 방 코드를 넣거나 **새 테이블 만들기**로 다른 테이블을 열 수 있어요 (☰ 메뉴 → 다른 테이블).

## 무료 사용량

Firebase 무료(Spark) 요금제: 동시 접속 100명, 월 10GB 전송. 6명이 쳐도 한 달에 수백 시간은 충분해요.

## 문제 해결

| 화면에 나오는 말 | 확인할 것 |
|---|---|
| 아직 서버(Firebase)가 연결되지 않았어요 | 5단계 — `firebase-config.js` 에 `apiKey`, `databaseURL` 이 들어갔는지 |
| Firebase 익명 로그인이 꺼져 있어요 | 3단계 |
| 데이터베이스 보안 규칙이 막고 있어요 | 4단계 3번 — 규칙을 붙여 넣고 **게시**했는지 |
| 계속 "연결 중…" | `databaseURL` 주소가 데이터 탭의 주소와 똑같은지 |

설정을 바꾼 뒤에는 휴대폰에서 새로고침(필요하면 1~2분 뒤 다시)하세요.

---

## 개발

```
src/engine.js            순수 게임 로직 (족보, 베팅, 사이드팟, 봇)
src/app.js               UI + 딜러/요청 동기화 + 카드 암호화
src/backend-firebase.js  Firebase(익명 로그인 + Realtime Database) 연결
src/app.css, shell.html  스타일, HTML 뼈대
build.py                 src/ → index.html 한 파일로 합치기
firebase-config.js       Firebase 설정값 (index.html 이 따로 불러옴)
database.rules.json      Realtime Database 보안 규칙
```

- 빌드: `python3 build.py` (src/ 를 고친 뒤 꼭 다시 빌드해서 `index.html` 도 함께 커밋)
- 엔진 테스트: `node test/engine.test.js`
- 실제 Firebase 에뮬레이터로 3명 동시 플레이 테스트: `npm install` 후 `npm run test:e2e` (Java 필요)

#!/usr/bin/env node
/**
 * 매뉴얼 화면 촬영.
 *
 *   MANUAL_BOOK=user MANUAL_WEB=http://localhost:6273 MANUAL_API=http://localhost:6160 MANUAL_PASS=... pnpm manual:shots
 *   MANUAL_SHOTS_ONLY=home,issue-list ...   # 일부만 다시 찍기 (boxes.json 은 샷 단위로 합쳐진다)
 *
 * 환경변수: MANUAL_BOOK(기본 user) · MANUAL_WEB · MANUAL_API · MANUAL_PASS(로그 출력 금지) · MANUAL_SHOTS_ONLY(쉼표 id).
 * MANUAL_WEB·MANUAL_API·MANUAL_PASS 는 기본값이 없다 — 촬영할 장면이 있는데 하나라도 비면 이름만 알리고 exit 1.
 * (기본값을 두면 공유 개발 웹과 격리 API 처럼 서로 다른 스택을 섞어 찍을 수 있어서다.)
 * 종료 코드: 0 성공·장면 없음, 1 촬영 실패·환경변수 누락, 2 사용법 오류(알 수 없는 책·장면이 없는 id).
 * 전제: 시드가 끝난 격리 스택. 운영·공유 DB 를 찍지 않는다.
 *
 * 결정적으로 찍는다: 촬영 컨텍스트(newShotContext)가 모든 문서에서 토스트를 숨기고 애니메이션·전환을 0초로 만들며, rec.shoot 이 입력 커서를 숨긴다.
 * 그 밖에 촬영 중 스스로 바뀌는 UI(유휴 자동 복귀, 회전하는 캐러셀, 상대 시간 표기)는
 * 장면이 끄거나 고정한다(smart-dcim 교훈). 장면별 실패는 모아서 끝에 보고하고 하나라도 실패면 exit 1.
 * 실패한 장면이 기록하던 좌표와 임시 그림은 버린다(rec.begin/commit/discard) — boxes.json·PNG 에는 끝까지 성공한 장면만 반영된다.
 * Playwright 는 장면이 있을 때만 불러온다 — 장면 0개면 브라우저 없이 정상 종료한다.
 */
import { resolveBooks } from './lib/books.mjs';
import { loadChromium } from './lib/cli.mjs';
import { createShotRecorder, selectScenes, signIn, unknownShotIds } from './lib/capture-kit.mjs';
import { blockedRequests, resetGuard } from './lib/scene-kit.mjs';

const [book] = resolveBooks(process.env.MANUAL_BOOK); // 생략하면 user
const bookKey = book.key;
const ONLY = process.env.MANUAL_SHOTS_ONLY ? new Set(process.env.MANUAL_SHOTS_ONLY.split(',')) : null;

/**
 * 장면용 API 헬퍼 — 로그인해 받은 bearer 토큰으로 JSON 요청. 시드·정리용이며 화면 촬영은 UI 로 한다.
 * 경로 접두사는 책 설정(capture.apiBase)을 따른다 — 운영자 책은 /api/platform 에 로그인해 플랫폼 토큰을 받는다.
 * API·PASS 는 아래 환경변수 검사 뒤에 정해지며, 이 함수는 그 뒤(장면 실행 중)에만 불린다.
 */
async function makeApi(username) {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PASS }),
  });
  if (!login.ok) throw new Error(`API 로그인 실패(${username}): ${login.status}`);
  const { accessToken } = await login.json();
  return async (method, p, body) => {
    const res = await fetch(API + p, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };
}

const { scenes } = await import(`./scenes/${bookKey}.mjs`);
const unknown = unknownShotIds(ONLY, scenes);
if (unknown.length) {
  console.error(`MANUAL_SHOTS_ONLY 에 장면이 없는 id: ${unknown.join(', ')}`); // 오타가 조용히 성공하지 않게
  process.exit(2);
}
const todo = selectScenes(ONLY, scenes); // 그림 id 를 적어도 그 그림을 찍는 장면이 돈다
if (todo.length === 0) {
  console.log(`[${bookKey}] 촬영할 장면이 없다.`);
  process.exit(0);
}

// 찍을 장면이 있을 때만 접속 정보를 요구한다. 빈 문자열도 없는 것으로 보고, 값은 출력하지 않는다(비밀번호 보호).
const missingEnv = ['MANUAL_WEB', 'MANUAL_API', 'MANUAL_PASS'].filter((k) => !process.env[k]);
if (missingEnv.length) {
  console.error(`촬영에 필요한 환경변수가 없습니다: ${missingEnv.join(', ')}`);
  process.exit(1);
}
const WEB = process.env.MANUAL_WEB;
const API = `${process.env.MANUAL_API}${book.capture.apiBase}`;
const PASS = process.env.MANUAL_PASS;

// 장면이 있을 때만 Playwright 를 불러온다(웹 앱의 의존성을 빌려 쓴다).
const chromium = loadChromium();

const rec = createShotRecorder({ book: bookKey, viewport: book.capture.viewport });
const failures = [];
// 브라우저 UI 언어를 한국어로 띄운다 — 날짜·시각 입력칸(datetime-local)처럼 브라우저가 직접 그리는 칸은 컨텍스트 locale 이 아니라
// 이 값을 따른다(없으면 「10/29/2026, 06:20 PM」 처럼 영어 형식으로 찍힌다).
const browser = await chromium.launch({ args: ['--lang=ko-KR'] });
// 계정별 세션 재사용 — 로그인한 브라우저 컨텍스트와 API 헬퍼. 장면마다 로그인하면 로그인 요청 제한(분당 20회/IP)에 걸릴 수 있다.
const sessions = new Map();
try {
  for (const s of todo) {
    console.log(`▶ ${s.id}`);
    blockedRequests.length = 0; // 이 장면이 막은 요청만 모아 끝에 출력한다
    try {
      await rec.begin(); // 이 장면의 좌표·그림은 성공해야 확정된다
      if (!sessions.has(s.account)) {
        const context = await signIn(browser, {
          web: WEB,
          username: s.account,
          password: PASS,
          usernameSelector: book.capture.usernameSelector,
          viewport: book.capture.viewport,
        });
        sessions.set(s.account, { context, api: await makeApi(s.account) });
      }
      const { context, api } = sessions.get(s.account);
      // 로그인한 첫 페이지를 쓴다(토큰이 메모리에만 있어 새 페이지는 로그아웃 상태일 수 있다).
      try {
        await s.run({ page: context.pages()[0], rec, api });
      } finally {
        resetGuard(context); // 장면이 연 허용(allowRead·allowWrite)·추가 차단을 다음 장면에 넘기지 않는다
        if (blockedRequests.length) console.log(`  막은 요청 ${blockedRequests.length}건: ${[...new Set(blockedRequests)].join(', ')}`);
      }
      await rec.commit();
    } catch (e) {
      await rec.discard(); // 실패한 장면이 남긴 좌표·임시 그림은 boxes.json·PNG 에 반영하지 않는다
      failures.push(`${s.id}: ${e.message.split('\n')[0]}`);
      console.error(`  ✗ ${e.message.split('\n')[0]}`);
    }
  }
} finally {
  try {
    await rec.save();
  } finally {
    await browser.close(); // save 가 실패해도 브라우저는 반드시 닫는다
  }
}
if (failures.length) {
  console.error(`\n실패 ${failures.length}건:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

// 촬영 실행기 — 매뉴얼(capture.mjs)과 제품 소개 자료(docs/intro/scripts/capture.mjs)가 같은 흐름으로 장면을 돈다.
// 장면 고르기 → 환경변수 확인 → 계정별 로그인 세션 재사용 → 장면 단위 확정(commit/discard) → boxes.json 저장 → 실패 모아 보고.
// 환경변수: MANUAL_WEB · MANUAL_API · MANUAL_PASS(로그 출력 금지) · MANUAL_SHOTS_ONLY(쉼표 id).
import { loadChromium } from './cli.mjs';
import { createShotRecorder, selectScenes, signIn, unknownShotIds } from './capture-kit.mjs';
import { blockedRequests, resetGuard } from './scene-kit.mjs';

/**
 * 장면 목록을 찍고 종료 코드를 돌려준다(capture.mjs 머리 주석과 같다 — 진입 스크립트가 process.exit 에 넘긴다).
 * label 은 로그 머리(책 이름 등), capture 는 { apiBase, usernameSelector, viewport? }, recorder 는 createShotRecorder 인자
 * ({ book } 이면 docs/manual/shots/<book>, { dir } 를 주면 그 폴더 — 소개 자료는 docs/intro/deck/shots).
 */
export async function runCapture({ label, scenes, capture, recorder }) {
  const ONLY = process.env.MANUAL_SHOTS_ONLY ? new Set(process.env.MANUAL_SHOTS_ONLY.split(',')) : null;
  const unknown = unknownShotIds(ONLY, scenes);
  if (unknown.length) {
    console.error(`MANUAL_SHOTS_ONLY 에 장면이 없는 id: ${unknown.join(', ')}`); // 오타가 조용히 성공하지 않게
    return 2;
  }
  const todo = selectScenes(ONLY, scenes); // 그림 id 를 적어도 그 그림을 찍는 장면이 돈다
  if (todo.length === 0) {
    console.log(`[${label}] 촬영할 장면이 없다.`);
    return 0;
  }
  // 찍을 장면이 있을 때만 접속 정보를 요구한다. 빈 문자열도 없는 것으로 보고, 값은 출력하지 않는다(비밀번호 보호).
  const missingEnv = ['MANUAL_WEB', 'MANUAL_API', 'MANUAL_PASS'].filter((k) => !process.env[k]);
  if (missingEnv.length) {
    console.error(`촬영에 필요한 환경변수가 없습니다: ${missingEnv.join(', ')}`);
    return 1;
  }
  const WEB = process.env.MANUAL_WEB;
  const API = `${process.env.MANUAL_API}${capture.apiBase}`;
  const PASS = process.env.MANUAL_PASS;

  // 장면이 있을 때만 Playwright 를 불러온다(웹 앱의 의존성을 빌려 쓴다).
  const chromium = loadChromium();

  const rec = createShotRecorder({ ...recorder, viewport: capture.viewport });
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
            usernameSelector: capture.usernameSelector,
            viewport: capture.viewport,
          });
          sessions.set(s.account, { context, api: await makeApi(API, s.account, PASS) });
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
    return 1;
  }
  return 0;
}

/**
 * 장면용 API 헬퍼 — 로그인해 받은 bearer 토큰으로 JSON 요청. 시드·정리용이며 화면 촬영은 UI 로 한다.
 * 경로 접두사는 책 설정(capture.apiBase)을 따른다 — 운영자 책은 /api/platform 에 로그인해 플랫폼 토큰을 받는다.
 */
async function makeApi(API, username, PASS) {
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

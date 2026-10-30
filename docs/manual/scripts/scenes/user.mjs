// user 매뉴얼 촬영 장면 목록(WP-1196). 촬영 대상 표(shots/targets.md 「사용자 매뉴얼」)를 구현한다.
// 04장 그림 ai-collaboration-2 는 여기서 찍는다. 1·3·4·5 는 AI 결과가 필요해 once 장면(아래 「AI 결과 장면」)으로 찍는다.
//
// 장면 형식:
//   { id: '샷-id', shots?: ['샷-id', ...], account: '계정 아이디', async run({ page, rec, api }) { ... } }
//   - page: 로그인된 Playwright 페이지(뷰포트 1440x810, 배율 2, 라이트 테마)
//   - rec:  createShotRecorder — 장면은 capture() 로 표식 좌표를 쌓고 그림을 저장한다
//   - api:  (method, path, body?) → JSON. MANUAL_API 에 이 계정의 bearer 토큰으로 요청하는 헬퍼(이 책 장면은 쓰지 않는다)
//
// 촬영 환경은 **운영**의 매뉴얼 전용 테넌트(누리커머스)다. 그래서 장면은 읽기만 한다(앱이 저절로 보내는 읽음 처리 같은 쓰기는
// openHome·openApp 이 거는 guardReadOnly 가 브라우저 안에서 막는다):
//   화면을 열고, 메뉴·창을 열고, 칸을 채운 뒤 닫기만 한다. 로그인 폼 제출·알림 읽음·위젯 추가·저장·테마 전환을 하지 않는다.
//   편집 모드는 언제나 「취소」로 끝내고, 레일 펼침처럼 브라우저 저장소에 남는 조작은 finally 에서 되돌린다.
// 페이지는 계정별로 공유된다: 장면은 먼저 자기 시작 URL 로 goto 한다(앞 장면의 화면이 남아 있을 수 있다).
// 결정적으로 찍는다: 브라우저 시계를 FIXED_NOW 로 고정해 「n분 전」·「오늘」 계산이 매번 같게 한다(아래 주석).
import { newShotContext } from '../lib/capture-kit.mjs';
import { blurActive, byTestId, capture, closeDialog, dialog, fontsReady, guardReadOnly, MARK_PAD, settleStable, WEB } from '../lib/scene-kit.mjs';
import { SCENE_ISSUES } from '../lib/user-seed.mjs';

const ACCOUNT = 'seoyeon@example.com'; // 소유자 김서연 — 시드(seed-user.mjs)가 쓰는 촬영 계정

// 읽기 전용 가드가 GET 인데도 막는 요청 — 화면 여는 도우미(openHome·openApp·withMobile)가 모두 이 하나를 건다.
// 채널 캐치업 요약(GET …/catchup)·노트 페이지 요약(GET …/summary)은 AI 를 부른다. 메일 상세 GET 은 markSeen 기본값이 true 라(서버)
// 웹이 붙이는 markSeen=false 없이 가는 조회는 읽음을 바꿀 수 있다. 이 가운데 하나를 여는 once 장면은 allowRead 로 그 경로만 연다.
// once 장면이 여는 요청 — 장면마다 guardReadOnly 에 넘긴다(장면이 끝나면 촬영기가 걷는다).
const ALLOW_AI_CHAT = (method, url) => method === 'POST' && /\/api\/v1\/ai\/chat$/.test(url); // AI 어시스턴트 대화 시작
const ALLOW_DRIVE_SPACE = (method, url) => method === 'POST' && /\/messaging\/channels\/\d+\/drive-space$/.test(url); // 채널 드라이브 열기
const ALLOW_CATCHUP = (url) => /\/catchup(\?|$)/.test(url); // 놓친 대화 요약 GET
const ALLOW_AI_SUMMARY = (method, url) =>
  method === 'POST' && url.endsWith(`/api/v1/projects/MOB/issues/${SCENE_ISSUES.aiSummary.number}/ai-summary`); // AI 현황 요약
const ALLOW_AI_CLASSIFY = (method, url) => method === 'POST' && /\/api\/v1\/projects\/MOB\/issues\/ai-classify$/.test(url); // AI 제안 받기
const ALLOW_WIKI_AI = (method, url) => method === 'POST' && /\/api\/v1\/wiki\/pages\/\d+\/ai$/.test(url); // 노트 AI 초안

const BLOCK_GET = (url) =>
  /\/(catchup|summary)(\?|$)/.test(url) || (/\/mail\/messages\/\d+(\?|$)/.test(url) && !/markSeen=false/.test(url));

// 브라우저 시계를 고정할 시각 — 마지막 시드(대화·캘린더 보강: DM·스레드 답글·반응·초대 일정·태그)를 넣은 직후.
// 그 시드의 마지막 쓰기가 2026-10-29 19:49:03 KST 라, 그 뒤 몇 분으로 두어 「n분 전」이 자연스럽고 오늘이 10-29 로 남게 한다.
// (그 전 홈 보강 시드 — 오늘 마감 MOB-14·기한 지남 MOB-15·이준호의 멘션 — 는 18:13:33 KST 에 넣었다.)
// 홈의 「n분 전」, 오늘 일정, 마감 계산이 모두 브라우저 시각 기준이라 고정하지 않으면 다시 찍을 때마다 그림이 바뀐다.
// 시드가 날짜를 촬영일 기준 상대값으로 넣으므로 **시드를 다시 넣으면 이 값도 새 시드 직후로 바꾼다.**
// 실제 시각보다 앞선 시각은 쓰지 않는다(토큰 만료 판단이 미래 시각으로 어긋나지 않게) — 이 시각이 지난 뒤에 찍는다.
const FIXED_NOW = new Date('2026-10-29T19:55:00+09:00');

// 홈 위젯 본문은 지연 로딩되고 각자 데이터를 따로 받는다 — 스켈레톤·aria-busy 가 모두 사라지고 글꼴이 다 읽힌 뒤 찍는다.
async function settle(page) {
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-testid=dashboard-skeleton], [aria-busy="true"], [data-slot=skeleton]').length === 0,
    null,
    { timeout: 20000 },
  );
  await fontsReady(page);
}

/** 화면 여는 도우미 공통 준비 — 쓰기·AI GET 차단(BLOCK_GET)을 걸고, 시계를 고정하고, path 로 간다. */
async function prime(page, path) {
  await guardReadOnly(page.context(), { extraBlock: BLOCK_GET });
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto(`${WEB()}${path}`);
}

/** 시계를 고정하고 홈을 연다. 요약·내 작업·오늘 일정·알림 위젯이 다 그려질 때까지 기다린다. */
async function openHome(page) {
  await prime(page, '/');
  await page.getByTestId('dashboard-counts').waitFor();
  await page.getByTestId('dash-mytasks').waitFor();
  await page.getByTestId('inbox-trigger').waitFor();
  // AI 비서가 있는 계정이라 화면 위 가운데에 AI 어시스턴트 단추가 뜬다(useAiAvailable). 단추만 기다리고 누르지 않는다.
  await page.getByTestId('chat-launcher').waitFor();
  await settle(page);
}

/** 로그아웃 상태 화면을 새 컨텍스트에서 연다 — 공유 페이지를 로그아웃시키지 않는다. 끝나면 컨텍스트를 닫는다. */
async function withLoggedOut(page, fn) {
  const ctx = await newShotContext(page.context().browser());
  try {
    await fn(await ctx.newPage());
  } finally {
    await ctx.close();
  }
}

/** 레일을 펼친 채로 fn 을 돌린다. 펼침은 localStorage(app-rail-expanded)에 남으므로 끝나면 지운다(다음 장면은 goto 로 다시 접힌 상태). */
async function withRailExpanded(page, fn) {
  await page.getByTestId('rail-toggle').click();
  await page.getByTestId('rail-collapse').waitFor();
  try {
    await fn();
  } finally {
    await page.evaluate(() => localStorage.removeItem('app-rail-expanded'));
  }
}

/** 편집 모드로 fn 을 돌리고, 어떻게 끝나든 저장하지 않고 「취소」로 빠져나온다(열린 창은 먼저 닫는다). */
async function withEditMode(page, fn) {
  await page.getByTestId('dashboard-edit-toggle').click();
  await page.getByTestId('dashboard-edit-banner').waitFor();
  try {
    await fn();
  } finally {
    if (await page.getByTestId('add-widget-modal').isVisible()) await page.keyboard.press('Escape');
    if (await page.getByTestId('dashboard-edit-cancel').isVisible()) await page.getByTestId('dashboard-edit-cancel').click();
  }
}

// ── 06 메일(M365 연결 중에만 찍는다) ────────────────────────────────────────────
// 김서연 계정에 사용자가 직접 연결한 실제 Outlook(Microsoft 365) 메일함이다. 그래서
// - 목록은 시연 메일 검색어 「【누리커머스】」 로만 연다(검색하지 않은 받은편지함은 실제 메일이 보인다).
// - 목록 행(보낸 사람 실명)·사이드바(폴더별 안 읽은 수)·레일(메일 배지)은 자르기 밖에 둔다.
// - 서버 검색은 본문 전문 검색이라 옛 사본 「[누리커머스]」 도 결과에 섞인다 — 상세는 제목 전체로 골라 연다.
// - 동기화가 끝난 뒤(sync-status 의 running=false) 찍는다. 읽음 처리·AI 요청은 guardReadOnly 가 막는다.
// - 원본 PNG 도 저장소에 커밋되므로 자르기 영역 밖은 찍기 전에 가린다(capture 의 redact — 그림 지시문 crop 키와 같게 둔다).
const MAIL_QUERY = '【누리커머스】';
const MAIL_SUBJECT = '【누리커머스】 배송 추적 API 개편 관련 미팅 요청';

/** 메일함을 시연 메일 검색어로 연다. 첫 계정으로 넘어간 주소에 검색어를 붙이고, 동기화가 끝날 때까지 기다린다. */
async function openMail(page) {
  await openApp(page, '/mail');
  await page.waitForURL(/\/mail\/\d+/);
  const accountPath = new URL(page.url()).pathname;
  await page.goto(`${WEB()}${accountPath}?q=${encodeURIComponent(MAIL_QUERY)}`);
  await page.getByText(MAIL_SUBJECT, { exact: true }).first().waitFor();
  await waitMailSynced(page);
}

/**
 * 동기화가 끝날 때까지 기다린다. 화면은 동기화가 도는 동안에만 sync-status 를 부르고(running 이면 1초마다), 그동안
 * 「본문 n/m」 진행률을 보이고 새로고침 단추를 잠근다 — 진행률이 없고 「… 동기화됨」 이 보이며 단추가 풀리면 running=false 다.
 */
async function waitMailSynced(page) {
  await page.waitForFunction(
    () => {
      const sync = document.querySelector('[data-testid="mail-sync"]');
      const at = document.querySelector('[data-testid="mail-synced-at"]');
      return (
        sync && !sync.disabled && at && at.offsetParent !== null && !document.querySelector('[data-testid="mail-sync-progress"]')
      );
    },
    null,
    { timeout: 300000 },
  );
}

/**
 * AI 어시스턴트에게 한 번 묻고 답이 끝날 때까지 기다린다(once 장면 전용 — 실제 AI 1회).
 * 이 컨텍스트에서 POST /ai/chat(대화 시작)만 연다. 추천 질문(POST /ai/suggestions — 별도 AI 호출)·확인 카드 승인/거부는 막힌 채 둔다.
 * 어시스턴트의 도구는 서버에서 돌아 브라우저 차단이 닿지 않으므로, 프롬프트는 읽기 또는 확인 카드(propose)로만 끝나는 요청만 쓴다.
 * 앞 대화를 이어 받지 않게 새 대화로 시작한다(새 대화는 화면 안에서만 초기화한다 — 서버 쓰기 없음).
 */
async function askAssistant(page, prompt) {
  await guardReadOnly(page.context(), { allowWrite: ALLOW_AI_CHAT });
  await page.getByTestId('chat-launcher').click();
  const panel = page.getByTestId('chat-panel');
  await panel.waitFor();
  if (process.env.MANUAL_AI_REUSE === '1') {
    // MANUAL_AI_REUSE=1: 새로 묻지 않고 이 질문으로 시작한 대화를 다시 연다(GET 만 — AI 를 다시 부르지 않는다).
    // 답은 받았는데 찍기에서 실패한 장면을 같은 답으로 다시 찍을 때 쓴다.
    await panel.getByTestId('chat-session-switcher').click();
    // 대화 제목은 첫 질문에서 온다 — 질문 앞부분으로 이 장면의 대화를 고른다(뒤에 다른 장면의 대화가 쌓여도 맞는 것을 연다).
    await page.getByTestId('chat-session-select').filter({ hasText: prompt.slice(0, 12) }).first().click();
    await panel.getByTestId('chat-widgets').last().waitFor({ timeout: 30000 });
  } else {
    if ((await panel.getByTestId('ai-chat-empty-state').count()) === 0) await panel.getByTestId('chat-new-session').click();
    await panel.getByTestId('ai-chat-empty-state').waitFor();
    await panel.getByTestId('chat-input').fill(prompt);
    await panel.getByTestId('chat-send').click();
    await panel.getByTestId('chat-user-bubble').waitFor();
    await panel.getByTestId('chat-stop').waitFor({ timeout: 30000 }).catch(() => {});
    await panel.getByTestId('chat-stop').waitFor({ state: 'detached', timeout: 300000 });
    await page.waitForFunction(() => !document.querySelector('[data-testid="chat-pending"]'), null, { timeout: 60000 });
  }
  // 공통 마무리 — 답이 다 그려지게 잠깐 두고, 입력 칸 포커스·hover 를 풀고, 글꼴을 기다린다.
  await page.waitForTimeout(1500);
  await blurActive(page);
  await page.mouse.move(0, 0);
  await fontsReady(page);
  return panel;
}

/** 방금 대화에서 남은 확인 카드(대기 제안) id 를 GET 으로 읽어 출력한다 — 코디네이터가 찍은 뒤 거부해 정리한다. */
async function logPendingProposals(api, label) {
  const page = await api('GET', '/home/sessions?size=1');
  const sid = (page?.content ?? page?.items ?? page)?.[0]?.id ?? (page?.content ?? page?.items ?? page)?.[0]?.sessionId;
  const list = sid ? await api('GET', `/home/sessions/${sid}/proposals`) : [];
  console.log(`  ${label} 세션 ${sid} 대기 제안: ${JSON.stringify((list ?? []).map((x) => ({ id: x.id, type: x.type ?? x.actionType ?? x.tool, status: x.status })))}`);
}

/**
 * 대화·캘린더 장면 공용 — 시계를 고정하고 화면을 연다. 이 컨텍스트의 쓰기 요청은 guardReadOnly 가 브라우저 안에서 막는다
 * (채널을 열기만 해도 가는 읽음 처리 POST, 스레드 읽음 POST — 막지 않으면 01~03장 그림의 안 읽음 수가 바뀐다).
 * 채널 캐치업 요약(GET …/catchup)·노트 페이지 요약(GET …/summary)은 AI 를 부르므로 함께 막는다.
 */
async function openApp(page, path) {
  await prime(page, path);
  await page.getByTestId('chat-launcher').waitFor();
}

/** 대화 앱에서 시드 채널 「모바일-주문앱」 을 연다(채널 id 는 운영 값이라 사이드바 이름으로 찾는다). 메시지가 다 그려진 뒤 돌려준다. */
async function openChannel(page) {
  await openApp(page, '/chat');
  await page.getByRole('link', { name: /모바일-주문앱/ }).click();
  await page.getByText('재주문 버튼 최종 시안').waitFor();
  await page.getByText('답글 1개').waitFor();
  await fontsReady(page);
}

/** 캘린더를 월 보기로 연다(시드 일정이 그려질 때까지). 고른 보기는 브라우저에 남으므로 매번 월 보기를 눌러 맞춘다. */
async function openCalendar(page) {
  await openApp(page, '/calendar');
  await page.getByTestId('calendar-view-month-btn').click();
  await page.getByTestId('calendar-view-month').getByText('재주문 디자인 리뷰').first().waitFor();
  await fontsReady(page);
}

/** 뷰포트를 잠시 바꿔(높이를 안 주면 지금 높이) fn 을 돌리고 되돌린다 — 본문 전체 폭 요소를 1400px 근처로 자르려고 데스크톱 최소 폭(1024)으로 찍을 때. */
async function withViewport(page, width, fn, height) {
  const original = page.viewportSize();
  await page.setViewportSize({ width, height: height ?? original.height });
  try {
    await fn();
  } finally {
    await page.setViewportSize(original);
  }
}

// 05장부터의 그림은 표식 상자를 글자에서 조금 띄운다(capture 의 기본 pad = MARK_PAD). 01~03장 그림은 이미 찍어 검수한 좌표라 { pad: 0 } 으로 찍는다.

/** MOB 프로젝트 이슈 목록을 연다. view 는 「목록」·「보드」 — 고른 보기가 브라우저에 남아 매번 눌러 맞춘다. */
async function openProject(page, view) {
  await openApp(page, '/projects/MOB');
  const toggle = page.getByRole('group', { name: '뷰 전환' });
  await toggle.waitFor();
  await (view === '보드' ? toggle.getByRole('button', { name: '보드' }) : toggle.getByRole('button').first()).click();
  await page.getByText('베타 오픈 Go/No-Go 체크리스트 확정').first().waitFor();
  await fontsReady(page);
}

/**
 * MOB 이슈 상세를 연다(코멘트가 그려질 때까지). issue 는 SCENE_ISSUES 의 항목({ number, title }) — 번호로 열고 제목이 맞는지 본다
 * (시드를 다시 넣어 번호가 바뀌면 다른 이슈를 조용히 찍지 않고 여기서 실패한다). AI 현황 요약은 「요약 생성」 을 눌러야 AI 를 부르므로 누르지 않는다.
 */
async function openIssue(page, issue) {
  await openApp(page, `/projects/MOB/issues/${issue.number}`);
  await page.getByRole('heading', { name: issue.title }).first().waitFor();
  await byTestId(page, 'property-rail').waitFor();
  await page.getByText('코멘트', { exact: true }).first().waitFor();
  // 첨부·하위 태스크는 따로 받아 오며 그동안 「로딩 중…」 이 보인다 — 모두 사라진 뒤 찍는다.
  await page.waitForFunction(() => !document.body.innerText.includes('로딩 중'), null, { timeout: 20000 });
  await fontsReady(page);
}

/** 드라이브 팀 공간 「모바일 주문 앱」 을 연다(공간 id 는 운영 값이라 사이드바 이름으로 찾는다). */
async function openDriveSpace(page) {
  await openApp(page, '/drive');
  await byTestId(page, 'drive-space-list').getByText('모바일 주문 앱').click();
  await page.getByText('기획', { exact: true }).first().waitFor();
  await fontsReady(page);
}

/** 노트 팀 스페이스의 「제품 요구사항 (PRD)」 를 연다. 본문이 동기화돼 그려질 때까지 기다린다. */
async function openWikiPage(page) {
  await openApp(page, '/wiki');
  const space = page.getByRole('combobox').first();
  if (!(await space.textContent()).includes('모바일 주문 앱')) {
    await space.click();
    await page.getByRole('option', { name: '모바일 주문 앱' }).click();
  }
  await page.getByText('제품 요구사항 (PRD)').first().click();
  await byTestId(page, 'page-body-content').getByText('재주문 소요 시간 60% 단축').waitFor();
  await fontsReady(page);
}

/**
 * 레일·탭바의 안 읽음 배지가 다 그려질 때까지 기다린다. 배지는 대화·알림 수를 따로 받아 늦게(때로 1 → 10 처럼 나눠) 그려진다.
 * 안 읽음이 없으면 배지가 없으므로 등장은 잠깐만 기다리고, 그 뒤 글자가 두 번 연속 같을 때까지 본다.
 */
async function settleBadges(page, ids) {
  await Promise.all(ids.map((id) => page.getByTestId(id).first().waitFor({ timeout: 10000 }).catch(() => {})));
  await settleStable(page, () =>
    page.evaluate((list) => list.map((id) => document.querySelector(`[data-testid="${id}"]`)?.textContent ?? '').join('|'), ids),
  );
}


/**
 * 누르기 영역(최소 높이 44px 등)이 글자보다 훨씬 큰 링크·단추의 글자 상자를 돌려준다 — 표식 상자가 위아래로 벌어지지 않게.
 * 요소의 자식(React 가 관리하는 노드)은 건드리지 않는다: 내용 전체를 감싼 Range 의 상자를 재어, 그 자리에 투명한 고정 위치 상자를
 * body 끝에 하나 두고 그 로케이터를 돌려준다. 상자는 보이지 않고(opacity 0) 누르기도 받지 않는다. 재는 시점의 화면 좌표라
 * 스크롤을 끝낸 뒤, 표식을 기록하기 직전에 부른다.
 */
async function textOnly(locator) {
  const n = await locator.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    const box = document.createElement('div');
    const n = String(document.querySelectorAll('[data-shot-text]').length);
    box.dataset.shotText = n;
    box.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;opacity:0;pointer-events:none`;
    document.body.append(box);
    return n;
  });
  return locator.page().locator(`[data-shot-text="${n}"]`);
}

/** 설정 화면을 연다 — 시계 고정·쓰기 차단(openApp)을 건 뒤 그 화면의 문구가 보일 때까지 기다린다. */
async function openSettings(page, path, readyText) {
  await openApp(page, path);
  // 같은 문구가 숨은 요소(낭독용 등)에도 있을 수 있어 보이는 것만 기다린다.
  await page.getByText(readyText, { exact: true }).filter({ visible: true }).first().waitFor();
  await settleBadges(page, ['inbox-badge', 'rail-badge-/chat']);
  await fontsReady(page);
}

/** 에이전트 지니의 상세 패널을 연다. */
async function openAgent(page) {
  await openSettings(page, '/settings/agents', 'genie');
  await page.locator('tr[data-testid^="agent-row-"]').filter({ hasText: 'genie' }).first().click();
  await dialog(page).getByText('에이전트 정보', { exact: true }).waitFor();
  // 패널이 열리면 이름 칸이 포커스되며 글자가 선택돼 보인다 — 포커스를 풀고 찍는다.
  await blurActive(page);
  await fontsReady(page);
}

/** 감사 로그를 열고 설명 검색으로 시드의 「구성원 계정 생성」 행만 남긴다(로그인 행은 찍을 때마다 늘어난다). */
async function openAudit(page) {
  await openSettings(page, '/settings/audit-logs', '설명');
  await page.getByPlaceholder('설명으로 검색...').fill('구성원 계정 생성');
  await page.getByText('구성원 계정 생성: yuna@example.com (역할 USER)').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length === 4, null, { timeout: 15000 });
  // 검색 칸의 포커스 테두리(바깥으로 번지는 링)가 표 그림 위 끝에 걸리지 않게 포커스를 푼다.
  await blurActive(page);
}

/**
 * 모바일 폭(390x844)으로 바꿔 fn 을 돌리고 데스크톱 폭으로 되돌린다. 앱은 폭(lg 미만)으로 모바일 셸을 고른다.
 * 배율은 촬영 컨텍스트 그대로(2)라 원본은 780x1688 이다.
 */
async function withMobile(page, path, fn) {
  await withViewport(
    page,
    390,
    async () => {
      await prime(page, path);
      // 탭바 순서 편집 화면은 탭바를 감추므로 모바일 셸의 다른 표지(편집 화면 머리)도 받는다.
      await page.getByTestId('mobile-tabbar').or(page.getByTestId('tab-edit-header')).first().waitFor();
      await settleBadges(page, ['mobile-bell-badge', 'mobile-tab-badge-chat']);
      await fontsReady(page);
      await fn();
    },
    844,
  );
}

/** 목록 행 전체(체크박스·아이콘 포함) — 이름 글자만 잡으면 상자가 글자에 붙으므로 testid 접두어로 행 컨테이너를 잡는다. */
const rowOf = (page, prefix, text, tag = '') => page.locator(`${tag}[data-testid^="${prefix}"]`).filter({ hasText: text }).first();
const widget = (page, type) => page.locator(`[data-widget=${type}]`);
const railLinks = (page) => page.locator('[data-testid=app-rail] nav a');

export const scenes = [
  // ── 01 소개 ──
  {
    id: 'introduction-1',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openHome(page);
      await withRailExpanded(page, () =>
        capture(page, rec, 'introduction-1', { rail: byTestId(page, 'app-rail') }, { pad: 0 }),
      );
    },
  },

  // ── 02 로그인과 화면 구조 ──
  {
    id: 'login-and-layout-1',
    account: ACCOUNT,
    async run({ page, rec }) {
      await withLoggedOut(page, async (p) => {
        await p.goto(`${WEB()}/login`);
        await p.getByRole('link', { name: 'Microsoft 계정으로 로그인' }).waitFor();
        // 가입이 잠긴 운영에서는 가입 가용성 응답이 오면 「회원가입」 링크가 사라진다 — 사라진 뒤 찍어야 매번 같다.
        await p.getByText('계정이 없으신가요? 회원가입').waitFor({ state: 'detached' });
        await p.getByLabel('아이디').fill(ACCOUNT);
        await p.locator('input[type=password]').fill('password-mask'); // 화면에는 점으로만 보인다(실제 비밀번호 아님). 제출하지 않는다
        await capture(p, rec, 'login-and-layout-1', {
          card: p.locator('[data-slot=card]'),
          username: p.getByLabel('아이디'),
          password: p.locator('input[type=password]'),
          submit: p.getByRole('button', { name: '로그인', exact: true }),
          microsoft: p.getByRole('link', { name: 'Microsoft 계정으로 로그인' }),
        }, { pad: 0 });
      });
    },
  },
  {
    id: 'login-and-layout-2',
    account: ACCOUNT,
    async run({ page, rec }) {
      await withLoggedOut(page, async (p) => {
        await p.goto(`${WEB()}/signup`);
        const notice = p.getByText('회원가입이 비활성화되어 있습니다. 관리자에게 문의하세요.');
        await notice.waitFor();
        await capture(p, rec, 'login-and-layout-2', {
          card: p.locator('[data-slot=card]'),
          notice,
          login: p.getByRole('link', { name: '로그인' }),
        }, { pad: 0 });
      });
    },
  },
  {
    id: 'login-and-layout-3',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openHome(page);
      await capture(page, rec, 'login-and-layout-3', {
        apps: page.locator('[data-testid=app-rail] nav'),
        assistant: byTestId(page, 'chat-launcher'),
        workspace: byTestId(page, 'workspace-switcher'),
        inbox: byTestId(page, 'inbox-trigger'),
        user: byTestId(page, 'rail-user-menu'),
      }, { pad: 0 });
    },
  },
  {
    id: 'login-and-layout-4',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openHome(page);
      await withRailExpanded(page, () =>
        capture(page, rec, 'login-and-layout-4', {
          toggle: byTestId(page, 'rail-collapse'),
          // 레일 링크 첫 항목(홈)부터 마지막 항목(설정)까지 — nav 요소는 아래 빈 공간까지 늘어나 있어 쓰지 않는다.
          apps: [railLinks(page).first(), railLinks(page).last()],
        }, { pad: 0 }),
      );
    },
  },
  {
    id: 'login-and-layout-5',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openHome(page);
      // 목록을 여는 것만으로는 읽음 처리되지 않는다(행을 누를 때만 — InboxList). 행·「모두 읽음」은 누르지 않는다.
      await byTestId(page, 'inbox-trigger').click();
      const panel = byTestId(page, 'inbox-panel');
      await panel.getByTestId('inbox-item').first().waitFor();
      await settle(page);
      await capture(page, rec, 'login-and-layout-5', {
        panel,
        trigger: byTestId(page, 'inbox-trigger'),
        item: panel.getByTestId('inbox-item').first(),
        markAll: panel.getByTestId('inbox-mark-all'),
      }, { pad: 0 });
    },
  },
  {
    id: 'login-and-layout-6',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openHome(page);
      await byTestId(page, 'workspace-switcher').click();
      const menu = page.getByRole('menu');
      // 소속 목록은 메뉴를 열 때 받아 온다 — 「불러오는 중…」 이 「워크스페이스」 로 바뀐 뒤 찍는다.
      await menu.getByText('워크스페이스', { exact: true }).waitFor();
      await menu.getByRole('menuitem').first().waitFor();
      await capture(page, rec, 'login-and-layout-6', { menu, trigger: byTestId(page, 'workspace-switcher') }, { pad: 0 });
    },
  },
  {
    id: 'login-and-layout-7',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openHome(page);
      await byTestId(page, 'rail-user-menu').click();
      const menu = page.getByRole('menu');
      await menu.waitFor();
      // 항목은 누르지 않는다 — 「새 소식」 은 읽음 표시를, 「테마 전환」 은 테마를 바꾼다.
      await capture(page, rec, 'login-and-layout-7', {
        menu,
        trigger: byTestId(page, 'rail-user-menu'),
        profile: page.getByRole('menuitem', { name: '프로필' }),
        whatsNew: byTestId(page, 'whats-new-menu-item'),
        theme: page.getByRole('menuitem', { name: '테마 전환' }),
        logout: page.getByRole('menuitem', { name: '로그아웃' }),
      }, { pad: 0 });
    },
  },

  // ── 03 홈 ──
  {
    id: 'home-1',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openHome(page);
      await capture(page, rec, 'home-1', {
        home: byTestId(page, 'rail-link-/'),
        summary: widget(page, 'synthesis'),
        edit: byTestId(page, 'dashboard-edit-toggle'),
      }, { pad: 0 });
    },
  },
  {
    // 요약 위젯은 본문 전체 폭이라 1440 폭에서는 원본 2600px 가까이 된다. 데스크톱 배치가 유지되는 가장 좁은 폭(1024)으로 찍는다.
    id: 'home-2',
    account: ACCOUNT,
    async run({ page, rec }) {
      await withViewport(page, 1024, async () => {
        await openHome(page);
        await capture(page, rec, 'home-2', {
          counts: byTestId(page, 'dashboard-counts'),
          attention: byTestId(page, 'dashboard-attention'),
        }, { pad: 0 });
      });
    },
  },
  {
    id: 'home-3',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openHome(page);
      const w = widget(page, 'my_tasks');
      // 위젯 전체가 보이도록 가운데로 내린다(스크롤 위치를 고정해 매번 같은 화면).
      await w.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await settle(page);
      await capture(page, rec, 'home-3', {
        widget: w,
        title: w.locator('[data-slot=card-header] a'),
        group: w.getByRole('link', { name: '진행 중 →' }),
        // 묶음 머리 바로 아래 행을 고르면 3번 표식이 2번 상자 옆에 붙어 헷갈린다 — 한 행 아래를 고른다.
        row: w.getByRole('link', { name: '이슈 열기: 포인트·쿠폰 통합' }),
      }, { pad: 0 });
    },
  },
  {
    id: 'home-4',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openHome(page);
      const w = widget(page, 'quick_actions');
      await capture(page, rec, 'home-4', {
        title: w.locator('[data-slot=card-title]'),
        // 단추 묶음 상자는 위젯 전체 폭이라 단추 셋의 합집합으로 기록한다.
        buttons: [w.getByRole('link', { name: '새 이슈' }), w.getByRole('link', { name: '새 대화' })],
        newIssue: w.getByRole('link', { name: '새 이슈' }),
        newMail: w.getByRole('link', { name: '메일 작성' }),
        newChat: w.getByRole('link', { name: '새 대화' }),
      }, { pad: 0 });
    },
  },
  {
    id: 'home-5',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openHome(page);
      await withEditMode(page, async () => {
        const summary = widget(page, 'synthesis');
        await capture(page, rec, 'home-5', {
          add: byTestId(page, 'dashboard-add-widget-open'),
          banner: [byTestId(page, 'dashboard-edit-undo'), byTestId(page, 'dashboard-edit-save')],
          // 첫 위젯(요약) 머리의 단추 줄 — 위로·아래로·숨김·테두리·삭제
          controls: [summary.getByTestId('widget-move-up'), summary.getByTestId('widget-remove')],
          save: byTestId(page, 'dashboard-edit-save'),
        }, { pad: 0 });
      });
    },
  },
  {
    id: 'home-6',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openHome(page);
      await withEditMode(page, async () => {
        await byTestId(page, 'dashboard-add-widget-open').click();
        const modal = byTestId(page, 'add-widget-modal');
        await modal.waitFor();
        // AI 우선순위처럼 미리보기가 예시 데이터를 그리는 위젯 대신 이슈 목록을 고른다. 「+ 위젯 추가」 는 누르지 않는다.
        const card = modal.locator('[data-testid=add-widget-card][data-widget-type=issue_list]');
        await card.click();
        await modal.getByText('미리보기').waitFor();
        await settle(page);
        // 창 제목을 자르기에 넣어야 위 여백이 제목 글자를 반으로 자르지 않는다. 제목 요소는 창 전체 폭이라
        // 글자 폭으로 줄여(화면 모양은 같다) 상자를 잰다 — 촬영 브라우저 안의 스타일만 바꾸고 서버에는 아무것도 쓰지 않는다.
        const title = modal.getByRole('heading', { name: '위젯 추가' });
        await title.evaluate((el) => {
          el.style.width = 'fit-content';
          el.style.alignSelf = 'flex-start';
        });
        await capture(page, rec, 'home-6', {
          title,
          categories: byTestId(page, 'add-widget-categories'),
          grid: byTestId(page, 'add-widget-grid'),
          category: modal.locator('[data-testid=add-widget-category][data-category=전체]'),
          card,
        }, { pad: 0 });
      });
    },
  },

  // ── 05 대화 ── 쓰기(보내기·반응·읽음 처리·채널 만들기)는 하지 않는다. 읽음 처리 POST 는 openApp 의 guardReadOnly 가 막는다.
  {
    id: 'chat-1',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openChannel(page);
      // 「놓친 대화 요약」 단추(AI)는 누르지 않는다.
      await capture(page, rec, 'chat-1', {
        channels: [page.getByLabel('채널 탐색'), page.getByRole('link', { name: /모바일-주문앱/ })],
        dms: [page.getByLabel('새 메시지'), page.getByRole('link', { name: '김서연 (나)' })],
        threads: page.getByRole('link', { name: /^스레드/ }),
        header: byTestId(page, 'channel-header'),
        composer: byTestId(page, 'message-composer'),
      });
    },
  },
  {
    // 입력기는 본문 전체 폭이라 데스크톱 최소 폭(1024)으로 찍는다. 글을 넣고 첨부 메뉴를 연 채 찍고, 보내지 않는다.
    id: 'chat-2',
    account: ACCOUNT,
    async run({ page, rec }) {
      await withViewport(page, 1024, async () => {
        await openChannel(page);
        const input = page.getByLabel('채팅 메시지 작성');
        await input.click();
        await input.pressSequentially('베타 빌드 배포 일정 공유드려요');
        // 메뉴가 열리면 나머지 화면이 보조기기에서 가려져(역할로 못 찾는다) 단추 위치를 먼저 잰다.
        await page.mouse.move(0, 0);
        await rec.mark('chat-2', 'format', page.getByLabel('서식'));
        await rec.mark('chat-2', 'input', input);
        await rec.mark('chat-2', 'send', page.getByRole('button', { name: '보내기' }));
        await rec.mark('chat-2', 'attach', page.getByLabel('첨부 추가'));
        await page.getByLabel('첨부 추가').click();
        const menu = page.getByRole('menu');
        await menu.getByText('드라이브에서 링크').waitFor();
        await capture(page, rec, 'chat-2', { menu });
        await page.keyboard.press('Escape');
        await input.fill(''); // 입력 초안을 남기지 않는다
      });
    },
  },
  {
    // 마우스를 올려야 보이는 메시지 도구 줄 — capture() 는 마우스를 구석으로 옮기므로 직접 기록한다.
    id: 'chat-3',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openChannel(page);
      const own = page.getByText('이번 주 목표는 재주문 베타 빌드입니다', { exact: false });
      await own.hover();
      const bar = page.locator('[data-message-toolbar]').first();
      await bar.waitFor();
      await rec.mark('chat-3', 'message', own, { pad: MARK_PAD });
      // 도구 줄 단추는 서로 붙어 있고 단추 자체에 여백이 있어 넓히지 않는다(넓히면 이웃 상자와 겹친다).
      await rec.mark('chat-3', 'emoji', bar.getByLabel('이모지 추가'));
      await rec.mark('chat-3', 'thread', bar.getByLabel('스레드', { exact: true }));
      await rec.mark('chat-3', 'edit', bar.locator('[data-testid^=message-edit-]'));
      await rec.mark('chat-3', 'delete', bar.locator('[data-testid^=message-delete-]'));
      await rec.shoot(page, 'chat-3');
    },
  },
  {
    // 스레드 패널 — 패널을 열면 스레드 읽음 POST 가 가지만 guardReadOnly 가 막는다. 답글은 보내지 않는다.
    id: 'chat-4',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openChannel(page);
      await page.getByText('답글 1개').click();
      // 누른 링크에 포커스가 남으면 그 메시지 행의 도구 줄이 떠 있다 — 포커스를 거둔다.
      await page.evaluate(() => document.activeElement?.blur());
      const panel = byTestId(page, 'thread-panel');
      await panel.getByText('확인했습니다. 원인 파악됐고').waitFor();
      await capture(page, rec, 'chat-4', {
        panel,
        root: panel.getByText('iOS 17 에서 재주문 후 수량이 0으로'),
        replies: panel.getByText('확인했습니다. 원인 파악됐고'),
        close: page.getByLabel('스레드 닫기'),
      });
    },
  },
  {
    id: 'chat-5',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openChannel(page);
      await page.getByLabel('채널 탐색').click();
      const d = dialog(page);
      await d.getByText('참여 중').first().waitFor();
      await capture(page, rec, 'chat-5', {
        dialog: d,
        search: d.getByPlaceholder('채널 이름으로 검색'),
        rows: [d.locator('[data-testid^=channel-browser-row-]').first(), d.locator('[data-testid^=channel-browser-row-]').last()],
      });
      await closeDialog(page);
    },
  },
  {
    // 채널 만들기 창 — 이름을 넣기만 하고 「만들기」 는 누르지 않는다.
    id: 'chat-6',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openChannel(page);
      await page.getByLabel('채널 만들기').click();
      const d = dialog(page);
      await d.getByPlaceholder('예: 마케팅').fill('베타-피드백');
      await capture(page, rec, 'chat-6', {
        dialog: d,
        name: d.getByPlaceholder('예: 마케팅'),
        private: d.getByRole('switch'),
        submit: d.getByRole('button', { name: '만들기' }),
      });
      await closeDialog(page);
    },
  },
  {
    // 멤버 창 — 역할을 바꾸거나 내보내지 않는다(목록만 본다).
    id: 'chat-7',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openChannel(page);
      await byTestId(page, 'channel-members-btn').click();
      const d = byTestId(page, 'channel-members-panel');
      await d.getByRole('button', { name: '채널 나가기' }).waitFor();
      await capture(page, rec, 'chat-7', {
        dialog: d,
        add: byTestId(page, 'member-add-trigger'),
        role: d.locator('select').first(),
        leave: d.getByRole('button', { name: '채널 나가기' }),
      });
      await closeDialog(page);
    },
  },
  {
    // 새 메시지 — 받는 사람 후보 목록만 연다(상대를 고르지 않는다 — 고르면 DM 을 찾거나 만들 수 있다).
    id: 'chat-8',
    account: ACCOUNT,
    async run({ page, rec }) {
      await withViewport(page, 1024, async () => {
        await openApp(page, '/chat/new');
        const list = byTestId(page, 'recipient-suggestions');
        await list.getByText('지니').first().waitFor();
        await capture(page, rec, 'chat-8', {
          input: byTestId(page, 'new-message-recipients'),
          filter: list.getByRole('group', { name: '사람·에이전트 필터' }),
          list: list.getByRole('listbox'),
        });
      });
    },
  },

  {
    // 반응 칩과 새 답글 표시 — 박지민 메시지의 반응, 김서연 메시지의 「답글 2개」(새 답글 점).
    // 왼쪽(남의 메시지)과 오른쪽(내 메시지)을 한 그림에 담으려고 데스크톱 최소 폭(1024)으로 찍는다.
    id: 'chat-9',
    account: ACCOUNT,
    async run({ page, rec }) {
      await withViewport(page, 1024, async () => {
        await openChannel(page);
        const bar = page.locator('[data-testid*=reaction-bar-]').first();
        await bar.waitFor();
        await capture(page, rec, 'chat-9', {
          message: page.getByText('재주문 버튼 최종 시안'),
          reactions: bar,
          replies: page.getByText('답글 2개'),
          own: page.getByText('이번 주 목표는 재주문 베타 빌드입니다', { exact: false }),
        });
      });
    },
  },
  {
    // 스레드 모아 보기 — 카드는 누르지 않는다(누르면 스레드가 열려 스레드 읽음을 보낸다 — guardReadOnly 가 막지만 열 필요가 없다).
    id: 'chat-10',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openApp(page, '/chat/threads/inbox');
      const card = page.locator('[data-testid^=thread-inbox-card-]').first();
      await card.getByText('새 답글 2개').waitFor();
      await capture(page, rec, 'chat-10', {
        nav: page.getByRole('link', { name: /스레드/ }).first(),
        card,
        badge: card.getByText('새 답글 2개'),
      });
    },
  },
  {
    // DM — 열면 읽음 처리 POST 가 가지만 guardReadOnly 가 막는다. 「놓친 대화 요약」(AI)은 누르지 않는다.
    id: 'chat-11',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openApp(page, '/chat');
      await page.getByRole('link', { name: /이준호/ }).first().click();
      await byTestId(page, 'unread-divider').waitFor();
      await page.getByText('감사합니다! 회귀 체크리스트').waitFor();
      await capture(page, rec, 'chat-11', {
        dm: page.getByRole('link', { name: /이준호/ }).first(),
        header: byTestId(page, 'dm-header'),
        divider: byTestId(page, 'unread-divider'),
      });
    },
  },

  // ── 07 캘린더 ── 일정 만들기·수정·삭제·응답은 하지 않는다. 창은 채운 뒤 Esc 로 닫는다.
  {
    id: 'calendar-1',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openCalendar(page);
      await capture(page, rec, 'calendar-1', {
        create: byTestId(page, 'calendar-new-event'),
        mini: byTestId(page, 'calendar-mini'),
        calendars: {
          at: [
            page.getByText('내 캘린더', { exact: true }),
            page.getByLabel('캘린더 추가'),
            page.getByLabel('캘린더 표시: 기본'),
            page.getByText('기본', { exact: true }).first(), // 캘린더 행 이름 — 체크 상자만 넣으면 상자 아래 끝이 이름 글자에 걸친다
          ],
          pad: 8, // 「내 캘린더」 글자 요소의 상자가 글자 왼쪽 끝에 붙어 있어 더 띄운다
        },
        nav: { at: [page.getByRole('button', { name: '오늘', exact: true }), page.getByText('2026년 10월').last()], pad: 8 }, // 제목 글자 상자가 글자보다 좁다
        views: [byTestId(page, 'calendar-view-month-btn'), byTestId(page, 'calendar-view-agenda-btn')],
        // 글자가 아니라 마감 칩 전체(깃발·점선 테두리 포함)를 감싼다 — 글자만 감싸면 테두리가 제목을 덮는다.
        due: page.locator('[data-testid^=calendar-issue-due-]').filter({ hasText: '쿠폰 중복 적용 정책 정리' }).first(),
      });
    },
  },
  {
    id: 'calendar-2',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openCalendar(page);
      await byTestId(page, 'calendar-view-agenda-btn').click();
      await page.getByText(`MOB-${SCENE_ISSUES.overdue.number} ${SCENE_ISSUES.overdue.title}`).waitFor();
      await capture(page, rec, 'calendar-2', {
        views: [byTestId(page, 'calendar-view-month-btn'), byTestId(page, 'calendar-view-agenda-btn')],
        due: page.getByText(`MOB-${SCENE_ISSUES.dueToday.number} ${SCENE_ISSUES.dueToday.title}`),
        event: page.getByText('재주문 디자인 리뷰'),
      });
    },
  },
  {
    // 새 일정 창 — 제목만 넣고 저장하지 않는다. 시작·끝은 FIXED_NOW 기준 기본값(오늘 18:20~19:20).
    id: 'calendar-3',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openCalendar(page);
      await byTestId(page, 'calendar-new-event').click();
      const d = dialog(page);
      await byTestId(page, 'calendar-form-title').fill('베타 오픈 회고');
      await capture(page, rec, 'calendar-3', {
        dialog: d,
        title: byTestId(page, 'calendar-form-title'),
        time: [d.locator('input[type=datetime-local]').first(), d.locator('input[type=datetime-local]').last(), d.getByLabel('반복')],
        place: d.getByPlaceholder('장소 추가'),
        attendees: d.getByLabel('참석자 추가'),
        reminder: d.getByLabel('알림(리마인더)'),
        save: d.getByRole('button', { name: '저장' }),
      });
      await closeDialog(page);
    },
  },
  {
    // 내가 만든 일정을 누르면 바로 수정 창이 열린다 — 참석자 응답 상태를 보여 주고, 수정·삭제하지 않고 닫는다.
    id: 'calendar-4',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openCalendar(page);
      await page.getByText('스프린트 7 데일리').first().click();
      const d = dialog(page);
      await d.getByRole('heading', { name: '일정 수정' }).waitFor();
      await capture(page, rec, 'calendar-4', {
        dialog: d,
        attendees: d.getByLabel('참석자', { exact: true }),
        delete: d.getByRole('button', { name: '삭제' }),
        update: d.getByRole('button', { name: '수정' }),
      });
      await closeDialog(page);
    },
  },
  {
    // 캘린더 추가 창 — 이름을 넣기만 하고 추가하지 않는다.
    id: 'calendar-5',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openCalendar(page);
      await page.getByLabel('캘린더 추가').click();
      const d = dialog(page);
      await d.getByPlaceholder('캘린더 이름').fill('베타 오픈');
      await capture(page, rec, 'calendar-5', {
        dialog: d,
        name: d.getByPlaceholder('캘린더 이름'),
        color: d.getByText('색상', { exact: true }),
        submit: d.getByRole('button', { name: '추가' }),
      });
      await closeDialog(page);
    },
  },
  {
    // 초대받은 일정 — 이준호가 주최한 일정을 누르면 읽기 전용 「일정 보기」가 열린다. 응답 단추는 누르지 않는다.
    id: 'calendar-6',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openCalendar(page);
      await page.getByText('포인트 결제 UI 구현 범위 논의').first().click();
      const d = dialog(page);
      await byTestId(page, 'event-detail-rsvp').waitFor();
      await capture(page, rec, 'calendar-6', {
        dialog: d,
        readonly: byTestId(page, 'event-organizer-only-label'),
        attendees: [byTestId(page, 'event-detail-attendee').first(), byTestId(page, 'event-detail-attendee').last()],
        rsvp: byTestId(page, 'rsvp-controls'),
      });
      await closeDialog(page);
    },
  },
  {
    // 태그 — 사이드바 태그 목록과 태그 메뉴(이름·색 바꾸기·구독 주소…·태그 지우기). 항목은 누르지 않는다.
    id: 'calendar-7',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openCalendar(page);
      const rows = page.locator('[data-testid^=calendar-tag-item-]');
      await rows.first().waitFor();
      await rows.filter({ hasText: '출시' }).hover();
      await page.getByLabel('출시 태그 메뉴').click();
      const menu = page.getByRole('menu');
      await menu.getByText('구독 주소…').waitFor();
      await rec.mark('calendar-7', 'tags', [page.getByText('태그', { exact: true }).first(), rows.last()], { pad: MARK_PAD });
      await rec.mark('calendar-7', 'menu', menu, { pad: MARK_PAD });
      await rec.mark('calendar-7', 'feed', menu.getByText('구독 주소…'), { pad: MARK_PAD });
      await rec.shoot(page, 'calendar-7');
      await page.keyboard.press('Escape');
    },
  },

  // ── 08 작업 관리 ── 이슈·프로젝트를 만들거나 고치지 않는다. 창·메뉴는 열고 닫기만 한다.
  {
    id: 'work-1',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openApp(page, '/projects');
      await page.getByText('모바일 주문 앱 2.0').waitFor();
      await capture(page, rec, 'work-1', {
        nav: [page.getByRole('link', { name: '내 작업' }), page.getByRole('link', { name: '전체 보기' })],
        create: page.getByRole('button', { name: /새 프로젝트/ }).last(), // 머리의 「+ 새 프로젝트」(사이드바 「+」 도 같은 이름이다)
        row: page.getByRole('link', { name: /모바일 주문 앱 2\.0/ }).first(),
      });
    },
  },
  {
    id: 'work-2',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openProject(page, '목록');
      await capture(page, rec, 'work-2', {
        pages: [page.getByRole('button', { name: '사이클' }), page.getByRole('button', { name: '설정' })],
        create: page.getByRole('button', { name: /새 태스크/ }),
        filters: byTestId(page, 'issue-filter-main'),
        view: page.getByRole('group', { name: '뷰 전환' }),
        group: page.getByText('스프린트 7', { exact: true }).first(),
      });
    },
  },
  {
    id: 'work-3',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openProject(page, '보드');
      try {
        await capture(page, rec, 'work-3', {
          view: page.getByRole('group', { name: '뷰 전환' }),
          column: page.getByText('진행 중', { exact: true }).nth(1),
          card: byTestId(page, `issue-card-${SCENE_ISSUES.dueToday.number}`), // 카드 전체(오늘 마감 보강 이슈)
        });
      } finally {
        await page.getByRole('group', { name: '뷰 전환' }).getByRole('button').first().click(); // 목록으로 되돌린다(보기 기억은 이 브라우저에만 남는다)
      }
    },
  },
  {
    // 새 이슈 창 — 제목만 넣고 「생성」 은 누르지 않는다.
    id: 'work-4',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openProject(page, '목록');
      await page.getByRole('button', { name: /새 태스크/ }).click();
      const d = dialog(page);
      await d.getByRole('heading', { name: '새 이슈' }).waitFor();
      await d.getByLabel(/제목/).first().fill('베타 테스터 피드백 정리');
      await capture(page, rec, 'work-4', {
        dialog: d,
        title: d.getByLabel(/제목/).first(),
        body: d.getByText('본문', { exact: true }),
        fields: [byTestId(page, 'create-type-select'), d.locator('input[type=date]').last()],
        submit: d.getByRole('button', { name: '생성' }),
      });
      await closeDialog(page);
    },
  },
  {
    id: 'work-5',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openIssue(page, SCENE_ISSUES.bug);
      // 상태 칸의 아이콘은 상태 목록이 늦게 오면 빈 채로 찍힌다 — 아이콘이 붙고 오른쪽 칸 마크업이 멈출 때까지 기다린다.
      const statusSelect = byTestId(page, 'issue-status-select');
      await page.waitForFunction(
        () => document.querySelector('[data-testid="issue-status-select"]')?.querySelectorAll('svg').length >= 2,
        null,
        { timeout: 10000 },
      ).catch(() => {});
      // 늦게 붙는 아이콘·배지가 찍힐 때마다 달라지지 않게 마크업이 멈출 때까지 기다린다.
      await settleStable(page, () => statusSelect.evaluate((el) => el.innerHTML).catch(() => ''));
      await capture(page, rec, 'work-5', {
        path: byTestId(page, 'issue-breadcrumb'),
        title: page.getByRole('heading', { name: /iOS 17에서 재주문/ }),
        children: page.getByText('하위 태스크', { exact: true }),
        activity: page.getByRole('region', { name: '활동' }).getByRole('tablist'),
        rail: page.getByText('상태·담당', { exact: true }),
      });
    },
  },
  {
    // 상태 목록만 연다(고르지 않는다).
    id: 'work-6',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openIssue(page, SCENE_ISSUES.bug);
      const status = byTestId(page, 'issue-status-select');
      await status.click();
      const list = page.getByRole('listbox');
      await list.getByText('취소').waitFor();
      await capture(page, rec, 'work-6', {
        panel: page.getByText('상태·담당', { exact: true }),
        status,
        list,
      });
      await page.keyboard.press('Escape');
    },
  },
  {
    id: 'work-7',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openApp(page, '/me/tasks/assigned');
      await page.getByText('페이링크 결제 연동 계약서 검토 회신').waitFor();
      await capture(page, rec, 'work-7', {
        tabs: [byTestId(page, 'tab-assigned'), byTestId(page, 'tab-watched')],
        filters: byTestId(page, 'me-task-filter-bar'),
        group: page.getByText('모바일 주문 앱 2.0', { exact: true }).last(),
        row: rowOf(page, 'assigned-row-', '페이링크 결제 연동 계약서 검토 회신', 'tr'), // tbody(assigned-row-project-*)는 빼고 행만
      });
    },
  },
  {
    id: 'work-8',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openApp(page, '/projects/MOB/timeline');
      await page.getByText('베타 오픈').first().waitFor();
      await page.getByText('간편 재주문 (2/7)').first().waitFor();
      // 보강 시드의 버전 「베타 1.0」 줄이 늦게 붙으면 목록이 아래로 밀린다 — 그 줄까지 그려진 뒤 찍는다.
      await page.getByText('베타 1.0', { exact: true }).first().waitFor();
      await capture(page, rec, 'work-8', {
        scale: [page.getByRole('button', { name: '일', exact: true }), page.getByRole('button', { name: '마일스톤 추가' })],
        filter: page.getByRole('button', { name: /스프린트 7/ }).first(),
        list: page.getByText('이슈', { exact: true }).first(),
        milestone: page.getByText('베타 오픈', { exact: true }).first(),
      });
    },
  },

  // ── 09 드라이브 ── 올리기·폴더 만들기·이동·삭제·공유 링크 만들기는 하지 않는다.
  {
    id: 'drive-1',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openDriveSpace(page);
      await capture(page, rec, 'drive-1', {
        spaces: byTestId(page, 'drive-space-list'),
        actions: [byTestId(page, 'drive-new-folder'), byTestId(page, 'trash-toggle')],
        search: page.getByLabel('파일명 및 콘텐츠 검색'),
        row: rowOf(page, 'drive-row-folder-', '기획'),
        attachments: byTestId(page, 'drive-nav-attachments'),
        usage: byTestId(page, 'drive-usage-bar'),
      });
    },
  },
  {
    // 폴더 안 — 파일 행에 마우스를 올리고 「⋯」 메뉴를 연다(항목은 누르지 않는다).
    id: 'drive-2',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openDriveSpace(page);
      await page.getByText('기획', { exact: true }).first().dblclick();
      const file = page.getByText('모바일 주문 앱 2.0 요구사항 정의서.pdf');
      await file.waitFor();
      await file.hover();
      await page.getByLabel('모바일 주문 앱 2.0 요구사항 정의서.pdf 더보기').click();
      const menu = page.getByRole('menu');
      await menu.getByText('버전 이력').waitFor();
      await fontsReady(page);
      await rec.mark('drive-2', 'path', byTestId(page, 'drive-breadcrumb').first(), { pad: MARK_PAD });
      await rec.mark('drive-2', 'file', rowOf(page, 'drive-row-file-', '모바일 주문 앱 2.0 요구사항 정의서.pdf'), { pad: MARK_PAD });
      await rec.mark('drive-2', 'menu', menu, { pad: MARK_PAD });
      await rec.shoot(page, 'drive-2');
      await page.keyboard.press('Escape');
    },
  },
  {
    id: 'drive-3',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openDriveSpace(page);
      await byTestId(page, 'drive-new-folder').click();
      const d = dialog(page);
      await d.getByPlaceholder('폴더 이름').fill('디자인 시안');
      await capture(page, rec, 'drive-3', {
        dialog: d,
        name: d.getByPlaceholder('폴더 이름'),
        submit: d.getByRole('button', { name: '만들기' }),
      });
      await closeDialog(page);
    },
  },

  {
    // 공유 링크 창 — 열기만 하고 「링크 생성」 은 누르지 않는다.
    id: 'drive-4',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openDriveSpace(page);
      await page.getByText('기획', { exact: true }).first().dblclick();
      const file = page.getByText('모바일 주문 앱 2.0 요구사항 정의서.pdf');
      await file.waitFor();
      await file.hover();
      await page.getByLabel('모바일 주문 앱 2.0 요구사항 정의서.pdf 공유').click();
      const d = byTestId(page, 'share-link-modal');
      await byTestId(page, 'share-link-create-btn').waitFor();
      await capture(page, rec, 'drive-4', {
        dialog: d,
        audience: d.getByRole('radiogroup', { name: '공유 대상' }),
        options: [d.getByLabel('비밀번호 (선택)'), d.getByLabel('만료일 (선택)')],
        create: byTestId(page, 'share-link-create-btn'),
      });
      await closeDialog(page);
    },
  },

  // ── 10 노트 ── 본문을 고치지 않는다(에디터는 열기만 — 동기화 연결은 빈 갱신만 보낸다). 메뉴·창은 열고 닫기만 한다.
  {
    id: 'wiki-1',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openWikiPage(page);
      await capture(page, rec, 'wiki-1', {
        space: page.getByRole('combobox').first(),
        tree: [page.getByText('페이지', { exact: true }).first(), page.getByLabel('새 페이지'), page.getByText('출시 체크리스트').first()],
        path: byTestId(page, 'wiki-breadcrumb').first(),
        header: [byTestId(page, 'wiki-share-button'), byTestId(page, 'wiki-ai-header-button')],
        body: byTestId(page, 'page-body-content'),
      });
    },
  },
  {
    id: 'wiki-2',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openWikiPage(page);
      await byTestId(page, 'wiki-page-menu').click();
      const menu = page.getByRole('menu');
      await menu.getByText('버전 기록').waitFor();
      await capture(page, rec, 'wiki-2', {
        trigger: byTestId(page, 'wiki-page-menu'),
        menu,
        history: byTestId(page, 'wiki-menu-history'),
      });
      await page.keyboard.press('Escape');
    },
  },
  {
    // 공유 창 — 열기만 하고 링크 공유를 켜거나 바꾸지 않는다.
    id: 'wiki-3',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openWikiPage(page);
      await byTestId(page, 'wiki-share-button').click();
      const d = byTestId(page, 'wiki-share-dialog');
      await byTestId(page, 'wiki-share-switch').waitFor();
      // 공유 상태를 불러오는 동안 스위치는 꺼진 채 비활성이다 — 상태가 와서 스위치가 풀린 뒤 찍는다(PRD 는 시드가 공유해 두었다).
      await page.waitForFunction(() => {
        const sw = document.querySelector('[data-testid="wiki-share-switch"]');
        return sw && !sw.hasAttribute('disabled');
      });
      await capture(page, rec, 'wiki-3', {
        dialog: d,
        toggle: byTestId(page, 'wiki-share-switch'),
        // 링크 칸은 폭이 좁아 주소 뒤쪽(공유 토큰)이 잘려 보이지 않는다.
        link: [d.getByRole('textbox').first(), byTestId(page, 'wiki-share-copy')],
        fields: [d.getByText('열 수 있는 사람', { exact: true }), d.getByRole('combobox').first(), d.getByRole('combobox').filter({ hasText: '까지' })],
      });
      await closeDialog(page);
    },
  },

  // ── 11 연락처 ── 즐겨찾기·추가·수정·삭제는 하지 않는다.
  {
    id: 'contacts-1',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openApp(page, '/contacts');
      await page.getByText('한지우').first().click();
      await page.getByText('외부 연락처 · 공유').waitFor();
      await page.mouse.move(0, 0);
      await capture(page, rec, 'contacts-1', {
        views: [page.getByText('전체', { exact: true }).first(), page.getByText('즐겨찾기', { exact: true }).first()],
        groups: [page.getByText('조직도', { exact: true }).first(), page.getByText('베타 오픈 TF', { exact: true }).first()],
        search: page.getByLabel('연락처 검색'),
        row: rowOf(page, 'contact-row-', 'jiwoo.han@partner.example.com'),
        detail: [page.getByRole('heading', { name: '한지우' }), page.getByText('jiwoo.han@partner.example.com').last(), page.getByText('메모', { exact: true })],
        create: page.getByRole('button', { name: '새 외부 연락처' }),
      });
    },
  },
  {
    id: 'contacts-2',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openApp(page, '/contacts');
      // 뒤에 깔린 목록·조직도가 다 그려진 뒤 창을 연다 — 「불러오는 중…」 이 찍히면 그림이 흔들린다.
      await page.getByText('한지우').first().waitFor();
      await page.getByText('베타 오픈 TF', { exact: true }).first().waitFor();
      await page.getByRole('button', { name: '새 외부 연락처' }).click();
      const d = dialog(page);
      await d.getByText('공개 범위').waitFor();
      await d.getByLabel(/이름/).first().fill('윤하늘');
      await d.getByLabel('이메일').fill('haneul.yoon@print.example.com');
      await d.getByLabel('소속').fill('하늘인쇄');
      await capture(page, rec, 'contacts-2', {
        dialog: d,
        name: d.getByLabel(/이름/).first(),
        fields: [d.getByLabel('이메일'), d.getByLabel('메모')],
        scope: d.getByLabel('공개 범위'),
        save: d.getByRole('button', { name: '저장' }),
      });
      await closeDialog(page);
    },
  },
  // ── 12 내 설정 ─────────────────────────────────────────────────────────────
  // 저장·비밀번호 변경·토큰 발급·계정 추가는 누르지 않는다(창은 열고 Escape 로 닫는다).
  {
    id: 'my-settings-1',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openSettings(page, '/settings/profile', '프로필 정보');
      await capture(page, rec, 'my-settings-1', {
        nav: page.getByTestId('settings-sidebar').locator('nav').first(),
        // 제목부터 입력 칸·단추까지 감싼다(칸이 제목보다 오른쪽으로 길다).
        profile: [page.getByText('프로필 정보', { exact: true }), page.locator('input').nth(2), page.getByRole('button', { name: '저장', exact: true })],
        password: [page.getByText('비밀번호 변경', { exact: true }).first(), page.locator('input[type=password]').last(), page.getByRole('button', { name: '비밀번호 변경' })],
        guide: page.getByRole('button', { name: '가이드' }),
      });
    },
  },
  {
    // 알림 — 이 기기 푸시와 이슈 알림 표의 윗부분(헤드리스 브라우저는 알림 권한이 차단된 상태로 보인다).
    id: 'my-settings-2',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openSettings(page, '/settings/notifications', '알림 종류');
      // 데스크톱 최소 폭(1024)으로 찍는다 — 오른쪽 끝 스위치까지 넣어도 자른 폭이 1400px 근처로 남는다.
      await withViewport(page, 1024, async () => {
        await capture(page, rec, 'my-settings-2', {
          head: page.getByText('이 기기', { exact: true }), // 왼쪽 묶음 제목 — 자르기를 그 위까지(설명 글이 위에서 잘리지 않게)
        device: [page.getByText('이 기기에서 푸시 받기'), page.getByText(/알림 권한이 차단/)],
          app: page.getByText('앱 전체').first(),
          cols: [page.getByText('사람이', { exact: true }).first(), page.getByText('AI가', { exact: true }).first()],
          row: page.getByText('나에게 할당', { exact: true }),
        });
      });
    },
  },
  {
    // AI 비서 — 토큰 칸은 비어 있다(자리 표시 글자만 보인다). 등록은 누르지 않는다.
    id: 'my-settings-3',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openSettings(page, '/settings/assistant', '추천 질문 보기');
      // 데스크톱 최소 폭(1024)으로 찍는다 — 오른쪽 끝 스위치까지 넣어도 자른 폭이 1400px 근처로 남는다.
      await withViewport(page, 1024, async () => {
        await capture(page, rec, 'my-settings-3', {
          head: page.getByText('개인 비서', { exact: true }), // 왼쪽 묶음 제목(자르기용)
        mode: [page.getByText('연결 방식', { exact: true }), page.getByText('OpenAI 호환', { exact: true })],
          token: [page.getByText('토큰', { exact: true }), page.getByRole('button', { name: '등록' })],
          suggest: [page.getByText('추천 질문 보기', { exact: true }), page.getByRole('switch').first()],
          memory: [page.getByRole('tab', { name: '내 메모리' }), page.getByRole('button', { name: /직접 추가/ })],
        });
      });
    },
  },
  {
    // API 토큰 발급 창 — 목록의 토큰 앞자리가 보이지 않게 창만 자른다. 발급은 누르지 않는다.
    id: 'my-settings-4',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openSettings(page, '/settings/tokens', '도구에 연결하기');
      await page.getByRole('button', { name: '토큰 발급' }).click();
      const d = dialog(page);
      await d.getByText('유효기간').waitFor();
      await capture(page, rec, 'my-settings-4', {
        dialog: d,
        name: d.getByRole('textbox').first(),
        expiry: [d.getByText('유효기간', { exact: true }), d.getByRole('combobox')],
        submit: d.getByRole('button', { name: '발급' }),
      });
      await closeDialog(page);
    },
  },
  {
    // 외부 AI 도구 연결 안내 — 「다른 도구로 연결」을 펼친다. 토큰 목록(앞자리)은 자르기 밖에 둔다.
    id: 'my-settings-5',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openSettings(page, '/settings/tokens', '도구에 연결하기');
      await page.getByText('다른 도구로 연결 (Claude.ai, ChatGPT 등)').click();
      const url = page.getByText('https://genia-works.iacloud.kr/mcp', { exact: true });
      await url.waitFor();
      await url.scrollIntoViewIfNeeded();
      await capture(page, rec, 'my-settings-5', {
        claude: [page.getByText('Claude Code 에 연결', { exact: true }), page.getByRole('button', { name: '복사' }).first()],
        other: page.getByText('다른 도구로 연결 (Claude.ai, ChatGPT 등)'),
        url: [page.getByText('연결 주소', { exact: true }), page.getByRole('button', { name: '복사' }).nth(1)],
      });
    },
  },
  {
    // 메일 계정 추가 창 — 기본 공급자(IMAP) 그대로, 칸은 채우지 않는다. 공급자 목록은 열지 않는다.
    id: 'my-settings-6',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openSettings(page, '/settings/mail', '연결된 메일 계정이 없습니다.');
      await page.getByRole('button', { name: '계정 추가' }).click();
      const d = dialog(page);
      await d.getByText('받기(IMAP)').waitFor();
      await capture(page, rec, 'my-settings-6', {
        dialog: d,
        provider: [d.getByText('공급자', { exact: true }), d.getByRole('combobox').first()],
        address: [d.getByText('이메일 주소', { exact: true }), d.getByText('표시 이름(선택)', { exact: true })],
        imap: d.getByText('받기(IMAP)', { exact: true }),
      });
      await closeDialog(page);
    },
  },
  // ── 13 모바일에서 쓰기 ─────────────────────────────────────────────────────
  // 뷰포트를 390x844 로 줄여 모바일 셸로 찍는다(앱은 폭으로 모바일을 판단한다). 고정·순서 저장은 하지 않는다.
  {
    id: 'mobile-1',
    account: ACCOUNT,
    async run({ page, rec }) {
      await withMobile(page, '/apps', async () => {
        await page.getByTestId('apps-edit-tabs').waitFor();
        const edit = await textOnly(page.getByTestId('apps-edit-tabs')); // 링크 누르기 영역(44px)이 글자보다 크다
        await capture(page, rec, 'mobile-1', {
          // 안내 띠의 손 아이콘과 글자(닫기 단추 앞까지) — 띠 자체는 화면 폭을 다 써 번호 원을 띠 바깥에 둘 자리가 없다.
          coach: [page.getByTestId('apps-coach').locator('svg').first(), page.getByText('길게 눌러 탭바에 고정', { exact: true })],
          // 앱 격자 전체(4열 x 3행) — 격자 칸은 화면 폭을 다 써 번호 자리가 없으므로 네 귀퉁이 앱(첫 줄 양끝·마지막 줄)의 합집합으로 잡는다.
          grid: [page.getByTestId('apps-app-home'), page.getByTestId('apps-app-calendar'), page.getByTestId('apps-app-settings')],
          edit,
          tabbar: page.getByTestId('mobile-tabbar'),
        });
      });
    },
  },
  {
    id: 'mobile-2',
    account: ACCOUNT,
    async run({ page, rec }) {
      await withMobile(page, '/apps/tabs', async () => {
        await page.getByTestId('tab-edit-intro').waitFor();
        const save = await textOnly(page.getByTestId('tab-edit-save')); // 머리 높이만 한 단추 — 글자만 잡는다
        await capture(page, rec, 'mobile-2', {
          intro: page.getByTestId('tab-edit-intro'),
          // 화면 폭을 다 쓰는 목록이라 번호 자리가 없다 — 행의 화살표·빼기 단추 묶음과 「추가할 수 있는 앱」 글만 잡는다.
          slots: [page.getByTestId('tab-edit-up-0'), page.getByTestId('tab-edit-remove-4')],
          add: [page.getByText('추가할 수 있는 앱', { exact: true }), page.getByTestId('tab-edit-full-hint')],
          save,
        });
      });
    },
  },
  {
    // 탭바에 고정된 앱의 고정 표시를 눌러 메뉴를 연다(항목은 누르지 않는다).
    id: 'mobile-3',
    account: ACCOUNT,
    async run({ page, rec }) {
      await withMobile(page, '/apps', async () => {
        await page.getByTestId('apps-pinned-drive').click();
        const menu = page.getByTestId('apps-menu');
        await menu.waitFor();
        await page.waitForTimeout(300); // 메뉴 열림 확대(150ms)가 끝난 뒤
        await capture(page, rec, 'mobile-3', {
          row: page.getByTestId('apps-app-home'), // 자르기 위 끝을 첫 줄 앱 위로 올려 첫 줄 이름이 반쯤 잘리지 않게 한다(표식 없음)
          tile: page.getByTestId('apps-app-drive'),
          menu,
        });
        await page.keyboard.press('Escape');
      });
    },
  },
  // ── 14 구성원과 역할 ───────────────────────────────────────────────────────
  {
    id: 'members-1',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openSettings(page, '/settings/users', 'yuna@example.com');
      await capture(page, rec, 'members-1', {
        admin: page.getByTestId('settings-admin-group'),
        search: page.getByPlaceholder('이름 또는 아이디로 검색...'),
        list: page.getByRole('table'),
        create: page.getByRole('button', { name: '구성원 추가' }),
      });
    },
  },
  {
    // 구성원 추가 창 — 칸을 채우지 않고 닫는다.
    id: 'members-2',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openSettings(page, '/settings/users', 'yuna@example.com');
      await page.getByRole('button', { name: '구성원 추가' }).click();
      const d = dialog(page);
      await d.getByText('초기 비밀번호').waitFor();
      await capture(page, rec, 'members-2', {
        dialog: d,
        id: [d.getByText('아이디 (로그인 ID)'), d.getByText('회사 계정 주소(이메일)를 입력하세요.')],
        profile: [d.getByText('이메일 (선택)', { exact: true }), d.getByText('이름', { exact: true })],
        password: d.getByText('초기 비밀번호', { exact: true }),
        role: [d.getByText('역할', { exact: true }), d.getByText('관리자', { exact: true })],
        more: d.getByText(/계속 추가/),
        submit: d.getByRole('button', { name: '추가', exact: true }),
      });
      await closeDialog(page);
    },
  },
  {
    id: 'members-3',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openSettings(page, '/settings/users', 'jimin@example.com');
      await page.getByText('박지민', { exact: true }).first().click();
      await page.getByText('역할 할당', { exact: true }).waitFor();
      await fontsReady(page);
      // 데스크톱 최소 폭(1024)으로 찍는다 — 오른쪽 끝 스위치까지 넣어도 자른 폭이 1400px 근처로 남는다.
      await withViewport(page, 1024, async () => {
        await capture(page, rec, 'members-3', {
          info: [page.getByText('기본 정보', { exact: true }), page.getByText('가입일', { exact: true })],
          active: [page.getByText('활성 상태', { exact: true }), page.getByRole('switch')],
          roles: [page.getByText('역할 할당', { exact: true }), page.getByRole('button', { name: '역할 저장' })],
        });
      });
    },
  },
  {
    // 시스템 역할 USER 의 상세 — 이름·설명·권한을 바꿀 수 없다는 안내와 권한 목록.
    id: 'members-4',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openSettings(page, '/settings/roles', 'AI 에이전트(개인 비서)');
      await page.getByText('USER', { exact: true }).first().click();
      await page.getByText('권한 할당', { exact: true }).waitFor();
      await capture(page, rec, 'members-4', {
        lock: page.getByText(/시스템 역할은 이름·설명·권한을 수정할 수 없습니다/),
        info: [page.getByText('역할 이름', { exact: true }), page.getByRole('button', { name: '저장', exact: true })],
        perms: [page.getByText('권한 할당', { exact: true }), page.getByText('SSO 설정 관리', { exact: false })],
      });
    },
  },
  // ── 15 AI 에이전트 관리 ────────────────────────────────────────────────────
  {
    id: 'agents-1',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openSettings(page, '/settings/agents', 'genie');
      await capture(page, rec, 'agents-1', {
        toggle: page.getByText('개인 비서 표시', { exact: true }),
        create: page.getByRole('button', { name: /새 에이전트/ }),
        row: rowOf(page, 'agent-row-', 'genie', 'tr'),
      });
    },
  },
  {
    // 에이전트 상세(오른쪽 패널) 윗부분 — 정보·실행 방식·활성 상태. 저장하지 않는다.
    id: 'agents-2',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openAgent(page);
      const d = dialog(page);
      await capture(page, rec, 'agents-2', {
        info: [d.getByText('에이전트 정보', { exact: true }), d.getByRole('button', { name: '저장', exact: true })],
        mode: [d.getByText('실행 방식', { exact: true }), d.getByText(/비서 지정을 먼저 해제하세요/)],
        active: [d.getByText('활성 상태', { exact: true }), d.getByText(/지정을 해제한 뒤 비활성화할 수 있어요/)],
      });
      await closeDialog(page);
    },
  },
  // 패널 아래쪽(AI 연결 및 모델·공통 비서·API 키)은 찍지 않는다 — 「최근 사용」 시각이 AI 가 일할 때마다(홈 우선순위 배치 포함) 바뀐다.
  // ── 16 로그인·앱 설정 ──────────────────────────────────────────────────────
  {
    // SSO 켜기 칸만 자른다 — 아래 관리자 동의 링크(앱 등록 client_id 가 든 주소)는 그림에 넣지 않는다.
    id: 'workspace-settings-1',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openSettings(page, '/settings/sso', 'SSO 로그인 사용');
      await page.getByText('관리자 동의 링크', { exact: true }).waitFor(); // 아래 줄이 늦게 그려지면 그림이 달라진다(자르기 밖이어도 원본은 같아야 한다)
      // 데스크톱 최소 폭(1024)으로 찍는다 — 오른쪽 끝 스위치까지 넣어도 자른 폭이 1400px 근처로 남는다.
      await withViewport(page, 1024, async () => {
        await capture(page, rec, 'workspace-settings-1', {
          section: [page.getByText('SSO 로그인', { exact: true }), page.getByText(/SSO 전용/)],
          toggle: [page.getByText('SSO 로그인 사용', { exact: true }), page.getByRole('switch')],
        });
      });
    },
  },
  {
    id: 'workspace-settings-2',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openSettings(page, '/settings/apps/work', '이슈 관계 유형');
      await capture(page, rec, 'workspace-settings-2', {
        table: page.getByRole('table'),
        create: page.getByRole('button', { name: /관계 유형 추가/ }),
        hide: page.getByRole('button', { name: '숨기기' }).first(),
      });
    },
  },
  {
    id: 'workspace-settings-3',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openSettings(page, '/settings/apps/wiki', '외부 공유 허용');
      // 데스크톱 최소 폭(1024)으로 찍는다 — 오른쪽 끝 스위치까지 넣어도 자른 폭이 1400px 근처로 남는다.
      await withViewport(page, 1024, async () => {
        await page.locator('[data-testid^="wiki-share-row-"]').first().waitFor();
        await capture(page, rec, 'workspace-settings-3', {
          toggle: [page.getByText('외부 공유', { exact: true }), page.getByRole('switch').first()],
          // 보강 시드가 PRD·출시 체크리스트를 링크로 공유해 두었다 — 행이 다 그려진 뒤 목록 전체를 잡는다.
          list: [page.getByText('공유 중인 페이지', { exact: true }), byTestId(page, 'wiki-share-table')],
        });
      });
    },
  },
  // ── 17 감사 로그 ───────────────────────────────────────────────────────────
  // 로그인할 때마다 맨 위에 새 행이 쌓이므로 설명 검색(「구성원 계정 생성」)으로 시드가 남긴 행만 남겨 찍는다.
  // IP 열(클러스터 내부 주소)과 총 건수·날짜 칸은 자르기 밖에 둔다.
  {
    // 필터 줄 — 폭 1024 로 찍으면 날짜 칸이 둘째 줄 왼쪽으로 내려가 자르기 안에 다 든다(1440 폭에서는 날짜 칸이 표의 결과·IP 열 위에 있다).
    id: 'audit-logs-1',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openAudit(page);
      await withViewport(page, 1024, async () => {
        await page.getByLabel('시작 날짜').waitFor();
        const search = page.getByPlaceholder('설명으로 검색...');
        await capture(page, rec, 'audit-logs-1', {
          // 자르기 전용 상자 — 칸들보다 8px 안쪽으로 잡는다. 넓은 그림의 자르기 여백이 커서 칸 그대로 잡으면 위 머리의
          // AI 어시스턴트 단추 아래 끝이 그림 위 끝에 걸린다(표식 상자는 그대로 칸 바깥 4px).
          area: { at: [search, page.getByLabel('결과 필터'), page.getByLabel('종료 날짜')], pad: -8 },
          search,
          user: page.getByRole('combobox').first(),
          result: page.getByLabel('결과 필터'),
          dates: [page.getByLabel('시작 날짜'), page.getByLabel('종료 날짜')],
        });
      });
    },
  },
  {
    // 표 — 시간·사용자·액션·리소스·설명 열만 자른다. 결과 열 바로 오른쪽이 IP 열(클러스터 내부 주소)이라, 결과 열을 넣으면
    // 자르기 여백(24px)이 IP 글자를 끌어들인다. 위 끝은 머리칸 글자로 잡아 필터 줄이 들지 않게 한다.
    id: 'audit-logs-3',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openAudit(page);
      const head = await textOnly(page.getByRole('columnheader', { name: '시간' }));
      // 설명 칸(td)은 결과 열 앞까지 넓으므로 글자만 감싼 span 으로 오른쪽 끝을 잡는다.
      const desc = (who) => textOnly(page.getByRole('cell', { name: `구성원 계정 생성: ${who}@example.com (역할 USER)` }));
      const rows = [head];
      for (const who of ['doyun', 'yuna', 'jimin', 'junho']) rows.push(await desc(who));
      // 자르기는 여백 없는 상자(area)로 잡는다 — 넓은 그림은 번호 자리 때문에 자르기 여백이 커져(약 32px) 위 필터 칸 아래 끝이 들어온다.
      await capture(page, rec, 'audit-logs-3', { area: { at: [...rows], pad: 0 }, rows });
    },
  },
  {
    // 「+ 필터」 메뉴(액션 유형·리소스)를 연다(고르지 않는다).
    id: 'audit-logs-2',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openAudit(page);
      await page.getByRole('button', { name: '필터' }).click();
      await page.getByText('액션 유형', { exact: true }).waitFor();
      await capture(page, rec, 'audit-logs-2', {
        trigger: page.getByRole('button', { name: '필터' }),
        menu: [page.getByText('액션 유형', { exact: true }), page.getByText('리소스', { exact: true }).last()],
      });
      await page.keyboard.press('Escape');
    },
  },
  // ── 보강 시드(--app-extras) 장면 ─────────────────────────────────────────────
  {
    // 채널 머리의 「파일」 — 채널 드라이브 서랍. 여는 순간 앱이 POST …/drive-space 를 보낸다: 공간이 이미 있으면(시드가 만들어 둠)
    // 같은 역할로 멤버만 맞추고 새로 만들지 않는다(DriveChannelSpaceService.ensureChannelSpace) — 이 요청만 통과시킨다.
    id: 'chat-12',
    account: ACCOUNT,
    async run({ page, rec }) {
      await guardReadOnly(page.context(), { allowWrite: ALLOW_DRIVE_SPACE });
      await openChannel(page);
      await page.getByTestId('channel-files-button').first().click();
      const drawer = page.getByTestId('drive-space-drawer');
      await drawer.getByText('베타 빌드 배포 노트.pdf').waitFor();
      // 창을 열면 닫기 단추에 초점 테두리가 남는다 — 초점을 빼고 찍는다.
      await page.evaluate(() => document.activeElement?.blur());
      await page.mouse.move(0, 0);
      await capture(page, rec, 'chat-12', {
        // 서랍 아래는 비어 있다 — 머리부터 마지막 파일 행까지만 자른다.
        area: [drawer.getByRole('heading').first(), drawer.getByRole('button', { name: '휴지통' }), drawer.getByText('재주문 버튼 최종 시안.png')],
        head: drawer.getByRole('heading').first(),
        full: page.getByTestId('drive-drawer-open-full'),
        rows: [drawer.getByText('베타 빌드 배포 노트.pdf'), drawer.getByText('재주문 버튼 최종 시안.png')],
      });
      await page.keyboard.press('Escape');
    },
  },
  {
    // 버전 상세 — 「베타 1.0」(시드: MOB-4~7 이 수정 버전). 출시·편집은 누르지 않는다.
    id: 'work-9',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openApp(page, '/projects/MOB/versions');
      await page.getByText('베타 1.0', { exact: true }).first().click();
      await page.getByTestId('version-period').waitFor();
      await page.getByText('품절 상품 대체 추천 로직').waitFor();
      await capture(page, rec, 'work-9', {
        head: [page.getByRole('heading', { name: '베타 1.0' }), page.getByTestId('version-period')],
        actions: [page.getByTestId('version-edit'), page.getByTestId('version-release')],
        tabs: [page.getByTestId('version-tab-fix'), page.getByTestId('version-tab-affects')],
        issues: page.getByTestId('version-issues-fixVersion'),
      });
    },
  },
  {
    // 첨부 모아보기 — 「공지」 채널 메시지 첨부와 MOB-7 이슈 첨부(시드). 내려받기·저장은 누르지 않는다.
    id: 'drive-5',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openApp(page, '/drive/attachments');
      await page.getByText('iOS17 재주문 수량 화면.png').waitFor();
      await fontsReady(page);
      const groups = page.getByTestId('drive-attachment-group');
      await capture(page, rec, 'drive-5', {
        filters: [page.getByTestId('drive-attachment-filter-all'), page.getByTestId('drive-attachment-filter-message')],
        search: page.getByPlaceholder('파일 이름 검색…'),
        group: groups.first().getByTestId('drive-attachment-group-toggle'),
        save: page.locator('[data-testid^="drive-attachment-save-"]').first(),
      });
    },
  },
  {
    // 「/」 블록 메뉴 — 내 노트의 빈 페이지 「연습장」(시드)에 「/」 를 쳐서 메뉴를 연다.
    // 입력은 동기화 서버(collab 웹소켓)로 가면 저장되므로, 문서가 다 받아진 뒤부터 브라우저→서버 메시지를 모두 버린다
    // (서버→브라우저는 그대로). 찍은 뒤에는 다른 화면으로 떠나 이 문서 연결을 닫은 다음에야 버리기를 푼다.
    id: 'wiki-4',
    account: ACCOUNT,
    async run({ page, rec }) {
      let dropClientFrames = false;
      await page.routeWebSocket(/\/collab/, (ws) => {
        const server = ws.connectToServer();
        ws.onMessage((m) => { if (!dropClientFrames) server.send(m); });
        server.onMessage((m) => ws.send(m));
      });
      try {
        await openApp(page, '/wiki');
        const space = page.getByRole('combobox').first();
        if (!(await space.textContent()).includes('내 노트')) {
          await space.click();
          await page.getByRole('option', { name: /내 노트/ }).click();
        }
        await page.getByText('연습장', { exact: true }).first().click();
        await page.getByText('실시간', { exact: true }).waitFor();
        await page.waitForTimeout(500); // 첫 동기화 응답까지
        dropClientFrames = true;
        await page.getByTestId('page-body-content').click();
        await page.keyboard.type('/');
        const menu = page.getByRole('listbox').or(page.getByRole('menu')).last();
        await menu.waitFor();
        await capture(page, rec, 'wiki-4', { slash: menu });
        await page.keyboard.press('Escape');
      } finally {
        await page.goto('about:blank'); // 문서 연결을 닫는다 — 버린 「/」 는 서버에 가지 않았다
        dropClientFrames = false;
      }
    },
  },
  {
    // 연락처 — 조직도 부서 「제품개발팀」 을 고른 모습(시드: 부서 3개, 내 그룹 「베타 오픈 TF」).
    id: 'contacts-3',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openApp(page, '/contacts');
      await page.getByText('제품개발팀', { exact: true }).first().click();
      await page.waitForTimeout(800);
      await capture(page, rec, 'contacts-3', {
        // 묶음 제목 글자가 칸 왼쪽 끝이라 제목만 넣으면 상자가 글자에 붙는다 — 왼쪽으로 더 나온 고른 행(제품개발팀)까지 넣는다.
        org: [page.getByText('조직도', { exact: true }).first(), page.locator('[data-testid^="group-node-"]', { hasText: '제품개발팀' }).locator('xpath=..'), page.getByText('마케팅팀', { exact: true }).first()],
        mine: [page.getByText('내 그룹', { exact: true }).first(), page.locator('[data-testid^="group-node-"]', { hasText: '베타 오픈 TF' }).locator('xpath=..')],
        // 목록 칸 전체는 아래가 비어 있다 — 소속 멤버 제목부터 마지막 행까지만 감싼다.
        list: [page.getByText('소속 멤버', { exact: true }), page.locator('[data-testid^="group-member-"]:not([data-testid*="-path-"])').last()],
      });
    },
  },
  {
    // 내 공유 — PRD·출시 체크리스트 링크 공유(시드). 해제는 누르지 않는다.
    id: 'my-settings-7',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openSettings(page, '/settings/my-shares', '출시 체크리스트');
      await capture(page, rec, 'my-settings-7', {
        // 스페이스 고르기는 글자보다 넓다 — 단추 전체를 넣는다.
        filters: [page.getByPlaceholder('페이지 제목'), page.getByRole('combobox').filter({ hasText: '모든 스페이스' })],
        // 둘째 행 아래 줄(스페이스 이름)까지 넣어 자르기가 글자를 자르지 않게 한다.
        rows: [page.getByText('출시 체크리스트', { exact: true }), page.locator('[data-testid^="wiki-share-row-"]').last().getByText('모바일 주문 앱')],
        unshare: page.getByRole('button', { name: /해제/ }).first(),
      });
    },
  },
  {
    // 관리자가 만든 역할 PARTNER 의 상세(시드). 저장은 누르지 않는다.
    id: 'members-5',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openSettings(page, '/settings/roles', 'PARTNER');
      await page.getByText('PARTNER', { exact: true }).first().click();
      await page.getByText('권한 할당', { exact: true }).waitFor();
      await capture(page, rec, 'members-5', {
        // 입력 칸과 권한 줄은 요소 폭보다 글자·칸이 넓어 상자가 가로지른다 — 표식은 왼쪽 묶음 제목·설명에 단다.
        info: [page.getByText('역할 정보', { exact: true }), page.getByText(/목록과 구성원 화면에/)],
        perms: [page.getByText('권한 할당', { exact: true }), page.getByText(/이 역할을 가진 구성원이/)],
        // 자르기는 오른쪽 입력 칸·권한 줄까지 넓힌다.
        area: [page.getByText('역할 정보', { exact: true }), page.getByLabel('역할 이름'), page.getByText(/SSO 설정 관리/)],
      });
    },
  },
  {
    // 외부 실행 에이전트 release-bot(시드)의 「외부 에이전트 연결」 — ② 플러그인 설치부터 ④ 이 AI 로 일하기까지.
    // ① 의 키 목록에는 키 앞자리(ak_…)가 보이므로 자르기에 넣지 않는다.
    id: 'agents-3',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openSettings(page, '/settings/agents', 'release-bot');
      await page.locator('tr[data-testid^="agent-row-"]').filter({ hasText: 'release-bot' }).first().click();
      const d = dialog(page);
      await d.getByText('외부 에이전트 연결', { exact: true }).waitFor();
      await blurActive(page);
      await d.getByText(/② genia-works 플러그인 설치/).evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(300);
      await capture(page, rec, 'agents-3', {
        plugin: d.getByText(/② genia-works 플러그인 설치/),
        login: d.getByText(/③ Claude Code 에 이 AI 등록/),
        work: d.getByText('④ 이 AI로 일하기', { exact: false }),
        area: [d.getByText(/② genia-works 플러그인 설치/), d.getByText('/genia-works:as release-bot', { exact: true })],
      });
      await closeDialog(page);
    },
  },
  {
    // 09 파일 미리 보기 — PDF 는 원본을 GET 으로 받아 그린다(변환 요청 없음: 서버 변환은 한글·오피스 형식만, viewerItems.ts).
    // 미리 보기가 함께 부르는 AI 요약 GET(/summary)은 openApp 의 extraBlock 이 막는다.
    id: 'drive-6',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openDriveSpace(page);
      await page.getByText('기획', { exact: true }).first().dblclick();
      await page.getByText('모바일 주문 앱 2.0 요구사항 정의서.pdf').click();
      // PDF 쪽은 캔버스로 그려진다 — 쪽 수 표시와 캔버스가 나타나고, 캔버스 픽셀이 칠해질 때까지 기다린다.
      await page.getByText(/p\.1 \/ 1/).waitFor();
      await page.locator('canvas').first().waitFor();
      await page.waitForFunction(() => {
        const c = document.querySelector('canvas');
        if (!c || !c.width) return false;
        const d = c.getContext('2d')?.getImageData(0, 0, c.width, Math.min(c.height, 400)).data;
        if (!d) return true;
        for (let i = 0; i < d.length; i += 4) if (d[i] < 128) return true;
        return false;
      });
      await page.getByRole('button', { name: '맞춤' }).waitFor();
      await page.waitForTimeout(500);
      await page.mouse.move(0, 0);
      await fontsReady(page);
      // 파일 이름·크기 줄은 머리 폭만큼 넓고 다시 그려져 글자만 잴 수 없다 — 표식 없이 본문에서 설명한다.
      await capture(page, rec, 'drive-6', {
        actions: [page.getByRole('button', { name: '다운로드' }), page.getByRole('button', { name: '닫기' }).last()],
        next: page.getByRole('button', { name: '다음 파일' }),
        zoom: [page.getByRole('button', { name: '축소' }), page.getByRole('button', { name: '확대' })],
      });
    },
  },
  {
    // 15 지니의 AI 연결 및 모델 — 「최근 사용」 시각은 AI 가 일할 때마다 바뀐다. 그 줄 바로 아래(재발급·회수)부터 자른다.
    // area 를 단추 안쪽으로 10px 줄여 자르기 위 끝(여백 24px)이 최근 사용 줄 아래에 오게 한다. 화면을 덮거나 고치지 않는다.
    id: 'agents-4',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openAgent(page);
      const sec = page.getByTestId('agent-connection-section');
      await page.getByTestId('oauth-token-reissue').waitFor();
      // 모델 목록은 늦게 온다 — 모델 칸과 추천 질문 모델 칸에 이름이 채워질 때까지 기다린다(비어 찍히면 그림이 흔들린다).
      await page.getByTestId('workspace-assistant-model').getByText(/\S/).first().waitFor();
      await sec.getByText(/자동 \(/).first().waitFor();
      await sec.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(300);
      await capture(page, rec, 'agents-4', {
        conn: [page.getByTestId('oauth-token-reissue'), page.getByTestId('oauth-token-revoke')],
        model: [page.getByTestId('workspace-assistant-model'), page.getByTestId('workspace-assistant-depth'), page.getByText('추천·후속 질문을 만들 때만 쓰는 가벼운 모델이에요.')],
        assistant: [page.getByText('이 에이전트를 공통 비서로 지정', { exact: true }), page.getByTestId('workspace-assistant-current')],
        key: [page.getByText('API 키', { exact: true }), page.getByRole('button', { name: '키 발급' }), page.getByText('키가 없습니다')],
        area: { at: [page.getByTestId('oauth-token-reissue'), page.getByRole('button', { name: '키 발급' }), page.getByText('키가 없습니다')], pad: -10 },
      });
      await closeDialog(page);
    },
  },
  // ── 04 AI 와 함께 일하기 ── 담당자 선택창만 연다(체크하지 않고 Esc — 바뀐 것이 없으면 저장 요청도 없다).
  {
    id: 'ai-collaboration-2',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openIssue(page, SCENE_ISSUES.picker);
      await page.getByTestId('assignee-picker-trigger').click();
      const picker = page.getByTestId('assignee-picker');
      await picker.locator('[data-testid^="assignee-option-"]').filter({ hasText: '지니' }).waitFor();
      await page.mouse.move(0, 0);
      await capture(page, rec, 'ai-collaboration-2', {
        field: page.getByTestId('assignee-picker-trigger'),
        picker,
        agent: picker.locator('[data-testid^="assignee-option-"]').filter({ hasText: '지니' }),
      });
      await page.keyboard.press('Escape');
    },
  },
  // ── AI 결과 장면(once) ── 실제 AI 를 부른다. 결과가 매번 달라져 전체 재촬영에서 빠지고(once), 이름을 적었을 때만 돈다.
  // 한 번 찍어 눈으로 확인한 그림을 커밋해 고정한다. 쓰기 차단은 그대로 두고 그 장면의 AI 요청 경로만 연다.
  // 확인 카드의 승인·거부(/home/proposals/{id}/confirm|reject)는 어떤 장면에서도 열지 않는다.
  {
    // 05 놓친 대화 요약 — 이준호 DM(안 읽은 1건)에서 단추로 연다. 요약 GET(…/catchup)만 연다(AI 1회).
    // 「확인했어요 → 최신으로」 는 읽음 처리라 누르지 않는다(눌러도 guardReadOnly 가 막는다).
    id: 'chat-13',
    once: true,
    account: ACCOUNT,
    async run({ page, rec }) {
      // 이 장면만 캐치업 요약 GET 을 연다(BLOCK_GET 의 나머지 — 노트 요약·메일 상세 — 는 그대로 막힌다).
      await guardReadOnly(page.context(), { allowRead: ALLOW_CATCHUP });
      // 데스크톱 최소 폭(1024)으로 찍는다 — 카드가 대화 폭을 다 써서 1440 에서는 원본 2300px 넘게 넓다. 끝나면 폭을 되돌린다.
      await withViewport(page, 1024, async () => {
        await openApp(page, '/chat');
        await page.getByRole('link', { name: /이준호/ }).first().click();
        await page.getByText('감사합니다! 회귀 체크리스트').waitFor();
        // 요약은 서버가 (메모리 지문·대화·구간) 키로 캐시한다 — 같은 구간을 다시 찍으면 AI 를 다시 부르지 않는다.
        const started = Date.now();
        await page.getByTestId('catchup-summarize-btn').click();
        const card = page.getByTestId('catchup-card');
        await card.getByTestId('catchup-confirm').waitFor({ timeout: 180000 });
        console.log(`  catchup ${Date.now() - started}ms`);
        await page.mouse.move(0, 0);
        await capture(page, rec, 'chat-13', {
          divider: byTestId(page, 'unread-divider'),
          card,
          confirm: card.getByTestId('catchup-confirm'),
        });
      });
    },
  },
  {
    // 08 AI 현황 요약 — MOB-6(다른 그림에 상세가 나오지 않는 이슈)에서 「요약 생성」 을 누른다(AI 1회).
    // 이 장면만 POST …/issues/6/ai-summary 를 연다 — 서버가 요약을 이슈에 저장한다(이슈 필드는 바꾸지 않는다).
    id: 'work-10',
    once: true,
    account: ACCOUNT,
    async run({ page, rec }) {
      await guardReadOnly(page.context(), {
        allowWrite: ALLOW_AI_SUMMARY,
      });
      await openIssue(page, SCENE_ISSUES.aiSummary);
      const card = page.getByTestId('issue-instant-context');
      await card.getByTestId('issue-summary-generate').click();
      await card.getByText('요약 갱신').waitFor({ timeout: 180000 });
      await page.mouse.move(0, 0);
      await capture(page, rec, 'work-10', {
        card,
        generate: card.getByTestId('issue-summary-generate'),
      });
    },
  },
  {
    // 08 새 이슈 창의 AI 제안 받기 — 제목·본문을 넣고 단추를 누른다(AI 1회). 「생성」 은 누르지 않는다.
    // 이 장면만 POST …/issues/ai-classify 를 연다 — 서버는 저장하지 않고 제안만 돌려준다(IssueController 주석).
    id: 'work-11',
    once: true,
    account: ACCOUNT,
    async run({ page, rec }) {
      await guardReadOnly(page.context(), {
        allowWrite: ALLOW_AI_CLASSIFY,
      });
      await openProject(page, '목록');
      await page.getByRole('button', { name: /새 태스크/ }).click();
      const d = dialog(page);
      await d.getByRole('heading', { name: '새 이슈' }).waitFor();
      await d.getByLabel(/제목/).first().fill('iOS 17 에서 쿠폰을 적용하면 결제 버튼이 눌리지 않음');
      await d.locator('#issue-body').fill('재주문 화면에서 쿠폰을 적용하면 결제 버튼이 비활성으로 남는다. iOS 17.5 에서 재현된다.');
      await d.getByTestId('ai-classify-btn').click();
      await d.getByTestId('ai-classify-reason').waitFor({ timeout: 180000 });
      await blurActive(page);
      await page.mouse.move(0, 0);
      await capture(page, rec, 'work-11', {
        dialog: d,
        ai: [d.getByTestId('ai-classify-btn'), d.getByTestId('ai-classify-reason')],
        fields: [byTestId(page, 'create-type-select'), d.locator('input[type=date]').last()],
        submit: d.getByRole('button', { name: '생성' }),
      });
      await closeDialog(page);
    },
  },
  {
    // 10 노트 AI — 내 노트 「연습장」(빈 페이지)에서 머리 「AI」 메뉴(wiki-6)를 찍고, 빈 페이지 안내의 「AI 초안 작성」 으로
    // 초안을 받아 찍는다(wiki-5, AI 1회). 이 장면만 POST …/wiki/pages/{id}/ai 를 연다. 초안 글자는 브라우저가 편집기에 넣고
    // 협업 소켓으로 보내 저장하는데, 문서가 맞춰진 뒤의 보내는 프레임을 버려(wiki-4 와 같다) 페이지에는 저장되지 않는다.
    id: 'wiki-5',
    shots: ['wiki-5', 'wiki-6'],
    once: true,
    account: ACCOUNT,
    async run({ page, rec }) {
      await guardReadOnly(page.context(), {
        allowWrite: ALLOW_WIKI_AI,
      });
      let dropClientFrames = false;
      await page.routeWebSocket(/\/collab/, (ws) => {
        const server = ws.connectToServer();
        ws.onMessage((m) => { if (!dropClientFrames) server.send(m); });
        server.onMessage((m) => ws.send(m));
      });
      try {
        await openApp(page, '/wiki');
        const space = page.getByRole('combobox').first();
        if (!(await space.textContent()).includes('내 노트')) {
          await space.click();
          await page.getByRole('option', { name: /내 노트/ }).click();
        }
        await page.getByText('연습장', { exact: true }).first().click();
        await page.getByText('실시간', { exact: true }).waitFor();
        await page.getByTestId('wiki-ai-empty-draft').waitFor();
        await page.waitForTimeout(500); // 첫 동기화 응답까지
        dropClientFrames = true;
        // wiki-6: 머리의 「AI」 메뉴만 연다(항목은 누르지 않는다).
        await page.getByTestId('wiki-ai-header-button').click();
        await page.getByTestId('wiki-ai-header-draft').waitFor();
        await capture(page, rec, 'wiki-6', {
          button: page.getByTestId('wiki-ai-header-button'),
          menu: [page.getByTestId('wiki-ai-header-draft'), page.getByTestId('wiki-ai-header-continue')],
        });
        await page.keyboard.press('Escape');
        // wiki-5: 빈 페이지 안내의 「AI 초안 작성」 → 주제 → 확인. 초안이 다 들어올 때까지 기다린다.
        await page.getByTestId('wiki-ai-empty-draft').click();
        await page.getByTestId('rename-dialog-input').fill('베타 오픈 회고 회의록 틀. 잘한 점, 아쉬운 점, 다음 할 일 세 칸으로.');
        await page.getByTestId('rename-dialog-confirm').click();
        await page.getByTestId('wiki-ai-busy').waitFor({ timeout: 60000 }).catch(() => {});
        await page.getByTestId('wiki-ai-busy').waitFor({ state: 'detached', timeout: 180000 });
        await page.waitForTimeout(500);
        await page.mouse.move(0, 0);
        await blurActive(page);
        await capture(page, rec, 'wiki-5', {
          header: page.getByTestId('wiki-ai-header-button'),
          body: page.getByTestId('page-body-content'),
        });
      } finally {
        await page.goto('about:blank'); // 문서 연결을 닫는다 — 초안은 서버에 가지 않았다
        dropClientFrames = false;
      }
    },
  },
  {
    // 04 AI 어시스턴트 답 — 프로젝트 MOB 화면에서 진행 상황 정리를 묻는다(읽기만, AI 1회).
    id: 'ai-collaboration-5',
    once: true,
    account: ACCOUNT,
    async run({ page, rec }) {
      await openProject(page, '목록');
      const panel = await askAssistant(page, '이번 스프린트에서 마감이 가까운 MOB 이슈와 담당자를 정리해 줘');
      await capture(page, rec, 'ai-collaboration-5', {
        launcher: page.getByTestId('chat-launcher'),
        panel,
        answer: panel.getByTestId('chat-widgets').last(),
        composer: panel.getByTestId('ai-composer'),
      });
    },
  },
  // ── 04 AI 가 일한 결과(once) ── --ai-run 시드(지니에게 맡긴 MOB-16)를 읽기만 한다. AI 를 부르지 않지만 결과가 실행마다 달라
  // 다시 시드하면 글이 바뀌므로 once 로 고정한다. 활동 정렬(오래된 순·최신순)은 누르지 않고 기본(오래된 순) 그대로 찍는다.
  {
    // 04-3 사람이 요청하고 AI 가 답하는 흐름 — 지니 착수 코멘트 → 박지민 요청 → 지니 체크리스트(머리와 첫 절까지).
    id: 'ai-collaboration-3',
    once: true,
    account: ACCOUNT,
    async run({ page, rec }) {
      await openIssue(page, SCENE_ISSUES.aiRun);
      const comment = (text) => page.locator('li.bg-card').filter({ hasText: text });
      const start = comment('작업을 시작합니다.');
      const result = comment('베타 1.0 회귀 테스트 체크리스트');
      await result.waitFor();
      // 착수 코멘트 머리가 고정 머리줄(56px) 바로 아래에 오게 둔다 — 체크리스트 첫 절까지 한 화면에 들어온다.
      await start.evaluate((el) => {
        el.scrollIntoView({ block: 'start' });
        let s = el.parentElement;
        while (s && s.scrollHeight <= s.clientHeight) s = s.parentElement;
        (s ?? window).scrollBy(0, -80);
      });
      await page.waitForTimeout(500);
      await capture(page, rec, 'ai-collaboration-3', {
        start,
        request: comment('지니, 체크리스트 작성 결과를'),
        result: [result.locator('[data-testid^="issue-comment-header-"]'), result.getByText('1. 간편 재주문')],
      });
    },
  },
  {
    // 04-4 이력 탭 — 사람의 담당자 변경과 AI 의 상태 변경(할 일 → 진행 중)이 함께 보인다.
    id: 'ai-collaboration-4',
    once: true,
    account: ACCOUNT,
    async run({ page, rec }) {
      await openIssue(page, SCENE_ISSUES.aiRun);
      await page.getByRole('tab', { name: '이력' }).click();
      const timeline = page.getByTestId('issue-activity-timeline');
      const agentRow = timeline.locator('li[data-agent="true"]').filter({ hasText: '상태 변경' });
      await agentRow.waitFor();
      await agentRow.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(500);
      await capture(page, rec, 'ai-collaboration-4', {
        head: [page.getByText('활동', { exact: true }), page.getByRole('tablist').filter({ hasText: '이력' })],
        list: [timeline.getByText('박지민'), agentRow.getByText('할 일 → 진행 중')],
        changes: [agentRow.getByText('지니'), agentRow.getByText(/· 2026-/), agentRow.getByText('할 일 → 진행 중')],
      });
    },
  },
  {
    // 04-1 AI 위임 작업 「전체」 — 범위만 바꿔 본다(범위는 주소·브라우저에만 남는다). 행 제목은 누르지 않는다.
    id: 'ai-collaboration-1',
    once: true,
    account: ACCOUNT,
    async run({ page, rec }) {
      await openApp(page, '/me/ai-tasks');
      await page.getByTestId('ai-scope-all').click();
      const table = page.getByTestId('ai-tasks-table');
      await table.getByText('결제 단계 포인트 사용 UI').waitFor();
      await capture(page, rec, 'ai-collaboration-1', {
        nav: page.getByRole('link', { name: 'AI 위임 작업' }),
        scope: [page.getByTestId('ai-scope-mine'), page.getByTestId('ai-scope-all')],
        chips: page.getByTestId('ai-quick-chips'),
        rows: table,
        titles: [table.getByText('MOB-10', { exact: true }), table.getByText('결제 단계 포인트 사용 UI')],
      });
    },
  },
  {
    // 05 AI 어시스턴트 정리 + 확인 카드 — 채널 모바일-주문앱에서 정리(읽기)와 멤버 초대(확인 카드)를 함께 요청한다(AI 1회).
    // 카드는 승인·거부 둘 다 누르지 않는다. 대기 제안 id 는 출력해 코디네이터가 거부로 정리한다.
    id: 'chat-14',
    once: true,
    account: ACCOUNT,
    async run({ page, rec, api }) {
      await openChannel(page);
      const channelId = Number(new URL(page.url()).pathname.split('/').pop());
      const members = await api('GET', `/messaging/channels/${channelId}/members`);
      // 사람 구성원은 모두 이 채널 멤버라, 비멤버인 외부 에이전트 배포 알리미(release-bot)를 초대 대상으로 쓴다.
      if (members.some((m) => /배포 알리미|release-bot/.test(`${m.name ?? ''} ${m.username ?? ''}`))) {
        throw new Error('배포 알리미가 이미 채널 멤버다 — 초대 대상(비멤버)을 바꿔야 한다');
      }
      const panel = await askAssistant(page, '이 채널에서 이번 주에 정한 일을 세 줄로 정리하고, 배포 알리미(release-bot)를 이 채널에 초대해 줘');
      await panel.getByTestId('pending-action-card').waitFor();
      await capture(page, rec, 'chat-14', {
        panel,
        answer: panel.getByTestId('chat-widgets').last(),
        card: panel.getByTestId('pending-action-card'),
        // 자르기: 카드 안쪽으로 14px 줄여 위(답 말풍선 글자)·아래(화면 참고 칩)가 잘려 들어오지 않게 한다.
        area: { at: [panel.getByTestId('pending-action-card')], pad: -14 },
      });
      await logPendingProposals(api, 'chat-14');
    },
  },
  {
    // 07 일정 확인 카드 — 캘린더에서 날짜를 못 박아 일정 생성을 요청한다(서버는 실제 날짜로 판단하므로 상대 날짜를 쓰지 않는다, AI 1회).
    id: 'calendar-9',
    once: true,
    account: ACCOUNT,
    async run({ page, rec, api }) {
      await openApp(page, '/calendar');
      await page.getByTestId('calendar-new-event').waitFor();
      const panel = await askAssistant(page, "2026년 11월 3일 화요일 오후 3시에 '베타 회고' 1시간 일정을 잡고 박지민, 이준호 님을 초대해 줘");
      await panel.getByTestId('pending-action-card').waitFor();
      await capture(page, rec, 'calendar-9', {
        panel,
        answer: panel.getByTestId('chat-widgets').last(),
        card: panel.getByTestId('pending-action-card'),
      });
      await logPendingProposals(api, 'calendar-9');
    },
  },
  {
    // 09 드라이브 파일 요약 — 어시스턴트가 드라이브 파일을 읽어 요약한다(읽기, AI 1회 — 파일 요약 캐시가 남을 수 있다).
    id: 'drive-7',
    once: true,
    account: ACCOUNT,
    async run({ page, rec }) {
      await openDriveSpace(page);
      const panel = await askAssistant(page, "드라이브 모바일 주문 앱 › 기획 폴더의 '모바일 주문 앱 2.0 요구사항 정의서.pdf'를 세 줄로 요약해 줘");
      await capture(page, rec, 'drive-7', {
        panel,
        answer: panel.getByTestId('chat-widgets').last(),
      });
    },
  },
  {
    // 11 연락처 찾기 — 외부 연락처 오세훈을 묻는다(읽기, AI 1회).
    id: 'contacts-4',
    once: true,
    account: ACCOUNT,
    async run({ page, rec }) {
      await openApp(page, '/contacts');
      await page.getByText('한지우').first().waitFor();
      const panel = await askAssistant(page, '빠른물류 오세훈 님 연락처 알려 줘');
      await capture(page, rec, 'contacts-4', {
        panel,
        answer: panel.getByTestId('chat-widgets').last(),
      });
    },
  },
  {
    // 12 설정 질문 — 알림 설정 화면에서 휴대폰 알림을 묻는다(읽기, AI 1회).
    id: 'my-settings-9',
    once: true,
    account: ACCOUNT,
    async run({ page, rec }) {
      await openSettings(page, '/settings/notifications', '알림 종류');
      const panel = await askAssistant(page, '휴대폰으로 알림을 받으려면 어디서 켜?');
      await capture(page, rec, 'my-settings-9', {
        panel,
        answer: panel.getByTestId('chat-widgets').last(),
      });
    },
  },
  // ── 06 메일 ── M365 연결 중에만 찍는다(위 openMail 주석). 보내기·읽음 처리·옮기기·삭제는 하지 않는다.
  {
    // 경로와 목록 위 도구 줄 — 목록 행이 시작되기 전에서 자른다(행 첫 줄이 보낸 사람 이름).
    id: 'mail-1',
    once: true, // M365 연결 중에만 찍는다 — 전체 재촬영에서 빠지고 연결한 뒤 이름을 지정해 찍는다
    account: ACCOUNT,
    async run({ page, rec }) {
      await openMail(page);
      await page.mouse.move(0, 0);
      await capture(page, rec, 'mail-1', {
        path: page.getByTestId('mail-breadcrumb'),
        sync: [page.getByTestId('mail-sync'), page.getByTestId('mail-synced-at')],
        unread: page.getByTestId('mail-unread-toggle'),
        markAll: page.getByTestId('mail-mark-all-read'),
        // 자르기: 경로부터 AI 어시스턴트 단추(잘리지 않게 통째로)·도구 줄까지. 아래는 첫 행 글자 위에서 끊는다.
        area: { at: [page.getByTestId('mail-breadcrumb'), page.getByRole('button', { name: 'AI 어시스턴트' }), page.getByTestId('mail-mark-all-read')], pad: -4 },
      }, { redact: ['area'] });
    },
  },
  {
    // 메일 상세 — 보낸 사람 줄(실명) 아래, 단추 줄부터 본문까지만 자른다.
    id: 'mail-2',
    once: true, // M365 연결 중에만 찍는다 — 전체 재촬영에서 빠지고 연결한 뒤 이름을 지정해 찍는다
    account: ACCOUNT,
    async run({ page, rec }) {
      await openMail(page);
      await page.getByText(MAIL_SUBJECT, { exact: true }).first().click();
      const body = page.frameLocator('[data-testid="mail-body-html"]');
      await body.getByText(/빠른물류 API 담당 \|/).waitFor();
      await page.mouse.move(0, 0);
      await fontsReady(page);
      const detail = page.getByTestId('mail-detail');
      const btn = (name) => detail.getByRole('button', { name, exact: true });
      await capture(page, rec, 'mail-2', {
        actions: [btn('답장'), btn('삭제')],
        body: [body.getByText(/안녕하세요, 빠른물류/), body.getByText(/빠른물류 API 담당 \|/)],
        area: { at: [btn('답장'), btn('삭제'), body.getByText(/빠른물류 API 담당 \|/)], pad: -1 },
      }, { redact: ['area'] });
    },
  },
  {
    // 편지쓰기 — 빈 새 메일 창만 연다(받는 사람·본문을 넣지 않고, 보내지 않는다).
    id: 'mail-3',
    once: true, // M365 연결 중에만 찍는다 — 전체 재촬영에서 빠지고 연결한 뒤 이름을 지정해 찍는다
    account: ACCOUNT,
    async run({ page, rec }) {
      await openMail(page);
      await page.getByTestId('mail-compose-new').click();
      const dock = page.getByTestId('mail-compose-dock');
      await dock.getByText('AI 검토').waitFor();
      await blurActive(page);
      await page.mouse.move(0, 0);
      await capture(page, rec, 'mail-3', {
        dock,
        to: [page.getByTestId('mail-compose-to'), dock.getByText('참조/숨은참조')],
        subject: page.getByTestId('mail-compose-subject'),
        tabs: [dock.getByText('작성', { exact: true }), dock.getByText('AI 검토')],
        send: page.getByTestId('mail-compose-send'),
      }, { redact: ['dock'] });
    },
  },
  {
    // 12장 메일 계정 목록 — 연결한 Outlook(Microsoft 365) 계정 한 줄(주소는 연결한 사용자 본인 것).
    id: 'my-settings-8',
    once: true, // M365 연결 중에만 찍는다 — 전체 재촬영에서 빠지고 연결한 뒤 이름을 지정해 찍는다
    account: ACCOUNT,
    async run({ page, rec }) {
      await openSettings(page, '/settings/mail', 'Outlook (Microsoft 365)');
      // 데스크톱 최소 폭(1024)으로 찍는다 — 1440 에서는 이메일 칸과 삭제 단추가 원본 2300px 넘게 벌어진다.
      await withViewport(page, 1024, async () => {
      await capture(page, rec, 'my-settings-8', {
        list: [page.getByText('이메일', { exact: true }).first(), page.getByRole('button', { name: '삭제', exact: true })],
        provider: page.getByText('Outlook (Microsoft 365)', { exact: true }).filter({ visible: true }),
        status: page.getByText('연결됨', { exact: true }).filter({ visible: true }),
        add: page.getByTestId('mail-add-trigger'),
      }, { redact: ['list', 'add'] });
      });
    },
  },
  {
    // 07장 외부 캘린더 — 사이드바의 M365 계정 묶음만 자른다(달력 칸에는 실제 Outlook 일정 제목이 보인다).
    // 아래 태그 칸에도 실제 Outlook 범주 이름이 있어 묶음 테두리 안쪽으로 줄여 자른다.
    id: 'calendar-8',
    once: true, // M365 연결 중에만 찍는다 — 전체 재촬영에서 빠지고 연결한 뒤 이름을 지정해 찍는다
    account: ACCOUNT,
    async run({ page, rec }) {
      await openApp(page, '/calendar');
      const section = page.locator('[data-testid^="calendar-account-section-"]').first();
      await section.getByTestId('calendar-readonly-badge').first().waitFor();
      await page.mouse.move(0, 0);
      await capture(page, rec, 'calendar-8', {
        account: section.locator('div').first(),
        calendars: [section.locator('[data-testid^="calendar-list-item-"]').first(), section.locator('[data-testid^="calendar-list-item-"]').last()],
        readonly: section.getByTestId('calendar-readonly-badge').first(),
        area: { at: [section], pad: -14 },
      }, { redact: ['area'] });
    },
  },
];

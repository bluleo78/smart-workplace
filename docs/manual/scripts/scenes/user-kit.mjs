// 사용자 앱(운영 누리커머스 테넌트) 촬영 장면 공용 도구 — 사용자 매뉴얼(scenes/user.mjs)과 제품 소개 자료(docs/intro/scripts/scenes.mjs)가 함께 쓴다.
// 화면 여는 도우미는 모두 읽기 전용 가드(guardReadOnly)와 고정 시계(CLOCK.now)를 건다 — 자세한 규칙은 scenes/user.mjs 머리 주석.
import { newShotContext } from '../lib/capture-kit.mjs';
import { blurActive, byTestId, capture, dialog, fontsReady, guardReadOnly, MARK_PAD, settleStable, WEB } from '../lib/scene-kit.mjs';
import { SCENE_ISSUES } from '../lib/user-seed.mjs';

export const ACCOUNT = 'seoyeon@example.com'; // 소유자 김서연 — 시드(seed-user.mjs)가 쓰는 촬영 계정

// once 장면이 여는 요청 — 장면마다 guardReadOnly 에 넘긴다(장면이 끝나면 촬영기가 걷는다).
const ALLOW_AI_CHAT = (method, url) => method === 'POST' && /\/api\/v1\/ai\/chat$/.test(url); // AI 어시스턴트 대화 시작
export const ALLOW_DRIVE_SPACE = (method, url) => method === 'POST' && /\/messaging\/channels\/\d+\/drive-space$/.test(url); // 채널 드라이브 열기
export const ALLOW_CATCHUP = (url) => /\/catchup(\?|$)/.test(url); // 놓친 대화 요약 GET
export const ALLOW_AI_SUMMARY = (method, url) =>
  method === 'POST' && url.endsWith(`/api/v1/projects/MOB/issues/${SCENE_ISSUES.aiSummary.number}/ai-summary`); // AI 현황 요약
export const ALLOW_AI_CLASSIFY = (method, url) => method === 'POST' && /\/api\/v1\/projects\/MOB\/issues\/ai-classify$/.test(url); // AI 제안 받기
export const ALLOW_WIKI_AI = (method, url) => method === 'POST' && /\/api\/v1\/wiki\/pages\/\d+\/ai$/.test(url); // 노트 AI 초안

// 읽기 전용 가드가 GET 인데도 막는 요청 — 화면 여는 도우미(openHome·openApp·withMobile)가 모두 이 하나를 건다.
// 채널 캐치업 요약(GET …/catchup)·노트 페이지 요약(GET …/summary)은 AI 를 부른다. 메일 상세 GET 은 markSeen 기본값이 true 라(서버)
// 웹이 붙이는 markSeen=false 없이 가는 조회는 읽음을 바꿀 수 있다. 이 가운데 하나를 여는 once 장면은 allowRead 로 그 경로만 연다.
export const BLOCK_GET = (url) =>
  /\/(catchup|summary)(\?|$)/.test(url) || (/\/mail\/messages\/\d+(\?|$)/.test(url) && !/markSeen=false/.test(url));

// 브라우저 시계를 고정할 시각 — 마지막 시드(대화·캘린더 보강: DM·스레드 답글·반응·초대 일정·태그)를 넣은 직후.
// 그 시드의 마지막 쓰기가 2026-10-29 19:49:03 KST 라, 그 뒤 몇 분으로 두어 「n분 전」이 자연스럽고 오늘이 10-29 로 남게 한다.
// (그 전 홈 보강 시드 — 오늘 마감 MOB-14·기한 지남 MOB-15·이준호의 멘션 — 는 18:13:33 KST 에 넣었다.)
// 홈의 「n분 전」, 오늘 일정, 마감 계산이 모두 브라우저 시각 기준이라 고정하지 않으면 다시 찍을 때마다 그림이 바뀐다.
// 시드가 날짜를 촬영일 기준 상대값으로 넣으므로 **시드를 다시 넣으면 이 값도 새 시드 직후로 바꾼다.**
// 실제 시각보다 앞선 시각은 쓰지 않는다(토큰 만료 판단이 미래 시각으로 어긋나지 않게) — 이 시각이 지난 뒤에 찍는다.
export const FIXED_NOW = new Date('2026-10-29T19:55:00+09:00');

// prime 이 쓰는 고정 시각. 제품 소개 자료(docs/intro)처럼 시드 시점이 다른 장면 묶음은 CLOCK.now 를 바꿔 쓴다.
export const CLOCK = { now: FIXED_NOW };

// 홈 위젯 본문은 지연 로딩되고 각자 데이터를 따로 받는다 — 스켈레톤·aria-busy 가 모두 사라지고 글꼴이 다 읽힌 뒤 찍는다.
export async function settle(page) {
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-testid=dashboard-skeleton], [aria-busy="true"], [data-slot=skeleton]').length === 0,
    null,
    { timeout: 20000 },
  );
  await fontsReady(page);
}

/** 화면 여는 도우미 공통 준비 — 쓰기·AI GET 차단(BLOCK_GET)을 걸고, 시계를 고정하고, path 로 간다. */
export async function prime(page, path) {
  await guardReadOnly(page.context(), { extraBlock: BLOCK_GET });
  await page.clock.setFixedTime(CLOCK.now);
  await page.goto(`${WEB()}${path}`);
}

/** 시계를 고정하고 홈을 연다. 요약·내 작업·오늘 일정·알림 위젯이 다 그려질 때까지 기다린다. */
export async function openHome(page) {
  await prime(page, '/');
  await page.getByTestId('dashboard-counts').waitFor();
  await page.getByTestId('dash-mytasks').waitFor();
  await page.getByTestId('inbox-trigger').waitFor();
  // AI 비서가 있는 계정이라 화면 위 가운데에 AI 어시스턴트 단추가 뜬다(useAiAvailable). 단추만 기다리고 누르지 않는다.
  await page.getByTestId('chat-launcher').waitFor();
  await settle(page);
}

/** 로그아웃 상태 화면을 새 컨텍스트에서 연다 — 공유 페이지를 로그아웃시키지 않는다. 끝나면 컨텍스트를 닫는다. */
export async function withLoggedOut(page, fn) {
  const ctx = await newShotContext(page.context().browser());
  try {
    await fn(await ctx.newPage());
  } finally {
    await ctx.close();
  }
}

/** 레일을 펼친 채로 fn 을 돌린다. 펼침은 localStorage(app-rail-expanded)에 남으므로 끝나면 지운다(다음 장면은 goto 로 다시 접힌 상태). */
export async function withRailExpanded(page, fn) {
  await page.getByTestId('rail-toggle').click();
  await page.getByTestId('rail-collapse').waitFor();
  try {
    await fn();
  } finally {
    await page.evaluate(() => localStorage.removeItem('app-rail-expanded'));
  }
}

/** 편집 모드로 fn 을 돌리고, 어떻게 끝나든 저장하지 않고 「취소」로 빠져나온다(열린 창은 먼저 닫는다). */
export async function withEditMode(page, fn) {
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
export const MAIL_QUERY = '【누리커머스】';
export const MAIL_SUBJECT = '【누리커머스】 배송 추적 API 개편 관련 미팅 요청';

/** 메일함을 시연 메일 검색어로 연다. 첫 계정으로 넘어간 주소에 검색어를 붙이고, 동기화가 끝날 때까지 기다린다. */
export async function openMail(page) {
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
export async function askAssistant(page, prompt, { launcher = 'chat-launcher' } = {}) {
  await guardReadOnly(page.context(), { allowWrite: ALLOW_AI_CHAT });
  await page.getByTestId(launcher).click(); // 데스크톱은 위 가운데 단추, 모바일은 탭바 「AI」(mobile-tab-ai)
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
export async function logPendingProposals(api, label) {
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
export async function openApp(page, path) {
  await prime(page, path);
  await page.getByTestId('chat-launcher').waitFor();
}

/** 대화 앱에서 시드 채널 「모바일-주문앱」 을 연다(채널 id 는 운영 값이라 사이드바 이름으로 찾는다). 메시지가 다 그려진 뒤 돌려준다. */
export async function openChannel(page) {
  await openApp(page, '/chat');
  await page.getByRole('link', { name: /모바일-주문앱/ }).click();
  await page.getByText('재주문 버튼 최종 시안').waitFor();
  await page.getByText('답글 1개').waitFor();
  await fontsReady(page);
}

/** 캘린더를 월 보기로 연다(시드 일정이 그려질 때까지). 고른 보기는 브라우저에 남으므로 매번 월 보기를 눌러 맞춘다. */
export async function openCalendar(page) {
  await openApp(page, '/calendar');
  await page.getByTestId('calendar-view-month-btn').click();
  await page.getByTestId('calendar-view-month').getByText('재주문 디자인 리뷰').first().waitFor();
  await fontsReady(page);
}

/** 뷰포트를 잠시 바꿔(높이를 안 주면 지금 높이) fn 을 돌리고 되돌린다 — 본문 전체 폭 요소를 1400px 근처로 자르려고 데스크톱 최소 폭(1024)으로 찍을 때. */
export async function withViewport(page, width, fn, height) {
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
export async function openProject(page, view) {
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
export async function openIssue(page, issue) {
  await openApp(page, `/projects/MOB/issues/${issue.number}`);
  await page.getByRole('heading', { name: issue.title }).first().waitFor();
  await byTestId(page, 'property-rail').waitFor();
  await page.getByText('코멘트', { exact: true }).first().waitFor();
  // 첨부·하위 태스크는 따로 받아 오며 그동안 「로딩 중…」 이 보인다 — 모두 사라진 뒤 찍는다.
  await page.waitForFunction(() => !document.body.innerText.includes('로딩 중'), null, { timeout: 20000 });
  await fontsReady(page);
}

/** 드라이브 팀 공간 「모바일 주문 앱」 을 연다(공간 id 는 운영 값이라 사이드바 이름으로 찾는다). */
export async function openDriveSpace(page) {
  await openApp(page, '/drive');
  await byTestId(page, 'drive-space-list').getByText('모바일 주문 앱').click();
  await page.getByText('기획', { exact: true }).first().waitFor();
  await fontsReady(page);
}

/** 노트 팀 스페이스의 「제품 요구사항 (PRD)」 를 연다. 본문이 동기화돼 그려질 때까지 기다린다. */
export async function openWikiPage(page) {
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
export async function settleBadges(page, ids) {
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
export async function textOnly(locator) {
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
export async function openSettings(page, path, readyText) {
  await openApp(page, path);
  // 같은 문구가 숨은 요소(낭독용 등)에도 있을 수 있어 보이는 것만 기다린다.
  await page.getByText(readyText, { exact: true }).filter({ visible: true }).first().waitFor();
  await settleBadges(page, ['inbox-badge', 'rail-badge-/chat']);
  await fontsReady(page);
}

/** 에이전트 지니의 상세 패널을 연다. */
export async function openAgent(page) {
  await openSettings(page, '/settings/agents', 'genie');
  await page.locator('tr[data-testid^="agent-row-"]').filter({ hasText: 'genie' }).first().click();
  await dialog(page).getByText('에이전트 정보', { exact: true }).waitFor();
  // 패널이 열리면 이름 칸이 포커스되며 글자가 선택돼 보인다 — 포커스를 풀고 찍는다.
  await blurActive(page);
  await fontsReady(page);
}

/** 감사 로그를 열고 설명 검색으로 시드의 「구성원 계정 생성」 행만 남긴다(로그인 행은 찍을 때마다 늘어난다). */
export async function openAudit(page) {
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
export async function withMobile(page, path, fn) {
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
export const rowOf = (page, prefix, text, tag = '') => page.locator(`${tag}[data-testid^="${prefix}"]`).filter({ hasText: text }).first();
export const widget = (page, type) => page.locator(`[data-widget=${type}]`);
export const railLinks = (page) => page.locator('[data-testid=app-rail] nav a');

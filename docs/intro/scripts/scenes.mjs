// 제품 소개 자료(docs/intro/deck) 촬영 장면 목록(WP-1210). 실행 진입점은 같은 폴더의 capture.mjs.
//
// 사용자 매뉴얼(docs/manual/scripts/scenes/user.mjs)과 같은 운영 누리커머스 테넌트·같은 촬영기·같은 화면 여는 도우미(user-kit.mjs)를 쓴다.
// 장면 형식도 같다: { id, account, once?, async run({ page, rec, api }) }. 그림은 docs/intro/deck/shots/<id>.png, 좌표는 같은 폴더 boxes.json.
//
// 매뉴얼과 다른 점 — 슬라이드는 그림을 자르지 않고 1440x810 화면 전체를 보인다. 그래서
//   - 표식 키는 슬라이드가 번호를 붙일 대상만 기록한다(자르기용 area 상자는 쓰지 않는다).
//   - 매뉴얼이 자르기로 감추던 것(토큰 앞자리·감사 로그 IP 열)은 화면 안에서 가린 채 찍는다(hideSecrets — 서버에는 아무것도 쓰지 않는다).
//
// 안전 규칙(운영 테넌트): 장면은 모두 화면 여는 도우미(prime 계열)로 시작해 guardReadOnly 를 건다. 저장·제출·승인·삭제·읽음 처리는 하지 않는다.
// 창·메뉴는 열고 칸을 채운 뒤 닫기만 한다. 고르기만 해도 바로 저장되는 곳(프로젝트 멤버의 부서 행, 공유 창 선택칸)은 탭만 바꾸고 행은 누르지 않는다.
// 운영 쓰기는 AI 결과 장면(once)에서 그 장면의 AI 요청 하나만 연다 — 각 장면 주석에 무엇을 여는지 적었다.
import { blurActive, byTestId, capture, closeDialog, dialog, fontsReady, guardReadOnly } from '../../manual/scripts/lib/scene-kit.mjs';
import { SCENE_ISSUES } from '../../manual/scripts/lib/user-seed.mjs';
import {
  ACCOUNT,
  ALLOW_AI_CLASSIFY,
  ALLOW_AI_SUMMARY,
  ALLOW_CATCHUP,
  CLOCK,
  askAssistant,
  openAgent,
  openApp,
  openCalendar,
  openChannel,
  openMail,
  openDriveSpace,
  openHome,
  openIssue,
  openProject,
  openSettings,
  openWikiPage,
  rowOf,
  settle,
  settleBadges,
  withMobile,
} from '../../manual/scripts/scenes/user-kit.mjs';

// 브라우저 시계 — 읽기만 하는 장면(단계 A)은 매뉴얼과 같은 시각에 둔다. 이번 촬영은 채널 시드를 넣지 않았으므로(놓친 대화 요약은
// 이미 있던 「디자인-리뷰」 안 읽은 대화를 쓴다) 「마지막 시드 뒤 몇 분」 은 매뉴얼 시드(대화·캘린더 보강, 2026-10-29 19:49:03 KST)
// 뒤 몇 분이다. 시드 데이터의 「오늘」(오늘 마감 MOB-14·오늘 일정)이 10-29 라 이 날짜여야 홈 숫자·일정이 시드대로 보인다.
// 실제 시각보다 미래가 아니다(촬영일 10-30). 그래서 매뉴얼 장면과 같은 고정 시각(user-kit 의 CLOCK.now = FIXED_NOW)을 그대로 쓴다.
// AI 결과 장면(단계 B)은 그 자리에서 새 글·요약이 생기므로 withRealClock 으로 지금 시각을 쓴다.

/**
 * AI 결과 장면 전용 — 브라우저 시계를 지금 실제 시각으로 두고 fn 을 돈다. 방금 만든 대화·요약의 시각이 고정 시계(10-29)보다 뒤라
 * 「10월 30일」 처럼 미래 날짜로 찍히지 않게 한다. 끝나면 고정 시각으로 되돌린다(다음 장면은 prime 이 다시 맞춘다).
 */
async function withRealClock(fn) {
  return withClock(new Date(), fn);
}

/** 브라우저 시계를 at 으로 두고 fn 을 돈다(끝나면 장면 기본 시각으로 되돌린다). */
async function withClock(at, fn) {
  const fixed = CLOCK.now;
  CLOCK.now = at;
  try {
    return await fn();
  } finally {
    CLOCK.now = fixed;
  }
}

/** 화면 안의 비밀 조각을 흐리게 가린다 — selector 에 맞는 요소에 블러를 건다(촬영 브라우저 안 스타일만, 서버 쓰기 없음). */
async function hideSecrets(page, selector) {
  await page.addStyleTag({ content: `${selector} { filter: blur(5px) !important; }` });
}

// 모바일 홈 시각 — 슬라이드에서 mobile-ai(10-30 실제 시각에 받은 답)와 나란히 놓여, 홈도 같은 날로 맞춘다. 10-29 로 두면 홈은 MOB-14 를
// 「오늘」 마감으로, AI 답은 「마감 지난」 이슈로 말해 한 슬라이드 안에서 어긋난다. 단계 B 마지막 쓰기(이슈 채팅 지니 답,
// 2026-10-30 12:19:06 KST) 뒤 몇 분이고 촬영 시각보다 앞이다.
const MOBILE_HOME_NOW = new Date('2026-10-30T12:22:00+09:00');

// 8장 채널 위임 요청 — 확인 카드(이슈 제안)가 나오도록 「이슈로 만들어 줘」 로 끝낸다.
const CHANNEL_REQUEST = '재주문 장바구니 쿠폰 미적용 문의 건, MOB 프로젝트에 원인 확인 이슈로 만들어 줘';

// 이슈 채팅 질문 — 첫 질문(「이 이슈 진행 상황과 남은 일 정리해줘」)에 지니가 코멘트를 읽지 않고 「진척은 알 수 없다」 고 답해 한 번 다시 물었다.
const ISSUE_CHAT_QUESTION = '코멘트까지 확인해서 지금까지 한 일과 남은 일을 정리해줘';

/**
 * 실제 계정 정보(사람 이름·메일 주소·Outlook 범주)를 단색 띠로 덮는다 — 글자를 투명하게 하고 회색 배경을 깐다(촬영 브라우저 안 스타일만).
 * 블러는 글자 모양이 남을 수 있어 실제 정보에는 이것을 쓴다.
 */
async function maskText(page, selector) {
  await page.addStyleTag({
    content: `${selector} { color: transparent !important; background: #d4d4d8 !important; border-radius: 4px; }
      ${selector} * { visibility: hidden !important; }`,
  });
}

// 단계 C(메일·캘린더)는 사용자가 김서연에 연결한 **실제 Microsoft 365** 메일함·캘린더를 찍는다. 그래서
//   - 메일 목록은 언제나 시연 메일 검색어 「【누리커머스】」 결과로만 연다(openMail). 보내기·저장·읽음·보관·삭제·분류 변경은 하지 않는다.
//   - 보낸 사람·받는 사람 줄과 계정 주소는 maskText 로 덮고, 키 합집합 밖은 capture 의 redact 로 칠한다(원본 PNG 에도 남지 않게).
//   - 캘린더는 Outlook 캘린더를 화면 안에서만 끈다(표시 설정은 브라우저 저장소에만 남는다 — 끝나면 원래 값으로 되돌린다).
const DEMO_MAIL = { id: 54808, subject: '【누리커머스】 재주문 시 쿠폰이 적용되지 않는다는 문의 3건' };
// 시드 태그(김서연이 만든 것). 나머지 태그는 연결한 Outlook 의 범주라 화면에서 뺀다.
const SEED_TAGS = ['스프린트', '출시'];

/** 실제 메일함의 안 읽은 수 배지(레일 메일 아이콘)를 숨긴다 — 실제 메일함 상태라 그림에 남기지 않는다. */
async function hideMailBadges(page) {
  await page.addStyleTag({ content: '[data-testid="rail-badge-/mail"] { visibility: hidden !important; }' });
}

/** 시연 메일 상세를 연다 — 검색 결과에서 제목으로 고르고 본문이 그려질 때까지. 보낸 사람·받는 사람 줄은 덮는다. */
async function openDemoMail(page) {
  await openMail(page);
  await page.getByText(DEMO_MAIL.subject, { exact: true }).first().click();
  const detail = page.getByTestId('mail-detail');
  await detail.getByRole('heading', { name: DEMO_MAIL.subject }).waitFor();
  await detail.getByTestId('mail-reply').waitFor();
  // 목록 행의 보낸 사람 이름, 상세의 「이름 <주소>」·받는사람·참조 줄.
  await maskText(page, '[data-testid^="mail-row-"][data-message-id] > span:first-of-type > span:first-child');
  await maskText(page, '[data-testid="mail-detail"] h2 ~ div.text-muted-foreground');
  await hideMailBadges(page);
  // 메일함 사이드바(계정 주소·폴더별 안 읽은 수)는 가림 덮개 여백에 일부가 걸려 통째로 숨긴다.
  await page.addStyleTag({ content: '[data-testid="mail-sidebar"] { visibility: hidden !important; }' });
  return detail;
}

export const scenes = [
  // ── 단계 A: 읽기만 ───────────────────────────────────────────────────────────
  {
    // 홈 전체 — 왼쪽 레일, 오늘의 요약 숫자, 지금 신경 쓸 일, 위 가운데 AI 어시스턴트 단추.
    id: 'home',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openHome(page);
      await settleBadges(page, ['inbox-badge', 'rail-badge-/chat']);
      await capture(page, rec, 'home', {
        rail: byTestId(page, 'app-rail'),
        counts: byTestId(page, 'dashboard-counts'),
        attention: byTestId(page, 'dashboard-attention'),
        ai: byTestId(page, 'chat-launcher'),
      });
    },
  },
  {
    // 담당자 선택창 — 사람과 AI(지니)가 한 목록에 있다. 체크하지 않고 Esc(바뀐 것이 없으면 저장 요청도 없다).
    id: 'assignee',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openIssue(page, SCENE_ISSUES.picker);
      await page.getByTestId('assignee-picker-trigger').click();
      const picker = page.getByTestId('assignee-picker');
      const agent = picker.locator('[data-testid^="assignee-option-"]').filter({ hasText: '지니' });
      await agent.waitFor();
      await capture(page, rec, 'assignee', { picker, agent });
      await closeDialog(page);
    },
  },
  {
    // MOB 보드 — 상태 열과 카드. 보기 기억은 브라우저에만 남으므로 끝나면 목록으로 되돌린다.
    id: 'board',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openProject(page, '보드');
      try {
        await byTestId(page, `issue-card-${SCENE_ISSUES.dueToday.number}`).waitFor();
        await settle(page);
        await capture(page, rec, 'board', {
          board: byTestId(page, 'board-scroll'),
          filters: [byTestId(page, 'issue-filter-main'), page.getByRole('group', { name: '뷰 전환' })],
        });
      } finally {
        await page.getByRole('group', { name: '뷰 전환' }).getByRole('button').first().click();
      }
    },
  },
  {
    // MOB 타임라인 — 에픽 막대·마일스톤 「베타 오픈」·버전 「베타 1.0」 줄.
    id: 'timeline',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openApp(page, '/projects/MOB/timeline');
      await page.getByText('베타 오픈').first().waitFor();
      await page.getByText('간편 재주문 (2/7)').first().waitFor();
      await page.getByText('베타 1.0', { exact: true }).first().waitFor();
      await capture(page, rec, 'timeline', {
        // 둘째 에픽 막대 「포인트·쿠폰 통합」(SVAR Gantt 가 그리는 막대 — testid 가 없다). 첫 막대는 시작이 차트 왼쪽 밖이라 상자가 표 칸까지 번진다.
        bars: page.locator('.wx-bars .wx-bar').nth(1),
        milestone: page.getByText('베타 오픈', { exact: true }).first(),
        version: page.getByText('베타 1.0', { exact: true }).first(),
      });
    },
  },
  {
    // 노트 PRD 공유 창 — 열기만 한다(공유 켜기·선택칸 바꾸기는 바로 저장되므로 건드리지 않는다).
    id: 'wiki-share',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openWikiPage(page);
      await byTestId(page, 'wiki-share-button').click();
      const d = byTestId(page, 'wiki-share-dialog');
      await byTestId(page, 'wiki-share-switch').waitFor();
      await page.waitForFunction(() => {
        const sw = document.querySelector('[data-testid="wiki-share-switch"]');
        return sw && !sw.hasAttribute('disabled');
      });
      await byTestId(page, 'wiki-share-audience').waitFor();
      await blurActive(page);
      await capture(page, rec, 'wiki-share', {
        dialog: d,
        audience: [d.getByText('열 수 있는 사람', { exact: true }), byTestId(page, 'wiki-share-audience')],
        options: [byTestId(page, 'wiki-share-permission'), byTestId(page, 'wiki-share-expiry')],
      });
      await closeDialog(page);
    },
  },
  {
    // 설정 › 내 공유 — 시드가 링크로 공유한 노트 2개.
    id: 'my-shares',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openSettings(page, '/settings/my-shares', '내 공유');
      await page.locator('[data-testid^="wiki-share-row-"]').nth(1).waitFor();
      await capture(page, rec, 'my-shares', {
        rows: [page.locator('[data-testid^="wiki-share-row-"]').first(), page.locator('[data-testid^="wiki-share-row-"]').last()],
      });
    },
  },
  {
    // MOB 프로젝트 설정 › 멤버 추가 창의 「조직」 탭 — 부서 행을 누르면 바로 멤버로 저장되므로 탭만 바꾸고 행은 누르지 않는다.
    id: 'dept-project',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openApp(page, '/projects/MOB/settings');
      const memberTab = page.getByRole('tab', { name: /멤버/ }).or(page.getByRole('button', { name: /^멤버/ })).first();
      if (await memberTab.isVisible().catch(() => false)) await memberTab.click();
      // 멤버 칸을 화면 가운데로 올린 뒤 연다 — 창이 아래로 펼쳐지고 지금 멤버 표도 함께 보이게.
      await byTestId(page, 'member-add-trigger').evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(300);
      await byTestId(page, 'member-add-trigger').click();
      const picker = byTestId(page, 'project-member-picker-search');
      await picker.waitFor();
      await byTestId(page, 'project-member-picker-tab-departments').click();
      const dept = picker.locator('[data-testid^="project-member-picker-department-"]').first();
      await dept.waitFor();
      await blurActive(page);
      await capture(page, rec, 'dept-project', {
        dialog: picker,
        dept: [byTestId(page, 'project-member-picker-tab-departments'), dept],
      });
      await closeDialog(page);
    },
  },
  {
    // 캘린더 새 일정 창의 참석자 — 「조직」 탭에서 부서 하나를 고르면 인원 확인 줄이 뜬다(창 안 상태일 뿐, 저장하지 않는다).
    id: 'dept-event',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openCalendar(page);
      await byTestId(page, 'calendar-new-event').click();
      const d = dialog(page);
      await byTestId(page, 'calendar-form-title').fill('베타 오픈 회고');
      await byTestId(page, 'attendee-add-btn').click();
      const picker = byTestId(page, 'attendee-picker-search');
      await picker.waitFor();
      await byTestId(page, 'attendee-picker-tab-departments').click();
      const dept = picker.locator('[data-testid^="attendee-picker-department-"]').first();
      await dept.waitFor();
      await dept.click();
      const confirm = byTestId(page, 'attendee-group-confirm');
      await confirm.waitFor();
      await blurActive(page);
      await capture(page, rec, 'dept-event', {
        dialog: d,
        dept,
        confirm,
      });
      await closeDialog(page);
      await closeDialog(page);
    },
  },
  {
    // 설정 › API 토큰 목록 — 토큰 앞자리는 흐리게 가린다. 발급은 누르지 않는다.
    id: 'tokens',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openSettings(page, '/settings/tokens', '도구에 연결하기');
      const row = page.locator('table tbody tr').first();
      await row.waitFor();
      await hideSecrets(page, 'table tbody tr td:nth-child(2)'); // 앞자리 열
      await capture(page, rec, 'tokens', {
        row,
        create: page.getByRole('button', { name: '토큰 발급' }),
      });
    },
  },
  {
    // 설정 › 에이전트 목록 — 지니 행.
    id: 'agents',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openSettings(page, '/settings/agents', 'genie');
      await capture(page, rec, 'agents', { row: rowOf(page, 'agent-row-', 'genie', 'tr') });
    },
  },
  {
    // 지니 상세 패널 — 패널이 화면보다 길어 「AI 연결 및 모델」 이 보이게 내린다(역할 할당 → 연결·모델 → 공통 비서). 저장하지 않는다.
    // 패널 맨 위 「에이전트 정보」(이름·아이디·설명)는 화면 밖으로 나간다. 지시 칸은 이 패널에 없다.
    id: 'agent-detail',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openAgent(page);
      const d = dialog(page);
      const sec = byTestId(page, 'agent-connection-section');
      await byTestId(page, 'workspace-assistant-model').getByText(/\S/).first().waitFor();
      await sec.getByText(/자동 \(/).first().waitFor();
      await d.getByText('역할 할당', { exact: true }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(300);
      await capture(page, rec, 'agent-detail', {
        roles: [d.getByText('역할 할당', { exact: true }), d.getByRole('button', { name: '역할 저장' })],
        connection: [sec.getByText('AI 연결 및 모델', { exact: true }), page.getByText('추천·후속 질문을 만들 때만 쓰는 가벼운 모델이에요.')],
        assistant: [d.getByText('이 에이전트를 공통 비서로 지정', { exact: true }), byTestId(page, 'workspace-assistant-current')],
      });
      await closeDialog(page);
    },
  },
  {
    // 모바일 홈 — 탭바와 가운데 「AI」. 시계는 MOBILE_HOME_NOW(10-30, 주석 참고).
    id: 'mobile-home',
    account: ACCOUNT,
    async run({ page, rec }) {
      await withClock(MOBILE_HOME_NOW, () =>
        withMobile(page, '/', async () => {
          await page.getByTestId('dashboard-counts').waitFor();
          await settle(page);
          await capture(page, rec, 'mobile-home', {
            tabbar: page.getByTestId('mobile-tabbar'),
            ai: page.getByTestId('mobile-tab-ai'),
          });
        }),
      );
    },
  },
  {
    // 모바일 채널 「모바일-주문앱」 대화 — 읽음 처리 POST 는 guardReadOnly 가 막는다.
    id: 'mobile-channel',
    account: ACCOUNT,
    async run({ page, rec }) {
      await withMobile(page, '/chat', async () => {
        await page.getByRole('link', { name: /모바일-주문앱/ }).first().click();
        await page.getByText('재주문 버튼 최종 시안').waitFor();
        await page.waitForTimeout(500);
        await capture(page, rec, 'mobile-channel', {
          messages: byTestId(page, 'message-list').or(page.getByRole('log')).first(),
        });
      });
    },
  },

  // ── 단계 B: AI 결과(once) ── 실제 AI 를 부른다. 이름을 적었을 때만 돈다. 그 장면의 AI 요청 하나만 연다.
  {
    // 새 이슈 창의 「AI 제안 받기」 — 서버는 제안만 돌려주고 저장하지 않는다(POST …/issues/ai-classify 만 연다). 「생성」 은 누르지 않는다.
    // 이슈 속성 패널의 같은 단추는 제안을 받자마자 우선순위·유형·라벨을 바로 저장(PATCH)해 「적용 안 함」 으로 찍을 수 없어 새 이슈 창을 쓴다.
    id: 'issue-classify',
    once: true,
    account: ACCOUNT,
    async run({ page, rec }) {
      await withRealClock(async () => {
        await guardReadOnly(page.context(), { allowWrite: ALLOW_AI_CLASSIFY });
        await openProject(page, '목록');
        await page.getByRole('button', { name: /새 태스크/ }).click();
        const d = dialog(page);
        await d.getByRole('heading', { name: '새 이슈' }).waitFor();
        await d.getByLabel(/제목/).first().fill('iOS 17 에서 쿠폰을 적용하면 결제 버튼이 눌리지 않음');
        await d.locator('#issue-body').fill('재주문 화면에서 쿠폰을 적용하면 결제 버튼이 비활성으로 남는다. iOS 17.5 에서 재현된다.');
        await d.getByTestId('ai-classify-btn').click();
        await d.getByTestId('ai-classify-reason').waitFor({ timeout: 180000 });
        await blurActive(page);
        await capture(page, rec, 'issue-classify', {
          card: [d.getByTestId('ai-classify-btn'), d.getByTestId('ai-classify-reason')],
          fields: [byTestId(page, 'create-type-select'), d.locator('input[type=date]').last()],
        });
        await closeDialog(page);
      });
    },
  },
  {
    // MOB-6 AI 현황 요약 — 이미 만든 요약이 있으면 그대로 찍고(AI 호출 없음), 없을 때만 「요약 생성」 을 누른다(POST …/ai-summary 만 연다).
    id: 'issue-summary',
    once: true,
    account: ACCOUNT,
    async run({ page, rec }) {
      await withRealClock(async () => {
        await guardReadOnly(page.context(), { allowWrite: ALLOW_AI_SUMMARY });
        await openIssue(page, SCENE_ISSUES.aiSummary);
        const card = page.getByTestId('issue-instant-context');
        await card.waitFor();
        if (!(await card.getByText('요약 갱신').isVisible().catch(() => false))) {
          await card.getByTestId('issue-summary-generate').click();
          await card.getByText('요약 갱신').waitFor({ timeout: 180000 });
        }
        await capture(page, rec, 'issue-summary', { card });
      });
    },
  },
  {
    // 이슈(MOB-7) 위에 AI 어시스턴트 패널을 열고 그 이슈를 묻는다(POST /ai/chat 만 연다, 읽기만 하는 질문).
    id: 'ai-panel',
    once: true,
    account: ACCOUNT,
    async run({ page, rec }) {
      await withRealClock(async () => {
        await openIssue(page, SCENE_ISSUES.bug);
        const panel = await askAssistant(page, '이 이슈의 진행 상황과 남은 일을 세 줄로 정리해 줘');
        const marks = {
          launcher: page.getByTestId('chat-launcher'),
          answer: panel.getByTestId('chat-widgets').last(),
        };
        if (await panel.getByTestId('chat-context-chip').isVisible().catch(() => false)) marks.context = panel.getByTestId('chat-context-chip');
        await capture(page, rec, 'ai-panel', marks);
      });
    },
  },
  {
    // 이슈 채팅 서랍(MOB-16 — 지니가 대화 멤버)에서 @지니 에게 읽기만 하는 질문을 보낸다.
    // 그 대화의 메시지 POST 하나만 연다(읽음·입력 중 알림은 막힌 채). 지니의 답이 올 때까지 기다린다.
    id: 'issue-chat',
    once: true,
    account: ACCOUNT,
    async run({ page, rec, api }) {
      await withRealClock(async () => {
        const { threadId } = await api('GET', `/projects/MOB/issues/${SCENE_ISSUES.aiRun.number}/chat/thread`);
        let posted = 0;
        await guardReadOnly(page.context(), {
          allowWrite: (method, url) => {
            const ok = method === 'POST' && new RegExp(`/api/v1/chat/threads/${threadId}/messages$`).test(url) && posted === 0;
            if (ok) posted += 1; // 한 번만 통과시킨다
            return ok;
          },
        });
        await openIssue(page, SCENE_ISSUES.aiRun);
        await page.getByTestId('issue-chat-open').click();
        const drawer = page.getByTestId('issue-chat-drawer');
        await drawer.waitFor();
        const input = drawer.getByTestId('chat-composer-input');
        await input.click();
        await page.keyboard.type('@지니');
        const option = page.getByTestId('chat-mention-popover').locator('[data-testid^="chat-mention-option-"]').filter({ hasText: '지니' }).first();
        await option.click();
        await page.keyboard.type(` ${ISSUE_CHAT_QUESTION}`);
        const bodies = drawer.locator('[data-testid^="chat-message-body-"]');
        const before = await bodies.count();
        await drawer.getByTestId('chat-composer-submit').click();
        // 지니의 답(에이전트 메시지)이 내 질문 뒤에 붙을 때까지 기다린다.
        await bodies.nth(before + 1).waitFor({ timeout: 300000 });
        await page.waitForFunction(() => !document.querySelector('[data-testid="ai-working-bubble"]'), null, { timeout: 300000 });
        await page.waitForTimeout(1500);
        // 앞서 물은 대화가 있으면 이번 질문이 서랍 위쪽에 오게 내린다.
        if (before > 0) await bodies.nth(before).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.waitForTimeout(300);
        await blurActive(page);
        await capture(page, rec, 'issue-chat', { drawer });
      });
    },
  },
  {
    // 채널 「디자인-리뷰」 놓친 대화 요약 — 김서연이 안 읽은 다른 사람 글 6건(매뉴얼 시드)으로 들어가자마자 카드가 뜬다.
    // 요약 GET(…/catchup)만 연다(AI 1회). 「확인했어요」 는 읽음 처리라 누르지 않는다.
    id: 'catchup',
    once: true,
    account: ACCOUNT,
    async run({ page, rec }) {
      await withRealClock(async () => {
        await guardReadOnly(page.context(), { allowRead: ALLOW_CATCHUP });
        await openApp(page, '/chat');
        await page.getByRole('link', { name: /디자인-리뷰/ }).first().click();
        await page.getByText('결제 단계 포인트 사용 UI 시안 2안').waitFor();
        const btn = page.getByTestId('catchup-summarize-btn');
        if (await btn.isVisible().catch(() => false)) await btn.click();
        const card = page.getByTestId('catchup-card');
        await card.getByTestId('catchup-confirm').waitFor({ timeout: 180000 });
        await capture(page, rec, 'catchup', { card });
      });
    },
  },
  {
    // 파일 미리보기의 AI 요약 — 요약은 파일을 올릴 때 파이프라인이 만들어 둔 것을 GET 으로 읽기만 한다(새로 만들지 않는다).
    // 미리 보기는 요약 GET(/drive/files/{id}/summary)을 BLOCK_GET 으로 막으므로 이 장면만 그 경로를 연다.
    id: 'drive-preview',
    once: true,
    account: ACCOUNT,
    async run({ page, rec }) {
      await guardReadOnly(page.context(), { allowRead: (url) => /\/drive\/files\/\d+\/summary(\?|$)/.test(url) });
      await openDriveSpace(page);
      await page.getByText('기획', { exact: true }).first().dblclick();
      await page.getByText('모바일 주문 앱 2.0 요구사항 정의서.pdf').click();
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
      const panel = byTestId(page, 'viewer-side-panel');
      if (!(await panel.isVisible().catch(() => false))) await page.getByRole('button', { name: /AI 요약|요약/ }).first().click();
      const summary = byTestId(page, 'drive-summary-card');
      await summary.waitFor({ timeout: 30000 });
      await page.waitForTimeout(500);
      await capture(page, rec, 'drive-preview', { summary });
    },
  },
  {
    // 모바일 AI — 탭바 「AI」 로 시트를 열고 읽기만 하는 질문을 한다(POST /ai/chat 만 연다).
    id: 'mobile-ai',
    once: true,
    account: ACCOUNT,
    async run({ page, rec }) {
      await withRealClock(async () => {
        await withMobile(page, '/', async () => {
          const panel = await askAssistant(page, '오늘 내가 챙길 일을 세 줄로 정리해 줘', { launcher: 'mobile-tab-ai' });
          await capture(page, rec, 'mobile-ai', { answer: panel.getByTestId('chat-widgets').last() });
        });
      });
    },
  },

  // ── 단계 C: 메일·캘린더(실제 M365 연결 중에만, once) ──
  {
    // 시연 메일 상세 + AI 요약. 이 메일의 요약 GET(/mail/messages/54808/summary — 처음 열면 AI 가 만든다)만 연다.
    // 상세 조회는 markSeen=false 로 가고(읽음 안 바뀜), 읽음 POST 는 가드가 막는다.
    id: 'mail-detail',
    once: true,
    account: ACCOUNT,
    async run({ page, rec }) {
      await withRealClock(async () => {
        await guardReadOnly(page.context(), { allowRead: (url) => new RegExp(`/mail/messages/${DEMO_MAIL.id}/summary(\\?|$)`).test(url) });
        const detail = await openDemoMail(page);
        const summary = detail.getByTestId('mail-ai-summary');
        await summary.waitFor({ timeout: 180000 });
        await page.waitForFunction(() => !document.querySelector('[data-testid="mail-ai-summary-loading"]'), null, { timeout: 180000 });
        await page.mouse.move(0, 0);
        await fontsReady(page);
        const marks = {
          list: byTestId(page, 'mail-list'),
          summary,
        };
        const category = page.locator(`[data-testid="mail-badge-category-${DEMO_MAIL.id}"]`);
        if (await category.isVisible().catch(() => false)) marks.category = category;
        const aiButtons = [detail.getByTestId('mail-ai-reply-draft'), detail.getByTestId('mail-ai-issue')];
        if (await aiButtons[0].isVisible().catch(() => false)) marks.actions = aiButtons;
        marks.body = detail.locator('[data-testid="mail-body-html"], pre').first(); // 자르기·가림 경계용(본문까지 남긴다)
        await capture(page, rec, 'mail-detail', marks, { redact: Object.keys(marks) });
      });
    },
  },
  {
    // 시연 메일의 「AI 답장 초안」 — POST /mail/messages/54808/reply-draft 만 연다(AI 1회). 보내지 않는다.
    // 작성창은 1.5초 뒤 임시보관 자동 저장을 시도하지만 가드가 막아 서버에 저장되지 않는다(그 결과로 뜨는 「저장하지 못했어요」 줄은 숨긴다).
    // 받는 사람 칩(실제 주소)은 덮는다. 닫을 때도 저장·삭제 요청은 가드가 막는다.
    id: 'mail-reply',
    once: true,
    account: ACCOUNT,
    async run({ page, rec }) {
      await withRealClock(async () => {
        await guardReadOnly(page.context(), {
          allowWrite: (method, url) => method === 'POST' && url.endsWith(`/api/v1/mail/messages/${DEMO_MAIL.id}/reply-draft`),
        });
        const detail = await openDemoMail(page);
        // 받는 사람 칩과 인용 원문 머리(「보낸 사람 이름 · 날짜」)는 실제 사람·주소라 덮는다.
        await maskText(page, '[data-testid="mail-compose-to-chip"], [data-testid="mail-compose-cc-chip"], [data-testid="mail-compose-bcc-chip"], [data-testid="mail-compose-quote-toggle"] > span.truncate');
        await page.addStyleTag({ content: '[data-testid="mail-compose-save-status"] { visibility: hidden !important; }' });
        await detail.getByTestId('mail-ai-reply-draft').click();
        const dock = page.getByTestId('mail-compose-dock');
        await dock.waitFor({ timeout: 180000 });
        await page.waitForFunction(() => !document.body.innerText.includes('초안 작성 중'), null, { timeout: 180000 });
        // 오른쪽 아래 작은 창 대신 크게 펼쳐 찍는다(가림 덮개가 화면 대부분을 덮지 않게).
        await page.getByTestId('mail-compose-expand').click().catch(() => {});
        await page.waitForTimeout(1000);
        await blurActive(page);
        await capture(page, rec, 'mail-reply', { dock }, { redact: ['dock'] });
        await page.getByTestId('mail-compose-close').first().click().catch(() => {});
      });
    },
  },
  {
    // 시연 메일의 「AI 이슈 생성」 창 — POST /mail/messages/54808/issue-draft 만 연다(AI 1회). 「이슈 생성」 은 누르지 않고 취소한다.
    // 보고자 「보낸 사람 (이름)」 은 실제 보낸 사람이라 덮는다.
    id: 'mail-issue',
    once: true,
    account: ACCOUNT,
    async run({ page, rec }) {
      await withRealClock(async () => {
        await guardReadOnly(page.context(), {
          allowWrite: (method, url) => method === 'POST' && url.endsWith(`/api/v1/mail/messages/${DEMO_MAIL.id}/issue-draft`),
        });
        const detail = await openDemoMail(page);
        await maskText(page, 'label[for="mail-to-issue-reporter-sender"] > span');
        await detail.getByTestId('mail-ai-issue').click();
        const d = page.getByTestId('mail-to-issue-dialog');
        await d.waitFor();
        await d.getByTestId('mail-to-issue-submit').waitFor();
        await page.waitForFunction(() => !document.querySelector('[data-testid="mail-to-issue-dialog"]')?.innerText.includes('이슈 작성 중'), null, { timeout: 180000 });
        await page.waitForTimeout(800);
        await blurActive(page);
        await capture(page, rec, 'mail-issue', { dialog: d }, { redact: ['dialog'] });
        await d.getByRole('button', { name: '취소' }).click();
      });
    },
  },
  {
    // 캘린더 월 보기(시드 일정이 있는 10월). 연결한 Outlook 캘린더는 화면 안에서만 끄고(브라우저 저장소), 계정 주소는 덮고,
    // Outlook 범주에서 온 태그는 숨긴다. 끝나면 표시 설정을 원래대로 돌린다.
    id: 'calendar',
    once: true,
    account: ACCOUNT,
    async run({ page, rec }) {
      // openCalendar 는 시드 일정이 보일 때까지 기다리는데, Outlook 일정이 달력 칸을 채우면 시드 일정이 「+n」 뒤로 숨는다 — Outlook 을 먼저 끈다.
      await openApp(page, '/calendar');
      await byTestId(page, 'calendar-view-month-btn').click();
      const saved = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('calendar.layers')).map((k) => [k, localStorage.getItem(k)])));
      try {
        const section = page.locator('[data-testid^="calendar-account-section-"]').first();
        await section.getByTestId('calendar-readonly-badge').first().waitFor();
        const toggles = section.locator('[data-testid^="calendar-toggle-"]');
        for (let i = 0; i < (await toggles.count()); i++) {
          const t = toggles.nth(i);
          if ((await t.getAttribute('data-state')) === 'checked') await t.click();
        }
        await byTestId(page, 'calendar-view-month').getByText('재주문 디자인 리뷰').first().waitFor();
        await page.waitForTimeout(800);
        await maskText(page, '[data-testid^="calendar-account-section-"] > div:first-child > span:first-child');
        await hideMailBadges(page);
        await page.evaluate((seed) => {
          for (const el of document.querySelectorAll('[data-testid^="calendar-tag-item-"]')) {
            if (!seed.some((n) => el.textContent.trim().startsWith(n))) el.style.display = 'none';
          }
        }, SEED_TAGS);
        await page.mouse.move(0, 0);
        await fontsReady(page);
        const grid = byTestId(page, 'calendar-view-month');
        await capture(page, rec, 'calendar', {
          m365: section,
          due: page.locator('[data-testid^="calendar-issue-due-"]').first(),
          event: grid.getByText('재주문 디자인 리뷰').first(),
          tags: byTestId(page, 'calendar-tag-section'),
          grid, // 가림 경계용 — 달력 칸 전체를 남긴다
        }, { redact: ['m365', 'tags', 'grid'] });
      } finally {
        await page.evaluate((s) => {
          for (const k of Object.keys(localStorage).filter((k) => k.startsWith('calendar.layers'))) localStorage.removeItem(k);
          for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
        }, saved);
      }
    },
  },

  // ── 단계 D: AI 가 일한 결과·위임 흐름 ──
  {
    // 8장 위임 흐름 — 채널 「모바일-주문앱」 에서 @지니 에게 이슈를 부탁하고(메시지 POST 1건), 지니가 낸 이슈 제안 카드를 찍은 뒤
    // 승인한다(confirm POST 1건 → MOB-17 이 생기고 지니가 담당). 이 두 요청만 한 번씩 통과시킨다. 읽음·입력 중 알림은 막힌 채다.
    // 승인 뒤 화면(channel-confirmed)은 아래 따로 찍는다(쓰기 없이 다시 찍을 수 있게).
    id: 'channel-proposal',
    once: true,
    account: ACCOUNT,
    async run({ page, rec }) {
      await withRealClock(async () => {
        const used = { post: 0, confirm: 0 };
        await guardReadOnly(page.context(), {
          allowWrite: (method, url) => {
            if (method !== 'POST') return false;
            if (/\/api\/v1\/messaging\/channels\/\d+\/messages$/.test(url) && used.post === 0) return (used.post += 1);
            if (/\/api\/v1\/messaging\/proposals\/\d+\/confirm$/.test(url) && used.confirm === 0) return (used.confirm += 1);
            return false;
          },
        });
        await openChannel(page);
        const before = await page.locator('[data-testid^="proposal-confirm-"]').count();
        const input = page.getByLabel('채팅 메시지 작성');
        await input.click();
        await page.keyboard.type('@지니');
        await page.getByTestId('chat-mention-popover').locator('[data-testid^="chat-mention-option-"]').filter({ hasText: '지니' }).first().click();
        await page.keyboard.type(` ${CHANNEL_REQUEST}`);
        await page.getByRole('button', { name: '보내기' }).click();
        const mine = page.locator('[data-testid^="message-body-"]').filter({ hasText: CHANNEL_REQUEST }).last();
        await mine.waitFor();
        // 지니의 제안 카드(승인 단추가 있는 대기 카드)가 새로 붙을 때까지.
        const approve = page.locator('[data-testid^="proposal-confirm-"]').nth(before);
        await approve.waitFor({ timeout: 300000 });
        await page.waitForFunction(() => !document.querySelector('[data-testid="ai-working-bubble"]'), null, { timeout: 120000 }).catch(() => {});
        const pid = (await approve.getAttribute('data-testid')).replace('proposal-confirm-', '');
        const card = page.getByTestId(`proposal-card-${pid}`);
        await card.evaluate((el) => el.scrollIntoView({ block: 'end' }));
        await page.waitForTimeout(800);
        await blurActive(page);
        await page.mouse.move(0, 0);
        await fontsReady(page);
        console.log(`  제안 ${pid} 프로젝트: ${await page.getByTestId(`proposal-project-${pid}`).textContent().catch(() => '-')}`);
        await capture(page, rec, 'channel-proposal', { mention: mine, card, approve });
        await approve.click();
        await page.getByTestId(`proposal-confirmed-${pid}`).waitFor({ timeout: 60000 });
      });
    },
  },
  {
    // 승인된 제안 카드와 지니의 후속 안내(「MOB-17 … 만들었어요. 제가 맡았습니다」) — 읽기만 한다(channel-proposal 이 승인한 뒤).
    id: 'channel-confirmed',
    once: true,
    account: ACCOUNT,
    async run({ page, rec }) {
      await withRealClock(async () => {
        await openChannel(page);
        const confirmed = page.locator('[data-testid^="proposal-confirmed-"]').last();
        await confirmed.waitFor();
        const pid = (await confirmed.getAttribute('data-testid')).replace('proposal-confirmed-', '');
        const card = page.getByTestId(`proposal-card-${pid}`);
        const follow = page.locator('[data-testid^="message-body-"]').filter({ hasText: /만들었어요/ }).last();
        await follow.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(800);
        await blurActive(page);
        await page.mouse.move(0, 0);
        await fontsReady(page);
        const marks = { done: card };
        if (await follow.isVisible().catch(() => false)) marks.done = [card, follow];
        await capture(page, rec, 'channel-confirmed', marks);
      });
    },
  },
  {
    // MOB-16 코멘트 — 지니 착수 코멘트와 결과(체크리스트) 코멘트. 박지민의 재요청은 슬라이드가 잘라 내므로 키에 넣지 않는다.
    // 착수 코멘트 머리가 고정 머리줄 바로 아래에 오게 내린다(매뉴얼 ai-collaboration-3 과 같다).
    id: 'ai-issue',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openIssue(page, SCENE_ISSUES.aiRun);
      const comment = (text) => page.locator('li.bg-card').filter({ hasText: text });
      const start = comment('작업을 시작합니다.');
      const result = comment('베타 1.0 회귀 테스트 체크리스트');
      await result.waitFor();
      await start.evaluate((el) => {
        el.scrollIntoView({ block: 'start' });
        let s = el.parentElement;
        while (s && s.scrollHeight <= s.clientHeight) s = s.parentElement;
        (s ?? window).scrollBy(0, -80);
      });
      await page.waitForTimeout(500);
      await capture(page, rec, 'ai-issue', { start, result });
    },
  },
  {
    // MOB-16 이력 탭 — 사람의 담당자 변경과 지니의 상태 변경(할 일 → 진행 중).
    id: 'ai-issue-history',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openIssue(page, SCENE_ISSUES.aiRun);
      await page.getByRole('tab', { name: '이력' }).click();
      const timeline = page.getByTestId('issue-activity-timeline');
      const agentRows = timeline.locator('li[data-agent="true"]');
      await agentRows.first().waitFor();
      await agentRows.first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(500);
      await capture(page, rec, 'ai-issue-history', {
        changes: [timeline.locator('li').first(), agentRows.last()],
      });
    },
  },
  {
    // 노트 「제품 요구사항 (PRD)」 — 페이지 목록과 「실시간」 표시.
    id: 'wiki-prd',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openWikiPage(page);
      const live = page.getByText('실시간', { exact: true });
      const marks = {
        tree: [page.getByText('페이지', { exact: true }).first(), page.getByText('출시 체크리스트').first()],
      };
      if (await live.isVisible().catch(() => false)) marks.live = live;
      await capture(page, rec, 'wiki-prd', marks);
    },
  },
  {
    // 설정 › 에이전트 › 배포 알리미(release-bot, 외부) 상세의 「에이전트 정보」. 칸은 고치지 않는다(패널을 열면 이름 칸에 포커스가 가 풀어 둔다).
    id: 'agent-identity',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openSettings(page, '/settings/agents', 'release-bot');
      await page.locator('tr[data-testid^="agent-row-"]').filter({ hasText: 'release-bot' }).first().click();
      const d = dialog(page);
      await d.getByText('에이전트 정보', { exact: true }).waitFor();
      await blurActive(page);
      await fontsReady(page);
      // 설명(역할)·지시 칸은 비어 있어 자리 표시 예시 글만 보인다(시드가 채우지 않았다).
      const marks = { identity: [d.getByText('에이전트 정보', { exact: true }), d.getByText(/다른 AI 가 일을 맡길 상대를 고를 때 읽습니다/)] };
      const instr = d.getByText(/^지시/).first();
      if (await instr.isVisible().catch(() => false)) marks.instructions = [instr, d.getByText(/이 AI 가 이슈를 맡을 때마다 따르는 규칙/)];
      await capture(page, rec, 'agent-identity', marks);
      await closeDialog(page);
    },
  },
  {
    // AI 위임 작업 「이슈별」·범위 「전체」(범위·보기는 주소·브라우저에만 남는다). 행 제목은 누르지 않는다.
    // 8장 승인으로 생긴 MOB-17 이 들어오므로 channel-proposal 뒤에 찍는다(그래서 once).
    id: 'ai-tasks',
    once: true,
    account: ACCOUNT,
    async run({ page, rec }) {
      await withRealClock(async () => {
        await openApp(page, '/me/ai-tasks');
        await page.getByTestId('ai-scope-all').click();
        const table = page.getByTestId('ai-tasks-table');
        // 목록은 AI 가 작업 보고로 맡은 이슈만 보인다 — 지금은 배포 알리미(외부)의 MOB-9·10. 지니(내부)의 MOB-16·17 은 이 목록에 들지 않는다.
        await table.getByText('MOB-9', { exact: true }).waitFor();
        await page.waitForTimeout(800);
        await capture(page, rec, 'ai-tasks', {
          nav: page.getByRole('link', { name: 'AI 위임 작업' }),
          chips: page.getByTestId('ai-quick-chips'),
          rows: table,
        });
      });
    },
  },
  {
    // 같은 화면의 「AI별」 보기 — AI 행(지니·배포 알리미).
    id: 'ai-agents',
    once: true,
    account: ACCOUNT,
    async run({ page, rec }) {
      await withRealClock(async () => {
        await openApp(page, '/me/ai-tasks');
        await page.getByTestId('ai-scope-all').click();
        await page.getByTestId('ai-view-agents').click();
        const table = page.getByTestId('ai-roster-table');
        await table.locator('[data-testid^="ai-agent-"]').nth(1).waitFor();
        await page.waitForTimeout(800);
        await capture(page, rec, 'ai-agents', { rows: table, chips: page.getByTestId('ai-roster-chips') });
      });
    },
  },
];

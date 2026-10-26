// 이슈 상세 레이아웃 E2E(#343) — 브라우저가 있어야 판정되는 것만 남긴다.
// 남는 것: 본문 탭 배선(@wiring), 탭 전환 뒤 코멘트 초안 유지(@input), 채팅 드로워 Esc 닫기(history, @platform),
//          폭별 세로 스택·가로 배치·AI 패널 넘침(@layout).
// 속성 그룹 접힘·배지, 보고자 표시·바꾸기·넘기기 확인, 첨부 스트립·드라이브 공간 1회 조회, 브레드크럼 이동, 본문 container 클래스,
// beforeunload 경고는 페이지 테스트 src/pages/projects/issueDetailLayout.test.tsx 가 지킨다(WP-980).

import { expect, test } from '../../fixtures/auth.fixture';
import { createChatMessage, createChatThread } from '../../factories/chat.factory';
import {
  createComment,
  createHistoryEntry,
  createIssue,
  createIssueDetail,
} from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import type { ChatMessageResponse, ChatThreadResponse } from '../../../src/types/chat';
import type {
  IssueCommentResponse,
  IssueDetailResponse,
  IssueHistoryEntry,
  IssueResponse,
} from '../../../src/types/issue';
import type { UserSummary } from '../../../src/types/user';

const PROJECT_KEY = 'PROJ';
const ISSUE_NUMBER = 1;

// 이슈 상세 페이지 공통 API 스텁 설정.
// 무엇을: project/members/issue-detail/watchers/labels/attachments 엔드포인트 모킹.
// 왜: 백엔드 없이 이슈 상세 레이아웃을 테스트하기 위해 issue-comments.spec.ts 패턴 재사용.
// summaryOverrides 외에 comments/history 도 직접 지정 가능 — 탭 분리(Task 3) 이후 활동 탭 테스트에 필요.
async function mockIssueDetail(
  page: import('@playwright/test').Page,
  overrides: Partial<IssueResponse> & {
    comments?: IssueCommentResponse[];
    history?: IssueHistoryEntry[];
    // 상세 응답 reporter(WP-272) — 생략하면 팩토리 기본(양동희, HUMAN).
    reporter?: UserSummary | null;
    // 보고자 바꾸기 권한(WP-944) — 생략하면 팩토리 기본(읽기 전용).
    viewerCanChangeReporter?: boolean;
  } = {},
) {
  const { comments, history, reporter, viewerCanChangeReporter, ...summaryOverrides } = overrides;
  const summary = { ...createIssue({ projectKey: PROJECT_KEY }), ...summaryOverrides };
  const detail: IssueDetailResponse = createIssueDetail({
    summary,
    ...(comments !== undefined && { comments }),
    ...(history !== undefined && { history }),
    ...(reporter !== undefined && { reporter }),
    ...(viewerCanChangeReporter !== undefined && { viewerCanChangeReporter }),
  });
  // reporter 키를 undefined 로 명시하면 필드가 없는 구버전 서버 응답을 흉내 낸다(롤링 배포).
  if ('reporter' in overrides && reporter === undefined) delete detail.reporter;

  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createProject({ key: PROJECT_KEY })),
    }),
  );
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detail),
      }),
  );
  for (const sub of ['watchers', 'labels', 'attachments']) {
    await page.route(
      (url) =>
        url.pathname ===
        `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/${sub}`,
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
  }
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/labels`,
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  // #80: 드라이브 링크·공간 쿼리 — IssueAttachmentList 가 항상 호출하므로 빈 배열로 스텁.
  await page.route(
    (url) =>
      url.pathname ===
      `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/drive-links`,
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === '/api/v1/drive/spaces',
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  // IssueChatButton(미읽음 배지)이 항상 thread 를 조회하므로 기본 빈 thread stub 등록.
  // 무엇을: 개별 테스트가 mockChatThread 로 override 할 수 있도록 default stub 을 마지막에 등록.
  // 왜: Playwright 은 마지막 등록 route 가 우선 — mockChatThread 를 뒤에 호출하면 덮어씀.
  await page.route(
    (url) =>
      url.pathname ===
      `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/chat/thread`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createChatThread({ threadId: 999, recentMessages: [] })),
      }),
  );
}

// chat thread endpoint 모킹.
// 무엇을: IssueChatButton·IssueChatSection 이 호출하는 thread GET 과 messages GET 엔드포인트를 stub.
// 왜: recentMessages 를 제어해 패널 자동 펼침/접힘 동작을 결정론적으로 검증하기 위해.
async function mockChatThread(
  page: import('@playwright/test').Page,
  overrides: Partial<Omit<ChatThreadResponse, 'recentMessages'>> & {
    recentMessages?: Partial<ChatMessageResponse>[];
  } = {},
) {
  const { recentMessages: msgs, ...rest } = overrides;
  const recentMessages = (msgs ?? []).map((m) => createChatMessage(m));
  const thread = createChatThread({ ...rest, recentMessages });
  await page.route(
    (url) =>
      url.pathname ===
      `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/chat/thread`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(thread),
      }),
  );
  // 패널이 펼쳐질 때 messages 엔드포인트 stub(IssueChatSection → useChatMessages 가 호출).
  await page.route(
    (url) => url.pathname === `/api/v1/chat/threads/${thread.threadId}/messages`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: recentMessages, nextCursor: null, hasMore: false }),
      });
    },
  );
}

// 이슈 본문 탭 — 코멘트/활동 분리 (Task 3, #343).
// 무엇을: 기본 탭이 코멘트이고 활동 탭 클릭 시 타임라인 표시, 사이드바엔 활동 헤딩 없음 검증.
// 왜: 활동 로그를 사이드바에서 본문 탭으로 이동해 속성 접근 방해 해소.
test.describe('이슈 본문 탭 (코멘트/활동)', () => {
  test(
    '본문 탭: 코멘트 기본, 활동 탭 클릭 시 타임라인 표시·사이드바엔 활동 없음',
    { tag: ['@wiring', '@smoke'] },
    async ({ authenticatedPage: page }) => {
      await mockIssueDetail(page, {
        comments: [createComment({ id: 1, body: '첫 코멘트', authorName: '홍길동' })],
        history: [createHistoryEntry({ id: 1 })],
      });
      await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

      // 코멘트 탭 기본 활성 — 탭이 존재하고 active 상태
      await expect(page.getByRole('tab', { name: /코멘트/ })).toHaveAttribute('data-state', 'active');
      // 기본 탭에서 코멘트 본문 보임
      await expect(page.getByText('첫 코멘트')).toBeVisible();

      // 활동 탭 클릭 → 타임라인 testid 보임
      await page.getByRole('tab', { name: /이력/ }).click();
      await expect(page.getByTestId('issue-activity-timeline')).toBeVisible();

      // 사이드바(속성 레일)에 '활동' 헤딩 없음 — 활동 섹션이 본문 탭으로 이동됨
      await expect(
        page.getByTestId('property-rail').getByRole('heading', { name: '활동' }),
      ).toHaveCount(0);
    },
  );

  test('코멘트 탭 초안이 활동 탭 전환 후에도 유지된다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    // 무엇을: 코멘트 작성 중 활동 탭 전환 후 코멘트 탭 복귀 시 초안 유지 검증.
    // 왜: Radix TabsContent 는 기본 unmount → 초안 소실. forceMount 수정의 회귀 방지.
    await mockIssueDetail(page, {});
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 코멘트 작성 RichInput 에 초안 입력 (#785: shadcn Textarea → RichInput 교체)
    const composer = page.getByTestId('issue-comment-input');
    await composer.click();
    await page.keyboard.type('초안 테스트 텍스트');

    // 활동 탭 → 코멘트 탭 순서로 전환
    await page.getByRole('tab', { name: /이력/ }).click();
    await page.getByRole('tab', { name: /코멘트/ }).click();

    // forceMount 덕에 초안이 DOM 에 유지되어야 함
    await expect(composer).toContainText('초안 테스트 텍스트');
  });
});

// 채팅 드로워 — 헤더 채팅 버튼(우측 actions)으로 여는 우측 오버레이(구 인라인 패널 대체).
// 무엇을: 버튼 클릭 → Sheet 드로워 열림, 토글 상태(aria-pressed) 반영, Esc 로 닫힘.
// 왜: 채팅을 3컬럼 고정 영역에서 빼내 본문 폭을 확보하고 필요할 때만 연다(채널 '파일' 드로워 패턴).
test.describe('이슈 채팅 드로워', () => {
  test(
    '헤더 채팅 버튼 → 드로워 열림, Esc 로 닫힘',
    // 닫기는 ?chat=1 을 브라우저 history 로 되돌린다(useHistoryParam — history.state 키·idx) — jsdom·MemoryRouter 로는 재현되지 않는다.
    { tag: ['@platform', '@smoke'] },
    async ({ authenticatedPage: page }) => {
      await mockIssueDetail(page, {});
      await mockChatThread(page, {
        threadId: 7,
        recentMessages: [{ id: 1, threadId: 7, body: '안녕' }],
      });
      await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

      const btn = page.getByTestId('issue-chat-open');
      await expect(btn).toBeVisible();
      // 기본 닫힘 — 드로워 미마운트.
      await expect(page.getByTestId('issue-chat-drawer')).toHaveCount(0);

      // 클릭 → 드로워 열림.
      await btn.click();
      await expect(page.getByTestId('issue-chat-drawer')).toBeVisible();

      // Esc → 닫힘.
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('issue-chat-drawer')).toHaveCount(0);
    },
  );
});

// 반응형 레이아웃 — 데스크톱 최소폭(1024px)에서 세로 스택 검증 (Task 5, #343).
// 무엇을: 1024px 뷰포트에서 본문 스트립·속성 레일이 모두 보임을 확인(채팅은 드로워라 행에서 제외).
// 왜: 2구역 flex 레이아웃이 컨테이너 1032px 미만에서 flex-col 스택으로 무너지지 않는지 회귀 방지.
test.describe('반응형 레이아웃 (데스크톱 최소폭)', () => {
  test('컨테이너가 1032px 미만인 데스크톱 폭(1024px)에서 본문·레일이 세로로 쌓인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    // 의존: 뷰포트 1024px − 앱 사이드바 폭 < 1032px(@container 분기점) 이라 세로 스택 구간이다.
    // 800px 는 모바일(<1024px, WP-192)이라 하단 레일이 없고 「＋ 속성」 시트를 쓰므로(WP-196) 쓸 수 없다.
    await page.setViewportSize({ width: 1024, height: 900 });
    await mockIssueDetail(page, {});
    await mockChatThread(page, { threadId: 9, recentMessages: [] });
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 본문·레일 모두 보임 — 가로 분할이 무너지지 않고 세로 스택으로 유지.
    await expect(page.getByTestId('issue-attachment-strip')).toBeVisible();
    await expect(page.getByTestId('property-rail')).toBeVisible();
  });
});

// AI 사이드패널 + 2구역(본문+레일) 레이아웃 — 가로 오버플로우/붕괴 방지 (#354, 채팅 컬럼 제거 후).
// 무엇을: 본문+레일 행(@container 1032px 기준)이 AI 사이드패널로 좁아져도 오버플로우 없이 세로 스택 전환.
// 왜: 채팅은 이제 오버레이 드로워라 행에서 빠졌지만, AI 패널이 main 을 좁힐 때의 #354 붕괴 회귀는 유지 검증.
test.describe('AI 사이드패널 + 2구역 레이아웃 (#354)', () => {
  // 본문+레일 행(속성 레일의 상위 행)의 가로 오버플로우 + flex 방향 측정.
  async function rowProbe(page: import('@playwright/test').Page) {
    return page.evaluate(() => {
      const rail = document.querySelector('[data-testid="property-rail"]') as HTMLElement;
      const aside = rail.closest('aside') as HTMLElement;
      const row = aside.parentElement as HTMLElement;
      return {
        overflow: row.scrollWidth - row.clientWidth,
        flexDir: getComputedStyle(row).flexDirection,
      };
    });
  }

  test(
    '1280px + AI 사이드패널 열림: 세로 스택 + 가로 오버플로우 없음',
    { tag: ['@layout', '@smoke'] },
    async ({ authenticatedPage: page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await mockIssueDetail(page, {});
      await mockChatThread(page, { threadId: 11, recentMessages: [] });
      await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

      // AI 사이드패널 열기(chat-launcher 1클릭 → side 모드).
      await page.getByTestId('chat-launcher').click();
      await expect(page.getByTestId('ai-side-panel')).toBeVisible();

      // 사이드패널이 열리며 main 폭이 줄어드는 중에 재지 않도록 측정·단언을 재시도한다(WP-225).
      await expect(async () => {
        const r = await rowProbe(page);
        expect(r.flexDir).toBe('column'); // 좁아진 영역 → 세로 스택
        expect(r.overflow).toBeLessThanOrEqual(1); // 가로 오버플로우 없음
      }).toPass();
    },
  );

  test('넓은 화면(1700px) no-AI: 2구역 가로 배치(row) 유지', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    // 컨테이너가 충분히 넓으면(≥1032px) 본문+레일 가로 배치 유지 — 항상-스택 회귀 방지.
    await page.setViewportSize({ width: 1700, height: 900 });
    await mockIssueDetail(page, {});
    await mockChatThread(page, { threadId: 12, recentMessages: [] });
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.getByTestId('property-rail')).toBeVisible();

    // 첫 렌더 직후 배치가 자리 잡을 때까지 다시 잰다(WP-225).
    await expect.poll(async () => (await rowProbe(page)).flexDir).toBe('row');
  });
});

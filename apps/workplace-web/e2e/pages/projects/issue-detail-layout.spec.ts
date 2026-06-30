// 이슈 상세 레이아웃 — 속성 레일 3그룹 접기/펼침 + 첨부 본문 이동 E2E 테스트 (#343).
// 무엇을: property-group-classification 기본 접힘·배지 + 첨부가 본문 스트립으로 이동 검증.
// Task 4: 채팅 접기 패널 자동 토글 + 3구역 flex 레이아웃.

import { expect, test } from '../../fixtures/auth.fixture';
import { createAttachment } from '../../factories/attachment.factory';
import { createChatMessage, createChatThread } from '../../factories/chat.factory';
import {
  createComment,
  createHistoryEntry,
  createIssue,
  createIssueDetail,
} from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import type { IssueAttachment } from '../../../src/types/attachment';
import type { ChatMessageResponse, ChatThreadResponse } from '../../../src/types/chat';
import type {
  IssueCommentResponse,
  IssueDetailResponse,
  IssueHistoryEntry,
  IssueResponse,
} from '../../../src/types/issue';
import type { LabelSummary } from '../../../src/types/label';

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
  } = {},
) {
  const { comments, history, ...summaryOverrides } = overrides;
  const summary = { ...createIssue({ projectKey: PROJECT_KEY }), ...summaryOverrides };
  const detail: IssueDetailResponse = createIssueDetail({
    summary,
    ...(comments !== undefined && { comments }),
    ...(history !== undefined && { history }),
  });

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
  // IssueChatPanel 이 항상 렌더되므로 기본 빈 thread stub 등록.
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

// 첨부 목록 API 스텁 — mockIssueDetail 이후 호출해 attachments 응답을 override.
// 무엇을: mockIssueDetail 이 attachments→[] 로 스텁하는 것을 실제 목록으로 교체.
// 왜: Playwright 은 마지막 등록 route 가 우선하므로 mockIssueDetail 후 이걸 등록하면 덮어씀.
async function mockAttachmentList(
  page: import('@playwright/test').Page,
  items: IssueAttachment[],
) {
  await page.route(
    (url) =>
      url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/attachments`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(items),
      }),
  );
}

// chat thread endpoint 모킹.
// 무엇을: IssueChatPanel 이 호출하는 thread GET 과 messages GET 엔드포인트를 stub.
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

test.describe('이슈 상세 레이아웃 — 속성 레일 3그룹', () => {
  test(
    '분류·관계 그룹은 기본 접힘이고 개수 배지를 보여준다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const labels: LabelSummary[] = [{ id: 1, name: 'bug', colorToken: 'RED' }];
      await mockIssueDetail(page, { labels });
      await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

      // 상태·담당 그룹: 기본 펼침 → 상태 셀렉트 보임
      await expect(page.getByTestId('property-group-status-people')).toBeVisible();
      await expect(page.getByTestId('issue-status-select')).toBeVisible();

      // 분류·관계 그룹: 기본 접힘 → 라벨 영역 숨김 + 배지 표시
      const classGroup = page.getByTestId('property-group-classification');
      await expect(classGroup).toBeVisible();
      await expect(page.getByTestId('issue-labels')).toBeHidden();
      await expect(classGroup.getByTestId('property-group-badge')).toHaveText('1');

      // 헤더 클릭 → 펼침 → 라벨 보임
      await classGroup.getByRole('button', { name: /분류/ }).click();
      await expect(page.getByTestId('issue-labels')).toBeVisible();
    },
  );

  test('첨부는 본문 설명 아래 스트립으로 표시되고 사이드바엔 없다', async ({
    authenticatedPage: page,
  }) => {
    await mockIssueDetail(page, { attachmentCount: 2 });
    await mockAttachmentList(page, [
      createAttachment({ fileId: 1, originalName: 'spec.pdf', mimeType: 'application/pdf', sizeBytes: 1234, attachedById: 9 }),
      createAttachment({ fileId: 2, originalName: 'shot.png', mimeType: 'image/png', sizeBytes: 5678, attachedById: 9 }),
    ]);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    const strip = page.getByTestId('issue-attachment-strip');
    await expect(strip).toBeVisible();
    await expect(strip.getByText('spec.pdf')).toBeVisible();
    // 사이드바(속성 레일)에 첨부 섹션이 없다
    await expect(page.getByTestId('property-rail').getByText('첨부')).toHaveCount(0);
  });

  test('첨부가 0개인 스트립에서는 "첨부가 없습니다" 텍스트가 숨겨지고 드롭존만 표시된다', async ({
    authenticatedPage: page,
  }) => {
    // 무엇을: attachmentCount=0, 빈 목록 → "첨부가 없습니다" 텍스트는 strip 모드에서 숨김 (drop-zone만 표시).
    // 왜: strip 레이아웃에서 빈 상태 텍스트는 불필요 — drop-zone 이 목적을 대신.
    await mockIssueDetail(page, { attachmentCount: 0 });
    await mockAttachmentList(page, []);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    const strip = page.getByTestId('issue-attachment-strip');
    await expect(strip).toBeVisible();

    // strip 내에서 "첨부가 없습니다" 텍스트는 보이지 않아야 함
    await expect(strip.getByText('첨부가 없습니다')).toHaveCount(0);

    // drop-zone 은 여전히 보여야 함
    const dropzone = strip.getByTestId('attachment-dropzone');
    await expect(dropzone).toBeVisible();
    await expect(dropzone).toContainText('파일을 드롭하거나 클릭해 첨부');
  });
});

// 이슈 본문 탭 — 코멘트/활동 분리 (Task 3, #343).
// 무엇을: 기본 탭이 코멘트이고 활동 탭 클릭 시 타임라인 표시, 사이드바엔 활동 헤딩 없음 검증.
// 왜: 활동 로그를 사이드바에서 본문 탭으로 이동해 속성 접근 방해 해소.
test.describe('이슈 본문 탭 (코멘트/활동)', () => {
  test(
    '본문 탭: 코멘트 기본, 활동 탭 클릭 시 타임라인 표시·사이드바엔 활동 없음',
    { tag: '@smoke' },
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

  test('코멘트 탭 초안이 활동 탭 전환 후에도 유지된다', async ({ authenticatedPage: page }) => {
    // 무엇을: 코멘트 작성 중 활동 탭 전환 후 코멘트 탭 복귀 시 초안 유지 검증.
    // 왜: Radix TabsContent 는 기본 unmount → 초안 소실. forceMount 수정의 회귀 방지.
    await mockIssueDetail(page, {});
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 코멘트 작성 textarea 에 초안 입력
    const composer = page.getByPlaceholder('코멘트를 작성하세요');
    await composer.fill('초안 테스트 텍스트');

    // 활동 탭 → 코멘트 탭 순서로 전환
    await page.getByRole('tab', { name: /이력/ }).click();
    await page.getByRole('tab', { name: /코멘트/ }).click();

    // forceMount 덕에 초안이 DOM 에 유지되어야 함
    await expect(composer).toHaveValue('초안 테스트 텍스트');
  });
});

// 채팅 드로워 — 헤더 채팅 버튼(좌측)으로 여는 우측 오버레이(구 인라인 패널 대체).
// 무엇을: 버튼 클릭 → Sheet 드로워 열림, 토글 상태(aria-pressed) 반영, Esc 로 닫힘.
// 왜: 채팅을 3컬럼 고정 영역에서 빼내 본문 폭을 확보하고 필요할 때만 연다(채널 '파일' 드로워 패턴).
test.describe('이슈 채팅 드로워', () => {
  test(
    '헤더 채팅 버튼 → 드로워 열림, Esc 로 닫힘',
    { tag: '@smoke' },
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

// 반응형 레이아웃 — 좁은 화면(<lg) 세로 스택 검증 (Task 5, #343).
// 무엇을: 800px 뷰포트에서 본문 스트립·속성 레일이 모두 보임을 확인(채팅은 드로워라 행에서 제외).
// 왜: 2구역 flex 레이아웃이 lg 미만에서 flex-col 스택으로 무너지지 않는지 회귀 방지.
test.describe('반응형 레이아웃 (좁은 화면)', () => {
  test('좁은 화면(<lg)에서 본문·레일이 세로로 쌓인다', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
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
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await mockIssueDetail(page, {});
      await mockChatThread(page, { threadId: 11, recentMessages: [] });
      await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

      // AI 사이드패널 열기(chat-launcher 1클릭 → side 모드).
      await page.getByTestId('chat-launcher').click();
      await expect(page.getByTestId('ai-side-panel')).toBeVisible();

      const r = await rowProbe(page);
      expect(r.flexDir).toBe('column'); // 좁아진 영역 → 세로 스택
      expect(r.overflow).toBeLessThanOrEqual(1); // 가로 오버플로우 없음
    },
  );

  test('넓은 화면(1700px) no-AI: 2구역 가로 배치(row) 유지', async ({ authenticatedPage: page }) => {
    // 컨테이너가 충분히 넓으면(≥1032px) 본문+레일 가로 배치 유지 — 항상-스택 회귀 방지.
    await page.setViewportSize({ width: 1700, height: 900 });
    await mockIssueDetail(page, {});
    await mockChatThread(page, { threadId: 12, recentMessages: [] });
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.getByTestId('property-rail')).toBeVisible();

    const r = await rowProbe(page);
    expect(r.flexDir).toBe('row');
  });
});

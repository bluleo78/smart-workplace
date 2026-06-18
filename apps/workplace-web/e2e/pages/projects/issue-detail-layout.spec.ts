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
      await classGroup.getByRole('button', { name: /분류·관계/ }).click();
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
      await page.getByRole('tab', { name: /활동/ }).click();
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
    await page.getByRole('tab', { name: /활동/ }).click();
    await page.getByRole('tab', { name: /코멘트/ }).click();

    // forceMount 덕에 초안이 DOM 에 유지되어야 함
    await expect(composer).toHaveValue('초안 테스트 텍스트');
  });
});

// 이슈 본문 최소 너비 — 채팅 패널 열림 시 224px 압축 회귀 방지 (#355).
// 무엇을: 1200px 뷰포트에서 채팅 패널 열림 시 이슈 본문이 360px 이상을 유지하는지 검증.
// 왜: min-w-[360px] 누락 시 채팅(320px)+레일(280px) 고정 너비에 밀려 본문이 224px로 줄어드는 회귀가 발생.
test.describe('이슈 본문 최소 너비 (#355)', () => {
  test(
    '1200px 뷰포트에서 채팅 패널 열림 시 이슈 본문이 360px 이상 유지된다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      await page.setViewportSize({ width: 1200, height: 900 });
      await mockIssueDetail(page, {});
      await mockChatThread(page, {
        threadId: 10,
        recentMessages: [{ id: 1, threadId: 10, body: '테스트 메시지' }],
      });
      await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

      // 채팅 패널이 자동으로 펼쳐진 상태 확인.
      await expect(page.getByTestId('issue-chat-panel-body')).toBeVisible();

      // 이슈 본문 영역(채팅 패널의 이전 형제 요소)의 너비가 360px 이상이어야 함.
      const mainContentWidth = await page.evaluate(() => {
        const chatPanel = document.querySelector('[data-testid="issue-chat-panel-body"]');
        const mainContent = chatPanel?.parentElement?.children[0] as HTMLElement | undefined;
        return mainContent ? Math.round(mainContent.getBoundingClientRect().width) : 0;
      });
      expect(mainContentWidth).toBeGreaterThanOrEqual(360);
    },
  );
});

// 반응형 레이아웃 — 좁은 화면(<lg) 세로 스택 검증 (Task 5, #343).
// 무엇을: 800px 뷰포트에서 본문 스트립·속성 레일이 모두 보임을 확인.
// 왜: 3구역 flex 레이아웃이 lg 미만에서 flex-col 스택으로 무너지지 않는지 회귀 방지.
test.describe('반응형 레이아웃 (좁은 화면)', () => {
  test('좁은 화면(<lg)에서 본문·채팅·레일이 세로로 쌓인다', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await mockIssueDetail(page, {});
    await mockChatThread(page, { threadId: 9, recentMessages: [] });
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 본문·레일 모두 보임 — 가로 3분할이 무너지지 않고 세로 스택으로 유지.
    await expect(page.getByTestId('issue-attachment-strip')).toBeVisible();
    await expect(page.getByTestId('property-rail')).toBeVisible();
  });
});

// 채팅 접기 패널 — 자동 토글 + 수동 토글 영속 (Task 4, #343).
// 무엇을: recentMessages 유무로 패널 자동 펼침/접힘 + 수동 접기 후 새로고침 유지 검증.
// 왜: 채팅 사용 여부에 따라 공간 자동 배분, 사용자 설정을 localStorage 로 기억.
test.describe('이슈 채팅 패널 (채팅 접기 패널, Task 4)', () => {
  test(
    '메시지 있으면 자동 펼침, 수동 접기 후 새로고침 시 접힘 유지',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      await mockIssueDetail(page, {});
      await mockChatThread(page, {
        threadId: 7,
        recentMessages: [{ id: 1, threadId: 7, body: '안녕' }],
      });
      await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

      // 자동 펼침 — recentMessages 있으므로 패널이 열려있어야 함.
      await expect(page.getByTestId('issue-chat-panel-body')).toBeVisible();

      // 수동 접기 → 얇은 세로 토글 바로 전환.
      await page.getByTestId('issue-chat-panel-collapse').click();
      await expect(page.getByTestId('issue-chat-panel-body')).toBeHidden();
      await expect(page.getByTestId('issue-chat-panel-open')).toBeVisible();

      // 새로고침 후에도 접힘 유지(localStorage '0' 기억). routes 는 page 객체에 유지됨.
      await page.reload();
      await expect(page.getByTestId('issue-chat-panel-body')).toBeHidden();
    },
  );

  test('메시지 없으면 기본 접힘 → 토글 바 표시', async ({ authenticatedPage: page }) => {
    await mockIssueDetail(page, {});
    await mockChatThread(page, { threadId: 8, recentMessages: [] });
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 메시지 없으면 패널 기본 접힘.
    await expect(page.getByTestId('issue-chat-panel-body')).toBeHidden();
    await expect(page.getByTestId('issue-chat-panel-open')).toBeVisible();
  });
});

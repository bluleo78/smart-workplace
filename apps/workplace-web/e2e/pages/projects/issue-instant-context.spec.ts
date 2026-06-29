// 이슈 Instant Context 카드 E2E 테스트 (#517 → 온디맨드 재설계).
// 무엇을: 카드가 항상 렌더되고, 생성 버튼 클릭 → POST 발생 → GET 재조회 → summary 표시를 검증한다.
// 왜: Task 6 구현 후 DOM 노출 여부 및 생성 플로우를 결정론적으로 보장.

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import { createUser } from '../../factories/auth.factory';
import { mockApi } from '../../fixtures/api-mock';
import type { IssueAiContext, IssueDetailResponse } from '../../../src/types/issue';

const PROJECT_KEY = 'PROJ';
const ISSUE_NUMBER = 1;

// 이슈 상세 페이지 공통 API 스텁 설정.
// 무엇을: 이슈 상세 레이아웃 스텁 패턴을 따른다.
// 왜: 백엔드 없이 이슈 상세 레이아웃을 테스트하기 위해.
async function mockIssueDetail(
  page: import('@playwright/test').Page,
  detail: IssueDetailResponse,
) {
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
  await page.route(
    (url) =>
      url.pathname ===
      `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/chat/thread`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          threadId: 999,
          issueId: 100,
          archivedAt: null,
          members: [],
          recentMessages: [],
        }),
      }),
  );
}

test.describe('이슈 Instant Context 카드 (#517 온디맨드)', () => {
  test(
    'aiContext 가 있는 이슈는 현황 카드·블로커 배지·다음 액션을 보여준다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      // aiContext(summary + nextAction + OVERDUE 블로커)를 포함한 이슈 상세 스텁.
      const detail: IssueDetailResponse = createIssueDetail({
        summary: createIssue({ projectKey: PROJECT_KEY }),
        aiContext: {
          summary: '리뷰 대기 중 — 3일째 변화 없음',
          nextAction: '리뷰어 지정',
          generatedAt: new Date().toISOString(),
          blockers: [{ type: 'OVERDUE', message: '내일 마감' }],
        },
      });
      await mockIssueDetail(page, detail);
      await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

      // 현황 카드 컨테이너가 DOM 에 보여야 한다.
      await expect(page.getByTestId('issue-instant-context')).toBeVisible();

      // 요약 텍스트가 카드 안에 표시된다.
      await expect(page.getByText('리뷰 대기 중 — 3일째 변화 없음')).toBeVisible();

      // 블로커 배지 컨테이너와 OVERDUE 배지가 노출된다.
      await expect(page.getByTestId('issue-blocker-badges')).toBeVisible();
      await expect(page.getByTestId('blocker-OVERDUE')).toBeVisible();

      // 다음 액션 텍스트가 issue-next-action 요소에 포함된다.
      await expect(page.getByTestId('issue-next-action')).toContainText('리뷰어 지정');
    },
  );

  test(
    '저장본 없는 이슈는 카드가 항상 렌더되고 생성 버튼이 노출된다',
    async ({ authenticatedPage: page }) => {
      // summary=null — 백엔드가 aiContext 를 항상 반환(온디맨드 재설계).
      const detail: IssueDetailResponse = createIssueDetail({
        summary: createIssue({ projectKey: PROJECT_KEY }),
        aiContext: {
          summary: null,
          nextAction: null,
          generatedAt: null,
          blockers: [],
        } satisfies IssueAiContext,
      });
      await mockIssueDetail(page, detail);
      await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

      // 카드는 항상 렌더됨 — container 표시 확인.
      await expect(page.getByTestId('issue-instant-context')).toBeVisible();

      // 생성 버튼이 보여야 한다.
      await expect(page.getByTestId('issue-summary-generate')).toBeVisible();
      await expect(page.getByTestId('issue-summary-generate')).toContainText('생성');
    },
  );

  test(
    '생성 버튼 클릭 → POST 발생 → GET 재조회 → 카드에 현황 텍스트 노출',
    async ({ authenticatedPage: page }) => {
      const summaryText = '테스트용 AI 현황 요약 텍스트';
      const aiSummaryAfter: IssueAiContext = {
        summary: summaryText,
        nextAction: '코드 리뷰 요청',
        generatedAt: new Date().toISOString(),
        blockers: [],
      };

      // 초기 상태 — summary 없음.
      const detailBefore: IssueDetailResponse = createIssueDetail({
        summary: createIssue({ projectKey: PROJECT_KEY }),
        aiContext: { summary: null, nextAction: null, generatedAt: null, blockers: [] },
      });
      // 생성 후 상태 — summary 있음.
      const detailAfter: IssueDetailResponse = createIssueDetail({
        summary: createIssue({ projectKey: PROJECT_KEY }),
        aiContext: aiSummaryAfter,
      });

      // GET 모킹 — POST 성공 후 캐시 무효화로 재요청 시 detailAfter 반환.
      // 상태 플립: 첫 조회는 detailBefore, POST 이후 조회는 detailAfter.
      let postDone = false;
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
            body: JSON.stringify(postDone ? detailAfter : detailBefore),
          }),
      );
      for (const sub of ['watchers', 'labels', 'attachments']) {
        await page.route(
          (url) =>
            url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/${sub}`,
          (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
        );
      }
      await page.route(
        (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/labels`,
        (route) =>
          route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );
      await page.route(
        (url) =>
          url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/drive-links`,
        (route) =>
          route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );
      await page.route(
        (url) => url.pathname === '/api/v1/drive/spaces',
        (route) =>
          route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );
      await page.route(
        (url) =>
          url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/chat/thread`,
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ threadId: 999, issueId: 100, archivedAt: null, members: [], recentMessages: [] }),
          }),
      );

      // POST ai-summary 모킹 — 일부러 지연해 비활성 상태를 확인할 수 있게 한다.
      let postRequestFired = false;
      await page.route(
        (url) =>
          url.pathname ===
          `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/ai-summary`,
        async (route) => {
          postRequestFired = true;
          // 의도적 지연 — in-flight 동안 버튼 비활성 확인 가능.
          await new Promise((r) => setTimeout(r, 300));
          postDone = true;
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(aiSummaryAfter),
          });
        },
      );

      await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

      // 초기: 생성 버튼 노출 + 활성화 상태.
      const btn = page.getByTestId('issue-summary-generate');
      await expect(btn).toBeVisible();
      await expect(btn).not.toBeDisabled();

      // 버튼 클릭 → POST 발생.
      await btn.click();

      // in-flight: 버튼 비활성(생성 중… 텍스트).
      await expect(btn).toBeDisabled();
      await expect(btn).toContainText('생성 중…');

      // POST 완료 후 캐시 무효화 → GET 재조회 → 카드에 summary 표시.
      await expect(page.getByText(summaryText)).toBeVisible();

      // POST 가 실제로 발생했는지 확인.
      expect(postRequestFired).toBe(true);
    },
  );

  test(
    '블로커가 있으면 summary 없어도 즉시 블로커 배지가 표시된다',
    async ({ authenticatedPage: page }) => {
      // summary null + BLOCKED 블로커 — 블로커는 read 경로에서 항상 계산됨.
      const detail: IssueDetailResponse = createIssueDetail({
        summary: createIssue({ projectKey: PROJECT_KEY }),
        aiContext: {
          summary: null,
          nextAction: null,
          generatedAt: null,
          blockers: [{ type: 'BLOCKED', message: '선행 이슈 미완료' }],
        } satisfies IssueAiContext,
      });
      await mockIssueDetail(page, detail);
      await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

      // 블로커 배지 노출 (summary 없이도).
      await expect(page.getByTestId('issue-blocker-badges')).toBeVisible();
      await expect(page.getByTestId('blocker-BLOCKED')).toBeVisible();

      // 생성 버튼도 함께 표시.
      await expect(page.getByTestId('issue-summary-generate')).toBeVisible();
    },
  );

  test(
    'aiAvailable=false 이면 AI 카드가 렌더되지 않는다',
    async ({ authenticatedPage: page }) => {
      // aiAvailable:false — 비서 없는 사용자. fixture 기본값(true) 위에 LIFO 재정의.
      await mockApi(page, 'GET', '/api/v1/users/me', createUser({ aiAvailable: false }));

      const detail: IssueDetailResponse = createIssueDetail({
        summary: createIssue({ projectKey: PROJECT_KEY }),
        aiContext: {
          summary: '요약 있음',
          nextAction: null,
          generatedAt: new Date().toISOString(),
          blockers: [],
        } satisfies IssueAiContext,
      });
      await mockIssueDetail(page, detail);
      await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

      // AI 카드가 DOM 에 없어야 한다 (aiAvailable 게이트).
      await expect(page.getByTestId('issue-instant-context')).not.toBeVisible();
    },
  );
});

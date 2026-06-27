// 이슈 Instant Context 카드 E2E 테스트 (#517).
// 무엇을: IssueAiContext 가 있을 때 현황 카드·블로커 배지가 노출되고,
//         null 일 때 카드가 렌더되지 않음을 검증한다.
// 왜: Task 7(카드 컴포넌트) 구현 후 실제 DOM 노출 여부를 결정론적으로 보장.

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import type { IssueDetailResponse } from '../../../src/types/issue';

const PROJECT_KEY = 'PROJ';
const ISSUE_NUMBER = 1;

// 이슈 상세 페이지 공통 API 스텁 설정.
// 무엇을: issue-detail-layout.spec.ts 의 mockIssueDetail 패턴을 그대로 따른다.
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

test.describe('이슈 Instant Context 카드 (#517)', () => {
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

  test('aiContext 가 null 이면 현황 카드를 렌더하지 않는다', async ({
    authenticatedPage: page,
  }) => {
    // aiContext=null 이슈 — 카드가 DOM 에 존재하지 않아야 한다.
    const detail: IssueDetailResponse = createIssueDetail({
      summary: createIssue({ projectKey: PROJECT_KEY }),
      aiContext: null,
    });
    await mockIssueDetail(page, detail);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 카드가 렌더되지 않음 — count 0 으로 검증.
    await expect(page.getByTestId('issue-instant-context')).toHaveCount(0);
  });
});

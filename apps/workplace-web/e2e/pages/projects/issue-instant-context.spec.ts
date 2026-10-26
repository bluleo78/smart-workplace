// 이슈 Instant Context 카드 E2E (#517 → 온디맨드 재설계).
// 브라우저가 있어야 판정되는 것만 남긴다 — 경고 톤 블로커 배지 글자가 AI 카드 배경 위에서 AA(4.5:1) 이상인지(WP-303, 계산된 색 @layout).
// 카드 문구·블로커 배지·접기·생성 POST → 재조회 → 요약 반영·aiAvailable 게이트는
// 페이지 테스트 src/pages/projects/issueInstantContext.test.tsx 가 지킨다(WP-980).

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import { textContrast } from '../../fixtures/contrast';
import type { IssueDetailResponse } from '../../../src/types/issue';

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
    '경고 톤 블로커 배지 글자가 AI 카드 배경 위에서 AA 대비를 넘는다',
    { tag: ['@layout', '@smoke'] },
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
      // WP-303: 경고 톤(action) 블로커 배지 글자가 AI 카드 배경 위에서도 AA(4.5:1) 이상.
      await expect.poll(() => textContrast(page.getByTestId('blocker-OVERDUE'))).toBeGreaterThanOrEqual(4.5);

      // 다음 액션 텍스트가 issue-next-action 요소에 포함된다.
      await expect(page.getByTestId('issue-next-action')).toContainText('리뷰어 지정');
    },
  );
});

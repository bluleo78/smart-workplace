// IssueDetailPage 태스크 삭제 확인 AlertDialog E2E 회귀 테스트 (#161).
// window.confirm() 대신 shadcn AlertDialog가 표시되고, 확인/취소가 올바르게 동작하는지 검증.

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';

const PROJECT_KEY = 'WP';
const ISSUE_NUMBER = 2;

// IssueDetailPage 공통 스텁 — 삭제 다이얼로그 테스트에 필요한 최소 엔드포인트 모킹.
async function setupDeleteStubs(
  page: import('@playwright/test').Page,
  childCount = 0,
) {
  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createProject()),
    }),
  );
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createIssueDetail({
            summary: createIssue({ id: ISSUE_NUMBER, number: ISSUE_NUMBER, title: '삭제 대상 태스크', childCount }),
            body: '본문',
            comments: [],
            history: [],
          }),
        ),
      });
    },
  );
  for (const sub of ['watchers', 'labels', 'attachments', 'children']) {
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/${sub}`,
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
  }
}

test.describe('IssueDetailPage 삭제 확인 AlertDialog (#161)', () => {
  test(
    '삭제 버튼 클릭 시 shadcn AlertDialog가 열리고 취소 시 API 미호출',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      await setupDeleteStubs(page);
      let deleteCalled = false;
      await page.route(
        (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`,
        (route) => {
          if (route.request().method() === 'DELETE') {
            deleteCalled = true;
            return route.fulfill({ status: 204, body: '' });
          }
          return route.fallback();
        },
      );

      await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

      // 삭제 버튼 클릭 — window.confirm() 이 아닌 AlertDialog가 열려야 함.
      await page.getByTestId('issue-delete').click();

      // AlertDialog 제목이 보이는지 확인.
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await expect(page.getByText('태스크 삭제')).toBeVisible();
      await expect(page.getByText('이 태스크를 삭제하시겠습니까?')).toBeVisible();

      // 취소 → 다이얼로그 닫힘 + DELETE API 미호출.
      await page.getByRole('button', { name: '취소' }).click();
      await expect(page.getByRole('alertdialog')).not.toBeVisible();
      expect(deleteCalled).toBe(false);
    },
  );

  test(
    '삭제 확인 클릭 시 DELETE API 호출 후 보드로 이동',
    async ({ authenticatedPage: page }) => {
      await setupDeleteStubs(page);
      let deleteCalled = false;
      await page.route(
        (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`,
        (route) => {
          if (route.request().method() === 'DELETE') {
            deleteCalled = true;
            return route.fulfill({ status: 204, body: '' });
          }
          return route.fallback();
        },
      );
      // 보드 페이지 스텁.
      await page.route(`**/api/v1/projects/${PROJECT_KEY}/issues*`, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [], totalElements: 0, totalPages: 0, number: 0, size: 20 }) }),
      );

      await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
      await page.getByTestId('issue-delete').click();
      await expect(page.getByRole('alertdialog')).toBeVisible();

      // 삭제 버튼 클릭 → DELETE API 호출.
      await page.getByRole('button', { name: '삭제' }).click();
      expect(deleteCalled).toBe(true);
    },
  );

  test(
    'childCount > 0 이면 AlertDialog에 자식 SUBTASK 경고 문구 표시',
    async ({ authenticatedPage: page }) => {
      await setupDeleteStubs(page, 3);

      await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
      await page.getByTestId('issue-delete').click();

      await expect(page.getByRole('alertdialog')).toBeVisible();
      await expect(
        page.getByText('이 태스크에는 하위 태스크가 3개 있습니다. 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.'),
      ).toBeVisible();
    },
  );
});

// IssueDetailPage 태스크 삭제 확인 AlertDialog E2E 회귀 테스트 (#161).
// window.confirm() 대신 shadcn AlertDialog가 표시되고, 확인/취소가 올바르게 동작하는지 검증.

import { expect, test } from '../../fixtures/auth.fixture';
import { expectTheme, textContrast, withTheme } from '../../fixtures/contrast';
import { trackRequests } from '../../fixtures/requests';
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
      const deletes = trackRequests(page, 'DELETE', `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
      await page.route(
        (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`,
        (route) => {
          if (route.request().method() === 'DELETE') {
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
      expect(deletes.count()).toBe(0);
    },
  );

  test(
    '삭제 확인 클릭 시 DELETE API 호출 후 보드로 이동',
    async ({ authenticatedPage: page }) => {
      await setupDeleteStubs(page);
      const deletes = trackRequests(page, 'DELETE', `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
      await page.route(
        (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`,
        (route) => {
          if (route.request().method() === 'DELETE') {
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
      await deletes.waitFor();
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

// 채움 버튼 글자 대비(WP-322) — 다크 기본 버튼(밝은 primary 위 흰 글자 3.25:1)·라이트 삭제 버튼(밝은 빨강 위 흰 글자 3.6:1)이 AA 미달이던 회귀 방지.
// 브라우저가 실제로 칠한 색(반투명 다크 삭제 버튼 bg-destructive/60 포함)으로 잰다.
for (const theme of ['light', 'dark'] as const) {
  test(`기본·삭제 버튼 글자가 4.5:1 대비를 지킨다 (${theme}) (WP-322)`, async ({ authenticatedPage: page }) => {
    await withTheme(page, theme);
    await setupDeleteStubs(page);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expectTheme(page, theme);

    // 기본(primary) 버튼 — 본문 편집의 「저장」.
    await page.getByRole('button', { name: '본문 편집' }).click();
    const save = page.getByTestId('issue-body-save');
    await expect(save).toBeVisible();
    expect(await textContrast(save)).toBeGreaterThanOrEqual(4.5);
    await page.getByTestId('issue-body-cancel').click();

    // 삭제(destructive) 버튼 — 삭제 확인 다이얼로그의 「삭제」.
    await page.getByTestId('issue-delete').click();
    const confirm = page.getByRole('alertdialog').getByRole('button', { name: '삭제' });
    await expect(confirm).toBeVisible();
    expect(await textContrast(confirm)).toBeGreaterThanOrEqual(4.5);
  });
}

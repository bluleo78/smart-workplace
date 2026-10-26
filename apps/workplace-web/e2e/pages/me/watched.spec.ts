// /me/watched — 구버전 경로가 내 작업 구독 탭(/me/tasks/watched)으로 리다이렉트되는지 검증한다(라우트 배선, @wiring).
// 구독 탭의 빈 문구·group=recent 조회·담당자 열·프로젝트 머리는 src/pages/me/myTasksPage.test.tsx(vitest 화면 테스트)가 지킨다.

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';

test.describe('/me/watched', () => {
  test('구독 탭으로 리다이렉트되고 구독 목록을 표시한다', { tag: '@wiring' }, async ({
    authenticatedPage: page,
  }) => {
    await page.route(
      (url) => url.pathname === '/api/v1/me/watched-issues',
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            createIssueSearchResponse(
              [
                createIssue({ id: 1, number: 1, title: 'watched A' }),
                createIssue({ id: 2, number: 2, title: 'watched B' }),
              ],
              null,
            ),
          ),
        });
      },
    );

    await page.goto('/me/watched');
    // 구버전 경로 → 새 구독 탭으로 리다이렉트
    await expect(page).toHaveURL(/\/me\/tasks\/watched$/);
    await expect(page.getByRole('heading', { name: '내 작업' })).toBeVisible();
    await expect(page.getByTestId('watched-row-1')).toBeVisible();
    await expect(page.getByTestId('watched-row-1')).toContainText('watched A');
    await expect(page.getByTestId('watched-row-2')).toContainText('watched B');
  });
});

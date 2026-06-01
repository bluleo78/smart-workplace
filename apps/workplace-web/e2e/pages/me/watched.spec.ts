// /me/watched — 구버전 경로가 내 작업 구독 탭(/me/tasks/watched)으로 리다이렉트되는지 검증한다.

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';

test.describe('/me/watched', () => {
  test('구독 탭으로 리다이렉트되고 구독 목록을 표시한다', async ({
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

  test('구독 중인 작업이 없으면 빈 메시지를 표시한다', async ({
    authenticatedPage: page,
  }) => {
    await page.route(
      (url) => url.pathname === '/api/v1/me/watched-issues',
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssueSearchResponse([], null)),
        });
      },
    );

    await page.goto('/me/watched');
    // 구버전 경로 → 새 구독 탭으로 리다이렉트
    await expect(page).toHaveURL(/\/me\/tasks\/watched$/);
    await expect(page.getByText('구독 중인 작업이 없습니다.')).toBeVisible();
  });
});

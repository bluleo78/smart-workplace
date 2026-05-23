// /me/watched — 내 태스크 페이지 E2E.

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';

test.describe('/me/watched', () => {
  test('구독 중인 태스크 목록을 표시한다', async ({ authenticatedPage: page }) => {
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
    await expect(page.getByRole('heading', { name: '내 태스크' })).toBeVisible();
    await expect(page.getByTestId('watched-row-1')).toBeVisible();
    await expect(page.getByTestId('watched-row-1')).toContainText('watched A');
    await expect(page.getByTestId('watched-row-2')).toContainText('watched B');
  });

  test('구독 중인 태스크가 없으면 빈 메시지를 표시한다', async ({
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
    await expect(page.getByText('구독 중인 태스크가 없습니다.')).toBeVisible();
  });
});

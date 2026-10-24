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
    await expect(page.getByTestId('watched-row-empty')).toContainText('구독 중인 작업이 없습니다');
  });
  // WP-916 — 구독 탭은 최근 순 프로젝트 묶음(group=recent)으로 부르고, 남의 이슈도 섞이므로 담당자 열을 둔다.
  test('구독 탭은 group=recent 로 부르고 담당자 열이 있다', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const seen: URLSearchParams[] = [];
    await page.route(
      (url) => url.pathname === '/api/v1/me/watched-issues',
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        seen.push(new URL(route.request().url()).searchParams);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            createIssueSearchResponse([
              createIssue({
                id: 5, projectKey: 'EX', number: 5, title: '구독한 이슈',
                assignees: [{ id: 7, username: 'kim', name: '김담당', kind: 'HUMAN' }],
                projectGroup: { name: '외부 연동 프로젝트', size: 1 },
              }),
            ]),
          ),
        });
      },
    );
    await page.goto('/me/tasks/watched');
    await expect(page.getByTestId('watched-row-5')).toBeVisible();
    expect(seen[0].get('group')).toBe('recent');
    await expect(page.getByRole('columnheader', { name: '담당자' })).toHaveCount(1);
    await expect(page.getByTestId('watched-row-project-EX-head-name')).toHaveText('외부 연동 프로젝트');
  });
});

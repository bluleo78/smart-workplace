// 이슈 watcher (구독) 토글 E2E.
// IssueDetailPage 의 watch-toggle 버튼이 POST/DELETE 를 호출하고 aria-pressed 를 반영하는지 검증.

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssueDetail, createIssue } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';

const PROJECT_KEY = 'WP';

test.describe('이슈 watcher', () => {
  test('상세에서 watch 토글 → aria-pressed + API 호출', async ({
    authenticatedPage: page,
  }) => {
    let watchers: Array<{ userId: number; username: string; name: string }> = [];

    await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createProject()),
      }),
    );

    // 상세 응답 — labels 빈 배열.
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1`,
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            createIssueDetail({
              summary: createIssue({ id: 1, number: 1, title: 'watch 대상' }),
              body: '본문',
              comments: [],
              history: [],
            }),
          ),
        });
      },
    );

    // watchers 목록은 가변 — toggle 결과 반영.
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/watchers`,
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(watchers),
        });
      },
    );

    let postCount = 0;
    let deleteCount = 0;
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/watch`,
      (route) => {
        const method = route.request().method();
        if (method === 'POST') {
          postCount += 1;
          watchers = [{ userId: 1, username: 'testuser', name: '테스트 사용자' }];
          return route.fulfill({ status: 204, body: '' });
        }
        if (method === 'DELETE') {
          deleteCount += 1;
          watchers = [];
          return route.fulfill({ status: 204, body: '' });
        }
        return route.fallback();
      },
    );

    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

    const btn = page.getByTestId('watch-toggle');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await expect(btn).toHaveAttribute('aria-label', '구독');

    // 구독 → aria-pressed=true + POST 호출.
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(btn).toHaveAttribute('aria-label', '구독 중');
    expect(postCount).toBe(1);

    // 해제 → false + DELETE 호출.
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await expect(btn).toHaveAttribute('aria-label', '구독');
    expect(deleteCount).toBe(1);
  });

  test('watch 토글 실패 시 토스트 노출', async ({ authenticatedPage: page }) => {
    await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createProject()),
      }),
    );
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1`,
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssueDetail({ summary: createIssue({ id: 1, number: 1 }) })),
        });
      },
    );
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/watchers`,
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/watch`,
      (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 500,
            error: 'Internal Server Error',
            message: '',
            errors: null,
            timestamp: new Date().toISOString(),
            path: `/api/v1/projects/${PROJECT_KEY}/issues/1/watch`,
          }),
        }),
    );

    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);
    await page.getByTestId('watch-toggle').click();
    await expect(page.getByText('구독 상태를 변경하지 못했습니다')).toBeVisible();
  });
});

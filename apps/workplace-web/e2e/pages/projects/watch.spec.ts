// 이슈 watcher(구독) 토글 E2E — 키보드로 누른 뒤 응답이 늦어도 초점이 버튼에 남는지(@input)만 남긴다.
// 구독/해제 POST·DELETE·aria 반영과 실패 토스트는 src/pages/projects/issueDetailFields.test.tsx 페이지 테스트가 지킨다(WP-971).

import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';
import { createIssueDetail, createIssue } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';

const PROJECT_KEY = 'WP';

test.describe('이슈 watcher', () => {
  // WP-847: 요청 중 잠금은 disabled 가 아니라 aria-disabled — 키보드로 누른 뒤 응답이 늦어도 초점이 버튼에 남는다.
  test('키보드로 구독 → 응답 전엔 잠기고(중복 요청 없음) 응답 뒤에도 초점이 버튼에 남는다', { tag: '@input' }, async ({
    authenticatedPage: page,
  }) => {
    let watchers: Array<{ userId: number; username: string; name: string }> = [];
    await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) => route.fulfill({ json: createProject() }));
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1`,
      (route) =>
        route.request().method() !== 'GET'
          ? route.fallback()
          : route.fulfill({
            json: createIssueDetail({ summary: createIssue({ id: 1, number: 1, title: 'watch 대상' }), body: '본문', comments: [], history: [] }),
          }),
    );
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/watchers`,
      (route) => (route.request().method() !== 'GET' ? route.fallback() : route.fulfill({ json: watchers })),
    );
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const posts = trackRequests(page, 'POST', `/api/v1/projects/${PROJECT_KEY}/issues/1/watch`);
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/watch`,
      async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await gate;
        watchers = [{ userId: 1, username: 'testuser', name: '테스트 사용자' }];
        return route.fulfill({ status: 204, body: '' });
      },
    );

    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);
    const btn = page.getByTestId('watch-toggle');
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await btn.focus();
    await page.keyboard.press('Enter');
    await posts.waitFor();
    await expect(btn).toHaveAttribute('aria-disabled', 'true');
    await expect(btn).toBeFocused();
    // 잠긴 동안 다시 눌러도 요청을 더 보내지 않는다.
    await page.keyboard.press('Enter');

    release();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(btn).not.toHaveAttribute('aria-disabled', 'true');
    await expect(btn).toBeFocused();
    expect(posts.count()).toBe(1);
  });
});

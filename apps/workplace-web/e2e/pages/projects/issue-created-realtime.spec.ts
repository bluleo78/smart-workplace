// WP-36 — AI Chat 등 브라우저 밖에서 생성된 이슈가 목록 화면에 새로고침 없이 반영되는지 E2E.
// /api/v1/events(통합 SSE) 를 모킹해 issue.created 프레임을 목록이 먼저 그려진 *뒤에* 흘려보내고,
// 목록 검색 API 가 재호출되어 새 행이 나타나는지 검증한다(브라우저 쪽 create POST 없음).
import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';

const KEY = 'WP';

test.describe('이슈 생성 실시간 반영 (WP-36)', () => {
  test('issue.created SSE 수신 시 열려 있는 목록에 새 이슈가 즉시 나타난다', async ({
    authenticatedPage: page,
  }) => {
    const existing = createIssue({ id: 1, number: 7, title: '기존 이슈' });
    const created = createIssue({ id: 2, number: 8, title: 'AI Chat 에서 만든 이슈' });
    // 서버 상태 — SSE 발사 시점에 새 이슈가 추가된 것으로 바꾼다(AI 가 서버에서 생성한 상황 재현).
    let issues = [existing];

    await page.route(`**/api/v1/projects/${KEY}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
    );
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${KEY}/issues`,
      (route) => {
        // 이 시나리오에서 브라우저가 직접 생성 POST 를 보내면 안 된다 — 오면 실패로 드러나게 404.
        if (route.request().method() !== 'GET') return route.fulfill({ status: 404 });
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssueSearchResponse(issues, null)),
        });
      },
    );

    // SSE 응답을 목록 첫 렌더 이후까지 보류 — 첫 조회보다 먼저 이벤트가 오면 무효화할 캐시가 없어 검증이 무의미해진다.
    let releaseSse!: () => void;
    const sseGate = new Promise<void>((resolve) => (releaseSse = resolve));
    await page.route(
      (url) => url.pathname === '/api/v1/events',
      async (route) => {
        await sseGate;
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: { 'cache-control': 'no-cache' },
          body:
            `event: issue.created\n` +
            `data: ${JSON.stringify({ projectKey: KEY, issueId: 2, issueKey: `${KEY}-8`, actorId: 99 })}\n\n`,
        });
      },
    );

    await page.goto(`/projects/${KEY}`);
    await expect(page.getByTestId('issue-row-7')).toBeVisible();
    await expect(page.getByTestId('issue-row-8')).toHaveCount(0);

    // AI 가 서버에서 이슈를 만든 뒤 issue.created 가 도착.
    issues = [created, existing];
    releaseSse();

    await expect(page.getByTestId('issue-row-8')).toBeVisible();
    await expect(page.getByTestId('issue-row-8')).toContainText('AI Chat 에서 만든 이슈');
  });
});

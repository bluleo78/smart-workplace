// WP-36/WP-59 — 서버 측(AI Chat 등) 이슈 생성·수정·삭제가 열린 목록에 새로고침 없이 반영되는지 E2E.
// /api/v1/events 를 모킹해 resource.changed 프레임을 목록 첫 렌더 *뒤에* 흘려보내고, 검색 API 재호출로 행이 바뀌는지 본다.
import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';

const KEY = 'WP';
type Issue = ReturnType<typeof createIssue>;

/** 목록 모킹 + 게이트된 SSE 1프레임. release(frame) 호출 시 서버 상태를 바꾸고 이벤트를 보낸다. */
async function setup(page: import('@playwright/test').Page, initial: Issue[]) {
  const state = { issues: initial };
  await page.route(`**/api/v1/projects/${KEY}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/issues`,
    (route) => {
      // 브라우저가 직접 쓰기 요청을 보내면 안 되는 시나리오 — 오면 404 로 드러낸다.
      if (route.request().method() !== 'GET') return route.fulfill({ status: 404 });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(state.issues, null)),
      });
    },
  );
  // SSE 응답을 목록 첫 렌더 이후까지 보류 — 첫 조회보다 먼저 이벤트가 오면 무효화할 캐시가 없어 검증이 무의미해진다.
  // 프레임 전달 이후의 재연결 요청은 연결 실패(abort)로 처리 — 재연결 catch-up(전체 무효화)이 발화하면 resource.changed 분기가 없어도
  // 테스트가 통과해 버리므로, 이 스펙은 오직 resource.changed 처리만 검증하도록 catch-up 을 차단한다.
  let open!: (body: string) => void;
  const gate = new Promise<string>((r) => (open = r));
  let delivered = false;
  await page.route(
    (url) => url.pathname === '/api/v1/events',
    async (route) => {
      // StrictMode 이중 마운트로 첫 연결 요청이 2번 올 수 있어(앞선 것은 취소됨) '몇 번째'가 아니라 '릴리스 이전 도착 여부'로 구분한다.
      if (delivered) return route.abort();
      const body = await gate;
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body,
      });
    },
  );
  const release = (next: Issue[], op: string, issueNumber: number) => {
    state.issues = next;
    const data = { resource: 'issue', op, scopeType: 'PROJECT', scopeId: 1, ids: [issueNumber], actorId: 99, projectKey: KEY, issueNumber };
    delivered = true; // 이후 도착하는 재연결 요청은 abort
    open(`event: resource.changed\ndata: ${JSON.stringify(data)}\n\n`);
  };
  return { release };
}

test.describe('이슈 변경 실시간 반영 (WP-59)', () => {
  test('생성 — 새 행이 나타난다', async ({ authenticatedPage: page }) => {
    const a = createIssue({ id: 1, number: 7, title: '기존 이슈' });
    const b = createIssue({ id: 2, number: 8, title: 'AI Chat 에서 만든 이슈' });
    const { release } = await setup(page, [a]);
    await page.goto(`/projects/${KEY}`);
    await expect(page.getByTestId('issue-row-7')).toBeVisible();
    await expect(page.getByTestId('issue-row-8')).toHaveCount(0);
    release([b, a], 'created', 8);
    await expect(page.getByTestId('issue-row-8')).toContainText('AI Chat 에서 만든 이슈');
  });

  test('수정 — 행 제목이 바뀐다', async ({ authenticatedPage: page }) => {
    const a = createIssue({ id: 1, number: 7, title: '수정 전 제목' });
    const { release } = await setup(page, [a]);
    await page.goto(`/projects/${KEY}`);
    await expect(page.getByTestId('issue-row-7')).toContainText('수정 전 제목');
    release([{ ...a, title: 'AI 가 고친 제목' }], 'updated', 7);
    await expect(page.getByTestId('issue-row-7')).toContainText('AI 가 고친 제목');
  });

  test('삭제 — 행이 사라진다', async ({ authenticatedPage: page }) => {
    const a = createIssue({ id: 1, number: 7, title: '남는 이슈' });
    const b = createIssue({ id: 2, number: 8, title: '지워질 이슈' });
    const { release } = await setup(page, [a, b]);
    await page.goto(`/projects/${KEY}`);
    await expect(page.getByTestId('issue-row-8')).toBeVisible();
    release([a], 'deleted', 8);
    await expect(page.getByTestId('issue-row-8')).toHaveCount(0);
    await expect(page.getByTestId('issue-row-7')).toBeVisible();
  });
});

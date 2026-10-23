// 이슈 불러오기 실패 상태 E2E(WP-858) — 이슈 검색이 실패하면 「이슈가 없습니다」·「검색 결과가 없습니다」 빈 상태 대신
// 「이슈를 불러오지 못했습니다」+다시 시도를 보이고, 다시 시도가 재요청해 결과를 그리는지(목록·보드 배선) 본다.
// URL 의 id 토큰이 정수가 아니면(label=1.5) 서버로 보내지 않는지도 본다. 판정 경우의 수는 issueFilters 단위 테스트가 맡는다.
import { mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';

const KEY = 'WP';
const ISSUES_PATH = `/api/v1/projects/${KEY}/issues`;

// 프로젝트 메타 + 이슈 검색 — failing() 이 true 인 동안 검색 GET 은 500, 그 뒤로는 이슈 1건.
async function mockSearch(page: import('@playwright/test').Page, failing: () => boolean) {
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}`, createProject());
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/members`, []);
  await page.route(
    (url) => url.pathname === ISSUES_PATH,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      if (failing()) {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: '서버 오류' }) });
      }
      // 목록은 범주(status)로, 보드 컬럼은 프로젝트 상태 id(statusId — 시드 할 일 = 1)로 좁혀 온다(WP-808).
      const params = new URL(route.request().url()).searchParams;
      const statusId = params.get('statusId');
      const todo = statusId != null ? statusId === '1' : (params.get('status') ?? 'TODO').includes('TODO');
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createIssueSearchResponse(todo ? [createIssue({ number: 7, title: '살아 있는 이슈', status: 'TODO' })] : [], null),
        ),
      });
    },
  );
}

test.describe('이슈 불러오기 실패 상태 (WP-858)', () => {
  test('목록: 검색이 500 이면 빈 상태가 아니라 실패 안내, 다시 시도하면 이슈가 보인다', async ({ authenticatedPage: page }) => {
    let failing = true;
    await mockSearch(page, () => failing);

    await page.goto(`/projects/${KEY}`);

    // 5xx 는 전역 정책상 1회 재시도한 뒤 실패로 확정된다.
    await expect(page.getByTestId('issue-load-error')).toBeVisible();
    await expect(page.getByTestId('issue-load-error')).toContainText('이슈를 불러오지 못했습니다');
    await expect(page.getByTestId('empty-no-issues')).toHaveCount(0);
    await expect(page.getByTestId('empty-filter')).toHaveCount(0);

    failing = false;
    await page.getByTestId('issue-load-retry').click();
    await expect(page.getByTestId('issue-row-7')).toContainText('살아 있는 이슈');
    await expect(page.getByTestId('issue-load-error')).toHaveCount(0);
  });

  test('목록: 다시 보내도 같은 실패(400)면 다시 시도 대신 필터 초기화 — 누르면 필터 없이 다시 불러온다', async ({ authenticatedPage: page }) => {
    // 서버가 주소의 조건(q)을 받지 못하면 400, 조건이 없으면 이슈 1건.
    await mockSearch(page, () => false);
    await page.route(
      (url) => url.pathname === ISSUES_PATH && url.searchParams.has('q'),
      (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: '잘못된 조건' }) }),
    );

    await page.goto(`/projects/${KEY}?q=broken`);

    await expect(page.getByTestId('issue-load-error')).toContainText('필터를 초기화해 보세요');
    await expect(page.getByTestId('issue-load-retry')).toHaveCount(0);
    await page.getByTestId('issue-load-reset-filter').click();

    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}$`));
    await expect(page.getByTestId('issue-row-7')).toBeVisible();
  });

  test('보드: 컬럼 검색이 500 이면 보드 전체에 실패 안내, 다시 시도하면 카드가 보인다', async ({ authenticatedPage: page }) => {
    let failing = true;
    await mockSearch(page, () => failing);

    await page.goto(`/projects/${KEY}?view=board`);

    await expect(page.getByTestId('issue-load-error')).toBeVisible();
    await expect(page.getByTestId('board-col-1')).toHaveCount(0);

    failing = false;
    await page.getByTestId('issue-load-retry').click();
    await expect(page.getByTestId('board-col-1')).toContainText('살아 있는 이슈');
    await expect(page.getByTestId('issue-load-error')).toHaveCount(0);
  });

  test('사이클 그룹: 사이클 목록이 500 이면 실패 안내, 다시 시도하면 구간이 보인다', async ({ authenticatedPage: page }) => {
    await mockSearch(page, () => false);
    let failing = true;
    await page.route(`**/api/v1/projects/${KEY}/cycles`, (route) =>
      failing
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: '서버 오류' }) })
        : route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await mockApi(page, 'GET', `/api/v1/projects/${KEY}/cycles/progress`, []);

    await page.goto(`/projects/${KEY}?group=cycle`);

    await expect(page.getByTestId('issue-load-error')).toBeVisible();
    await expect(page.getByTestId('issue-cycle-grouped-list')).toHaveCount(0);

    failing = false;
    await page.getByTestId('issue-load-retry').click();
    await expect(page.getByTestId('issue-cycle-grouped-list')).toBeVisible();
    await expect(page.getByTestId('issue-load-error')).toHaveCount(0);
  });

  test('정수가 아닌 라벨 id(label=1.5)는 서버로 보내지 않고 이슈를 그대로 보인다', async ({ authenticatedPage: page }) => {
    await mockSearch(page, () => false);
    const searches = trackRequests(page, 'GET', ISSUES_PATH);

    await page.goto(`/projects/${KEY}?label=1.5`);

    await expect(page.getByTestId('issue-row-7')).toBeVisible();
    expect(searches.lastUrl()!.searchParams.has('label')).toBe(false);
  });
});

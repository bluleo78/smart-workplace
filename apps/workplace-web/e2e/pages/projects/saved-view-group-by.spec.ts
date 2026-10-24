// Saved View group-by E2E (#58) — group 셀렉터 → URL group= → 보드/리스트 그룹 렌더(셀 단위)
// → 저장 뷰에 group 영속. 백엔드 없이 page.route() 로 모킹.

import type { Page, Route } from '@playwright/test';

import { mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';
import {
  createIssue,
  createIssueSearchResponse,
} from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';

const KEY = 'WP';
const ISSUES_PATH = `/api/v1/projects/${KEY}/issues`;

async function stubProjectMeta(page: Page) {
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}`, createProject());
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/members`, []);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/saved-views`, []);
}

function routeIssueSearch(
  page: Page,
  handler: (route: Route, url: URL) => Promise<void> | void,
) {
  return page.route(
    (url) => url.pathname === ISSUES_PATH,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return handler(route, new URL(route.request().url()));
    },
  );
}

function fulfillIssues(route: Route, issues: ReturnType<typeof createIssue>[]) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(createIssueSearchResponse(issues)),
  });
}

test.describe('Saved View group-by', () => {
  test('우선순위 그룹 리스트 — 그룹 섹션별 행 배치 + 빈 그룹 숨김', async ({
    authenticatedPage: page,
  }) => {
    await stubProjectMeta(page);
    const issues = [
      createIssue({ id: 1, number: 1, title: 'High one', priority: 'HIGH' }),
      createIssue({ id: 2, number: 2, title: 'Low one', priority: 'LOW' }),
    ];
    await routeIssueSearch(page, (route) => fulfillIssues(route, issues));

    await page.goto(`/projects/${KEY}?group=priority`);

    // HIGH 섹션에 행 1, LOW 섹션에 행 2
    await expect(
      page.getByTestId('list-group-HIGH').getByTestId('issue-row-1'),
    ).toBeVisible();
    await expect(
      page.getByTestId('list-group-LOW').getByTestId('issue-row-2'),
    ).toBeVisible();
    // 헤더 라벨 노출
    await expect(page.getByTestId('list-group-HIGH')).toContainText('높음');
    // MID 그룹은 이슈가 없으므로 숨김
    await expect(page.getByTestId('list-group-MID')).toHaveCount(0);
  });

  test('그룹 헤더 수는 불러온 행 수가 아니라 서버 그룹 총계 — 같은 필터로 요청 (WP-472)', async ({
    authenticatedPage: page,
  }) => {
    await stubProjectMeta(page);
    // 첫 페이지에는 TODO 2건만 왔지만(뒤에 더 있음) 서버 총계는 TODO 32 · DONE 3.
    const issues = [
      createIssue({ id: 1, number: 1, title: 'Todo one', status: 'TODO' }),
      createIssue({ id: 2, number: 2, title: 'Todo two', status: 'TODO' }),
    ];
    await routeIssueSearch(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...createIssueSearchResponse(issues), hasMore: true, nextCursor: 'c1' }),
      }),
    );
    let countsUrl: URL | undefined;
    await page.route(
      (url) => url.pathname === `${ISSUES_PATH}/group-counts`,
      (route) => {
        countsUrl = new URL(route.request().url());
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          // 상태 그룹 총계는 프로젝트 상태(statusId)별 — 시드 「할 일」 id 1, 「완료」 id 3 (WP-808).
          body: JSON.stringify({ groupBy: 'statusId', groups: [{ key: '1', count: 32 }, { key: '3', count: 3 }] }),
        });
      },
    );

    await page.goto(`/projects/${KEY}?group=status&q=todo`);

    await expect(page.getByTestId('list-group-count-1')).toHaveText('32');
    // 목록과 같은 필터(검색어·기본 범위)로 센다.
    expect(countsUrl?.searchParams.get('groupBy')).toBe('statusId');
    expect(countsUrl?.searchParams.get('q')).toBe('todo');
    expect(countsUrl?.searchParams.get('excludeSubtasks')).toBe('true');
    expect(countsUrl?.searchParams.has('cursor')).toBe(false);
  });

  test('그룹 셀렉터 클릭 → URL group 파라미터 동기화', async ({
    authenticatedPage: page,
  }) => {
    await stubProjectMeta(page);
    await routeIssueSearch(page, (route) => fulfillIssues(route, []));

    await page.goto(`/projects/${KEY}?view=board`);
    // 그룹 셀렉트(드롭다운) 트리거를 열고 항목 선택.
    await page.getByTestId('group-by-trigger').click();
    await page.getByTestId('group-by-assignee').click();
    await expect(page).toHaveURL(/group=assignee/);
    // view 는 유지
    await expect(page).toHaveURL(/view=board/);

    // 없음으로 되돌리면 group=none 명시 — 키를 지우면 사이클이 있는 프로젝트는 기본 사이클 그룹으로 돌아가므로(#878)
    // 앞 선택의 목록이 닫히고 값이 그려진 뒤에 다시 연다 — 닫히는 중에 열면 「없음」 클릭이 먹지 않아
    // 부하가 걸린 게이트에서 가끔 실패했다(CPU 8배 감속으로 6/6 재현, 대기 추가 후 통과 — WP-929 에서 확인).
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(page.getByTestId('group-by-trigger')).toContainText('담당자');
    await page.getByTestId('group-by-trigger').click();
    await expect(page.getByTestId('group-by-none')).toBeVisible();
    await page.getByTestId('group-by-none').click();
    await expect(page).toHaveURL(/group=none/);
    await expect(page).not.toHaveURL(/group=assignee/);
  });

  test('group 설정 상태에서 뷰 저장 → POST query 에 group 영속', { tag: '@smoke' }, async ({
    authenticatedPage: page,
  }) => {
    await stubProjectMeta(page);
    await routeIssueSearch(page, (route) => fulfillIssues(route, []));

    const viewPosts = trackRequests(page, 'POST', `/api/v1/projects/${KEY}/saved-views`);
    await page.route(`**/api/v1/projects/${KEY}/saved-views`, (route) => {
      const m = route.request().method();
      if (m === 'GET')
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      if (m === 'POST') {
        const body = route.request().postDataJSON() as { query: string; name: string };
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 1,
            name: body.name,
            query: body.query,
            visibility: 'PRIVATE',
            ownerId: 1,
            mine: true,
            pinned: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
        });
      }
      return route.fallback();
    });

    await page.goto(`/projects/${KEY}?group=assignee`);
    await page.getByTestId('save-view-button').click();
    await page.getByTestId('save-view-name').fill('담당자 그룹');
    await page.getByTestId('save-view-submit').click();

    await expect.poll(() => viewPosts.lastBody<{ query: string }>()?.query).toContain('group=assignee');
  });
});

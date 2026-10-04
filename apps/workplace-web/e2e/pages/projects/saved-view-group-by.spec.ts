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

function user(id: number, name: string) {
  return { id, username: `u${id}`, name, kind: 'HUMAN' as const };
}

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
  test(
    '담당자 그룹 보드 — 담당자별 컬럼 + 미지정 컬럼에 카드 배치',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      await stubProjectMeta(page);
      const issues = [
        createIssue({ id: 1, number: 1, title: 'A', assignees: [user(10, '가람')] }),
        createIssue({ id: 2, number: 2, title: 'B', assignees: [] }),
      ];
      await routeIssueSearch(page, (route) => fulfillIssues(route, issues));

      await page.goto(`/projects/${KEY}?view=board&group=assignee`);

      // 담당자 컬럼에 카드 1, 미지정 컬럼에 카드 2 (셀 단위 검증)
      await expect(
        page.getByTestId('board-col-u-10').getByTestId('issue-card-1'),
      ).toBeVisible();
      await expect(
        page.getByTestId('board-col-unassigned').getByTestId('issue-card-2'),
      ).toBeVisible();
      // 카드 1 은 미지정 컬럼에 없어야 한다
      await expect(
        page.getByTestId('board-col-unassigned').getByTestId('issue-card-1'),
      ).toHaveCount(0);
    },
  );

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
    await page.getByTestId('group-by-trigger').click();
    await page.getByTestId('group-by-none').click();
    await expect(page).toHaveURL(/group=none/);
    await expect(page).not.toHaveURL(/group=assignee/);
  });

  test('group 설정 상태에서 뷰 저장 → POST query 에 group 영속', async ({
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

  // #773 — 필터 없이 그룹만 바꾸면 "전체" 칩 활성 표시가 사라지던 회귀 방지.
  test('필터 없이 그룹만 변경해도 "전체" 칩이 계속 활성 상태를 유지한다 (#773)', async ({
    authenticatedPage: page,
  }) => {
    await stubProjectMeta(page);
    await routeIssueSearch(page, (route) => fulfillIssues(route, []));

    await page.goto(`/projects/${KEY}`);
    await expect(page.getByTestId('view-chip-all')).toHaveClass(/border-foreground/)

    await page.getByTestId('group-by-trigger').click();
    await page.getByTestId('group-by-status').click();
    await expect(page).toHaveURL(/group=status/);

    // 필터는 여전히 없으므로 "전체"는 그룹 변경과 무관하게 활성 상태를 유지해야 한다.
    await expect(page.getByTestId('view-chip-all')).toHaveClass(/border-foreground/)
  });
});

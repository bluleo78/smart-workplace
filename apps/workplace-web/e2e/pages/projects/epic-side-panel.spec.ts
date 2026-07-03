// 왼쪽 에픽 패널 E2E — 목록/진행률 노출, 단일 선택 필터(재클릭 해제), 접기 상태 영속, EPIC 미보유 프로젝트 미노출.
import type { Route } from '@playwright/test';

import { mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType, systemTypes } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';
import type { IssueResponse } from '../../../src/types/issue';

const PROJECT_KEY = 'WP';
const ISSUES_PATH = `/api/v1/projects/${PROJECT_KEY}/issues`;

async function stubProjectMeta(page: import('@playwright/test').Page) {
  await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}`, createProject({ key: PROJECT_KEY, type: 'TEAM' }));
  await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/members`, []);
}

function epic(number: number, title: string, done: number, total: number): IssueResponse {
  return createIssue({
    id: number,
    number,
    title,
    type: makeEpicType(),
    childCount: total,
    childDoneCount: done,
  });
}

// 이슈 검색 라우트: query 의 type/parent 로 "에픽 목록 조회"와 "본문 이슈 목록 조회"를 구분한다.
function routeIssueSearch(
  page: import('@playwright/test').Page,
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

test.describe('에픽 왼쪽 패널', () => {
  test(
    '에픽 목록 + 진행률 노출, 클릭 시 이슈 검색에 parent 쿼리 적용, 재클릭 시 해제',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      await stubProjectMeta(page);
      await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/types`, systemTypes());

      const epics = [epic(10, '결제 리뉴얼', 6, 10), epic(11, '알림 개편', 8, 10)];
      let lastBodyIssuesUrl: URL | null = null;

      await routeIssueSearch(page, async (route, url) => {
        if (url.searchParams.get('type') === String(makeEpicType().id)) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(createIssueSearchResponse(epics)),
          });
          return;
        }
        lastBodyIssuesUrl = url;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssueSearchResponse([])),
        });
      });

      await page.goto(`/projects/${PROJECT_KEY}`);

      const panel = page.getByTestId('epic-side-panel');
      await expect(panel).toBeVisible();
      await expect(page.getByTestId('epic-filter-10')).toContainText('결제 리뉴얼');
      await expect(page.getByTestId('epic-filter-10')).toContainText('6/10');
      await expect(page.getByTestId('epic-filter-11')).toContainText('8/10');

      // 클릭 → parent=10 쿼리로 본문 이슈 검색.
      await page.getByTestId('epic-filter-10').click();
      await expect.poll(() => lastBodyIssuesUrl?.searchParams.get('parent')).toBe('10');
      await expect(page.getByTestId('epic-filter-10')).toHaveAttribute('aria-pressed', 'true');

      // 재클릭 → 해제.
      await page.getByTestId('epic-filter-10').click();
      await expect.poll(() => lastBodyIssuesUrl?.searchParams.get('parent')).toBeNull();
      await expect(page.getByTestId('epic-filter-10')).toHaveAttribute('aria-pressed', 'false');
    },
  );

  test('접기 상태는 새로고침 후에도 유지된다', async ({ authenticatedPage: page }) => {
    await stubProjectMeta(page);
    await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/types`, systemTypes());
    await routeIssueSearch(page, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([epic(10, '결제 리뉴얼', 6, 10)])),
      });
    });

    await page.goto(`/projects/${PROJECT_KEY}`);
    await expect(page.getByTestId('epic-side-panel')).toBeVisible();

    await page.getByTestId('epic-panel-collapse-toggle').click();
    await expect(page.getByTestId('epic-side-panel')).toBeHidden();

    await page.reload();
    await expect(page.getByTestId('epic-side-panel')).toBeHidden();
  });

  test('EPIC 유형이 없는 프로젝트에는 패널이 노출되지 않는다', async ({ authenticatedPage: page }) => {
    await stubProjectMeta(page);
    // EPIC 제외 시스템 유형만 응답.
    await mockApi(
      page,
      'GET',
      `/api/v1/projects/${PROJECT_KEY}/types`,
      systemTypes().filter((t) => t.name !== 'EPIC'),
    );
    await routeIssueSearch(page, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([])),
      });
    });

    await page.goto(`/projects/${PROJECT_KEY}`);
    await expect(page.getByTestId('epic-side-panel')).not.toBeAttached();
  });
});

// 이슈 목록 그룹 기준 「에픽」 + 그룹 헤더 접기 E2E (WP-194) — 백엔드 없이 page.route() 로 모킹.

import type { Page } from '@playwright/test';

import { mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType, makeSubtaskType } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';

const KEY = 'WP';
const ISSUES_PATH = `/api/v1/projects/${KEY}/issues`;

const epic = (number: number, title: string) => ({ number, title, type: makeEpicType() });
// 에픽이 아닌 부모(STORY) — 「에픽 없음」 으로 가야 한다.
const storyParent = { number: 7, title: '스토리', type: { id: 2, name: 'STORY', colorToken: 'BLUE', icon: 'Flag' as const } };

async function stubAll(page: Page) {
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}`, createProject());
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/members`, []);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/saved-views`, []);
  const issues = [
    createIssue({ id: 1, number: 1, title: '결제 A', parent: epic(30, '결제 안정화') }),
    createIssue({ id: 2, number: 2, title: '결제 B', parent: epic(30, '결제 안정화') }),
    createIssue({ id: 3, number: 3, title: '모바일 A', parent: epic(12, '모바일 UX') }),
    createIssue({ id: 4, number: 4, title: '부모 없음' }),
    createIssue({ id: 5, number: 5, title: '스토리 자식', type: makeSubtaskType(), parent: storyParent }),
  ];
  await page.route(
    (url) => url.pathname === ISSUES_PATH,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(issues)),
      });
    },
  );
}

const groupIds = (page: Page) =>
  page.locator('[data-testid^="list-group-"]:not([data-testid^="list-group-toggle-"])').evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-testid')),
  );

test.describe('이슈 목록 에픽 그룹', () => {
  test('그룹 셀렉트에서 에픽 선택 → 에픽 번호순 + 에픽 없음 마지막, 헤더 개수', async ({ authenticatedPage: page }) => {
    await stubAll(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await page.getByTestId('group-by-trigger').click();
    await page.getByTestId('group-by-epic').click();

    await expect(page).toHaveURL(/group=epic/);
    await expect(page.getByTestId('list-group-epic-12')).toBeVisible();
    expect(await groupIds(page)).toEqual(['list-group-epic-12', 'list-group-epic-30', 'list-group-no-epic']);
    await expect(page.getByTestId('list-group-toggle-epic-30')).toContainText('결제 안정화');
    await expect(page.getByTestId('list-group-toggle-epic-30')).toContainText('2');
    // STORY 부모 자식은 「에픽 없음」 에 부모 없는 이슈와 함께 있다.
    await expect(page.getByTestId('list-group-no-epic').getByTestId('issue-row-5')).toBeVisible();
    await expect(page.getByTestId('list-group-no-epic').getByTestId('issue-row-4')).toBeVisible();
  });

  test('그룹 헤더 클릭으로 접기/펼치기', async ({ authenticatedPage: page }) => {
    await stubAll(page);
    await page.goto(`/projects/${KEY}?group=epic`);
    const toggle = page.getByTestId('list-group-toggle-epic-30');
    await expect(page.getByTestId('issue-row-1')).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await toggle.click();
    await expect(page.getByTestId('issue-row-1')).toHaveCount(0);
    await expect(page.getByTestId('issue-row-2')).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // 다른 그룹은 그대로
    await expect(page.getByTestId('issue-row-3')).toBeVisible();

    await toggle.click();
    await expect(page.getByTestId('issue-row-1')).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  test('?group=epic 직접 진입(저장 뷰 복원 경로) 시 섹션 렌더', async ({ authenticatedPage: page }) => {
    await stubAll(page);
    await page.goto(`/projects/${KEY}?group=epic`);
    await expect(page.getByTestId('list-group-epic-30').getByTestId('issue-row-1')).toBeVisible();
    await expect(page.getByTestId('list-group-epic-12').getByTestId('issue-row-3')).toBeVisible();
  });
});

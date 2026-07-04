// 타임라인 에픽 계층 트리 E2E (#649) — 에픽 그룹 행/하위 트리/에픽 없음 그룹/접기-펼치기/
// 일정 미정 섹션 에픽 배지/그룹 행 클릭 이동을 검증한다.
import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType, makeSubtaskType } from '../../factories/issueType.factory';
import { createMember, createProject } from '../../factories/project.factory';

const KEY = 'WP';
const EPIC_TYPE = makeEpicType();
const SUBTASK_TYPE = makeSubtaskType();

function setupStubs(page: Page) {
  return Promise.all([
    page.route(`**/api/v1/projects/${KEY}/members`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const members = [createMember({ userId: 2, name: '김개발', username: 'kim@example.com' })];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(members) });
    }),
    page.route(`**/api/v1/projects/${KEY}/labels`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }),
    page.route(`**/api/v1/projects/${KEY}`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createProject({ key: KEY })),
      });
    }),
    page.route(`**/api/v1/projects/${KEY}/issues?*`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      // 에픽 40(온보딩 개편, 하위 2/2 중 1 DONE) + 하위 2건(41 일정 있음, 42 미정) +
      // 에픽 없는 이슈 1건(18) + SUBTASK 1건(50, 그룹/미정 어디에도 나타나면 안 됨).
      const issues = [
        createIssue({
          number: 40,
          title: '온보딩 개편',
          type: EPIC_TYPE,
          childCount: 2,
          childDoneCount: 1,
        }),
        createIssue({
          number: 41,
          title: '가입 플로우',
          parent: { number: 40, title: '온보딩 개편', type: EPIC_TYPE },
          startDate: '2026-07-01',
          dueDate: '2026-07-05',
          status: 'DONE',
        }),
        createIssue({
          number: 42,
          title: '온보딩 미정 하위',
          parent: { number: 40, title: '온보딩 개편', type: EPIC_TYPE },
        }),
        createIssue({ number: 18, title: '에픽 없는 이슈', dueDate: '2026-07-08' }),
        createIssue({
          number: 50,
          title: '하위 태스크 이슈',
          type: SUBTASK_TYPE,
          parent: { number: 41, title: '가입 플로우', type: { ...EPIC_TYPE, name: 'TASK' } },
          dueDate: '2026-07-05',
        }),
      ];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(issues)),
      });
    }),
    page.route(`**/api/v1/projects/${KEY}/cycles`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }),
    page.route(`**/api/v1/projects/${KEY}/milestones`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }),
    page.route(`**/api/v1/projects/${KEY}/issue-dependencies`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }),
  ]);
}

test('에픽 그룹 행 + 하위 트리 + 에픽 없음 그룹이 렌더된다', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  await page.goto(`/projects/${KEY}/timeline`);
  const grid = page.locator('.timeline-gantt-root .wx-grid');
  await expect(grid).toContainText('온보딩 개편'); // 에픽 그룹 행
  await expect(grid).toContainText('(1/2)'); // 진행률
  await expect(grid).toContainText('가입 플로우'); // 하위 이슈 행
  await expect(grid).toContainText('에픽 없음'); // 가상 그룹 행
  // summary 롤업 막대 렌더 — 에픽(epic-40) 1개만 보인다. no-epic 가상 그룹의 summary 는
  // DOM 에는 존재하지만 CSS 로 숨겨진다(range 없음 — 라벨 행만, timeline-gantt.css 참조).
  await expect(page.locator('.timeline-gantt-root .wx-bar.wx-summary:visible')).toHaveCount(1);
  // SUBTASK 는 어디에도 없다
  await expect(grid).not.toContainText('하위 태스크 이슈');
});

test('에픽 접기 → 하위 행 숨김 + localStorage 저장, 재방문 시 복원', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  await page.goto(`/projects/${KEY}/timeline`);
  await page
    .locator('.timeline-gantt-root .wx-grid .wx-row', { hasText: '온보딩 개편' })
    .locator('.wx-toggle-icon, [class*="toggle"]')
    .first()
    .click();
  await expect(page.locator('.timeline-gantt-root .wx-grid')).not.toContainText('가입 플로우');
  const stored = await page.evaluate((k) => localStorage.getItem(k), `timeline-collapsed:${KEY}`);
  expect(JSON.parse(stored ?? '[]')).toContain('epic-40');
  await page.reload();
  await expect(page.locator('.timeline-gantt-root .wx-grid')).toBeVisible();
  await expect(page.locator('.timeline-gantt-root .wx-grid')).not.toContainText('가입 플로우');
});

test('일정 미정 섹션에 소속 에픽 배지가 붙는다', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  await page.goto(`/projects/${KEY}/timeline`);
  await page.getByTestId('unscheduled-section').locator('summary').click();
  await expect(page.getByTestId('unscheduled-row-42')).toContainText('온보딩 개편');
});

test('에픽 그룹 행 클릭 → 에픽 이슈 상세로 이동', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  await page.goto(`/projects/${KEY}/timeline`);
  await page.locator('.timeline-gantt-root .wx-grid .wx-row', { hasText: '온보딩 개편' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${KEY}/issues/40`));
});


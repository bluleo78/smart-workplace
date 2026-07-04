// 타임라인 타이포/행 밀도 E2E (#646) — 행 40px, 월 14px/주 12px 위계.
import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';

const KEY = 'WP';

function setupStubs(page: Page) {
  return Promise.all([
    page.route(`**/api/v1/projects/${KEY}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject({ key: KEY })) }),
    ),
    page.route(`**/api/v1/projects/${KEY}/members`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    ),
    page.route(`**/api/v1/projects/${KEY}/labels`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    ),
    page.route(`**/api/v1/projects/${KEY}/cycles`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    ),
    page.route(`**/api/v1/projects/${KEY}/milestones`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    ),
    page.route(`**/api/v1/projects/${KEY}/issue-dependencies`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    ),
    page.route(`**/api/v1/projects/${KEY}/issues?*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createIssueSearchResponse([
            createIssue({
              number: 1,
              title: '아주 길어서 예전 행 높이에서는 잘리던 이슈 제목 예시입니다',
              startDate: '2026-07-01',
              dueDate: '2026-07-10',
            }),
          ]),
        ),
      }),
    ),
  ]);
}

test('간트 행 높이가 40px 로 렌더된다', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  await page.goto(`/projects/${KEY}/timeline`);
  await expect(page.getByTestId('timeline-gantt')).toBeVisible();
  // SVAR 차트 영역의 이슈 막대 행 — cellHeight prop 이 적용되면 40px.
  const bar = page.locator('.timeline-gantt-root .wx-bar').first();
  await expect(bar).toBeVisible();
  const rowHeight = await page
    .locator('.timeline-gantt-root .wx-area .wx-row, .timeline-gantt-root .wx-grid .wx-row')
    .first()
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(Math.round(rowHeight)).toBe(40);
});

test('시간축 텍스트 위계 — 상단 스케일 14px semibold, 하단 12px', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  await page.goto(`/projects/${KEY}/timeline`);
  await expect(page.getByTestId('timeline-gantt')).toBeVisible();
  const scaleRows = page.locator('.timeline-gantt-root .wx-scale .wx-row');
  const top = await scaleRows.nth(0).locator('.wx-cell').first().evaluate((el) => {
    const s = getComputedStyle(el);
    return { size: s.fontSize, weight: s.fontWeight };
  });
  const bottom = await scaleRows.nth(1).locator('.wx-cell').first().evaluate((el) => getComputedStyle(el).fontSize);
  expect(top.size).toBe('14px');
  expect(Number(top.weight)).toBeGreaterThanOrEqual(600);
  expect(bottom).toBe('12px');
});

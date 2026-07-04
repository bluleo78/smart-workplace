// 타임라인 아바타 스택 필터 E2E (#647) — 아바타 클릭=담당자 토글, URL 파라미터 반영, +N 팝오버.
import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { createMember, createProject } from '../../factories/project.factory';

const KEY = 'WP';

function setupStubs(page: Page) {
  return Promise.all([
    page.route(`**/api/v1/projects/${KEY}`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject({ key: KEY })) });
    }),
    page.route(`**/api/v1/projects/${KEY}/members`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const members = [
        createMember({ userId: 2, name: '김개발', username: 'kim@example.com' }),
        createMember({ userId: 3, name: '이테스트', username: 'lee@example.com', role: 'MEMBER' }),
        createMember({ userId: 4, name: '박세번', username: 'park@example.com', role: 'MEMBER' }),
        createMember({ userId: 5, name: '최네번', username: 'choi@example.com', role: 'MEMBER' }),
        createMember({ userId: 6, name: '정다섯', username: 'jung@example.com', role: 'MEMBER' }),
        createMember({ userId: 7, name: '한여섯', username: 'han@example.com', role: 'MEMBER' }),
      ];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(members) });
    }),
    page.route(`**/api/v1/projects/${KEY}/labels`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
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
    page.route(`**/api/v1/projects/${KEY}/issues?*`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createIssueSearchResponse([
            createIssue({ number: 1, title: '아바타 필터 대상 이슈', startDate: '2026-07-01', dueDate: '2026-07-10' }),
          ]),
        ),
      });
    }),
  ]);
}

test('아바타 스택 — 최대 5명 + 초과 인원 +N 버튼', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  await page.goto(`/projects/${KEY}/timeline`);
  await expect(page.getByTestId('assignee-avatar-stack')).toBeVisible();
  // overflow 버튼도 'assignee-avatar-' 로 시작하므로 별도 testid(assignee-avatar-overflow)를 제외한다.
  await expect(
    page
      .getByTestId('assignee-avatar-stack')
      .locator('[data-testid^="assignee-avatar-"]:not([data-testid="assignee-avatar-overflow"])'),
  ).toHaveCount(5);
  await expect(page.getByTestId('assignee-avatar-overflow')).toHaveText('+1');
});

test('아바타 클릭 → assignee 필터 토글, URL·이슈 검색 쿼리 반영', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  const issueRequests: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes(`/projects/${KEY}/issues?`)) issueRequests.push(req.url());
  });
  await page.goto(`/projects/${KEY}/timeline`);
  await page.getByTestId('assignee-avatar-2').click();
  // URL SearchParams 단일 소스 — parseFilters 가 읽는 assignee 파라미터로 직렬화된다.
  await expect(page).toHaveURL(/assignee/);
  await expect.poll(() => issueRequests.some((u) => /assignee[^&]*=2/.test(decodeURIComponent(u)))).toBe(true);
  await expect(page.getByTestId('assignee-avatar-2')).toHaveAttribute('aria-pressed', 'true');
  // 재클릭 = 해제
  await page.getByTestId('assignee-avatar-2').click();
  await expect(page.getByTestId('assignee-avatar-2')).toHaveAttribute('aria-pressed', 'false');
});

test('+N 팝오버에서 나머지 멤버 토글 가능', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  await page.goto(`/projects/${KEY}/timeline`);
  await page.getByTestId('assignee-avatar-overflow').click();
  await page.getByRole('button', { name: '한여섯' }).click();
  await expect(page).toHaveURL(/assignee/);
});

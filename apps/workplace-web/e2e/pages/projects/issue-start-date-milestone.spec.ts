// 새 이슈 다이얼로그 날짜 칸 폭 E2E(WP-463) — 날짜 전체가 보일 만큼 칸이 넓은지 실제 배치로 잰다(@layout).
// 상세 시작일·마일스톤 피커 PATCH 와 새 이슈 시작일 payload·검증(시작 > 마감, 5자리 연도)은
// src/pages/projects/issueDetailFields.test.tsx · issueCreateDialogDates.test.tsx 페이지 테스트가 지킨다(WP-971).

import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth.fixture';
import { mockApi } from '../../fixtures/api-mock';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { systemTypes } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';

const PROJECT_KEY = 'WP';

test.describe('IssueCreateDialog 시작일 입력 (#620)', () => {
  async function stubProject(page: Page) {
    await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}`, createProject());
    await mockApi(
      page,
      'GET',
      `/api/v1/projects/${PROJECT_KEY}/issues`,
      createIssueSearchResponse([createIssue({ title: '기존 이슈' })]),
    );
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/types`,
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(systemTypes()) }),
    );
    await page.route(`**/api/v1/projects/${PROJECT_KEY}/**`, (route) => {
      if (route.request().method() === 'GET' && !route.request().url().includes('/issues')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      return route.fallback();
    });
  }

  // WP-463: 4칸 한 줄이면 날짜 칸이 약 106px 라 연도가 잘렸다 — 2×2 로 두어 날짜 칸이 날짜 전체를 담을 폭을 갖는다.
  test('새 이슈 다이얼로그의 시작일·마감일 칸은 날짜 전체가 보일 만큼 넓다(WP-463)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await stubProject(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/projects/${PROJECT_KEY}`);
    await page.getByRole('button', { name: '+ 새 태스크' }).click();
    await expect(page.getByRole('dialog', { name: '새 이슈' })).toBeVisible();

    for (const id of ['#issue-start', '#issue-due']) {
      const input = page.locator(id);
      await input.fill('2026-10-01');
      const box = await input.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(160);
    }
  });
});

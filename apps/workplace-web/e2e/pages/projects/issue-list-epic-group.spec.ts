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

test.describe('이슈 목록 데스크톱 에픽 칩', () => {
  test('긴 제목·긴 에픽명에도 가로 오버플로 없이 칩이 보이고 제목이 최소 폭을 지킨다', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', `/api/v1/projects/${KEY}`, createProject());
    await mockApi(page, 'GET', `/api/v1/projects/${KEY}/members`, []);
    await mockApi(page, 'GET', `/api/v1/projects/${KEY}/saved-views`, []);
    const issue = createIssue({
      id: 21,
      number: 21,
      title: '결제 모듈에서 환불 처리 시 간헐적으로 실패하는 문제의 원인을 분석하고 재시도 로직을 보강한다 — 운영 로그 기준 재현',
      parent: epic(30, '결제 안정화 및 운영 모니터링 체계 정비 (2026 하반기 핵심 과제) — 매우 긴 에픽 이름'),
      childCount: 3,
      childDoneCount: 1,
    });
    await page.route(
      (url) => url.pathname === ISSUES_PATH,
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssueSearchResponse([issue])),
        });
      },
    );
    for (const width of [1280, 1024]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/projects/${KEY}?group=none`);
      const row = page.getByTestId('issue-row-21');
      const chip = row.getByTestId('issue-row-21-parent');
      await expect(chip).toBeVisible();
      // (a) 가로 스크롤 없음 — 긴 제목이 표를 밀어내지 않는다.
      const scroll = page.getByTestId('issue-list-scroll');
      const { sw, cw } = await scroll.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      expect(sw, `${width}px 목록 가로 오버플로`).toBeLessThanOrEqual(cw);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      // (b) 제목은 최소 8rem 보장
      const link = row.getByRole('link', { name: /결제 모듈/ });
      expect((await link.boundingBox())!.width).toBeGreaterThanOrEqual(128);
      // (c) 칩이 스크롤 영역 오른쪽 끝 안에 있다.
      const sb = (await scroll.boundingBox())!;
      const cb = (await chip.boundingBox())!;
      expect(cb.x + cb.width).toBeLessThanOrEqual(sb.x + sb.width + 1);
    }
  });
});

test.describe('이슈 목록 데스크톱 hideEpic', () => {
  test('특정 에픽 필터 / 에픽 그룹 안에선 에픽 칩을 숨기고, 비에픽(STORY) 부모 칩은 유지한다', async ({ authenticatedPage: page }) => {
    await stubAll(page);
    // 양성 대조 — 그룹 없음에선 에픽 행에 칩이 보인다.
    await page.goto(`/projects/${KEY}?group=none`);
    await expect(page.getByTestId('issue-row-1-parent')).toBeVisible();
    await expect(page.getByTestId('issue-row-5-parent')).toBeVisible();

    await page.goto(`/projects/${KEY}?group=epic`);
    await expect(page.getByTestId('issue-row-1')).toBeVisible();
    await expect(page.getByTestId('issue-row-1-parent')).toHaveCount(0);
    // STORY 부모는 에픽이 아니므로 「에픽 없음」 그룹에서도 칩 유지.
    await expect(page.getByTestId('issue-row-5-parent')).toBeVisible();

    await page.goto(`/projects/${KEY}?group=none&parent=30`);
    await expect(page.getByTestId('issue-row-1')).toBeVisible();
    await expect(page.getByTestId('issue-row-1-parent')).toHaveCount(0);
  });
});

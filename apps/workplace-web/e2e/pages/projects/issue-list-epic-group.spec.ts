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
  test('긴 제목 + 긴 에픽명이어도 칩은 줄어들 수 있고 제목은 최소 폭(8rem)을 지킨다', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
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
    await page.goto(`/projects/${KEY}?group=none`);
    const row = page.getByTestId('issue-row-21');
    await expect(row.getByTestId('issue-row-21-parent')).toBeVisible();
    const link = row.getByRole('link', { name: /결제 모듈/ });
    expect((await link.boundingBox())!.width).toBeGreaterThanOrEqual(128);
    // 자동 레이아웃 표에선 nowrap 텍스트의 최소 폭이 전체 글자 폭이라 실제 폭만으론 shrink 여부를 가를 수 없다 —
    // 칩이 줄어들 수 있고(flex-shrink 1, min-width 0) 제목은 8rem 을 보장하는지 계산된 스타일로 직접 단언한다.
    // (shrink-0 / min-w-0 로 되돌리면 실패)
    const chipStyle = await row.getByTestId('issue-row-21-parent').evaluate((el) => {
      const cs = getComputedStyle(el);
      return { shrink: cs.flexShrink, minWidth: cs.minWidth };
    });
    expect(chipStyle).toEqual({ shrink: '1', minWidth: '0px' });
    expect(await link.evaluate((el) => getComputedStyle(el).minWidth)).toBe('128px');
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

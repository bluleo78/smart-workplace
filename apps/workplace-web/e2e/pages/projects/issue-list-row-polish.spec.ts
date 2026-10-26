// 프로젝트 목록 소정리 E2E (WP-919) — 데스크톱 행·헤더 모양을 다른 이슈 목록과 맞춘 것을 고정한다.
// - ID 헤더 글자가 키 글자(유형 아이콘 뒤) 시작과 같은 x 에 온다 — 평면 목록·사이클 구간 목록 각각.
// - 1024px(데스크톱 하한)에서 우선순위·마감 칸이 보인다 — 죽은 640px(sm) 규칙을 지운 뒤에도 같다.
// 실제 글자 위치·폭이 필요한 것만 남긴다(@layout). 다중 선택 배경(bg-primary/10)과 빈 값 —·마감 날짜 표기는
// 페이지 테스트 src/pages/projects/issueListRowPolish.test.tsx 가 지킨다(WP-971).
import type { Locator, Page } from '@playwright/test';

import type { CycleProgress, CycleResponse } from '../../../src/types/cycle';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import { expect, test } from '../../fixtures/auth.fixture';

const KEY = 'WP';
const ISSUES_PATH = `/api/v1/projects/${KEY}/issues`;

const ISSUES = [
  createIssue({ id: 1, number: 11, title: '올해 마감 이슈', dueDate: '2026-10-25' }),
  createIssue({ id: 2, number: 12, title: '다른 해 마감 이슈', dueDate: '2027-01-05' }),
  createIssue({ id: 3, number: 13, title: '마감·담당자 없는 이슈', dueDate: null, assignees: [] }),
];

const ACTIVE_CYCLE: CycleResponse = {
  id: 1,
  projectId: 1,
  name: '스프린트 12',
  goal: null,
  startDate: '2026-09-21',
  endDate: '2026-10-10',
  status: 'ACTIVE',
  createdAt: '',
  updatedAt: '',
};
const PROGRESS: CycleProgress[] = [{ cycleId: 1, total: 3, done: 0, byStatus: { TODO: 3 } }];

/** 공통 목 — withCycle 이면 진행 중 사이클 하나를 줘 기본 그룹이 사이클 구간이 된다(없으면 평면 목록). */
async function setup(page: Page, { withCycle = false }: { withCycle?: boolean } = {}) {
  // 올해 판정이 실제 시계에 기대지 않도록 로컬 날짜를 2026-10-01 로 고정한다.
  await page.clock.setFixedTime(new Date(2026, 9, 1, 10, 0));
  await page.route(`**/api/v1/projects/${KEY}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
  );
  if (withCycle) {
    await page.route(`**/api/v1/projects/${KEY}/cycles`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([ACTIVE_CYCLE]) });
    });
    await page.route(`**/api/v1/projects/${KEY}/cycles/progress`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROGRESS) }),
    );
  }
  await page.route(
    (url) => url.pathname === ISSUES_PATH,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      // 사이클 구간 모드에선 진행 중 사이클에만 행을 두고 백로그는 비운다.
      const cycleParam = new URL(route.request().url()).searchParams.get('cycle');
      const items = cycleParam === 'null' ? [] : ISSUES;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(items, null)),
      });
    },
  );
}

/** 요소 안 글자의 실제 왼쪽 x — 패딩·들여쓰기를 뺀 글자 시작점을 Range 로 잰다. */
function textLeft(locator: Locator): Promise<number> {
  return locator.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect().x;
  });
}

/** ID 헤더 글자와 첫 행 키 글자의 왼쪽 x 차이. 보이는 열 머리 행이 DOM 상 첫 thead 다(구간별 thead 는 0 높이). */
async function idHeadOffset(page: Page): Promise<number> {
  const head = page.locator('thead').first().locator('th').filter({ hasText: /^ID$/ });
  const key = page.getByTestId('issue-row-11').getByText(`${KEY}-11`, { exact: true });
  await expect(key).toBeVisible();
  return Math.abs((await textLeft(head)) - (await textLeft(key)));
}

test.describe('프로젝트 목록 소정리 (WP-919)', { tag: '@layout' }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('평면 목록 — ID 헤더 글자가 키 글자와 2px 이내로 맞는다', async ({ authenticatedPage: page }) => {
    await setup(page);
    await page.goto(`/projects/${KEY}`);
    expect(await idHeadOffset(page)).toBeLessThanOrEqual(2);
  });

  test('사이클 구간 목록 — ID 헤더 글자가 키 글자와 2px 이내로 맞는다', async ({ authenticatedPage: page }) => {
    await setup(page, { withCycle: true });
    await page.goto(`/projects/${KEY}`);
    await expect(page.getByTestId('list-cycle-section-cycle-1')).toBeVisible();
    expect(await idHeadOffset(page)).toBeLessThanOrEqual(2);
  });

  test('1024px 에서도 우선순위·마감 칸이 보인다', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await setup(page);
    await page.goto(`/projects/${KEY}`);
    await expect(page.getByTestId('issue-row-11-priority')).toBeVisible();
    await expect(page.getByTestId('issue-row-11-due')).toBeVisible();
    // 유형 아이콘도 키 앞에 보인다(예전 sm:inline-flex).
    expect(await idHeadOffset(page)).toBeLessThanOrEqual(2);
  });
});

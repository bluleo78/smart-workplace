// 타임라인 조회 기간 E2E(WP-247) — 기본 활성 사이클로 거름, 필터를 바꿔도 기간 유지, 사이클 로딩 중 깜빡임 없음.
import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType } from '../../factories/issueType.factory';
import { createMember, createProject } from '../../factories/project.factory';
import type { CycleResponse } from '../../../src/types/cycle';
import type { IssueResponse } from '../../../src/types/issue';

const KEY = 'WP';
const EPIC_TYPE = makeEpicType();
const parent = (number: number, title: string) => ({ number, title, type: EPIC_TYPE });
const cycle = (o: Partial<CycleResponse>): CycleResponse => ({
  id: 1, projectId: 1, name: 'C', goal: null, startDate: null, endDate: null, status: 'PLANNED',
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', ...o,
});
const CYCLES = [
  cycle({ id: 1, name: 'GW-1', status: 'COMPLETED', startDate: '2026-09-17', endDate: '2026-09-30' }),
  cycle({ id: 2, name: 'GW-2', status: 'ACTIVE', startDate: '2026-10-01', endDate: '2026-10-14' }),
];
// 40 = GW-2 안 에픽(하위 41), 50 = GW-1 안 에픽(하위 51), 7 = GW-2 안 단독, 8 = 날짜 없음(일정 미정).
function issues(): IssueResponse[] {
  return [
    createIssue({ number: 40, title: '이번 에픽', type: EPIC_TYPE, startDate: '2026-10-01', dueDate: '2026-10-12', childCount: 1 }),
    createIssue({ number: 41, title: '이번 하위', parent: parent(40, '이번 에픽'), startDate: '2026-10-02', dueDate: '2026-10-06' }),
    createIssue({ number: 50, title: '지난 에픽', type: EPIC_TYPE, startDate: '2026-09-17', dueDate: '2026-09-28', childCount: 1 }),
    createIssue({ number: 51, title: '지난 하위', parent: parent(50, '지난 에픽'), startDate: '2026-09-18', dueDate: '2026-09-25' }),
    createIssue({ number: 7, title: '이번 단독', startDate: '2026-10-08', dueDate: '2026-10-09' }),
    createIssue({ number: 8, title: '미정 단독' }),
  ];
}

async function setupStubs(page: Page, { cycles = CYCLES, cycleDelayMs = 0 }: { cycles?: CycleResponse[]; cycleDelayMs?: number } = {}) {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  const get = (url: string, body: () => unknown, delay = 0) =>
    page.route(url, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      if (delay) await new Promise((r) => setTimeout(r, delay));
      return route.fulfill(json(body()));
    });
  await page.clock.setFixedTime(new Date('2026-10-05T10:00:00+09:00'));
  await Promise.all([
    get(`**/api/v1/projects/${KEY}/members`, () => [createMember({ userId: 2, name: '김개발', username: 'kim@example.com' })]),
    get(`**/api/v1/projects/${KEY}/labels`, () => []),
    get(`**/api/v1/projects/${KEY}`, () => createProject({ key: KEY })),
    get(`**/api/v1/projects/${KEY}/issues?*`, () => createIssueSearchResponse(issues())),
    get(`**/api/v1/projects/${KEY}/cycles`, () => cycles, cycleDelayMs),
    get(`**/api/v1/projects/${KEY}/milestones`, () => []),
    get(`**/api/v1/projects/${KEY}/issue-dependencies`, () => []),
  ]);
}

const gridRow = (page: Page, text: string) => page.locator('.timeline-gantt-root .wx-grid .wx-row', { hasText: text });

test.describe('타임라인 조회 기간 (WP-247)', () => {
  test('기본은 활성 사이클 — 그 기간에 걸친 에픽·이슈만 보이고 일정 미정은 남는다', async ({ authenticatedPage: page }) => {
    await setupStubs(page);
    await page.goto(`/projects/${KEY}/timeline`);
    await expect(gridRow(page, '이번 에픽')).toBeVisible();
    await expect(gridRow(page, '에픽 없음')).toBeVisible();
    await expect(gridRow(page, '지난 에픽')).toHaveCount(0);
    await expect(page.getByTestId('unscheduled-section')).toContainText('미정 단독');
  });

  test('상태 필터를 바꿔도 period 가 URL 에 남는다', async ({ authenticatedPage: page }) => {
    await setupStubs(page);
    await page.goto(`/projects/${KEY}/timeline?period=cycle-1`);
    await expect(gridRow(page, '지난 에픽')).toBeVisible();
    await expect(gridRow(page, '이번 에픽')).toHaveCount(0);
    // 아바타 스택으로 담당자 필터 토글(쓰기 경로 = useTimelineFilterControls.write)
    await page.getByTestId('assignee-avatar-2').click();
    await expect(page).toHaveURL(/period=cycle-1/);
  });

  test('사이클 응답 전에는 거르지 않은 목록을 비추지 않는다', async ({ authenticatedPage: page }) => {
    await setupStubs(page, { cycleDelayMs: 1500 });
    await page.goto(`/projects/${KEY}/timeline`);
    await expect(page.getByTestId('timeline-period-loading')).toBeVisible();
    await expect(gridRow(page, '지난 에픽')).toHaveCount(0);
    await expect(gridRow(page, '이번 에픽')).toBeVisible();
    await expect(gridRow(page, '지난 에픽')).toHaveCount(0);
  });
});

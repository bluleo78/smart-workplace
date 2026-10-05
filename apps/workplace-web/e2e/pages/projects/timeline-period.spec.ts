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

/** issueList: 이슈 응답 대체(0건 등), cyclesStatus: 사이클 응답 상태 코드(조회 실패 검증용). */
async function setupStubs(
  page: Page,
  { cycles = CYCLES, cycleDelayMs = 0, issueList }: { cycles?: CycleResponse[]; cycleDelayMs?: number; issueList?: IssueResponse[] } = {},
) {
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
    get(`**/api/v1/projects/${KEY}/issues?*`, () => createIssueSearchResponse(issueList ?? issues())),
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
    // 로딩 중에는 간트 자체를 그리지 않는다(거르지 않은 목록이 비칠 자리가 없음).
    await expect(page.getByTestId('timeline-gantt')).toHaveCount(0);
    await expect(gridRow(page, '이번 에픽')).toBeVisible();
    await expect(gridRow(page, '지난 에픽')).toHaveCount(0);
  });

  test('드롭다운 — 라벨이 늘 보이고, 다른 사이클·이번 분기·전체를 고르면 URL·목록이 바뀐다', async ({ authenticatedPage: page }) => {
    await setupStubs(page);
    await page.goto(`/projects/${KEY}/timeline`);
    const trigger = page.getByTestId('timeline-period-trigger');
    await expect(trigger).toContainText('GW-2 · 10/1–10/14');
    await trigger.click();
    const pop = page.getByTestId('timeline-period-popover');
    await expect(pop.getByTestId('timeline-period-option-active')).toHaveAttribute('aria-pressed', 'true');
    await expect(pop.getByTestId('timeline-period-option-cycle-1')).toContainText('완료됨');
    await pop.getByTestId('timeline-period-option-cycle-1').click();
    await expect(page).toHaveURL(/period=cycle-1/);
    await expect(gridRow(page, '지난 에픽')).toBeVisible();
    await expect(trigger).toContainText('GW-1');

    // 이번 분기(오늘 10/5 → 4분기) — GW-1(9월) 에픽은 빠지고 이번 에픽은 보인다.
    await trigger.click();
    await page.getByTestId('timeline-period-option-quarter').click();
    await expect(page).toHaveURL(/period=quarter/);
    await expect(trigger).toContainText('이번 분기 · 10/1–12/31');
    await expect(gridRow(page, '이번 에픽')).toBeVisible();
    await expect(gridRow(page, '지난 에픽')).toHaveCount(0);

    await trigger.click();
    await page.getByTestId('timeline-period-option-all').click();
    await expect(page).toHaveURL(/period=all/);
    await expect(gridRow(page, '지난 에픽')).toBeVisible();
    await expect(gridRow(page, '이번 에픽')).toBeVisible();
    await expect(trigger).toContainText('전체');

    await trigger.click();
    await page.getByTestId('timeline-period-option-active').click();
    await expect(page).not.toHaveURL(/period=/);
  });

  test('직접 지정 — 시작 > 종료면 적용할 수 없고, 적용하면 range 로 저장된다', async ({ authenticatedPage: page }) => {
    await setupStubs(page);
    await page.goto(`/projects/${KEY}/timeline`);
    await page.getByTestId('timeline-period-trigger').click();
    await page.getByTestId('period-range-from').fill('2026-09-20');
    await page.getByTestId('period-range-to').fill('2026-09-10');
    await expect(page.getByTestId('period-range-apply')).toBeDisabled();
    await expect(page.getByTestId('period-range-error')).toHaveText('시작일이 종료일보다 늦어요');
    await page.getByTestId('period-range-to').fill('2026-09-30');
    await expect(page.getByTestId('period-range-error')).toHaveCount(0);
    await page.getByTestId('period-range-apply').click();
    await expect(page).toHaveURL(/period=range%3A2026-09-20%7E2026-09-30|period=range:2026-09-20~2026-09-30/);
    await expect(page.getByTestId('timeline-period-trigger')).toContainText('9/20–9/30');
    await expect(gridRow(page, '지난 에픽')).toBeVisible();
  });

  test('활성 사이클이 없으면 대체 기간 라벨과 안내 툴팁', async ({ authenticatedPage: page }) => {
    await setupStubs(page, {
      cycles: [cycle({ id: 3, name: 'GW-3', status: 'PLANNED', startDate: '2026-10-15', endDate: '2026-10-28' })],
    });
    await page.goto(`/projects/${KEY}/timeline`);
    const trigger = page.getByTestId('timeline-period-trigger');
    await expect(trigger).toContainText('GW-3 (예정)');
    await expect(trigger).toHaveAttribute('title', '활성 사이클이 없어 가장 가까운 예정 사이클로 봅니다');
    // 팝오버 맨 위에도 같은 안내, 선택지 용어는 「예정」.
    await trigger.click();
    await expect(page.getByTestId('timeline-period-fallback-note')).toHaveText('활성 사이클이 없어 가장 가까운 예정 사이클로 봅니다');
    await expect(page.getByTestId('timeline-period-option-cycle-3')).toContainText('GW-3 (예정)');
  });

  test('응답이 0건이면(필터·새 프로젝트) 기본 기간이어도 기간 빈 상태를 띄우지 않는다 — 기간이 원인이 아님', async ({ authenticatedPage: page }) => {
    await setupStubs(page, { issueList: [] });
    await page.goto(`/projects/${KEY}/timeline`);
    await expect(page.getByTestId('timeline-period-trigger')).toContainText('GW-2');
    await expect(page.locator('.timeline-gantt-root')).toBeVisible();
    await expect(page.getByTestId('timeline-period-empty')).toHaveCount(0);
  });

  test('기간에 걸친 이슈가 없으면 빈 상태 문구', async ({ authenticatedPage: page }) => {
    await setupStubs(page);
    await page.goto(`/projects/${KEY}/timeline?period=range:2025-01-01~2025-01-31`);
    await expect(page.getByTestId('timeline-period-empty')).toContainText('이 기간에 걸친 이슈가 없어요');
    await expect(page.getByTestId('timeline-period-empty')).toContainText('기간을 「전체」로 바꿔 보세요');
    // 「전체 기간 보기」 → period=all, 간트에 이슈가 다시 보인다.
    await page.getByTestId('timeline-period-show-all').click();
    await expect(page).toHaveURL(/period=all/);
    await expect(page.getByTestId('timeline-period-empty')).toHaveCount(0);
    await expect(gridRow(page, '이번 에픽')).toBeVisible();
  });
});

test.describe('타임라인 완료·취소 에픽 표시 (WP-247)', () => {
  async function setup(page: Page, list: IssueResponse[], query = '?period=all') {
    await setupStubs(page);
    await page.unroute(`**/api/v1/projects/${KEY}/issues?*`);
    await page.route(`**/api/v1/projects/${KEY}/issues?*`, (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueSearchResponse(list)) })
        : route.fallback(),
    );
    await page.goto(`/projects/${KEY}/timeline${query}`);
  }
  const summary = (page: Page, n: number) => page.locator(`.timeline-gantt-root .wx-bar.wx-summary[data-task-id$="group-epic-${n}"]`);

  test('완료 에픽 — 요약 막대가 완료 색, 그리드에 「완료」', async ({ authenticatedPage: page }) => {
    await setup(page, [
      createIssue({ number: 40, title: '끝난 에픽', type: EPIC_TYPE, status: 'DONE', startDate: '2026-10-01', dueDate: '2026-10-10', childCount: 1, childDoneCount: 1 }),
      createIssue({ number: 41, title: '끝난 하위', status: 'DONE', parent: parent(40, '끝난 에픽'), startDate: '2026-10-02', dueDate: '2026-10-05' }),
    ]);
    await expect(summary(page, 40)).toHaveAttribute('data-epic-status', 'DONE');
    await expect(gridRow(page, '끝난 에픽')).toContainText('완료');
    // 완료 색상 검증 — 프로브 요소에서 --success 계산값을 읽어 요약 막대 배경과 비교
    const probeColor = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.color = 'var(--success)';
      document.documentElement.appendChild(probe);
      const computed = getComputedStyle(probe).color;
      probe.remove();
      return computed;
    });
    const bg = await summary(page, 40).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe(probeColor);
  });

  test('취소 에픽 — 기본은 숨고 하위 진행 중 이슈는 「에픽 없음」에 원래 에픽 이름과 함께, 「취소」 필터면 빗금 막대', async ({ authenticatedPage: page }) => {
    const list = [
      createIssue({ number: 70, title: '음성 메모', type: EPIC_TYPE, status: 'CANCELED', startDate: '2026-10-03', dueDate: '2026-10-12', childCount: 1 }),
      createIssue({ number: 71, title: '녹음 업로드 API', status: 'IN_PROGRESS', parent: parent(70, '음성 메모'), startDate: '2026-10-05', dueDate: '2026-10-08' }),
    ];
    await setup(page, list);
    // 「취소」 상태 필터 없으면 취소 에픽이 숨겨진다 — 요약 막대가 없음을 확인
    await expect(gridRow(page, '에픽 없음')).toBeVisible();
    await expect(summary(page, 70)).toHaveCount(0);
    // 취소 에픽의 진행 중 하위는 「에픽 없음」 그룹에 원래 에픽 이름과 함께 표시
    await gridRow(page, '에픽 없음').locator('.wx-toggle-icon, [class*="toggle"]').first().click();
    await expect(gridRow(page, '녹음 업로드 API')).toContainText('← 음성 메모');

    // 「취소」 필터를 추가하면 취소 에픽이 빗금 막대로 표시됨
    await setup(page, [list[0]], '?period=all&status=CANCELED');
    await expect(summary(page, 70)).toHaveAttribute('data-epic-status', 'CANCELED');
    await expect(gridRow(page, '음성 메모')).toContainText('취소');
    const bgImage = await summary(page, 70).evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bgImage).toContain('repeating-linear-gradient');
  });
});

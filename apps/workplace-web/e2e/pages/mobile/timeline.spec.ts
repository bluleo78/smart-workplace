// 모바일 타임라인(WP-197) — 간트 대신 월별 아젠다: 섹션 순서, 에픽 하위 들여쓰기, 미니 막대·오늘 선, 칩(필터·마일스톤·일정 미정).
// WP-251 — 에픽 기본 접힘·펼침 유지(데스크톱과 같은 저장소 키), 진행률 배지, 에픽 기간 vs 하위 실제 범위 얇은 막대.
// WP-247 — 기간 칩·시트와 완료·취소 에픽 상태 표시.
import type { Page } from '@playwright/test';

import type { CycleResponse } from '../../../src/types/cycle';
import type { IssueResponse } from '../../../src/types/issue';
import type { MilestoneResponse } from '../../../src/types/milestone';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';
import { json } from '../../fixtures/mobile-chat';
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture';

const KEY = 'WP';
const EPIC_TITLE = '결제 시스템 전면 개편 — 승인·정산·환불 파이프라인 재구축(여러 달에 걸친 에픽)';
const epicRef = { number: 40, title: EPIC_TITLE, type: makeEpicType() };
const I = (o: Partial<IssueResponse>) => createIssue({ projectKey: KEY, ...o });
const ISSUES: IssueResponse[] = [
  I({ id: 40, number: 40, title: EPIC_TITLE, type: makeEpicType(), startDate: '2026-10-01', dueDate: '2026-12-15' }),
  I({ id: 41, number: 41, title: '정산 배치 신규 파이프라인 이관', parent: epicRef, startDate: '2026-11-05', dueDate: '2026-11-20' }),
  I({ id: 42, number: 42, title: '승인 API 타임아웃 조정', parent: epicRef, dueDate: '2026-10-08' }),
  I({ id: 9, number: 9, title: '9월에 시작한 이슈', startDate: '2026-09-25', dueDate: '2026-10-05' }),
  // 하위가 에픽 기간(10/1~10/10)을 넘는 에픽(10/5~10/14) — 얇은 막대 초과 구간 검증용. 진행률 1/2.
  I({ id: 30, number: 30, title: '넘친 에픽', type: makeEpicType(), startDate: '2026-10-01', dueDate: '2026-10-10', childCount: 2, childDoneCount: 1 }),
  I({ id: 31, number: 31, title: '넘친 하위', parent: { number: 30, title: '넘친 에픽', type: makeEpicType() }, startDate: '2026-10-05', dueDate: '2026-10-14' }),
  I({ id: 10, number: 10, title: '모바일 결제 화면에서 카드 등록 실패 시 오류 문구가 잘려 보이는 문제와 재시도 버튼 위치 개선', startDate: '2026-10-11', dueDate: '2026-10-20' }),
  ...Array.from({ length: 6 }, (_, k) => I({ id: 20 + k, number: 20 + k, title: `10월 작업 ${k + 1}`, dueDate: `2026-10-2${k}` })),
  I({ id: 13, number: 13, title: '시작일만 있는 이슈', startDate: '2026-11-02' }),
  I({ id: 11, number: 11, title: '일정 미정 이슈 A' }),
  I({ id: 12, number: 12, title: '일정 미정 이슈 B' }),
  // WP-247: 완료 에픽 80, 취소 에픽 90 과 그 진행 중 하위 91(취소 에픽에서 「에픽 없음」으로 옮겨진다).
  I({ id: 80, number: 80, title: '완료 에픽', type: makeEpicType(), status: 'DONE', startDate: '2026-10-02', dueDate: '2026-10-09' }),
  I({ id: 90, number: 90, title: '취소 에픽', type: makeEpicType(), status: 'CANCELED', startDate: '2026-10-03', dueDate: '2026-10-12' }),
  I({ id: 91, number: 91, title: '취소 에픽의 진행 중 하위', parent: { number: 90, title: '취소 에픽', type: makeEpicType() }, status: 'IN_PROGRESS', startDate: '2026-10-05', dueDate: '2026-10-08' }),
];
const MILESTONES: MilestoneResponse[] = [
  { id: 1, projectId: 1, name: 'v2 베타', dueDate: '2026-11-01', description: null, createdAt: '', updatedAt: '' },
  { id: 2, projectId: 1, name: 'v2 정식 출시', dueDate: '2026-12-20', description: null, createdAt: '', updatedAt: '' },
];

// 사이클 팩토리 — 기간 칩 테스트(WP-247)용 CycleResponse.
function createCycle(o: Partial<CycleResponse>): CycleResponse {
  return { id: 1, projectId: 1, name: 'GW-1', goal: null, startDate: '2026-09-01', endDate: '2026-09-30', status: 'PLANNED', createdAt: '', updatedAt: '', ...o };
}

/** period: 기본 'all'(기간 거름 없이 기존 검증 유지), null 이면 period 없이 진입해 기본(활성 사이클) 기간을 쓴다. */
async function setup(page: Page, opts: { member?: boolean; query?: string; cycles?: CycleResponse[]; period?: string | null; issues?: IssueResponse[] } = {}) {
  await page.clock.setFixedTime(new Date('2026-10-15T03:00:00Z')); // 오늘 = 2026-10-15(KST)
  await stubChat(page);
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill(json(createProject({ key: KEY, viewerIsMember: opts.member ?? true }))));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues`, (r) => {
    // 상태 DONE 필터 = 0건(빈 상태 케이스).
    const status = new URL(r.request().url()).searchParams.get('status') ?? '';
    return r.fulfill(json(createIssueSearchResponse(status.includes('DONE') ? [] : (opts.issues ?? ISSUES), null)));
  });
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/milestones`, (r) => r.fulfill(json(MILESTONES)));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/cycles`, (r) => r.fulfill(json(opts.cycles ?? [])));
  await page.route((u) => [`/api/v1/projects/${KEY}/issue-dependencies`, `/api/v1/projects/${KEY}/members`, `/api/v1/projects/${KEY}/labels`].includes(u.pathname), (r) => r.fulfill(json([])));
  // 기간 필터 고정(WP-247) — 기본 period=all 을 쿼리에 덧붙인다(null 이면 붙이지 않음).
  const params = new URLSearchParams((opts.query ?? '').replace(/^\?/, ''));
  const period = opts.period === undefined ? 'all' : opts.period;
  if (period) params.set('period', period);
  const qs = params.toString();
  await page.goto(`/projects/${KEY}/timeline${qs ? `?${qs}` : ''}`);
  await expect(page.getByTestId('timeline-agenda')).toBeVisible();
}

test('간트 대신 아젠다 — 월 섹션 오름차순 + 일정 미정 맨 아래, 행 날짜 문구, 넘침 없음', async ({ authenticatedPage: page }) => {
  await setup(page);
  await expect(page.getByTestId('timeline-gantt')).toHaveCount(0);
  await expect(page.getByTestId('agenda-row-10')).toBeVisible();
  const order = await page.locator('[data-testid^="agenda-month-"], [data-testid="agenda-undated"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  expect(order).toEqual(['agenda-month-2026-09', 'agenda-month-2026-10', 'agenda-month-2026-11', 'agenda-undated']);
  await expect(page.getByTestId('agenda-month-2026-10').getByRole('heading')).toHaveText('2026년 10월');
  await expect(page.getByTestId('agenda-row-10')).toContainText('10월 11일 ~ 10월 20일');
  await expect(page.getByTestId('agenda-row-13')).toContainText('11월 2일');
  await expect(page.getByTestId('agenda-row-11')).toContainText('일정 미정');
  await expectNoHorizontalOverflow(page);
});

/** 에픽 행 왼쪽 펼침 버튼 탭(WP-251) — 에픽은 기본 접힘이라 하위를 보려면 먼저 펼친다. */
async function expandEpic(page: Page, epicNumber: number) {
  await page.getByTestId(`agenda-toggle-${epicNumber}`).tap();
}

test('에픽 머리 행 아래 하위가 들여쓰기로 묶이고(월이 달라도), 월 밖 하위 막대도 보인다', async ({ authenticatedPage: page }) => {
  await setup(page);
  await expandEpic(page, 40);
  const oct = page.getByTestId('agenda-month-2026-10');
  const kinds = await oct.locator('[data-testid^="agenda-row-"]').evaluateAll((els) => {
    const i = els.findIndex((e) => e.getAttribute('data-testid') === 'agenda-row-40');
    return els.slice(i, i + 3).map((e) => [e.getAttribute('data-testid'), e.getAttribute('data-kind')]);
  });
  expect(kinds).toEqual([['agenda-row-40', 'epic'], ['agenda-row-42', 'child'], ['agenda-row-41', 'child']]);
  const epicX = (await page.getByTestId('agenda-row-40').getByText(EPIC_TITLE).boundingBox())!.x;
  const childX = (await page.getByTestId('agenda-row-41').getByText('정산 배치').boundingBox())!.x;
  expect(childX).toBeGreaterThan(epicX + 12);
  // 들여쓰기는 글자만 — 막대는 모든 행이 같은 월 트랙을 써서 오늘 선이 행 사이에서 세로로 맞는다(WP-251).
  const todayX = async (n: number) => (await page.getByTestId(`agenda-row-${n}`).getByTestId('agenda-today').boundingBox())!.x;
  expect(await todayX(41)).toBeCloseTo(await todayX(40), 0);
  expect(await todayX(41)).toBeCloseTo(await todayX(10), 0);
  // 11월 하위(41)는 10월 섹션에서 오른쪽 끝으로 잘리지만 최소 폭 막대로 남는다(Review Focus 2).
  const bar = (await page.getByTestId('agenda-row-41').getByTestId('agenda-bar').boundingBox())!;
  expect(bar.width).toBeGreaterThanOrEqual(2);
  expect(bar.x + bar.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  // 오늘 선은 오늘이 속한 10월 섹션에만.
  await expect(oct.getByTestId('agenda-today').first()).toBeVisible();
  await expect(page.getByTestId('agenda-month-2026-09').getByTestId('agenda-today')).toHaveCount(0);
});

test('행 탭 → 이슈 상세', async ({ authenticatedPage: page }) => {
  await setup(page);
  await expandEpic(page, 40);
  await page.getByTestId('agenda-row-42').tap();
  await expect(page).toHaveURL(new RegExp(`/projects/${KEY}/issues/42$`));
});

test('「일정 미정 N」 칩 → 미정 섹션으로 스크롤, 「마일스톤 N」 칩 → 이름·날짜 시트', async ({ authenticatedPage: page }) => {
  await setup(page);
  const undated = page.getByTestId('agenda-undated');
  await expect(undated).not.toBeInViewport();
  const chip = page.getByTestId('agenda-chip-undated');
  await expect(chip).toHaveText('일정 미정 2');
  await chip.tap();
  await expect(undated).toBeInViewport();

  await page.getByTestId('agenda-chip-milestones').tap();
  const sheet = page.getByTestId('agenda-milestone-sheet');
  await expect(sheet).toContainText('v2 베타');
  await expect(sheet).toContainText('11월 1일');
  await expect(sheet).toContainText('v2 정식 출시');
});

test('필터 칩 → 필터 시트(활성 수 표시), 0건이면 빈 상태 + 칩 줄 유지', async ({ authenticatedPage: page }) => {
  await setup(page, { query: '?status=DONE' });
  await expect(page.getByTestId('timeline-agenda-empty')).toBeVisible();
  const filter = page.getByTestId('agenda-chip-filter');
  await expect(filter).toHaveText('필터 1');
  await filter.tap();
  const sheet = page.getByTestId('mobile-filter-sheet');
  await expect(sheet).toBeVisible();
  await sheet.getByTestId('mobile-filter-clear').tap();
  await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBeNull();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('agenda-row-10')).toBeVisible();
});

test('헤더 — 줌·오늘 없음, 멤버면 「마일스톤 추가」(헤더 인라인), 비멤버면 없음', async ({ authenticatedPage: page }) => {
  await setup(page);
  await expect(page.getByRole('button', { name: '오늘' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: '줌 전환' })).toHaveCount(0);
  await page.getByTestId('milestone-add-button').tap();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('비멤버는 「마일스톤 추가」가 없다', async ({ authenticatedPage: page }) => {
  await setup(page, { member: false });
  await expect(page.getByTestId('milestone-add-button')).toHaveCount(0);
});

test('에픽은 기본 접힘 — 펼침 버튼으로 하위를 펼치고 접으며, 새로고침 후에도 펼침이 유지된다', async ({ authenticatedPage: page }) => {
  await setup(page);
  const toggle = page.getByTestId('agenda-toggle-40');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('agenda-row-41')).toHaveCount(0);
  await toggle.tap();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('agenda-row-41')).toBeVisible();
  // 펼침 버튼은 상세로 이동하지 않는다(행 본문 탭만 이동).
  await expect(page).toHaveURL(new RegExp(`/projects/${KEY}/timeline`));
  // 데스크톱 간트와 같은 저장소 키·그룹 키로 기억 → 새로고침해도 펼친 채.
  expect(await page.evaluate((k) => localStorage.getItem(`timeline-expanded:${k}`), KEY)).toBe('["epic-40"]');
  await page.reload();
  await expect(page.getByTestId('agenda-row-41')).toBeVisible();
  await page.getByTestId('agenda-toggle-40').tap();
  await expect(page.getByTestId('agenda-row-41')).toHaveCount(0);
  // 하위가 없는 행·에픽 없는 이슈에는 펼침 버튼이 없다.
  await expect(page.getByTestId('agenda-toggle-10')).toHaveCount(0);
});

test('에픽 행 — 제목 옆 진행률 배지, 하위 실제 범위 얇은 막대와 에픽 기간 밖 초과 구간', async ({ authenticatedPage: page }) => {
  await setup(page);
  const epic = page.getByTestId('agenda-row-30');
  await expect(epic.getByTestId('agenda-progress').locator('[aria-hidden="true"]')).toHaveText('1/2');
  await expect(epic.getByTestId('agenda-progress')).toContainText('하위 2개 중 1개 완료'); // 스크린리더 문구(sr-only)
  await expect(epic).toContainText('하위 일정 10월 5일 ~ 10월 14일 (에픽 기간 초과)');
  await expect(page.getByTestId('agenda-toggle-30')).toHaveAccessibleName('넘친 에픽 하위 이슈 펼치기');
  // 에픽 막대 = 10/1~10/10, 얇은 막대 = 하위 10/5~10/14, 그중 10/5~10/10 이 안쪽(나머지는 빨강 초과).
  const box = async (id: string) => (await epic.getByTestId(id).boundingBox())!;
  const [bar, rollup, inside] = [await box('agenda-bar'), await box('agenda-rollup'), await box('agenda-rollup-inside')];
  const day = bar.width / 10;
  expect(Math.abs(rollup.x - (bar.x + 4 * day))).toBeLessThan(day / 2);
  expect(Math.abs(rollup.width - 10 * day)).toBeLessThan(day / 2);
  expect(Math.abs(inside.x + inside.width - (bar.x + bar.width))).toBeLessThan(day / 2); // 안쪽은 에픽 끝에서 멈춘다
  expect(rollup.x + rollup.width).toBeGreaterThan(inside.x + inside.width + 3 * day); // 4일 초과 구간
  // 하위가 모두 기간 안인 에픽(40)은 얇은 막대가 전부 안쪽이다.
  const e40 = page.getByTestId('agenda-row-40');
  const [r40, i40] = [(await e40.getByTestId('agenda-rollup').boundingBox())!, (await e40.getByTestId('agenda-rollup-inside').boundingBox())!];
  expect(Math.round(i40.width)).toBe(Math.round(r40.width));
  await expect(e40).not.toContainText('에픽 기간 초과');
  await expectNoHorizontalOverflow(page);
});

test('기간 칩 — 맨 앞에 활성 사이클 라벨, 시트에서 바꾸면 아젠다가 다시 걸러진다 (WP-247)', async ({ authenticatedPage: page }) => {
  // 오늘(10/15)이 활성 사이클 GW-2 안에 들도록 10/8~10/21. GW-3 는 예정.
  const cycles: CycleResponse[] = [
    createCycle({ id: 1, name: 'GW-2', startDate: '2026-10-08', endDate: '2026-10-21', status: 'ACTIVE' }),
    createCycle({ id: 2, name: 'GW-3', startDate: '2026-11-01', endDate: '2026-11-14', status: 'PLANNED' }),
  ];
  // period 없이 진입 — 기본값은 활성 사이클(GW-2).
  await setup(page, { cycles, period: null });
  const chips = page.locator('[data-testid^="agenda-chip-"]');
  await expect(chips.first()).toHaveAttribute('data-testid', 'agenda-chip-period');
  await expect(page.getByTestId('agenda-chip-period')).toContainText('GW-2');
  // 에픽 40(10/1~12/15)이 기간과 겹쳐 11월 하위 41 도 함께 남는다 — 에픽은 기본 접힘이라 펼쳐서 확인(WP-251).
  await expandEpic(page, 40);
  await expect(page.getByTestId('agenda-row-41')).toBeVisible();
  await expect(page.getByTestId('agenda-row-25')).toHaveCount(0); // 10/25 마감 단독 — 기간(10/8~10/21) 밖
  // 마감일 없는 단독(13, 11/2 시작)은 간트에선 「일정 미정」이라 기간과 무관하게 남는다.
  await expect(page.getByTestId('agenda-row-13')).toBeVisible();
  await page.getByTestId('agenda-chip-period').click();
  const sheet = page.getByTestId('agenda-period-sheet');
  await sheet.getByTestId('picker-option-all').click();
  await expect(page).toHaveURL(/period=all/);
  await expect(page.getByTestId('agenda-row-25')).toBeVisible();
  // 필터 개수에는 기간이 들어가지 않는다.
  await expect(page.getByTestId('agenda-chip-filter')).toHaveText('필터');
  await expectNoHorizontalOverflow(page);
});

test('응답 0건이면 기본(활성) 기간이어도 기간 문구가 아닌 필터 빈 상태 — 기간이 원인이 아님 (WP-247)', async ({ authenticatedPage: page }) => {
  // 스텁은 DONE 상태 필터에 0건을 준다. period 없이 진입 → 기본 기간이 걸려 있지만 「전체」로 바꿔도 0건이다.
  await setup(page, { query: '?status=DONE', period: null });
  const empty = page.getByTestId('timeline-agenda-empty');
  await expect(empty).toContainText('표시할 이슈가 없어요');
  await expect(empty).toContainText('필터를 풀면 더 많은 이슈가 보여요.');
  await expect(empty).not.toContainText('이 기간에 걸친 이슈가 없어요');
  await expect(page.getByTestId('agenda-chip-period')).toBeVisible();
});

test('기간에 걸친 일정 있는 이슈가 없으면 미정 섹션 위에 기간 빈 상태 — 데스크톱과 같은 조건 (WP-247)', async ({ authenticatedPage: page }) => {
  // 모든 일정 있는 이슈와 먼 직접 지정 기간 — 일정 미정 이슈(11·12)는 기간과 무관하게 남는다.
  // 시작일만 있는 13 은 마감일이 없어 기간과 무관하게 남고, 모바일에선 시작 월(11월) 섹션에 보이므로 이 검증에서 뺀다.
  await setup(page, { period: 'range:2030-01-01~2030-01-31', issues: ISSUES.filter((i) => i.number !== 13) });
  const empty = page.getByTestId('timeline-agenda-empty');
  await expect(empty).toContainText('이 기간에 걸친 이슈가 없어요');
  await expect(empty).toContainText('기간을 「전체」로 바꿔 보세요');
  await expect(page.getByTestId('agenda-undated')).toBeVisible();
  await expect(page.getByTestId('agenda-row-11')).toBeVisible();
  await expect(page.locator('[data-testid^="agenda-month-"]')).toHaveCount(0);
  // 안내가 미정 섹션보다 위.
  const [e, u] = [(await empty.boundingBox())!, (await page.getByTestId('agenda-undated').boundingBox())!];
  expect(e.y).toBeLessThan(u.y);
});

test('기간 시트 「직접 지정」 — 날짜 두 칸을 적용하면 URL·칩 라벨이 바뀌고 시트가 닫힌다 (WP-247)', async ({ authenticatedPage: page }) => {
  await setup(page);
  await page.getByTestId('agenda-chip-period').click();
  const sheet = page.getByTestId('agenda-period-sheet');
  await expect(sheet).toBeVisible();
  await sheet.getByTestId('period-range-from').fill('2026-10-01');
  await sheet.getByTestId('period-range-to').fill('2026-10-14');
  await sheet.getByTestId('period-range-apply').click();
  await expect(page).toHaveURL(/period=range(:|%3A)2026-10-01(~|%7E)2026-10-14/);
  await expect(page.getByTestId('agenda-chip-period')).toContainText('10/1–10/14');
  await expect(sheet).toHaveCount(0);
  // 기간 밖 단독 이슈(10/25 마감)는 빠진다.
  await expect(page.getByTestId('agenda-row-25')).toHaveCount(0);
});

test('완료 에픽은 완료 배지, 「취소」 필터면 취소 에픽이 배지·취소선으로, 옮겨진 하위는 단독 행 (WP-247)', async ({ authenticatedPage: page }) => {
  await setup(page);
  await expect(page.getByTestId('agenda-row-80').getByTestId('agenda-status-badge')).toHaveText('완료');
  await expect(page.getByTestId('agenda-row-80').getByTestId('agenda-bar')).toHaveClass(/bg-success/);
  await expect(page.getByTestId('agenda-row-90')).toHaveCount(0);
  await expect(page.getByTestId('agenda-row-91')).toHaveAttribute('data-kind', 'issue');
  await expect(page.getByTestId('agenda-row-91')).toContainText('← 취소 에픽');
  // 「취소」 상태 필터 URL 로 다시 진입 — 스텁은 status 를 무시하고 같은 목록을 준다.
  await page.goto(`/projects/${KEY}/timeline?period=all&status=CANCELED`);
  const canceled = page.getByTestId('agenda-row-90');
  await expect(canceled.getByTestId('agenda-status-badge')).toHaveText('취소');
  await expect(canceled.locator('.line-through')).toBeVisible();
  await expect(canceled.getByTestId('agenda-bar')).toHaveClass(/bg-muted-foreground/);
});

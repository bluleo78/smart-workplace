// 타임라인 에픽 기간 E2E — 에픽 막대가 에픽에 설정한 기간으로 그려지고(WP-248),
// 그 아래 얇은 막대로 하위 이슈 실제 범위·에픽 기간 초과 구간이 보이는지(WP-249) 검증한다.
import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType } from '../../factories/issueType.factory';
import { createMember, createProject } from '../../factories/project.factory';
import type { IssueResponse } from '../../../src/types/issue';

const KEY = 'WP';
const EPIC_TYPE = makeEpicType();
const parent = (number: number, title: string) => ({ number, title, type: EPIC_TYPE });

// 에픽 40: 기간 07-01~07-31, 하위 41(07-06~07-12)·42(07-27~08-04, 에픽 끝을 4일 넘김).
// 에픽 60: 자체 기간 없음, 하위 61(07-14~07-20) — 막대는 하위 롤업, 얇은 막대 없음.
// 드래그 테스트가 PATCH 로 바뀐 날짜를 재조회에 반영할 수 있도록 테스트마다 새 목록을 만든다.
function issues(): IssueResponse[] {
  return [
    createIssue({ number: 40, title: '기간 에픽', type: EPIC_TYPE, startDate: '2026-07-01', dueDate: '2026-07-31', childCount: 2 }),
    createIssue({ number: 41, title: '안쪽 하위', parent: parent(40, '기간 에픽'), startDate: '2026-07-06', dueDate: '2026-07-12' }),
    createIssue({ number: 42, title: '넘친 하위', parent: parent(40, '기간 에픽'), startDate: '2026-07-27', dueDate: '2026-08-04' }),
    createIssue({ number: 60, title: '기간 없는 에픽', type: EPIC_TYPE, childCount: 1 }),
    createIssue({ number: 61, title: '롤업 하위', parent: parent(60, '기간 없는 에픽'), startDate: '2026-07-14', dueDate: '2026-07-20' }),
  ];
}

function setupStubs(page: Page, list: IssueResponse[] = issues()) {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  const get = (url: string, body: () => unknown) =>
    page.route(url, (route) => (route.request().method() === 'GET' ? route.fulfill(json(body())) : route.fallback()));
  return Promise.all([
    get(`**/api/v1/projects/${KEY}/members`, () => [createMember({ userId: 2, name: '김개발', username: 'kim@example.com' })]),
    get(`**/api/v1/projects/${KEY}/labels`, () => []),
    get(`**/api/v1/projects/${KEY}`, () => createProject({ key: KEY })),
    get(`**/api/v1/projects/${KEY}/issues?*`, () => createIssueSearchResponse(list)),
    get(`**/api/v1/projects/${KEY}/cycles`, () => []),
    get(`**/api/v1/projects/${KEY}/milestones`, () => []),
    get(`**/api/v1/projects/${KEY}/issue-dependencies`, () => []),
  ]);
}

async function expandGroup(page: Page, title: string) {
  await page
    .locator('.timeline-gantt-root .wx-grid .wx-row', { hasText: title })
    .locator('.wx-toggle-icon, [class*="toggle"]')
    .first()
    .click();
}

const summaryBar = (page: Page, epicNumber: number) =>
  page.locator(`.timeline-gantt-root .wx-bar.wx-summary[data-task-id$="group-epic-${epicNumber}"]`);

/** 하위 막대 41(7일)의 폭으로 하루당 px 를 구한다 — 줌·컬럼 폭과 무관하게 비교하기 위함. */
async function pxPerDay(page: Page) {
  const box = (await page.locator('.timeline-gantt-root [data-task-id="41"]').boundingBox())!;
  return { box, perDay: box.width / 7 };
}

/** px 비교 — 하루당 px 를 7일 막대에서 역산하므로 긴 구간은 반올림 오차가 쌓인다. 반나절 이내면 같은 날짜로 본다. */
const expectDays = (actualPx: number, days: number, perDay: number) =>
  expect(Math.abs(actualPx - days * perDay)).toBeLessThan(perDay / 2);

/** 요약 막대 ::after(얇은 막대)의 계산된 위치·폭·배경. */
function thinBar(bar: Locator) {
  return bar.evaluate((el) => {
    const cs = getComputedStyle(el, '::after');
    return { content: cs.content, left: parseFloat(cs.left), width: parseFloat(cs.width), background: cs.backgroundImage };
  });
}

test('에픽 막대·그리드 시작일이 에픽에 설정한 기간으로 표시된다 (WP-248)', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  // 그리드 시작일 = 에픽 시작일(하위 최소 시작 07-06 이 아님)
  await expect(page.locator('.timeline-gantt-root .wx-grid .wx-row', { hasText: '기간 에픽' })).toContainText(
    '01-07-2026',
  );
  await expandGroup(page, '기간 에픽');
  const { box: child, perDay } = await pxPerDay(page);
  const epic = (await summaryBar(page, 40).boundingBox())!;
  // 에픽 막대: 07-01 시작(하위 41 보다 5일 앞) ~ 31일 폭
  expectDays(child.x - epic.x, 5, perDay);
  expectDays(epic.width, 31, perDay);
});

test('에픽 막대 아래 얇은 막대가 하위 실제 범위를 그리고 넘친 구간만 빨강이다 (WP-249)', async ({
  authenticatedPage: page,
}) => {
  await setupStubs(page);
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await expandGroup(page, '기간 에픽');
  const { perDay } = await pxPerDay(page);
  const bar = summaryBar(page, 40);
  // 주입된 변수: 얇은 막대 30일(07-06~08-04) 중 앞 26일(~07-31)이 에픽 기간 안쪽
  await expect.poll(() => bar.evaluate((el) => el.style.getPropertyValue('--rollup-in-end'))).toMatch(/^86\.66/);
  const thin = await thinBar(bar);
  expect(thin.content).not.toBe('none');
  // 얇은 막대: 에픽 시작 기준 +5일(07-06) ~ 30일 폭(07-06~08-04)
  expectDays(thin.left, 5, perDay);
  expectDays(thin.width, 30, perDay);
  // 그라데이션에 destructive 색이 들어 있다(초과 구간)
  const destructive = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.color = 'var(--destructive)';
    document.querySelector('.timeline-gantt-root')!.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
  expect(thin.background).toContain(destructive);
});

test('에픽 자체 기간이 없으면 막대는 하위 롤업이고 얇은 막대는 그리지 않는다', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await expect(page.locator('.timeline-gantt-root .wx-grid .wx-row', { hasText: '기간 없는 에픽' })).toContainText(
    '14-07-2026',
  );
  const bar = summaryBar(page, 60);
  await expect(bar).toBeVisible();
  expect(await bar.evaluate((el) => el.style.getPropertyValue('--rollup-left'))).toBe('');
  expect((await thinBar(bar)).content).toBe('none');
});

test('하위 막대를 드래그해 저장해도 에픽 막대는 에픽 기간을 유지한다', async ({ authenticatedPage: page }) => {
  const list = issues();
  await setupStubs(page, list);
  const patches = trackRequests(page, 'PATCH', `/api/v1/projects/${KEY}/issues/41`);
  // 실제 서버처럼 저장한 날짜를 목록에 반영 — 재조회 응답이 바뀌어 간트가 새 데이터로 다시 그려진다.
  await page.route(`**/api/v1/projects/${KEY}/issues/41`, (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const body = route.request().postDataJSON() as { startDate: string; dueDate: string };
    const child = list.find((i) => i.number === 41)!;
    Object.assign(child, { startDate: body.startDate, dueDate: body.dueDate });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(child) });
  });
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await expandGroup(page, '기간 에픽');
  const { box, perDay } = await pxPerDay(page);
  const before = (await summaryBar(page, 40).boundingBox())!;
  // 하위 41 을 오른쪽으로 끌어 저장 — SVAR 는 드래그 중 요약 막대를 하위 기준으로 다시 계산하지만,
  // 저장·재조회 뒤에는 에픽 기간으로 돌아와야 한다.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 3 * perDay, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => patches.count()).toBeGreaterThan(0);
  await expect
    .poll(async () => {
      const b = (await summaryBar(page, 40).boundingBox())!;
      return [Math.round(b.x - before.x), Math.round(b.width - before.width)];
    })
    .toEqual([0, 0]);
});


// 코드 리뷰 지적 — 에픽 막대 자체가 그대로면 SVAR 가 style 을 다시 쓰지 않으므로, 얇은 막대 변수는 직접 갱신·제거해야 한다.
async function dragChild41(page: Page, days: number) {
  const { box, perDay } = await pxPerDay(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + days * perDay, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
}

test('하위 마감일만 바뀌어 얇은 막대 시작이 그대로여도 폭·초과 구간이 갱신된다', async ({ authenticatedPage: page }) => {
  const list = issues();
  await setupStubs(page, list);
  // 42(07-27~08-04) 의 끝 리사이즈 대신, 41 을 08-10 까지 늘린 것처럼 재조회 응답을 바꾼다 — 시작(07-06)은 그대로.
  await page.route(`**/api/v1/projects/${KEY}/issues/41`, (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const child = list.find((i) => i.number === 41)!;
    Object.assign(child, { startDate: '2026-07-06', dueDate: '2026-08-10' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(child) });
  });
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await expandGroup(page, '기간 에픽');
  const bar = summaryBar(page, 40);
  await expect.poll(() => bar.evaluate((el) => el.style.getPropertyValue('--rollup-in-end'))).toMatch(/^86\.66/);
  await dragChild41(page, 3);
  // 07-06~08-10 = 36일 중 26일이 안쪽 → 72.2%
  await expect.poll(() => bar.evaluate((el) => el.style.getPropertyValue('--rollup-in-end'))).toMatch(/^72\.2/);
});

test('날짜 있는 하위가 없어지면 얇은 막대가 사라진다', async ({ authenticatedPage: page }) => {
  const list = issues();
  await setupStubs(page, list);
  await page.route(`**/api/v1/projects/${KEY}/issues/41`, (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    // 저장과 함께 두 하위의 날짜가 모두 비워진 상태를 재조회에 반영(다른 사용자가 지운 상황과 같다).
    for (const n of [41, 42]) Object.assign(list.find((i) => i.number === n)!, { startDate: null, dueDate: null });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list[1]) });
  });
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await expandGroup(page, '기간 에픽');
  const bar = summaryBar(page, 40);
  await expect.poll(() => bar.evaluate((el) => el.style.getPropertyValue('--rollup-left'))).not.toBe('');
  await dragChild41(page, 3);
  await expect.poll(() => bar.evaluate((el) => el.style.getPropertyValue('--rollup-left'))).toBe('');
  expect((await thinBar(bar)).content).toBe('none');
});

test('하위 막대 저장이 실패해도 하위·에픽 막대가 원래 자리로 돌아온다', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  await page.route(`**/api/v1/projects/${KEY}/issues/41`, (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: '일정 변경에 실패했습니다' }) })
      : route.fallback(),
  );
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await expandGroup(page, '기간 에픽');
  // 드래그 중 차트가 스크롤될 수 있어, 움직이지 않는 하위 42 막대 기준 상대 위치로 비교한다.
  const layout = async () => {
    const anchor = (await page.locator('.timeline-gantt-root [data-task-id="42"]').boundingBox())!;
    const child = (await page.locator('.timeline-gantt-root [data-task-id="41"]').boundingBox())!;
    const epic = (await summaryBar(page, 40).boundingBox())!;
    return [child.x - anchor.x, epic.x - anchor.x, epic.width].map(Math.round);
  };
  const before = await layout();
  await dragChild41(page, 3);
  await expect(page.getByText('일정 변경에 실패했습니다')).toBeVisible();
  // SVAR 는 드래그로 하위를 옮기고 에픽 요약 막대도 하위 기준으로 다시 계산해 둔다 — 실패 복원 뒤엔 모두 원래대로여야 한다.
  await expect.poll(layout).toEqual(before);
});

// 이슈 목록 열 고르기 — 열 정의 한 곳(WP-270) E2E.
// 무엇을: URL `cols` 로 고른 선택 열이 평면 목록·사이클 구간 목록의 헤더와 행 셀에 같은 순서로 그려지는지,
//        `cols=`(빈 값)이면 선택 열이 모두 꺼지고, `cols` 가 없으면 지금과 같은 기본 열(우선순위·담당자·마감)인지 검증.
// 왜: 헤더가 평면 thead·사이클 CycleSectionColumnHead 두 곳에 따로 있던 것을 열 정의 하나로 묶었기 때문 —
//     두 화면이 같은 정의를 쓰는지, 셀 렌더러(완료일·보고자·사이클·커스텀 필드)가 응답 값을 그대로 보이는지를 지킨다.
// 날짜는 같은 해면 연도를 생략하므로(스펙 4.6) 현재 시각을 2026-10-23(서울)로 고정한다.
import type { Page } from '@playwright/test';

import type { IssueFieldDef } from '../../../src/types/customField';
import type { CycleResponse } from '../../../src/types/cycle';
import type { IssueResponse } from '../../../src/types/issue';
import type { SavedViewResponse } from '../../../src/types/savedView';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import { expect, test } from '../../fixtures/auth.fixture';

const KEY = 'WP';
const ISSUES_PATH = `/api/v1/projects/${KEY}/issues`;
const COLS = 'priority,assignee,due,closed,reporter,cycle,cf7';

test.use({ timezoneId: 'Asia/Seoul' });

// 커스텀 필드 정의 — cf7 「고객사」(SELECT). cf8 은 정의만 있고 URL 에 없으니 열로 나오지 않아야 한다.
const FIELD_DEFS: IssueFieldDef[] = [
  { id: 7, projectId: 1, name: '고객사', type: 'SELECT', options: ['한빛', '누리'], position: 0, createdAt: '', updatedAt: '' },
  { id: 8, projectId: 1, name: '예상 공수', type: 'NUMBER', options: null, position: 1, createdAt: '', updatedAt: '' },
];

const CYCLE: CycleResponse = {
  id: 3, projectId: 1, name: 'GW-3', goal: null, startDate: '2026-10-19', endDate: '2026-10-30',
  status: 'ACTIVE', createdAt: '', updatedAt: '',
};

// 완료 이슈 — 마감 10/21, 서울 10/23 14:05 완료 → 「✓ 10월 23일」 + 「+2일」. 사이클 둘(첫 이름 + `+1`).
const ISSUE: IssueResponse = createIssue({
  id: 1,
  number: 1,
  title: '결제 모듈 개편',
  status: 'DONE',
  statusId: 3,
  statusName: '완료',
  priority: 'HIGH',
  dueDate: '2026-10-21',
  closedAt: '2026-10-23T05:05:00Z',
  reporter: { id: 5, username: 'lee', name: '이진우', kind: 'HUMAN' },
  cycles: [
    { id: 3, name: 'GW-3', status: 'ACTIVE' },
    { id: 2, name: 'GW-2', status: 'COMPLETED' },
  ],
  customFields: [{ defId: 7, name: '고객사', type: 'SELECT', value: '한빛' }],
});

/** 공통 목 — 사이클 유무에 따라 기본 그룹이 달라진다(사이클 있으면 사이클 그룹). */
async function setup(page: Page, { cycles = [] as CycleResponse[], issue = ISSUE } = {}) {
  await page.clock.setFixedTime(new Date('2026-10-23T06:00:00Z'));
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route(`**/api/v1/projects/${KEY}`, (route) => route.fulfill(json(createProject())));
  await page.route(`**/api/v1/projects/${KEY}/members`, (route) => route.fulfill(json([])));
  await page.route(`**/api/v1/projects/${KEY}/labels`, (route) => route.fulfill(json([])));
  await page.route(`**/api/v1/projects/${KEY}/saved-views`, (route) => route.fulfill(json([])));
  await page.route(`**/api/v1/projects/${KEY}/fields`, (route) => route.fulfill(json(FIELD_DEFS)));
  await page.route(`**/api/v1/projects/${KEY}/cycles`, (route) => route.fulfill(json(cycles)));
  await page.route(`**/api/v1/projects/${KEY}/cycles/progress`, (route) => route.fulfill(json([])));
  await page.route(
    (url) => url.pathname === ISSUES_PATH,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      // 사이클 그룹은 구간별(cycle=3·null) 요청 — 진행 중 구간에만 이슈를 둔다.
      const cycle = new URL(route.request().url()).searchParams.get('cycle');
      return route.fulfill(json(createIssueSearchResponse(cycle === 'null' ? [] : [issue], null)));
    },
  );
}

/** 보이는 헤더 문구(스크린리더 전용 상태·우선순위·작업은 뺀다)를 순서대로. */
async function visibleHeaders(page: Page, scope: string) {
  return page.locator(`${scope} th`).evaluateAll((ths) =>
    ths
      .filter((th) => !th.querySelector('.sr-only') && (th.textContent ?? '').trim() !== '')
      .map((th) => (th.textContent ?? '').trim()),
  );
}

/** 선택 열 셀 검증 — 평면·사이클 구간이 같은 셀 렌더러를 쓰는지 같은 기대값으로 본다. */
async function expectSelectedCells(page: Page) {
  const row = page.getByTestId('issue-row-1').first();
  await expect(row.getByTestId('issue-row-1-due')).toHaveText('10월 21일');
  const closed = row.getByTestId('issue-row-1-closed');
  await expect(closed).toContainText('✓ 10월 23일');
  await expect(closed).toContainText('+2일');
  // 스크린리더용 구분어(sr-only) — 날짜와 「+2일」 이 붙어 읽히지 않는다.
  await expect(closed).toContainText('10월 23일, 마감 +2일');
  // 셀 툴팁에 시각·완료·늦음이 함께 — 말줄임이 「+2일」 을 가려도 값을 볼 수 있다.
  await expect(closed.locator('xpath=ancestor::td[1]')).toHaveAttribute('title', /^2026-10-23 \d{2}:\d{2} 완료 · 마감 \+2일$/);
  await expect(row.getByTestId('issue-row-1-closed-late')).toHaveText('+2일');
  await expect(row.getByTestId('issue-row-1-closed-late')).toHaveClass(/text-warning-text/);
  await expect(row.getByTestId('issue-row-1-reporter')).toContainText('이진우');
  await expect(row.getByTestId('issue-row-1-cycle')).toHaveText('GW-3 +1');
  await expect(row.getByTestId('issue-row-1-cycle')).toHaveAttribute('title', 'GW-3, GW-2');
  await expect(row.getByTestId('issue-row-1-cf7')).toHaveText('한빛');
  // 우선순위는 ID 왼쪽 그대로.
  await expect(row.getByLabel('우선순위 높음')).toBeVisible();
}

const EXPECTED_HEADERS = ['ID', '제목', '담당자', '마감', '완료일', '보고자', '사이클', '고객사'];

test.describe('이슈 목록 열 정의 (WP-270)', () => {
  test('평면 목록 — URL cols 의 선택 열이 정해진 순서로 헤더·셀에 보인다', async ({ authenticatedPage: page }) => {
    await setup(page);
    await page.goto(`/projects/${KEY}?group=none&cols=${COLS}`);
    await expect(page.getByTestId('issue-row-1')).toBeVisible();
    await expect.poll(() => visibleHeaders(page, 'thead')).toEqual(EXPECTED_HEADERS);
    await expectSelectedCells(page);
  });

  test('사이클 구간 목록 — 상단 열 이름 행과 구간 표가 같은 열 정의를 쓴다', async ({ authenticatedPage: page }) => {
    await setup(page, { cycles: [CYCLE] });
    await page.goto(`/projects/${KEY}?cols=${COLS}`);
    await expect(page.getByTestId('list-cycle-section-cycle-3').getByTestId('issue-row-1')).toBeVisible();
    // 보이는 열 이름 행은 목록 상단에 한 번(구간 표의 헤더는 높이 0 · sr-only).
    await expect
      .poll(() => visibleHeaders(page, '[data-testid="list-cycle-column-head"]'))
      .toEqual(EXPECTED_HEADERS);
    await expectSelectedCells(page);
    // 모든 구간 표의 열 수가 상단 열 이름 행과 같다(정렬 유지) — 고정 5칸 + 선택 7칸.
    await expect(page.locator('[data-testid="list-cycle-column-head"] th')).toHaveCount(12);
    await expect(page.getByTestId('list-cycle-section-cycle-3').locator('thead th')).toHaveCount(12);
  });

  test('열을 많이 켜면 제목 칸은 최소 16rem 을 지키고 표가 가로 스크롤된다 — 평면·사이클 구간', async ({ authenticatedPage: page }) => {
    const ALL = 'priority,assignee,due,closed,start,created,updated,reporter,milestone,cycle,cf7,cf8';
    await page.setViewportSize({ width: 1280, height: 800 });
    await setup(page, { cycles: [CYCLE] });

    // 평면 — 표 스크롤 영역(issue-list-scroll)이 가로로 넘친다.
    await page.goto(`/projects/${KEY}?group=none&cols=${ALL}`);
    await expect(page.getByTestId('issue-row-1')).toBeVisible();
    await expect(async () => {
      const scroll = page.getByTestId('issue-list-scroll');
      const { sw, cw } = await scroll.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      expect(sw).toBeGreaterThan(cw);
      const title = await page.getByRole('columnheader', { name: '제목' }).boundingBox();
      expect(title!.width).toBeGreaterThanOrEqual(256);
    }).toPass();

    // 사이클 구간 — 구간 표(table-fixed)의 제목 칸도 같은 하한, 상단 열 이름 행과 구간 행의 칸 위치가 맞는다.
    await page.goto(`/projects/${KEY}?cols=${ALL}`);
    const row = page.getByTestId('list-cycle-section-cycle-3').getByTestId('issue-row-1');
    await expect(row).toBeVisible();
    await expect(async () => {
      const link = await row.getByRole('link', { name: '결제 모듈 개편' }).boundingBox();
      const head = page.locator('[data-testid="list-cycle-column-head"] th', { hasText: '제목' });
      const headBox = await head.boundingBox();
      expect(headBox!.width).toBeGreaterThanOrEqual(256);
      // 제목 링크가 열 이름 「제목」 칸 안에서 시작한다(열 정렬).
      expect(link!.x).toBeGreaterThanOrEqual(headBox!.x - 1);
      expect(link!.x).toBeLessThan(headBox!.x + headBox!.width);
      const cf8Head = await page
        .locator('[data-testid="list-cycle-column-head"] th', { hasText: '예상 공수' })
        .boundingBox();
      const cf8Cell = await row.getByTestId('issue-row-1-cf8').boundingBox();
      expect(Math.abs(cf8Cell!.x - cf8Head!.x)).toBeLessThanOrEqual(1);
    }).toPass();
  });

  test('좁은 데스크톱(1024px)에서 완료일 필터로 열이 늘어 가로 스크롤돼도 구간 헤더·일괄 작업 바는 보이는 폭 안에 있다', async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    // 1280px 미만이면 작업 관리 사이드바가 아이콘 줄로 접혀(WP-506) 목록 폭이 넓어진다 — 에픽 패널을 켜 둔 채 일하는
    // 흔한 상태로 목록을 좁혀 가로 스크롤 조건을 만든다.
    await page.addInitScript(() => localStorage.setItem('epicSidePanel.open.WP', 'true'));
    await setup(page, { cycles: [CYCLE] });
    // 완료일 필터 → 완료일 열 자동 추가 → 제목 하한·가로 스크롤 하한이 켜진다.
    await page.goto(`/projects/${KEY}?closedIn=last-week`);
    const list = page.getByTestId('issue-cycle-grouped-list');
    const row = page.getByTestId('list-cycle-section-cycle-3').getByTestId('issue-row-1');
    await expect(row).toBeVisible();
    // 스크롤 컨테이너 = 목록을 감싼 슬롯(ProjectDetailPage overflow-auto).
    const slot = list.locator('xpath=..');
    const inView = async (testId: string) => {
      const sb = (await slot.boundingBox())!;
      const clientWidth = await slot.evaluate((el) => el.clientWidth);
      const b = (await page.getByTestId(testId).boundingBox())!;
      expect(b.x, `${testId} 왼쪽`).toBeGreaterThanOrEqual(sb.x - 1);
      expect(b.x + b.width, `${testId} 오른쪽`).toBeLessThanOrEqual(sb.x + clientWidth + 1);
    };
    await expect(async () => {
      const { sw, cw } = await slot.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      expect(sw, '가로 스크롤이 생기는 조건').toBeGreaterThan(cw);
      await inView('list-cycle-period-cycle-3');
      await inView('cycle-progress-3');
    }).toPass();

    // 행을 고르면 일괄 작업 바도 보이는 폭 안.
    await row.getByTestId('select-issue-1').check();
    await expect(page.getByTestId('issue-bulk-toolbar')).toBeVisible();
    await expect(async () => {
      await inView('issue-bulk-toolbar');
    }).toPass();

    // 끝까지 가로 스크롤해도 헤더 메타·바는 왼쪽에 붙어 화면 안에 남는다(sticky left).
    await slot.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await expect(async () => {
      expect(await slot.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
      await inView('cycle-progress-3');
      await inView('issue-bulk-toolbar');
    }).toPass();
  });

  test('사이클 구간(table-fixed)에서 지난해 완료일이 칸을 넘치면 다음 칸으로 번지지 않고 잘린다', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const lastYear = { ...ISSUE, dueDate: '2025-10-21', closedAt: '2025-10-23T05:05:00Z' };
    await setup(page, { cycles: [CYCLE], issue: lastYear });
    await page.goto(`/projects/${KEY}?cols=${COLS}`);
    const closed = page.getByTestId('list-cycle-section-cycle-3').getByTestId('issue-row-1-closed');
    await expect(closed).toContainText('2025년 10월 23일');
    const td = closed.locator('xpath=ancestor::td[1]');
    // 내용이 칸보다 넓지만(scrollWidth > clientWidth) 칸이 잘라 낸다(overflow hidden + 말줄임), 툴팁엔 정확한 값.
    const m = await td.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { sw: el.scrollWidth, cw: el.clientWidth, overflow: cs.overflowX, ellipsis: cs.textOverflow };
    });
    expect(m.sw).toBeGreaterThan(m.cw);
    expect(m.overflow).toBe('hidden');
    expect(m.ellipsis).toBe('ellipsis');
    // 툴팁엔 정확한 시각 + 완료 + 늦음 — 말줄임이 「+N일」 을 가려도 값을 볼 수 있다.
    await expect(td).toHaveAttribute('title', /^2025-10-23 \d{2}:\d{2} 완료 · 마감 \+2일$/);
  });

  test('그룹 목록(group=status)에서 선택 열이 늘면 그룹 헤더 colSpan 이 헤더 칸 수와 같다', async ({ authenticatedPage: page }) => {
    await setup(page);
    await page.goto(`/projects/${KEY}?group=status&cols=${COLS}`);
    await expect(page.getByTestId('issue-row-1')).toBeVisible();
    const groupCell = page.locator('tbody[data-testid^="list-group-"] > tr').first().locator('td');
    await expect(groupCell).toHaveAttribute('colspan', String(await page.locator('thead th').count()));
    await expect(page.locator('thead th')).toHaveCount(12);
  });

  test('cols= (빈 값)이면 선택 열이 모두 꺼진다 — 우선순위·담당자·마감 헤더 없음', async ({ authenticatedPage: page }) => {
    await setup(page);
    await page.goto(`/projects/${KEY}?group=none&cols=`);
    const row = page.getByTestId('issue-row-1');
    await expect(row).toBeVisible();
    await expect.poll(() => visibleHeaders(page, 'thead')).toEqual(['ID', '제목']);
    await expect(page.locator('thead th', { hasText: '우선순위' })).toHaveCount(0);
    await expect(row.getByTestId('issue-row-1-due')).toHaveCount(0);
    await expect(row.getByLabel('우선순위 높음')).toHaveCount(0);
  });

  test('cols 가 없으면 지금과 같은 기본 열 — 우선순위·ID·제목·담당자·마감', async ({ authenticatedPage: page }) => {
    await setup(page);
    await page.goto(`/projects/${KEY}?group=none`);
    const row = page.getByTestId('issue-row-1');
    await expect(row).toBeVisible();
    await expect.poll(() => visibleHeaders(page, 'thead')).toEqual(['ID', '제목', '담당자', '마감']);
    await expect(page.locator('thead th .sr-only', { hasText: '우선순위' })).toHaveCount(1);
    await expect(row.getByLabel('우선순위 높음')).toBeVisible();
    // 날짜는 같은 해면 연도 생략(스펙 4.6), 마우스를 올리면 정확한 값.
    await expect(row.getByTestId('issue-row-1-due')).toHaveText('10월 21일');
    await expect(row.getByTestId('issue-row-1-due')).toHaveAttribute('title', '2026-10-21');
    await expect(row.getByTestId('issue-row-1-closed')).toHaveCount(0);
  });
});

// ── 열 메뉴·개인 저장·저장된 뷰·완료일 자동 열(WP-270 Task 9) ──
// 무엇을: 「▦ 열」 메뉴로 고른 열이 표에 반영되고 개인 저장값으로 새로고침 뒤에도 남는지(URL 은 그대로),
//        완료일 필터가 걸리면 완료일 열이 자동으로 보이고 메뉴가 「필터로 켜짐」을 보이는지,
//        저장된 뷰는 「현재 열 구성도 함께 저장」을 켰을 때만 cols 를 담고(사용자 결정, 스펙 4.7), 담은 뷰만 열까지 비교하는지.
// 왜: 열 구성은 URL·개인 저장값·저장된 뷰 세 곳에 걸쳐 있어, 한 곳이 어긋나면 예전 뷰가 「수정됨」으로 보이거나 고른 열이 사라진다.

/** 저장된 뷰 목 — 서버 상태 배열을 GET/POST/PATCH 가 공유한다(setup 의 빈 목록 목보다 나중에 등록해 우선한다). */
async function mockSavedViews(page: Page, views: SavedViewResponse[]) {
  const json = (status: number, body: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route(`**/api/v1/projects/${KEY}/saved-views`, async (route) => {
    const m = route.request().method();
    if (m === 'GET') return route.fulfill(json(200, views));
    if (m === 'POST') {
      const body = route.request().postDataJSON() as { name: string; query: string; visibility: SavedViewResponse['visibility'] };
      const created: SavedViewResponse = {
        id: views.length + 1, name: body.name, query: body.query, visibility: body.visibility,
        ownerId: 1, mine: true, pinned: false, createdAt: '', updatedAt: '',
      };
      views.push(created);
      return route.fulfill(json(201, created));
    }
    return route.fallback();
  });
  // 「뷰 업데이트」 — PATCH /saved-views/{id}. 저장된 쿼리를 바꿔 다시 불러온 목록에도 반영한다.
  await page.route(`**/api/v1/projects/${KEY}/saved-views/*`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const id = Number(new URL(route.request().url()).pathname.split('/').pop());
    const body = route.request().postDataJSON() as { name: string; query: string; visibility: SavedViewResponse['visibility'] };
    const i = views.findIndex((v) => v.id === id);
    views[i] = { ...views[i], ...body };
    return route.fulfill(json(200, views[i]));
  });
}

function savedView(id: number, name: string, query: string): SavedViewResponse {
  return { id, name, query, visibility: 'PRIVATE', ownerId: 1, mine: true, pinned: false, createdAt: '', updatedAt: '' };
}

/** 개인 열 저장값(localStorage 의 issue-list-columns* 항목) 스냅샷 — 뷰 안의 열 변경이 개인 설정을 건드리지 않는지 비교한다. */
async function personalColumnsStorage(page: Page) {
  return page.evaluate(() =>
    Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.includes('issue-list-columns'))),
  );
}

/** 열 메뉴에서 한 항목을 토글한다(메뉴는 고른 뒤에도 열려 있다 → Escape 로 닫는다). */
async function toggleColumn(page: Page, key: string) {
  await page.getByTestId('issue-column-picker').click();
  await page.getByTestId(`issue-column-option-${key}`).click();
  await page.keyboard.press('Escape');
}

test.describe('이슈 목록 열 고르기 메뉴 (WP-270)', () => {
  test('「열」에서 보고자를 켜면 표에 보이고, 새로고침 뒤에도 남으며 URL 엔 cols 가 없다 — 「기본 열로 되돌리기」로 원래대로', async ({
    authenticatedPage: page,
  }) => {
    await setup(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await expect(page.getByTestId('issue-row-1')).toBeVisible();

    // 메뉴 — 제목·기본 켜짐 항목 체크 상태.
    await page.getByTestId('issue-column-picker').click();
    await expect(page.getByTestId('issue-column-menu')).toContainText('표시할 열');
    await expect(page.getByTestId('issue-column-option-assignee')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('issue-column-option-reporter')).toHaveAttribute('aria-checked', 'false');
    // 메뉴를 연 뒤 커스텀 필드 정의를 불러와 후보로 보인다.
    await expect(page.getByTestId('issue-column-option-cf7')).toHaveText('고객사');
    await page.getByTestId('issue-column-option-reporter').click();
    // 고른 뒤에도 메뉴는 열려 있다(여러 열을 연달아 고르게).
    await expect(page.getByTestId('issue-column-option-reporter')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');

    await expect.poll(() => visibleHeaders(page, 'thead')).toEqual(['ID', '제목', '담당자', '마감', '보고자']);
    await expect(page.getByTestId('issue-row-1-reporter')).toContainText('이진우');
    expect(new URL(page.url()).searchParams.has('cols')).toBe(false);

    // 개인 저장값 — 새로고침 뒤에도 같은 열.
    await page.reload();
    await expect(page.getByTestId('issue-row-1')).toBeVisible();
    await expect.poll(() => visibleHeaders(page, 'thead')).toEqual(['ID', '제목', '담당자', '마감', '보고자']);
    expect(new URL(page.url()).searchParams.has('cols')).toBe(false);

    // 필터를 바꿔도 열은 그대로.
    await page.getByTestId('add-filter-trigger').click();
    await page.getByTestId('add-filter-facet-priority').click();
    await page.getByTestId('facet-value-priority-HIGH').click();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/priority=HIGH/);
    await expect.poll(() => visibleHeaders(page, 'thead')).toEqual(['ID', '제목', '담당자', '마감', '보고자']);

    // 기본 열로 되돌리기.
    await page.getByTestId('issue-column-picker').click();
    await page.getByTestId('issue-column-reset').click();
    await expect.poll(() => visibleHeaders(page, 'thead')).toEqual(['ID', '제목', '담당자', '마감']);
    await page.reload();
    await expect(page.getByTestId('issue-row-1')).toBeVisible();
    await expect.poll(() => visibleHeaders(page, 'thead')).toEqual(['ID', '제목', '담당자', '마감']);
  });

  test('완료일 필터 「지난 주」를 걸면 완료일 열이 자동으로 보이고 메뉴엔 「필터로 켜짐」, 필터를 풀면 사라진다', async ({
    authenticatedPage: page,
  }) => {
    await setup(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await expect(page.getByTestId('issue-row-1')).toBeVisible();
    await expect(page.getByTestId('issue-row-1-closed')).toHaveCount(0);

    await page.getByTestId('add-filter-trigger').click();
    await page.getByTestId('add-filter-facet-closedIn').click();
    await page.getByTestId('facet-value-closedIn-last-week').click();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/closedIn=last-week/);

    await expect.poll(() => visibleHeaders(page, 'thead')).toEqual(['ID', '제목', '담당자', '마감', '완료일']);
    await expect(page.getByTestId('issue-row-1-closed')).toContainText('✓ 10월 23일');
    await page.getByTestId('issue-column-picker').click();
    const closedOption = page.getByTestId('issue-column-option-closed');
    await expect(closedOption).toHaveAttribute('aria-checked', 'true');
    await expect(closedOption).toHaveAttribute('data-disabled', '');
    await expect(closedOption).toContainText('필터로 켜짐');
    // 스크린리더 이름이 「완료일필터로 켜짐」 으로 붙지 않는다.
    await expect(closedOption).toHaveAccessibleName(/^완료일\s*,\s*필터로 켜짐$/);
    await page.keyboard.press('Escape');
    // 자동 열은 개인 저장값·URL 에 남지 않는다.
    expect(new URL(page.url()).searchParams.has('cols')).toBe(false);

    await page.getByTestId('filter-chip-closedIn-remove').click();
    await expect(page).not.toHaveURL(/closedIn=/);
    await expect.poll(() => visibleHeaders(page, 'thead')).toEqual(['ID', '제목', '담당자', '마감']);
    await page.getByTestId('issue-column-picker').click();
    await expect(page.getByTestId('issue-column-option-closed')).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('issue-column-option-closed')).not.toContainText('필터로 켜짐');
  });

  test('뷰 저장 — 「현재 열 구성도 함께 저장」은 기본 꺼짐이라 POST query 에 cols 가 없고, 그 뷰를 열면 각자 개인 열로 보인다', async ({
    authenticatedPage: page,
  }) => {
    await setup(page);
    await mockSavedViews(page, []);
    await page.goto(`/projects/${KEY}?group=none&priority=HIGH`);
    await expect(page.getByTestId('issue-row-1')).toBeVisible();
    await toggleColumn(page, 'reporter');
    await expect.poll(() => visibleHeaders(page, 'thead')).toEqual(['ID', '제목', '담당자', '마감', '보고자']);

    const posted = page.waitForRequest((r) => r.url().endsWith(`/projects/${KEY}/saved-views`) && r.method() === 'POST');
    await page.getByTestId('save-view-button').click();
    // 체크박스는 꺼진 채 시작하고, 지금 고른 열을 헤더 문구로 알려 준다.
    const include = page.getByTestId('save-view-include-columns');
    await expect(include).not.toBeChecked();
    await expect(page.getByTestId('save-view-columns-hint')).toHaveText('(우선순위·담당자·마감·보고자)');
    await page.getByTestId('save-view-name').fill('높음');
    await page.getByTestId('save-view-submit').click();
    const query = new URLSearchParams((((await posted).postDataJSON()) as { query: string }).query);
    expect(query.has('cols')).toBe(false);
    expect(query.get('priority')).toBe('HIGH');
    await expect(page.getByTestId('view-chip-1')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('update-view-button')).toHaveCount(0);

    // 다른 개인 열(마일스톤 추가)로 바꾼 뒤 그 뷰를 열어도 뷰가 열을 담지 않았으니 개인 열 그대로.
    await page.getByTestId('view-chip-all').click();
    await toggleColumn(page, 'milestone');
    await page.getByTestId('view-chip-1').click();
    await expect(page).toHaveURL(/priority=HIGH/);
    expect(new URL(page.url()).searchParams.has('cols')).toBe(false);
    await expect.poll(() => visibleHeaders(page, 'thead')).toEqual(['ID', '제목', '담당자', '마감', '보고자', '마일스톤']);
    await expect(page.getByTestId('view-chip-1')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('update-view-button')).toHaveCount(0);
  });

  test('「현재 열 구성도 함께 저장」을 켜면 POST query 에 고른 열(자동 완료일 열 제외)이 실리고, 그 뷰에서 열만 바꿔도 「뷰 업데이트」로 새 열이 저장된다', async ({
    authenticatedPage: page,
  }) => {
    await setup(page);
    const views: SavedViewResponse[] = [];
    await mockSavedViews(page, views);
    await page.goto(`/projects/${KEY}?group=none&priority=HIGH&closedIn=last-week`);
    await expect(page.getByTestId('issue-row-1')).toBeVisible();
    await toggleColumn(page, 'reporter');
    await expect.poll(() => visibleHeaders(page, 'thead')).toEqual(['ID', '제목', '담당자', '마감', '완료일', '보고자']);

    const posted = page.waitForRequest((r) => r.url().endsWith(`/projects/${KEY}/saved-views`) && r.method() === 'POST');
    await page.getByTestId('save-view-button').click();
    // 힌트는 고른 열만 — 완료일 필터로 자동으로 붙은 완료일 열은 저장 대상이 아니다.
    await expect(page.getByTestId('save-view-columns-hint')).toHaveText('(우선순위·담당자·마감·보고자)');
    await page.getByTestId('save-view-include-columns').check();
    await page.getByTestId('save-view-name').fill('보고자 보기');
    await page.getByTestId('save-view-submit').click();
    const query = new URLSearchParams((((await posted).postDataJSON()) as { query: string }).query);
    expect(query.get('cols')).toBe('priority,assignee,due,reporter');
    expect(query.get('priority')).toBe('HIGH');
    expect(query.get('closedIn')).toBe('last-week');
    // 저장 직후 이 뷰가 활성이고 「수정됨」이 아니다.
    await expect(page.getByTestId('view-chip-1')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('update-view-button')).toHaveCount(0);

    // 개인 열을 기본으로 되돌린 뒤 뷰를 열면 뷰에 담긴 열로 보인다.
    await page.getByTestId('view-chip-all').click();
    await page.getByTestId('issue-column-picker').click();
    await page.getByTestId('issue-column-reset').click();
    await expect.poll(() => visibleHeaders(page, 'thead')).toEqual(['ID', '제목', '담당자', '마감']);
    await page.getByTestId('view-chip-1').click();
    await expect.poll(() => new URL(page.url()).searchParams.get('cols')).toBe('priority,assignee,due,reporter');
    await expect.poll(() => visibleHeaders(page, 'thead')).toEqual(['ID', '제목', '담당자', '마감', '완료일', '보고자']);
    await expect(page.getByTestId('update-view-button')).toHaveCount(0);

    // 열만 바꿔도 이 뷰는 「수정됨」 → 「뷰 업데이트」가 새 열을 저장한다.
    await toggleColumn(page, 'milestone');
    await expect(page.getByTestId('update-view-button')).toBeVisible();
    const patched = page.waitForRequest((r) => r.url().endsWith(`/projects/${KEY}/saved-views/1`) && r.method() === 'PATCH');
    await page.getByTestId('update-view-button').click();
    const updated = new URLSearchParams((((await patched).postDataJSON()) as { query: string }).query);
    expect(updated.get('cols')).toBe('priority,assignee,due,reporter,milestone');
    expect(updated.get('priority')).toBe('HIGH');
    // 갱신된 뷰와 다시 일치 — 「뷰 업데이트」가 사라진다.
    await expect(page.getByTestId('update-view-button')).toHaveCount(0);
    await expect(page.getByTestId('view-chip-1')).toHaveAttribute('aria-pressed', 'true');
  });

  test('cols 없는 예전 뷰 — 열면 개인 열로 보이고, 열을 바꿔도 「뷰 업데이트」(수정됨)가 뜨지 않는다', async ({ authenticatedPage: page }) => {
    await setup(page);
    await mockSavedViews(page, [savedView(1, '높음', 'priority=HIGH&group=none')]);
    await page.goto(`/projects/${KEY}?group=none`);
    await expect(page.getByTestId('issue-row-1')).toBeVisible();
    // 개인 열: 기본 + 보고자.
    await toggleColumn(page, 'reporter');
    await expect.poll(() => visibleHeaders(page, 'thead')).toEqual(['ID', '제목', '담당자', '마감', '보고자']);

    await page.getByTestId('view-chip-1').click();
    await expect(page).toHaveURL(/priority=HIGH/);
    expect(new URL(page.url()).searchParams.has('cols')).toBe(false);
    await expect(page.getByTestId('view-chip-1')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => visibleHeaders(page, 'thead')).toEqual(['ID', '제목', '담당자', '마감', '보고자']);
    await expect(page.getByTestId('update-view-button')).toHaveCount(0);

    // 열을 바꾸면 개인 저장값이 바뀌고(URL 엔 cols 없음) 뷰는 그대로 활성 — 열을 담지 않은 뷰라 비교하지 않는다.
    await toggleColumn(page, 'milestone');
    await expect.poll(() => visibleHeaders(page, 'thead')).toEqual(['ID', '제목', '담당자', '마감', '보고자', '마일스톤']);
    expect(new URL(page.url()).searchParams.has('cols')).toBe(false);
    await expect(page.getByTestId('view-chip-1')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('update-view-button')).toHaveCount(0);
  });

  test('cols 를 담은 뷰 안의 「기본 열로 되돌리기」는 그 화면 열만 기본으로 — 개인 열은 남고, 열 없는 뷰로 옮기면 개인 열로 보인다', async ({
    authenticatedPage: page,
  }) => {
    await setup(page);
    await mockSavedViews(page, [
      savedView(1, '마일스톤 보기', 'priority=HIGH&group=none&cols=assignee,milestone'),
      savedView(2, '중간', 'priority=MID&group=none'),
    ]);
    await page.goto(`/projects/${KEY}?group=none`);
    await expect(page.getByTestId('issue-row-1')).toBeVisible();
    await toggleColumn(page, 'reporter');
    await expect.poll(() => visibleHeaders(page, 'thead')).toEqual(['ID', '제목', '담당자', '마감', '보고자']);

    await page.getByTestId('view-chip-1').click();
    await expect.poll(() => new URL(page.url()).searchParams.get('cols')).toBe('assignee,milestone');
    await expect.poll(() => visibleHeaders(page, 'thead')).toEqual(['ID', '제목', '담당자', '마일스톤']);

    // 뷰 안에서 되돌리기 — URL cols 가 기본 열이 되고(그래서 이 뷰는 수정됨), 개인 저장값은 지우지 않는다.
    await page.getByTestId('issue-column-picker').click();
    await page.getByTestId('issue-column-reset').click();
    await expect.poll(() => new URL(page.url()).searchParams.get('cols')).toBe('priority,assignee,due');
    await expect.poll(() => visibleHeaders(page, 'thead')).toEqual(['ID', '제목', '담당자', '마감']);
    await expect(page.getByTestId('update-view-button')).toBeVisible();

    // cols 를 담지 않은 뷰로 옮기면 URL cols 가 빠지고 개인 열(보고자 포함)이 그대로 보인다.
    await page.getByTestId('view-chip-2').click();
    await expect(page).toHaveURL(/priority=MID/);
    expect(new URL(page.url()).searchParams.has('cols')).toBe(false);
    await expect.poll(() => visibleHeaders(page, 'thead')).toEqual(['ID', '제목', '담당자', '마감', '보고자']);
    await expect(page.getByTestId('view-chip-2')).toHaveAttribute('aria-pressed', 'true');
  });

  test('필터가 같은 두 뷰(열 담음·안 담음) — 열을 담은 뷰에서 열만 바꾸면 그 뷰가 수정됨으로 남고 다른 뷰로 넘어가지 않는다', async ({
    authenticatedPage: page,
  }) => {
    await setup(page);
    await mockSavedViews(page, [
      savedView(1, '높음', 'priority=HIGH&group=none'),
      savedView(2, '높음 + 열', 'priority=HIGH&group=none&cols=assignee,milestone'),
    ]);
    await page.goto(`/projects/${KEY}?group=none`);
    await expect(page.getByTestId('issue-row-1')).toBeVisible();

    await page.getByTestId('view-chip-2').click();
    await expect(page.getByTestId('view-chip-2')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('view-chip-1')).toHaveAttribute('aria-pressed', 'false');

    await toggleColumn(page, 'reporter');
    await expect.poll(() => new URL(page.url()).searchParams.get('cols')).toBe('assignee,reporter,milestone');
    await expect(page.getByTestId('update-view-button')).toBeVisible();
    // 필터만 같은 다른 뷰(열 안 담음)가 활성으로 잡히지 않는다.
    await expect(page.getByTestId('view-chip-1')).toHaveAttribute('aria-pressed', 'false');
    const patched = page.waitForRequest((r) => r.method() === 'PATCH');
    await page.getByTestId('update-view-button').click();
    expect((await patched).url()).toMatch(/\/saved-views\/2$/);
  });

  test('cols 를 담은 뷰를 열고 필터를 바꿔도 URL cols 는 유지되고, 「전체」로 돌아가면 개인 열로', async ({
    authenticatedPage: page,
  }) => {
    await setup(page);
    await mockSavedViews(page, [savedView(1, '마일스톤 보기', 'priority=HIGH&group=none&cols=assignee,milestone')]);
    await page.goto(`/projects/${KEY}?group=none`);
    await expect(page.getByTestId('issue-row-1')).toBeVisible();

    await page.getByTestId('view-chip-1').click();
    await expect(page).toHaveURL(/cols=assignee%2Cmilestone|cols=assignee,milestone/);
    await expect.poll(() => visibleHeaders(page, 'thead')).toEqual(['ID', '제목', '담당자', '마일스톤']);
    await expect(page.getByTestId('view-chip-1')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('update-view-button')).toHaveCount(0);

    // 필터를 바꾸면 수정됨이 되지만 URL cols 는 남는다.
    await page.getByTestId('add-filter-trigger').click();
    await page.getByTestId('add-filter-facet-priority').click();
    await page.getByTestId('facet-value-priority-MID').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('update-view-button')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('cols')).toBe('assignee,milestone');

    // 「전체」로 돌아가면 cols 가 빠져 개인 열(기본)로.
    await page.getByTestId('view-chip-all').click();
    await expect(page).not.toHaveURL(/cols=/);
    await expect.poll(() => visibleHeaders(page, 'thead')).toEqual(['ID', '제목', '담당자', '마감']);
  });

  test('열을 담아 새 뷰를 저장하면 URL 에도 그 열이 실린다 — 바로 열을 바꿔도 「뷰 업데이트」가 뜨고 개인 열 저장값은 그대로', async ({
    authenticatedPage: page,
  }) => {
    await setup(page);
    await mockSavedViews(page, []);
    await page.goto(`/projects/${KEY}?group=none&priority=HIGH`);
    await expect(page.getByTestId('issue-row-1')).toBeVisible();
    await toggleColumn(page, 'reporter');
    await expect.poll(() => visibleHeaders(page, 'thead')).toEqual(['ID', '제목', '담당자', '마감', '보고자']);
    const personal = await personalColumnsStorage(page);
    expect(Object.keys(personal)).toHaveLength(1);

    await page.getByTestId('save-view-button').click();
    await page.getByTestId('save-view-include-columns').check();
    await page.getByTestId('save-view-name').fill('보고자 보기');
    await page.getByTestId('save-view-submit').click();
    // 저장 직후 화면은 「그 뷰를 연 상태」 — URL 에 뷰의 열이 실린다.
    await expect.poll(() => new URL(page.url()).searchParams.get('cols')).toBe('priority,assignee,due,reporter');
    await expect(page.getByTestId('view-chip-1')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('update-view-button')).toHaveCount(0);

    // 열을 바꾸면 URL 이 바뀌고(개인 저장값은 그대로) 이 뷰가 「수정됨」.
    await toggleColumn(page, 'milestone');
    await expect.poll(() => new URL(page.url()).searchParams.get('cols')).toBe('priority,assignee,due,reporter,milestone');
    await expect(page.getByTestId('update-view-button')).toBeVisible();
    expect(await personalColumnsStorage(page)).toEqual(personal);
  });

  test('열을 담은 뷰를 「뷰 업데이트」하면 URL 에도 그 열이 실려, 뒤이은 열 변경이 개인 설정이 아니라 뷰를 바꾼다', async ({
    authenticatedPage: page,
  }) => {
    await setup(page);
    // 기본 열을 담은 뷰 — 개인 열이 기본이면 URL cols 없이도 일치해 활성이 된다.
    await mockSavedViews(page, [savedView(1, '높음', 'priority=HIGH&group=none&cols=priority,assignee,due')]);
    await page.goto(`/projects/${KEY}?group=none&priority=HIGH`);
    await expect(page.getByTestId('view-chip-1')).toHaveAttribute('aria-pressed', 'true');
    expect(new URL(page.url()).searchParams.has('cols')).toBe(false);

    // 필터를 바꿔 수정됨 → 뷰 업데이트 — 저장된 열이 URL 로 온다.
    await page.getByTestId('add-filter-trigger').click();
    await page.getByTestId('add-filter-facet-priority').click();
    await page.getByTestId('facet-value-priority-MID').click();
    await page.keyboard.press('Escape');
    const patched = page.waitForRequest((r) => r.method() === 'PATCH');
    await page.getByTestId('update-view-button').click();
    expect(new URLSearchParams((((await patched).postDataJSON()) as { query: string }).query).get('cols')).toBe('priority,assignee,due');
    await expect.poll(() => new URL(page.url()).searchParams.get('cols')).toBe('priority,assignee,due');
    await expect(page.getByTestId('update-view-button')).toHaveCount(0);

    const personal = await personalColumnsStorage(page);
    await toggleColumn(page, 'reporter');
    await expect(page.getByTestId('update-view-button')).toBeVisible();
    expect(await personalColumnsStorage(page)).toEqual(personal);
  });

  test('열을 담은 뷰에서 열 없이 새 뷰로 저장하면 URL cols 가 빠져 개인 열로 보인다', async ({ authenticatedPage: page }) => {
    await setup(page);
    await mockSavedViews(page, [savedView(1, '마일스톤 보기', 'priority=HIGH&group=none&cols=assignee,milestone')]);
    await page.goto(`/projects/${KEY}?group=none`);
    await expect(page.getByTestId('issue-row-1')).toBeVisible();
    await page.getByTestId('view-chip-1').click();
    await expect.poll(() => visibleHeaders(page, 'thead')).toEqual(['ID', '제목', '담당자', '마일스톤']);

    await page.getByTestId('add-filter-trigger').click();
    await page.getByTestId('add-filter-facet-priority').click();
    await page.getByTestId('facet-value-priority-MID').click();
    await page.keyboard.press('Escape');
    const posted = page.waitForRequest((r) => r.url().endsWith(`/projects/${KEY}/saved-views`) && r.method() === 'POST');
    await page.getByTestId('save-view-button').click();
    await expect(page.getByTestId('save-view-include-columns')).not.toBeChecked();
    await page.getByTestId('save-view-name').fill('높음·중간');
    await page.getByTestId('save-view-submit').click();
    expect(new URLSearchParams((((await posted).postDataJSON()) as { query: string }).query).has('cols')).toBe(false);
    // 새 뷰를 연 상태와 같게 — cols 가 빠지고 개인 열(기본)로.
    await expect.poll(() => new URL(page.url()).searchParams.has('cols')).toBe(false);
    await expect.poll(() => visibleHeaders(page, 'thead')).toEqual(['ID', '제목', '담당자', '마감']);
    await expect(page.getByTestId('view-chip-2')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('update-view-button')).toHaveCount(0);
  });

  for (const includeColumns of [false, true]) {
    test(`열을 담은 뷰에서 열만 바꾸고 「새 뷰로 저장」(열 ${includeColumns ? '담음' : '안 담음'}) — 새 뷰가 활성이 되고 예전 뷰는 수정됨으로 남지 않는다`, async ({
      authenticatedPage: page,
    }) => {
      await setup(page);
      await mockSavedViews(page, [savedView(1, '마일스톤 보기', 'priority=HIGH&group=none&cols=assignee,milestone')]);
      await page.goto(`/projects/${KEY}?group=none`);
      await expect(page.getByTestId('issue-row-1')).toBeVisible();
      await page.getByTestId('view-chip-1').click();
      await expect(page.getByTestId('view-chip-1')).toHaveAttribute('aria-pressed', 'true');

      // 열만 바꿔 수정됨 → 「새 뷰로 저장」.
      await toggleColumn(page, 'reporter');
      await expect(page.getByTestId('update-view-button')).toBeVisible();
      await page.getByTestId('save-view-button').click();
      if (includeColumns) await page.getByTestId('save-view-include-columns').check();
      await page.getByTestId('save-view-name').fill('새 보기');
      await page.getByTestId('save-view-submit').click();

      // 막 만든 뷰가 활성(마지막으로 고른 뷰, WP-473) — 예전 뷰는 꺼지고 「뷰 업데이트」 도 없다.
      await expect(page.getByTestId('view-chip-2')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('view-chip-1')).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByTestId('update-view-button')).toHaveCount(0);
      if (includeColumns) {
        await expect.poll(() => new URL(page.url()).searchParams.get('cols')).toBe('assignee,reporter,milestone');
      } else {
        await expect.poll(() => new URL(page.url()).searchParams.has('cols')).toBe(false);
      }
    });
  }

  test('활성 뷰가 아닌 뷰를 ⋯ 수정 「현재 필터로 갱신」 해도 지금 화면의 URL 열은 바뀌지 않는다', async ({ authenticatedPage: page }) => {
    await setup(page);
    await mockSavedViews(page, [
      savedView(1, '마일스톤 보기', 'priority=HIGH&group=none&cols=assignee,milestone'),
      // 열을 담지 않은 뷰 — 갱신 뒤 URL 을 이 뷰에 맞추면 지금 화면의 cols 가 빠져 버린다.
      savedView(2, '중간', 'priority=MID&group=none'),
    ]);
    await page.goto(`/projects/${KEY}?group=none`);
    await expect(page.getByTestId('issue-row-1')).toBeVisible();
    await page.getByTestId('view-chip-1').click();
    await expect.poll(() => new URL(page.url()).searchParams.get('cols')).toBe('assignee,milestone');

    const patched = page.waitForRequest((r) => r.method() === 'PATCH');
    await page.getByTestId('view-chip-menu-2').click();
    await page.getByTestId('view-edit-2').click();
    await page.getByTestId('save-view-update-query').check();
    await page.getByTestId('save-view-submit').click();
    expect((await patched).url()).toMatch(/\/saved-views\/2$/);
    await expect(page.getByTestId('save-view-submit')).toHaveCount(0);
    // 지금 화면(뷰 1)의 열은 그대로.
    expect(new URL(page.url()).searchParams.get('cols')).toBe('assignee,milestone');
    await expect.poll(() => visibleHeaders(page, 'thead')).toEqual(['ID', '제목', '담당자', '마일스톤']);
  });

  test('보드 뷰에선 「열」 버튼이 없다', async ({ authenticatedPage: page }) => {
    await setup(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await expect(page.getByTestId('issue-column-picker')).toBeVisible();
    await page.getByRole('button', { name: '보드' }).click();
    await expect(page).toHaveURL(/view=board/);
    await expect(page.getByTestId('issue-column-picker')).toHaveCount(0);
  });
});

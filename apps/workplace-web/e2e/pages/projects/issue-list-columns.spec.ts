// 이슈 목록 열 고르기 E2E(WP-270) — 브라우저가 있어야 판정되는 것만 남긴다.
// 남는 것: 열을 많이 켰을 때 제목 하한·가로 스크롤·칸 정렬, 좁은 폭의 sticky 헤더 메타·일괄 작업 바, 지난해 완료일 말줄임(@layout),
//          「열」 메뉴로 고른 개인 열이 새로고침 뒤에도 남는지(@platform).
// URL cols 헤더·셀 렌더, 빈 cols·기본 열, 그룹 colSpan, 완료일 자동 열, 저장된 뷰와 열(POST·PATCH·수정됨·URL cols), 보드의 「열」 없음은
// 페이지 테스트 src/pages/projects/issueListColumns.test.tsx 가 지킨다(WP-980).
// 날짜는 같은 해면 연도를 생략하므로(스펙 4.6) 현재 시각을 2026-10-23(서울)로 고정한다.
import type { Page } from '@playwright/test';

import type { IssueFieldDef } from '../../../src/types/customField';
import type { CycleResponse } from '../../../src/types/cycle';
import type { IssueResponse } from '../../../src/types/issue';
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


test.describe('이슈 목록 열 폭·스크롤 (WP-270)', { tag: '@layout' }, () => {
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
    // group=cycle 을 적는다 — 주소에 조건이 없으면 바로 앞의 group=none 을 되살린다(WP-1035 필터·보기 기억).
    await page.goto(`/projects/${KEY}?group=cycle&cols=${ALL}`);
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

});

// ── 열 메뉴·개인 저장·저장된 뷰·완료일 자동 열(WP-270 Task 9) ──
// 무엇을: 「▦ 열」 메뉴로 고른 열이 표에 반영되고 개인 저장값으로 새로고침 뒤에도 남는지(URL 은 그대로),
//        완료일 필터가 걸리면 완료일 열이 자동으로 보이고 메뉴가 「필터로 켜짐」을 보이는지,
//        저장된 뷰는 「현재 열 구성도 함께 저장」을 켰을 때만 cols 를 담고(사용자 결정, 스펙 4.7), 담은 뷰만 열까지 비교하는지.
// 왜: 열 구성은 URL·개인 저장값·저장된 뷰 세 곳에 걸쳐 있어, 한 곳이 어긋나면 예전 뷰가 「수정됨」으로 보이거나 고른 열이 사라진다.

test.describe('이슈 목록 열 고르기 — 개인 저장 (WP-270)', { tag: '@platform' }, () => {
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
    await page.getByTestId('quick-filter-priority-trigger').click();
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
});

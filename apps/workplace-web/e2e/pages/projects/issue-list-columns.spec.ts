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

// 첫 목록 그리기 대기 — 워커마다 처음 여는 화면은 dev 서버의 첫 변환을 기다려, 부하 속 커밋 훅에서 기본 10초를 넘겼다(WP-1648).
// 판정은 그대로 두고 첫 로드 대기와 테스트 한도만 늘린다.
const FIRST_LOAD = { timeout: 30_000 };
test.describe.configure({ timeout: 60_000 });

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
async function setup(page: Page, { cycles = [] as CycleResponse[], issue = ISSUE, issues = [] as IssueResponse[], fields = FIELD_DEFS } = {}) {
  await page.clock.setFixedTime(new Date('2026-10-23T06:00:00Z'));
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route(`**/api/v1/projects/${KEY}`, (route) => route.fulfill(json(createProject())));
  await page.route(`**/api/v1/projects/${KEY}/members`, (route) => route.fulfill(json([])));
  await page.route(`**/api/v1/projects/${KEY}/labels`, (route) => route.fulfill(json([])));
  await page.route(`**/api/v1/projects/${KEY}/saved-views`, (route) => route.fulfill(json([])));
  await page.route(`**/api/v1/projects/${KEY}/fields`, (route) => route.fulfill(json(fields)));
  await page.route(`**/api/v1/projects/${KEY}/cycles`, (route) => route.fulfill(json(cycles)));
  await page.route(`**/api/v1/projects/${KEY}/cycles/progress`, (route) => route.fulfill(json([])));
  await page.route(
    (url) => url.pathname === ISSUES_PATH,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      // 사이클 그룹은 구간별(cycle=3·null) 요청 — 진행 중 구간에만 이슈를 둔다.
      const cycle = new URL(route.request().url()).searchParams.get('cycle');
      // issues 를 주면 그 목록(긴 목록 스크롤용, WP-2068), 아니면 이슈 하나.
      return route.fulfill(json(createIssueSearchResponse(cycle === 'null' ? [] : issues.length ? issues : [issue], null)));
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
  // 평면·사이클 구간을 테스트 하나씩으로 둔다 — 한 테스트에서 goto 를 되풀이하면 부하 속 커밋 훅에서 30초 한도를 넘었다(WP-1648).
  const ALL = 'priority,assignee,due,closed,start,created,updated,reporter,milestone,cycle,cf7,cf8';

  test('열을 많이 켜면 제목 칸은 최소 16rem 을 지키고 표가 가로 스크롤된다 — 평면', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await setup(page, { cycles: [CYCLE] });

    // 평면 — 표 스크롤 영역(issue-list-scroll)이 가로로 넘친다.
    await page.goto(`/projects/${KEY}?group=none&cols=${ALL}`);
    await expect(page.getByTestId('issue-row-1')).toBeVisible(FIRST_LOAD);
    await expect(async () => {
      const scroll = page.getByTestId('issue-list-scroll');
      const { sw, cw } = await scroll.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      expect(sw).toBeGreaterThan(cw);
      const title = await page.getByRole('columnheader', { name: '제목' }).boundingBox();
      expect(title!.width).toBeGreaterThanOrEqual(256);
    }).toPass();
  });

  test('열을 많이 켜면 제목 칸은 최소 16rem 을 지키고 표가 가로 스크롤된다 — 사이클 구간', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await setup(page, { cycles: [CYCLE] });
    // 사이클 구간 — 구간 표(table-fixed)의 제목 칸도 같은 하한, 상단 열 이름 행과 구간 행의 칸 위치가 맞는다.
    await page.goto(`/projects/${KEY}?group=cycle&cols=${ALL}`);
    const row = page.getByTestId('list-cycle-section-cycle-3').getByTestId('issue-row-1');
    await expect(row).toBeVisible(FIRST_LOAD);
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
    await expect(row).toBeVisible(FIRST_LOAD);
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

  test('평면 목록에서 텍스트 커스텀 필드·마일스톤의 긴 값은 칸을 넓히지 않고 말줄임된다 — 뒤 열이 화면 밖으로 밀리지 않는다(WP-1091)', async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const LONG = '주식회사 한국가상테스트솔루션즈 서울본사 영업2팀 대외협력 담당 부서 (계약·정산·납품 일정 조율 전담 창구, 2026년 하반기 기준)';
    const longIssue = {
      ...ISSUE,
      milestoneName: `${LONG} 마일스톤`,
      customFields: [{ defId: 9, name: '고객 메모', type: 'TEXT' as const, value: LONG }],
    };
    const textDef: IssueFieldDef = { id: 9, projectId: 1, name: '고객 메모', type: 'TEXT', options: null, position: 2, createdAt: '', updatedAt: '' };
    await setup(page, { issue: longIssue, fields: [...FIELD_DEFS, textDef] });
    await page.goto(`/projects/${KEY}?group=none&cols=priority,assignee,due,milestone,cf9,reporter`);
    const cf = page.getByTestId('issue-row-1-cf9');
    await expect(cf).toContainText('주식회사', FIRST_LOAD);
    await expect(async () => {
      // 칸은 열 폭(8rem = 128px)을 넘지 않고, 안쪽 글자는 잘린다(말줄임).
      for (const id of ['issue-row-1-cf9', 'issue-row-1-milestone']) {
        const m = await page.getByTestId(id).evaluate((td) => {
          const inner = td.querySelector('.truncate')!;
          return { w: td.getBoundingClientRect().width, sw: inner.scrollWidth, cw: inner.clientWidth };
        });
        expect(m.w, `${id} 칸 폭`).toBeLessThanOrEqual(128.5);
        expect(m.sw, `${id} 말줄임`).toBeGreaterThan(m.cw);
      }
      // 마지막 열(보고자)이 목록 보이는 폭 안에 있고 표가 가로로 넘치지 않는다.
      const scroll = page.getByTestId('issue-list-scroll');
      const { sw, cw, right } = await scroll.evaluate((el) => ({
        sw: el.scrollWidth, cw: el.clientWidth, right: el.getBoundingClientRect().right,
      }));
      expect(sw).toBeLessThanOrEqual(cw);
      const reporter = await page.getByTestId('issue-row-1-reporter').boundingBox();
      expect(reporter!.x + reporter!.width).toBeLessThanOrEqual(right + 1);
    }).toPass();
    // 값 전체는 셀 툴팁으로 본다.
    await expect(cf).toHaveAttribute('title', LONG);
  });

  test('평면 목록에서 띄어쓰기 없는 긴 필드 이름(헤더)·긴 구성요소 칩·담당자 「+N」 도 칸을 넓히지 않고 옆 칸을 덮지 않는다(WP-1143)', async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // 띄어쓰기 없는 라틴 이름 — 한글은 글자 사이에서 줄바꿈돼 열을 넓히지 않지만, 라틴 낱말은 끊을 곳이 없어 옛 자동 레이아웃에선 열이 233px 로 넓어졌다.
    const LONG_NAME = 'CustomerInternalManagementFieldName';
    const user = (id: number) => ({ id, username: `u${id}`, name: `사용자${id}`, kind: 'HUMAN' as const });
    const wide = {
      ...ISSUE,
      // 열다섯 명 — 아바타 셋 + 「+12」(두 자리)가 가장 넓은 흔한 경우.
      assignees: Array.from({ length: 15 }, (_, i) => user(i + 1)),
      components: [
        { id: 1, name: 'PaymentGatewayIntegrationModule', archived: false },
        { id: 2, name: '정산배치스케줄러', archived: false },
        { id: 3, name: '알림', archived: false },
      ],
      customFields: [{ defId: 9, name: LONG_NAME, type: 'TEXT' as const, value: '짧음' }],
    } as IssueResponse;
    const longDef: IssueFieldDef = { id: 9, projectId: 1, name: LONG_NAME, type: 'TEXT', options: null, position: 2, createdAt: '', updatedAt: '' };
    await setup(page, { issue: wide, fields: [...FIELD_DEFS, longDef] });
    await page.goto(`/projects/${KEY}?group=none&cols=priority,assignee,due,components,cf9,reporter`);
    await expect(page.getByTestId('issue-row-1-cf9')).toContainText('짧음', FIRST_LOAD);
    await expect(async () => {
      // 칸 폭 = 열 폭(담당자 5rem·마감·구성요소·커스텀 필드 8rem) — 내용이 길어도 넓어지지 않는다.
      const widths = { assignee: 80, due: 128, components: 128, cf9: 128 };
      for (const [key, px] of Object.entries(widths)) {
        const box = (await page.getByTestId(`issue-row-1-${key}`).boundingBox())!;
        expect(box.width, `${key} 칸 폭`).toBeLessThanOrEqual(px + 0.5);
      }
      // 긴 필드 이름 머리는 칸 안에서 말줄임되고(툴팁에 전체), 칩은 칸 밖으로 그려지지 않는다.
      const head = page.getByRole('columnheader', { name: LONG_NAME });
      const h = await head.evaluate((th) => {
        const s = th.querySelector('.truncate')!;
        return { w: th.getBoundingClientRect().width, sw: s.scrollWidth, cw: s.clientWidth };
      });
      expect(h.w, '머리 칸 폭').toBeLessThanOrEqual(128.5);
      expect(h.sw, '머리 말줄임').toBeGreaterThan(h.cw);
      await expect(head.locator('.truncate')).toHaveAttribute('title', LONG_NAME);
      // 담당자 「+12」 가 다음 칸(마감) 왼쪽 경계를 넘지 않는다.
      const plus = (await page.getByTestId('issue-row-1-assignee').getByText('+12').boundingBox())!;
      const due = (await page.getByTestId('issue-row-1-due').boundingBox())!;
      expect(plus.x + plus.width, '「+N」 오른쪽 끝').toBeLessThanOrEqual(due.x + 0.5);
      // 표가 가로로 넘치지 않는다(뒤 열이 밀리지 않는다).
      const { sw, cw } = await page.getByTestId('issue-list-scroll').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      expect(sw).toBeLessThanOrEqual(cw);
    }).toPass();
  });

  test('사이클 구간(table-fixed)에서 지난해 완료일이 칸을 넘치면 다음 칸으로 번지지 않고 잘린다', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const lastYear = { ...ISSUE, dueDate: '2025-10-21', closedAt: '2025-10-23T05:05:00Z' };
    await setup(page, { cycles: [CYCLE], issue: lastYear });
    await page.goto(`/projects/${KEY}?cols=${COLS}`);
    const closed = page.getByTestId('list-cycle-section-cycle-3').getByTestId('issue-row-1-closed');
    await expect(closed).toContainText('2025년 10월 23일', FIRST_LOAD);
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
    // 개인 저장값이 새로고침 뒤에도 남는지 이어서 봐야 해 나눌 수 없는 한 흐름이다(로드 3번) — 부하 속 커밋 훅에서 30초 한도를 넘어(WP-1648)
    // 한도를 늘린다.
    test.slow();
    await setup(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await expect(page.getByTestId('issue-row-1')).toBeVisible(FIRST_LOAD);

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

test.describe('이슈 목록 키보드 초점과 sticky 머리글 (WP-2068)', () => {
  test('키보드로 위로 이동해도 초점이 sticky 머리글에 가려지지 않는다(WP-2068)', { tag: ['@layout', '@input'] }, async ({
    authenticatedPage: page,
  }) => {
    // 표를 벗어날 때까지(40행이면 170번 안팎) 키를 누르며 매번 재므로 부하 속 커밋 훅에서도 시간이 모자라지 않게 한도를 늘린다.
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    // 이슈 40개 — 표 본문이 세로로 스크롤되는 길이.
    const issues = Array.from({ length: 40 }, (_, i) =>
      createIssue({ id: i + 1, number: i + 1, title: `키보드 이동 이슈 ${i + 1}` }),
    );
    await setup(page, { issues });
    await page.goto(`/projects/${KEY}?group=none`);
    const last = page.getByTestId('issue-row-40');
    await expect(last).toBeVisible(FIRST_LOAD);
    await last.getByRole('link').first().focus();

    // Shift+Tab 으로 위로 거슬러 오르며, 표 안 초점의 위쪽(초점 링 2px 포함)이 머리글에 덮이는지 매번 잰다(완전 가림도 위쪽 덮임에 든다).
    // 표 본문은 tbody 가 여럿일 수 있어 첫 tbody 가 아니라 초점이 든 tbody 로 판정하고, 첫 행까지 실제로 닿았는지도 본다.
    // 행마다 탭 정지가 넷(행·선택 칸·제목 링크·작업 메뉴)이라 40행 전체를 오르도록 넉넉히 누르고, 초점이 표를 벗어나면 멈춘다.
    let inTable = 0;
    let reachedFirst = false;
    const covered: string[] = [];
    // 링이 transition 으로 자라는 도중에 재지 않는다 — 공통 fixture(auth.fixture 의 data-test-no-animation)가 전환을 0초로 끈다.
    // 행 탭 정지 수가 늘어도 첫 행까지 닿게 넉넉한 안전 상한을 두고, 초점이 표를 벗어나면 멈춘다.
    for (let i = 0; i < 400; i++) {
      await page.keyboard.press('Shift+Tab');
      const r = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const scroll = document.querySelector('[data-testid="issue-list-scroll"]')!;
        if (!el || !scroll.contains(el) || !el.closest('tbody')) return null;
        const head = scroll.querySelector('thead')!.getBoundingClientRect();
        // 바깥 초점 링은 요소 위로 링 두께만큼 그려지므로 그만큼 위까지 보여야 한다. 두께는 계산된 box-shadow 에서 inset 이 아닌 층의 퍼짐(spread) 중 가장 큰 값
        // (ring-2 = 2px, 체크박스 ring-[3px] = 3px). 행처럼 안쪽 링(ring-inset)만 있으면 요소 안이라 0 이다.
        // 색 표기(rgb·oklch·color-mix 등)와 무관하게 읽도록, 괄호(색 함수 — 겹쳐도 안쪽부터)를 지운 뒤 쉼표로 층을 나눠 px 길이만 본다.
        const shadow = getComputedStyle(el).boxShadow;
        let bareAll = shadow === 'none' ? '' : shadow;
        while (/\([^()]*\)/.test(bareAll)) bareAll = bareAll.replace(/\([^()]*\)/g, '');
        let RING = 0;
        for (const bare of bareAll ? bareAll.split(',') : []) {
          const lengths = [...bare.matchAll(/(-?[\d.]+)px/g)].map((m) => Number(m[1]));
          // 계산된 box-shadow 는 층마다 x·y·흐림·퍼짐 네 길이를 낸다. 못 읽으면 조용히 0 으로 재지 않고 덮임으로 올려 테스트가 알린다.
          if (lengths.length !== 4) return { covered: true, first: false, name: `링을 읽지 못함: ${shadow}` };
          // 요소 위로 닿는 거리 = 퍼짐 + 흐림 - y 오프셋(위로 밀린 그림자·흐림까지 포함). 링(ring-2)은 0 0 0 2px 라 2px 다.
          const [, y, blur, spread] = lengths;
          if (!/\binset\b/.test(bare)) RING = Math.max(RING, spread + blur - y);
        }
        return {
          covered: el.getBoundingClientRect().top - RING < head.bottom - 0.5,
          first: el.closest('[data-testid="issue-row-1"]') != null,
          name: el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '',
        };
      });
      if (!r) {
        if (inTable > 0) break;
        continue;
      }
      inTable++;
      if (r.first) reachedFirst = true;
      if (r.covered) covered.push(r.name);
    }
    expect(inTable).toBeGreaterThan(10);
    expect(reachedFirst, '첫 행(issue-row-1)까지 올라갔다').toBe(true);
    expect(covered, '위쪽이 머리글에 덮인 초점 요소').toEqual([]);
  });
});

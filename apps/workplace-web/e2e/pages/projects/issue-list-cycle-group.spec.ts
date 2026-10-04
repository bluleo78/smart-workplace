// 이슈 목록 「사이클」 그룹 E2E (#878) — Jira 백로그 방식 구간(진행 중 → 예정 → 백로그).
// 기본값 결정(사이클 유무·group=none·저장 뷰 하위호환), 구간별 요청 파라미터(필터·종료 이슈 스코프),
// 접힘/펼침 지연 요청, M:N 중복 표시와 선택 공유, 일괄 작업을 page.route 목으로 검증한다.
import type { Page } from '@playwright/test';

import type { CycleProgress, CycleResponse } from '../../../src/types/cycle';
import type { IssueResponse } from '../../../src/types/issue';
import type { SavedViewResponse } from '../../../src/types/savedView';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { createMember, createProject } from '../../factories/project.factory';
import { expect, test } from '../../fixtures/auth.fixture';

const KEY = 'WP';
const ISSUES_PATH = `/api/v1/projects/${KEY}/issues`;

function cycle(overrides: Partial<CycleResponse>): CycleResponse {
  return {
    id: 1,
    projectId: 1,
    name: '스프린트',
    goal: null,
    startDate: null,
    endDate: null,
    status: 'ACTIVE',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

// 기준 사이클 — 오늘(2026-09-30) 고정. 진행 중 2개(시작일 역순으로 넣어 정렬 검증), 예정 2개(미정 포함), 완료 1개.
const CYCLES: CycleResponse[] = [
  cycle({ id: 1, name: '스프린트 12', status: 'ACTIVE', startDate: '2026-09-21', endDate: '2026-10-03', goal: '결제 개편' }),
  cycle({ id: 2, name: '핫픽스 주간', status: 'ACTIVE', startDate: '2026-09-10', endDate: '2026-09-28' }),
  cycle({ id: 3, name: '스프린트 13', status: 'PLANNED', startDate: '2026-10-06', endDate: '2026-10-17' }),
  cycle({ id: 4, name: '미정 스프린트', status: 'PLANNED' }),
  cycle({ id: 5, name: '스프린트 11', status: 'COMPLETED', startDate: '2026-09-01', endDate: '2026-09-14' }),
];

const PROGRESS: CycleProgress[] = [
  { cycleId: 1, total: 3, done: 1, byStatus: { DONE: 1, TODO: 2 } },
  { cycleId: 2, total: 2, done: 0, byStatus: { TODO: 2 } },
  { cycleId: 3, total: 1, done: 0, byStatus: { TODO: 1 } },
  // 미정 스프린트 — 행(상위 작업)은 0 인데 하위 이슈 2건이 있는 경우.
  { cycleId: 4, total: 2, done: 0, byStatus: { TODO: 2 } },
];

// 구간별 이슈 — #11 은 스프린트 12·핫픽스 주간 두 사이클에 모두 속한다(M:N).
const ISSUES_BY_CYCLE: Record<string, IssueResponse[]> = {
  '1': [
    createIssue({ id: 11, number: 11, title: '결제 모듈 리팩터링' }),
    createIssue({ id: 12, number: 12, title: '결제 실패 알림', status: 'DONE' }),
  ],
  '2': [
    createIssue({ id: 21, number: 21, title: '로그인 오류 수정' }),
    createIssue({ id: 11, number: 11, title: '결제 모듈 리팩터링' }),
  ],
  '3': [createIssue({ id: 31, number: 31, title: '다음 스프린트 작업' })],
  '4': [],
  '5': [createIssue({ id: 51, number: 51, title: '지난 스프린트 작업', status: 'DONE' })],
  null: [createIssue({ id: 41, number: 41, title: '백로그 작업' })],
};
const FLAT_ISSUES = [createIssue({ id: 90, number: 90, title: '평면 목록 이슈' })];

interface SetupOptions {
  cycles?: CycleResponse[];
  savedViews?: SavedViewResponse[];
}

/** 공통 목 — 이슈 검색 요청 파라미터를 순서대로 기록해 돌려준다. */
async function setup(page: Page, { cycles = CYCLES, savedViews = [] }: SetupOptions = {}) {
  // 로컬 날짜 고정(D-N 계산) — setFixedTime 은 타이머를 멈추지 않아 debounce·observer 가 그대로 돈다.
  await page.clock.setFixedTime(new Date(2026, 8, 30, 10, 0));
  const requests: URLSearchParams[] = [];
  const views = [...savedViews];

  await page.route(`**/api/v1/projects/${KEY}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
  );
  await page.route(`**/api/v1/projects/${KEY}/members`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([createMember({ userId: 10, name: '김개발', username: 'kim' })]),
    }),
  );
  await page.route(`**/api/v1/projects/${KEY}/labels`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(`**/api/v1/projects/${KEY}/types`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(`**/api/v1/projects/${KEY}/cycles`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cycles) });
  });
  await page.route(`**/api/v1/projects/${KEY}/cycles/progress`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROGRESS) }),
  );
  await page.route(`**/api/v1/projects/${KEY}/saved-views`, (route) => {
    const m = route.request().method();
    if (m === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(views) });
    if (m === 'POST') {
      const body = route.request().postDataJSON() as { name: string; query: string; visibility: string };
      const created: SavedViewResponse = {
        id: views.length + 100, name: body.name, query: body.query,
        visibility: body.visibility as SavedViewResponse['visibility'],
        ownerId: 1, mine: true, pinned: false, createdAt: '', updatedAt: '',
      };
      views.push(created);
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(created) });
    }
    return route.fallback();
  });
  await page.route(
    (url) => url.pathname === ISSUES_PATH,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const params = new URL(route.request().url()).searchParams;
      requests.push(params);
      const cycleParam = params.get('cycle');
      const items = cycleParam == null ? FLAT_ISSUES : (ISSUES_BY_CYCLE[cycleParam] ?? []);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(items, null)),
      });
    },
  );
  return requests;
}

const section = (page: Page, key: string) => page.getByTestId(`list-cycle-section-${key}`);

test.describe('이슈 목록 사이클 그룹 (#878)', () => {
  test(
    '사이클이 있는 프로젝트는 기본 사이클 그룹 — 진행 중(시작일순) → 예정 → 백로그, 완료 제외, 진행 중 강조·D-N',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const requests = await setup(page);
      await page.goto(`/projects/${KEY}`);

      await expect(section(page, 'backlog')).toBeVisible();
      const order = await page
        .locator('[data-testid^="list-cycle-section-"]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
      expect(order).toEqual([
        'list-cycle-section-cycle-2',
        'list-cycle-section-cycle-1',
        'list-cycle-section-cycle-3',
        'list-cycle-section-cycle-4',
        'list-cycle-section-backlog',
      ]);
      // 완료 사이클 미표시.
      await expect(section(page, 'cycle-5')).toHaveCount(0);

      // 진행 중 강조 + 배지 + D-N(오늘 기준 3일 남음) / 지난 사이클은 "N일 초과" 경고색.
      await expect(section(page, 'cycle-1')).toHaveAttribute('data-active', 'true');
      await expect(section(page, 'cycle-3')).not.toHaveAttribute('data-active', 'true');
      await expect(page.getByTestId('list-cycle-badge-cycle-1')).toHaveText('진행 중');
      await expect(page.getByTestId('list-cycle-badge-cycle-3')).toHaveText('예정');
      await expect(page.getByTestId('list-cycle-remaining-cycle-1')).toHaveText('D-3');
      await expect(page.getByTestId('list-cycle-remaining-cycle-2')).toHaveText('2일 초과');
      await expect(page.getByTestId('list-cycle-remaining-cycle-2')).toHaveClass(/text-destructive/);
      await expect(page.getByTestId('list-cycle-period-cycle-1')).toHaveText('2026-09-21 ~ 2026-10-03');
      await expect(page.getByTestId('list-cycle-goal-cycle-1')).toHaveText('결제 개편');
      // 사이클 구간은 진행률, 백로그는 건수.
      await expect(section(page, 'cycle-1').getByTestId('cycle-progress-1')).toContainText('1/3 완료');
      await expect(page.getByTestId('list-cycle-count-backlog')).toHaveText('1건');

      // 진행 중·백로그 펼침(행 노출), 예정 접힘.
      await expect(section(page, 'cycle-1').getByTestId('issue-row-12')).toBeVisible();
      await expect(section(page, 'backlog').getByTestId('issue-row-41')).toBeVisible();
      await expect(page.getByTestId('list-cycle-toggle-cycle-3')).toHaveAttribute('aria-expanded', 'false');
      const toggle1 = page.getByTestId('list-cycle-toggle-cycle-1');
      await expect(toggle1).toHaveAttribute('aria-expanded', 'true');
      // aria-controls — 펼친 구간은 실재하는 본문 id 를, 접힌 구간은 아무것도 가리키지 않는다.
      // 값이 채워질 때까지 web-first 단언으로 기다린 뒤 그 id 를 읽는다(WP-225).
      await expect(toggle1).toHaveAttribute('aria-controls', /.+/);
      const controls = await toggle1.getAttribute('aria-controls');
      await expect(page.locator(`[id="${controls}"]`)).toHaveAttribute('data-testid', 'list-cycle-body-cycle-1');
      await expect(page.getByTestId('list-cycle-toggle-cycle-3')).not.toHaveAttribute('aria-controls', /.+/);
      // 진행 중 D-N 은 스크린리더용 문장을 함께 준다.
      await expect(page.getByTestId('list-cycle-remaining-cycle-1')).toHaveAttribute('aria-label', '종료까지 3일');

      // 평면 목록 요청(cycle 파라미터 없음)은 나가지 않는다.
      expect(requests.every((p) => p.has('cycle'))).toBe(true);
      // 그룹 메뉴 표시도 사이클.
      await expect(page.getByTestId('group-by-trigger')).toHaveText('사이클');
    },
  );

  test('구간별 요청 파라미터 — 사이클 구간은 종료 이슈 포함, 백로그는 cycle=null + 미종료 스코프', async ({
    authenticatedPage: page,
  }) => {
    const requests = await setup(page);
    await page.goto(`/projects/${KEY}`);
    await expect(section(page, 'backlog').getByTestId('issue-row-41')).toBeVisible();

    const backlog = requests.find((p) => p.get('cycle') === 'null');
    expect(backlog?.get('hideInactiveClosed')).toBe('true');
    expect(backlog?.get('excludeEpics')).toBe('true');
    expect(backlog?.get('excludeSubtasks')).toBe('true');
    expect(backlog?.get('status')).toBeNull();

    const active = requests.find((p) => p.get('cycle') === '1');
    expect(active?.get('hideInactiveClosed')).toBeNull();
    expect(active?.get('excludeEpics')).toBe('true');
    expect(active?.get('excludeSubtasks')).toBe('true');
  });

  test('「완료 모두 보기」를 켜면 백로그도 종료 이슈 숨김을 해제한다', async ({ authenticatedPage: page }) => {
    const requests = await setup(page);
    await page.goto(`/projects/${KEY}?closed=all`);
    await expect(section(page, 'backlog').getByTestId('issue-row-41')).toBeVisible();
    const backlog = requests.find((p) => p.get('cycle') === 'null');
    expect(backlog?.get('hideInactiveClosed')).toBeNull();
  });

  test('필터(담당자·검색어)는 모든 구간 요청에 함께 실린다', async ({ authenticatedPage: page }) => {
    const requests = await setup(page);
    await page.goto(`/projects/${KEY}?assignee=10&q=${encodeURIComponent('결제')}`);
    await expect(section(page, 'backlog').getByTestId('issue-row-41')).toBeVisible();
    await expect(section(page, 'cycle-1').getByTestId('issue-row-11')).toBeVisible();

    const cycleParams = requests.map((p) => p.get('cycle'));
    expect(cycleParams).toEqual(expect.arrayContaining(['1', '2', 'null']));
    for (const p of requests) {
      expect(p.get('assignee')).toBe('10');
      expect(p.get('q')).toBe('결제');
    }
  });

  test('예정 구간은 접혀 있고 펼칠 때 요청한다 — 빈 구간은 하위 이슈 안내', async ({ authenticatedPage: page }) => {
    const requests = await setup(page);
    await page.goto(`/projects/${KEY}`);
    await expect(section(page, 'backlog').getByTestId('issue-row-41')).toBeVisible();
    expect(requests.some((p) => p.get('cycle') === '3')).toBe(false);

    const req = page.waitForRequest(
      (r) => r.url().includes(ISSUES_PATH) && new URL(r.url()).searchParams.get('cycle') === '3',
    );
    await page.getByTestId('list-cycle-toggle-cycle-3').click();
    await req;
    await expect(page.getByTestId('list-cycle-toggle-cycle-3')).toHaveAttribute('aria-expanded', 'true');
    await expect(section(page, 'cycle-3').getByTestId('issue-row-31')).toBeVisible();

    // 다시 접으면 행이 사라진다.
    await page.getByTestId('list-cycle-toggle-cycle-3').click();
    await expect(section(page, 'cycle-3').getByTestId('issue-row-31')).toHaveCount(0);

    // 상위 작업 0행 + 진행률 total 2 → 하위 이슈 안내.
    await page.getByTestId('list-cycle-toggle-cycle-4').click();
    await expect(page.getByTestId('list-cycle-empty-cycle-4')).toHaveText(
      '표시할 상위 작업이 없습니다 (하위 이슈 2건 포함)',
    );
  });

  test('사이클 facet 으로 고르면 그 구간만 보이고 백로그는 숨긴다', async ({ authenticatedPage: page }) => {
    const requests = await setup(page);
    await page.goto(`/projects/${KEY}?cycle=3`);
    await expect(section(page, 'cycle-3').getByTestId('issue-row-31')).toBeVisible();
    await expect(page.locator('[data-testid^="list-cycle-section-"]')).toHaveCount(1);
    await expect(section(page, 'backlog')).toHaveCount(0);
    expect(requests.map((p) => p.get('cycle'))).toEqual(['3']);
  });

  test('사이클 없는 프로젝트(완료 사이클만 포함)는 평면 목록', async ({ authenticatedPage: page }) => {
    const requests = await setup(page, { cycles: [CYCLES[4]] });
    await page.goto(`/projects/${KEY}`);
    await expect(page.getByTestId('issue-row-90')).toBeVisible();
    await expect(page.locator('[data-testid^="list-cycle-section-"]')).toHaveCount(0);
    expect(requests.every((p) => !p.has('cycle'))).toBe(true);
    await expect(page.getByTestId('group-by-trigger')).toHaveText('없음');
  });

  test('group=none 이면 사이클이 있어도 평면 목록', async ({ authenticatedPage: page }) => {
    await setup(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await expect(page.getByTestId('issue-row-90')).toBeVisible();
    await expect(page.locator('[data-testid^="list-cycle-section-"]')).toHaveCount(0);
  });

  test('그룹 메뉴에서 없음 ↔ 사이클 전환이 URL 에 반영된다', async ({ authenticatedPage: page }) => {
    await setup(page);
    await page.goto(`/projects/${KEY}`);
    await expect(section(page, 'backlog')).toBeVisible();

    await page.getByTestId('group-by-trigger').click();
    await page.getByTestId('group-by-none').click();
    await expect(page).toHaveURL(/group=none/);
    await expect(page.getByTestId('issue-row-90')).toBeVisible();
    await expect(section(page, 'backlog')).toHaveCount(0);

    await page.getByTestId('group-by-trigger').click();
    await page.getByTestId('group-by-cycle').click();
    await expect(page).toHaveURL(/group=cycle/);
    await expect(section(page, 'backlog')).toBeVisible();
  });

  test('group 없는 저장 뷰를 적용하면 그룹 없음(평면)으로 열리고 칩이 활성', async ({ authenticatedPage: page }) => {
    await setup(page, {
      savedViews: [
        {
          id: 7, name: '높은 우선순위', query: 'priority=HIGH', visibility: 'PRIVATE',
          ownerId: 1, mine: true, pinned: false, createdAt: '', updatedAt: '',
        },
      ],
    });
    await page.goto(`/projects/${KEY}`);
    await expect(section(page, 'backlog')).toBeVisible();

    await page.getByTestId('view-chip-7').click();
    await expect(page).toHaveURL(/group=none/);
    await expect(page).toHaveURL(/priority=HIGH/);
    await expect(page.getByTestId('issue-row-90')).toBeVisible();
    await expect(page.locator('[data-testid^="list-cycle-section-"]')).toHaveCount(0);
    await expect(page.getByTestId('view-chip-7')).toHaveClass(/font-medium/);
    // 적용 직후는 저장된 뷰와 일치 — 「뷰 업데이트」가 뜨지 않는다.
    await expect(page.getByTestId('update-view-button')).toHaveCount(0);
  });

  test('기본 사이클 그룹 화면을 저장하면 group=cycle 이 명시 저장된다', async ({ authenticatedPage: page }) => {
    await setup(page);
    await page.goto(`/projects/${KEY}?priority=HIGH`);
    await expect(section(page, 'backlog')).toBeVisible();

    const posted = page.waitForRequest(
      (r) => r.url().endsWith(`/projects/${KEY}/saved-views`) && r.method() === 'POST',
    );
    await page.getByTestId('save-view-button').click();
    await page.getByTestId('save-view-name').fill('사이클 HIGH');
    await page.getByTestId('save-view-submit').click();
    const query = new URLSearchParams(((await posted).postDataJSON() as { query: string }).query);
    expect(query.get('group')).toBe('cycle');
    expect(query.get('priority')).toBe('HIGH');
  });

  test('M:N — 두 사이클에 속한 이슈는 두 구간 모두에 보이고 선택 상태를 공유한다 + 일괄 상태 변경', async ({
    authenticatedPage: page,
  }) => {
    await setup(page);
    const statusBodies: { number: number; body: unknown }[] = [];
    await page.route(
      (url) => /\/api\/v1\/projects\/WP\/issues\/\d+\/status$/.test(url.pathname),
      async (route) => {
        if (route.request().method() !== 'PATCH') return route.fallback();
        const number = Number(route.request().url().match(/issues\/(\d+)\/status/)?.[1]);
        statusBodies.push({ number, body: route.request().postDataJSON() });
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssue({ number, status: 'DONE' })),
        });
      },
    );
    // 진행률 재조회 카운트 — 일괄 작업 후 구간 헤더 진행률도 갱신돼야 한다.
    let progressGets = 0;
    page.on('request', (r) => {
      if (r.method() === 'GET' && new URL(r.url()).pathname === `/api/v1/projects/${KEY}/cycles/progress`) progressGets++;
    });
    await page.goto(`/projects/${KEY}`);

    const inActive = section(page, 'cycle-1').getByTestId('select-issue-11');
    const inHotfix = section(page, 'cycle-2').getByTestId('select-issue-11');
    await expect(inActive).toBeVisible();
    await expect(inHotfix).toBeVisible();

    await inActive.check();
    await expect(inHotfix).toBeChecked();
    await expect(page.getByTestId('issue-bulk-toolbar')).toContainText('선택 1개');

    // 다른 구간 선택을 더한다. 구간 헤더엔 체크박스가 없다 — 사이클은 이슈가 아니라 이슈 선택으로 오인되지 않게(#881).
    await section(page, 'cycle-2').getByTestId('select-issue-21').check();
    await expect(page.getByTestId('list-cycle-header-backlog').getByRole('checkbox')).toHaveCount(0);
    await section(page, 'backlog').getByTestId('select-issue-41').check();
    await expect(page.getByTestId('issue-bulk-toolbar')).toContainText('선택 3개');
    // 체크박스 클릭이 상세 이동을 일으키지 않는다.
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}$`));

    const progressBefore = progressGets;
    await page.getByTestId('bulk-status-trigger').click();
    await page.getByTestId('bulk-status-option-DONE').click();
    await expect.poll(() => statusBodies.map((b) => b.number).sort()).toEqual([11, 21, 41]);
    await expect(page.getByTestId('issue-bulk-toolbar')).toHaveCount(0);
    await expect.poll(() => progressGets).toBeGreaterThan(progressBefore);
  });

  test('로딩 중엔 평면 목록을 띄우지 않고 스켈레톤을 보인다', async ({ authenticatedPage: page }) => {
    const requests = await setup(page);
    // 사이클 목록 응답을 늦춰 판정 보류 상태를 만든다.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    await page.route(`**/api/v1/projects/${KEY}/cycles`, async (route) => {
      await gate;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CYCLES) });
    });
    await page.goto(`/projects/${KEY}`);
    await expect(page.getByTestId('issue-list-pending')).toBeVisible();
    await expect(page.getByTestId('issue-row-90')).toHaveCount(0);
    release();
    await expect(section(page, 'backlog')).toBeVisible();
    expect(requests.every((p) => p.has('cycle'))).toBe(true);
  });
  test('백로그 = 진행 중·예정 사이클 밖 — 완료 사이클에만 속한 미완료 이슈도 백로그 요청(cycle=null)으로 뜬다', async ({
    authenticatedPage: page,
  }) => {
    const requests = await setup(page);
    // 완료 사이클(스프린트 11)에만 속했던 미완료 이슈 — 서버가 cycle=null 로 돌려주는 백로그 결과.
    await page.route(
      (url) => url.pathname === ISSUES_PATH && url.searchParams.get('cycle') === 'null',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            createIssueSearchResponse([createIssue({ id: 52, number: 52, title: '끝난 스프린트에서 넘어온 작업' })], null),
          ),
        }),
    );
    await page.goto(`/projects/${KEY}`);
    await expect(section(page, 'backlog').getByTestId('issue-row-52')).toContainText('끝난 스프린트에서 넘어온 작업');
    // 완료 사이클 구간은 여전히 없다.
    await expect(section(page, 'cycle-5')).toHaveCount(0);
    expect(requests.some((p) => p.get('cycle') === '5')).toBe(false);
  });

  test('빈 백로그 문구는 새 정의(진행 중·예정 사이클 밖)를 따른다', async ({ authenticatedPage: page }) => {
    await setup(page);
    await page.route(
      (url) => url.pathname === ISSUES_PATH && url.searchParams.get('cycle') === 'null',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssueSearchResponse([], null)),
        }),
    );
    await page.goto(`/projects/${KEY}`);
    await expect(page.getByTestId('list-cycle-empty-backlog')).toHaveText(
      '진행 중·예정 사이클에 없는 미완료 이슈가 없습니다',
    );
  });
});

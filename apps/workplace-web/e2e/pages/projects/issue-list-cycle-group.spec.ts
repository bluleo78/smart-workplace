// 이슈 목록 「사이클」 그룹 E2E (#878) — Jira 백로그 방식 구간(진행 중 → 예정 → 백로그).
// 남는 것: 기본 사이클 그룹 진입(@wiring — 구간 순서·배지·D-N·진행률), 스크롤해 체크해도 일괄 바가 보임(@layout),
// 구간 끝이 화면에 들어올 때의 자동 로드/「더 보기」(@layout, IntersectionObserver).
// 구간별 요청 파라미터, 접힘/펼침 지연 요청, 그룹 전환·저장 뷰 하위호환, M:N 선택 공유·일괄 작업, 로딩·빈 구간 문구는
// 페이지 테스트 src/pages/projects/issueListCycleGroup.test.tsx 가 지킨다(WP-980).
import type { Page } from '@playwright/test';

import type { CycleProgress, CycleResponse } from '../../../src/types/cycle';
import type { IssueResponse } from '../../../src/types/issue';
import type { SavedViewResponse } from '../../../src/types/savedView';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { createMember, createProject } from '../../factories/project.factory';
import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';
import { expectStays } from '../../fixtures/wait';

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

/** 공통 목 — 이슈 검색 요청 파라미터(보낸 순서)를 읽는 함수를 돌려준다. */
async function setup(page: Page, { cycles = CYCLES, savedViews = [] }: SetupOptions = {}) {
  // 로컬 날짜 고정(D-N 계산) — setFixedTime 은 타이머를 멈추지 않아 debounce·observer 가 그대로 돈다.
  await page.clock.setFixedTime(new Date(2026, 8, 30, 10, 0));
  const searches = trackRequests(page, 'GET', ISSUES_PATH);
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
      const cycleParam = params.get('cycle');
      const items = cycleParam == null ? FLAT_ISSUES : (ISSUES_BY_CYCLE[cycleParam] ?? []);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(items, null)),
      });
    },
  );
  return () => searches.urls().map((u) => u.searchParams);
}

/** 진행 중 사이클(스프린트 12)·백로그 모두 다음 페이지가 남은 상태 — 첫 페이지 30행(사이클 #200~229·백로그 #500~529),
 * 둘째 페이지 1행(사이클 #109·백로그 #409) (WP-876). */
async function mockPagedSections(page: Page) {
  // 다음 페이지가 남은 구간의 전체 수(WP-1231) — 「더 보기」의 「전체 N건 중 M건 표시」.
  await page.route(
    (url) => url.pathname === `${ISSUES_PATH}/group-counts`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ groupBy: 'priority', groups: [{ key: 'MID', count: 31 }] }),
      }),
  );
  await page.route(
    (url) => url.pathname === ISSUES_PATH && ['1', 'null'].includes(url.searchParams.get('cycle') ?? ''),
    (route) => {
      const params = new URL(route.request().url()).searchParams;
      const isBacklog = params.get('cycle') === 'null';
      const base = isBacklog ? 400 : 100;
      const label = isBacklog ? '백로그' : '사이클';
      const page2 = params.get('cursor') != null;
      const items = page2
        ? [createIssue({ id: base + 9, number: base + 9, title: `${label} 둘째 페이지` })]
        : Array.from({ length: 30 }, (_, i) =>
            createIssue({ id: base + 100 + i, number: base + 100 + i, title: `${label} ${i}` }),
          );
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(items, page2 ? null : 'next')),
      });
    },
  );
}

const section = (page: Page, key: string) => page.getByTestId(`list-cycle-section-${key}`);

test.describe('이슈 목록 사이클 그룹 (#878)', () => {
  test(
    '사이클이 있는 프로젝트는 기본 사이클 그룹 — 진행 중(시작일순) → 예정 → 백로그, 완료 제외, 진행 중 강조·D-N',
    { tag: ['@wiring', '@smoke'] },
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
      expect(requests().every((p) => p.has('cycle'))).toBe(true);
      // 그룹 메뉴 표시도 사이클.
      await expect(page.getByTestId('group-by-trigger')).toHaveText('사이클');
    },
  );

  // WP-485 — 목록 아래쪽에서 체크해도 일괄 작업 바가 보인다(스크롤 영역 위쪽에 붙음). 예전엔 바가 화면 위쪽 밖에 남았다.
  test('아래로 스크롤해 체크해도 일괄 작업 바가 화면 안에 보인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1440, height: 420 })
    await setup(page)
    await page.goto(`/projects/${KEY}`)

    const backlogRow = section(page, 'backlog').getByTestId('select-issue-41')
    await backlogRow.scrollIntoViewIfNeeded()
    await backlogRow.check()

    const bar = page.getByTestId('issue-bulk-toolbar')
    await expect(bar).toContainText('선택 1개')
    await expect(bar).toBeInViewport()
  })

  test('위 사이클 구간은 「더 보기」를 눌러야 다음 페이지를 불러오고, 마지막(백로그) 구간만 자동 로드한다 (WP-876)', { tag: '@layout' }, async ({
    authenticatedPage: page,
  }) => {
    const requests = await setup(page);
    await mockPagedSections(page);
    await page.goto(`/projects/${KEY}`);
    const cycleMore = page.getByTestId('list-cycle-more-cycle-1');
    await expect(section(page, 'cycle-1').getByTestId('issue-row-229')).toBeVisible();

    // 사이클 구간 끝이 화면에 들어와도 자동으로 불러오지 않는다 — 버튼을 보인다.
    await cycleMore.scrollIntoViewIfNeeded();
    const moreButton = cycleMore.getByRole('button', { name: '더 보기' });
    await expect(moreButton).toBeVisible();
    // 부재 확인 — 끝이 보인 뒤 observer 가 돌 시간을 주고도 둘째 페이지 요청이 없어야 한다.
    await expectStays(page, () => requests().some((p) => p.get('cycle') === '1' && p.has('cursor')), false);

    // 눌러야 둘째 페이지 — 사이클 구간 안(백로그 앞)에 붙고 버튼은 사라진다.
    await moreButton.click();
    await expect(section(page, 'cycle-1').getByTestId('issue-row-109')).toBeVisible();
    await expect(cycleMore).toHaveCount(0);
    expect(requests().find((p) => p.get('cycle') === '1' && p.has('cursor'))?.get('cursor')).toBe('next');

    // 마지막(백로그) 구간은 끝에 닿으면 자동으로 불러온다 — 버튼 없음.
    await expect(section(page, 'backlog').getByTestId('issue-row-529')).toBeVisible();
    await expect(page.getByTestId('list-cycle-more-backlog').getByRole('button', { name: '더 보기' })).toHaveCount(0);
    await section(page, 'backlog').getByTestId('issue-row-529').scrollIntoViewIfNeeded();
    await expect(section(page, 'backlog').getByTestId('issue-row-409')).toBeVisible();
  });

  test('아래 구간이 모두 접혀 있으면 펼친 마지막 사이클 구간이 자동 로드한다 (WP-876)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await setup(page);
    await mockPagedSections(page);
    await page.goto(`/projects/${KEY}`);
    await expect(section(page, 'backlog').getByTestId('issue-row-500')).toBeVisible();
    await page.getByTestId('list-cycle-toggle-backlog').click();
    await section(page, 'cycle-1').getByTestId('issue-row-229').scrollIntoViewIfNeeded();
    await expect(section(page, 'cycle-1').getByTestId('issue-row-109')).toBeVisible();
    await expect(page.getByTestId('list-cycle-more-cycle-1')).toHaveCount(0);
  });
});

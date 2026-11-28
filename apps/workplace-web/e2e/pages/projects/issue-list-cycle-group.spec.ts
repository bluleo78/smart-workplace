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
import { boxOf } from '../../fixtures/layout';
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

      // WP-1929 — 평면 목록은 판정 전에 한 번만 나가고(중복 금지), 레이아웃이 사이클을 앞에서 미리 받아
      // 판정이 첫 렌더에 끝나면 평면 요청은 아예 없다(0건 — 그럴 때는 cycle 파라미터로만 요청한다).
      // 옛 불변식 « 평면 목록 요청은 아예 나가지 않는다 » 는 「게이트 위 즉시 발사」 와 양립하지 않아 0~1 건으로 본다
      // (vitest 동생 테스트는 사이클 응답을 묶어 두어 판정을 늦추므로 항상 1건이다).
      // 「0~1 건」만으로는 아무 요청도 안 하는 것으로도 통과하므로, 사이클 파라미터 요청은 반드시 나갔는지도 함께 단언한다
      // (WP-1929 리뷰 3차 nit — 단언 약화 되돌리기).
      const flat = requests().filter((p) => !p.has('cycle'));
      expect(flat.length).toBeLessThanOrEqual(1);
      expect(requests().some((p) => p.has('cycle'))).toBe(true);
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
  // WP-2070 — 사이클 그룹 목록에서 일괄 작업 바(sticky top-0)가 떠 있을 때 Shift+Tab 으로 위로 오르면 초점이 바 밑에 가려졌다.
  // 슬롯의 scroll-padding-top(바 높이만큼)이 브라우저의 초점 자동 스크롤 여백이 되어 가림을 막는다 — 기하라 jsdom 으로 못 잰다.
  test(
    '키보드로 위로 이동해도 초점이 사이클 목록의 일괄 작업 바에 가려지지 않는다(WP-2070)',
    { tag: ['@layout', '@input'] },
    async ({ authenticatedPage: page }) => {
      // 사이클 구간 35행(행마다 탭 정지 여럿)을 Shift+Tab 으로 오르며 매번 재므로 부하 속에서도 시간이 모자라지 않게 한도를 늘린다.
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      await setup(page);
      // 스프린트 12(cycle=1)만 35건으로 덮어쓴다 — 나중에 등록한 라우트가 먼저 적용된다. 다음 페이지는 없다.
      const cycleIssues = Array.from({ length: 35 }, (_, i) =>
        createIssue({ id: 100 + i, number: 100 + i, title: `키보드 이동 이슈 ${i}` }),
      );
      await page.route(
        (url) => url.pathname === ISSUES_PATH && url.searchParams.get('cycle') === '1',
        (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(createIssueSearchResponse(cycleIssues, null)),
          });
        },
      );
      await page.goto(`/projects/${KEY}`);
      const first = section(page, 'cycle-1').getByTestId('select-issue-100');
      const last = section(page, 'cycle-1').getByTestId('select-issue-134');
      await expect(last).toBeVisible();

      // 열 머리는 sticky 가 아니라 따로 여백이 필요 없다 — 이 전제가 깨지면 여백 계산을 다시 해야 한다.
      await expect(page.getByTestId('list-cycle-column-head').first()).toHaveCSS('position', 'static');

      // 첫 행을 선택해 바를 띄운다(선택 뒤 바가 sticky 로 붙고 표지가 달린다).
      await first.check();
      await expect(page.getByTestId('issue-bulk-toolbar')).toContainText('선택 1개');
      await expect(page.locator('[data-sticky-bulk-bar]')).toHaveCount(1);

      await last.focus();
      let steps = 0;
      let reachedFirst = false;
      const covered: string[] = [];
      // 첫 행 체크박스에 닿을 때까지(행당 탭 정지 수가 늘어도 되게 넉넉한 안전 상한) 한 칸씩 올라가며 잰다.
      for (let i = 0; i < 400 && !reachedFirst; i++) {
        await page.keyboard.press('Shift+Tab');
        const r = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          const list = document.querySelector('[data-testid="issue-cycle-grouped-list"]');
          const bar = document.querySelector('[data-sticky-bulk-bar]');
          if (!el || !list || !bar || !list.contains(el) || bar.contains(el)) return null;
          // 초점 링은 요소 위로 3px 그려진다(체크박스 focus-visible:ring-[3px]) — 링까지 바 아래에 있어야 한다.
          return {
            covered: el.getBoundingClientRect().top - 3 < bar.getBoundingClientRect().bottom - 0.5,
            first: el.getAttribute('data-testid') === 'select-issue-100',
            name: el.getAttribute('aria-label') ?? el.getAttribute('data-testid') ?? el.textContent?.trim() ?? '',
          };
        });
        if (!r) continue;
        steps++;
        if (r.covered) covered.push(r.name);
        if (r.first) reachedFirst = true;
      }
      expect(steps, '목록 안에서 여러 칸을 올라갔다').toBeGreaterThan(10);
      expect(reachedFirst, '첫 행 체크박스까지 올라갔다').toBe(true);
      expect(covered, '위쪽이 일괄 작업 바에 덮인 초점 요소').toEqual([]);
    },
  );


  // WP-2070 — 좁은 데스크톱(1024px + 에픽 패널 최대 폭 + AI 패널)에서 바보다 단추 글자가 넓을 때.
  // WP-2153 — 글자 폭은 글꼴마다 달라(macOS 가 더 좁다) 넘침은 실제 UI 로 좁힌 뒤 단추 최소 폭을 주입해 일부러 만든다.
  // 주입한 최소 폭이 단추를 넓혀 실제 줄바꿈을 가리므로(높이로 못 잡는다), 바 안 글자가 한 줄로 묶이는지(white-space)를 따로 본다.
  // 사이클 목록의 바 감싸개는 sticky left-0 w-[100cqw] 라 슬롯을 가로로 밀어도 넘친 단추에 닿지 못하고, 넘친 글자가 바 밖으로 나가 행과 겹쳤다.
  // 바 안 가로 스크롤(스크롤바 숨김)로 담아 높이 38px 을 지키고 Tab 으로 닿은 단추가 바 안에 보여야 한다 — 기하·포커스 스크롤이라 jsdom 으로 못 잰다.
  // 그 스크롤은 바만 가로로, 바 안 키보드 초점에만 일어난다 — 슬롯을 내린 채 바를 오가도 슬롯이 그대로, 메뉴 항목(포털) 초점·마우스 누름에는 바가 그대로.
  test(
    '좁은 데스크톱에서 일괄 작업 바가 넘친 단추를 바 안에 담고 Tab 으로 닿은 단추가 바 안에 보인다(WP-2070)',
    { tag: ['@layout', '@input'] },
    async ({ authenticatedPage: page }) => {
      await page.setViewportSize({ width: 1024, height: 800 });
      await setup(page);
      // 스프린트 12(cycle=1)를 35건으로 덮어써 목록 슬롯이 세로로 스크롤되게 한다 — 슬롯을 내린 채 바 단추를 지나가도 슬롯이 튀지 않는지 잰다.
      const cycleIssues = Array.from({ length: 35 }, (_, i) =>
        createIssue({ id: 100 + i, number: 100 + i, title: `좁은 폭 이슈 ${i}` }),
      );
      await page.route(
        (url) => url.pathname === ISSUES_PATH && url.searchParams.get('cycle') === '1',
        (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(createIssueSearchResponse(cycleIssues, null)),
          });
        },
      );
      // 담당자 후보 이름을 길게 — 담당자 메뉴가 바 안쪽 가장자리를 넘어 뻗게 한다(포털 항목 초점 단언의 전제).
      await page.route(`**/api/v1/projects/${KEY}/members`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([createMember({ userId: 10, name: '아주 긴 이름을 가진 담당자 후보 김개발', username: 'kim' })]),
        }),
      );
      await page.goto(`/projects/${KEY}`);
      // 맨 위 구간(핫픽스 주간)의 #11 — 여기서 Shift+Tab 몇 번이면 바에 닿는다.
      const checkbox = section(page, 'cycle-2').getByTestId('select-issue-11');
      await expect(checkbox).toBeVisible();
      // 좁히기 전 목록 폭 — 아래 좁히기가 실제로 먹었는지 견줄 기준(바는 이 목록 컨테이너 폭(100cqw)을 따른다).
      const list = page.getByTestId('issue-cycle-grouped-list');
      const listBefore = await list.evaluate((el) => el.clientWidth);

      // 실제 UI 로 목록을 좁힌다 — 에픽 패널을 열어 경계선을 끝까지 끌고(상한까지), AI 패널을 연다.
      const epicPanel = page.getByTestId('epic-side-panel');
      // 에픽 패널 경계선을 dx 만큼 오른쪽으로 끈다.
      const dragEpicHandle = async (dx: number) => {
        const handle = (await page.getByTestId('epic-panel-resize-handle').boundingBox())!;
        await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
        await page.mouse.down();
        await page.mouse.move(handle.x + dx, handle.y + handle.height / 2, { steps: 5 });
        await page.mouse.up();
      };
      await page.getByTestId('epic-panel-toggle').click();
      await expect(epicPanel).toBeVisible();
      await dragEpicHandle(400);
      const aiPanel = page.getByTestId('ai-side-panel');
      await page.getByTestId('chat-launcher').click();
      // 에픽 패널 상한은 앱 영역 폭의 비율이라 AI 패널을 열면 다시 줄어든다 — 연 뒤의 폭이 최대 폭인지 「더 끌어도 늘지 않음」으로 본다.
      // AI 패널이 뜬 뒤에 에픽 패널을 잰다(함께 재면 줄어들기 전 폭을 읽는다).
      const { width: aiWidth } = await boxOf(aiPanel);
      const { width: epicWidth } = await boxOf(epicPanel);
      await dragEpicHandle(200);
      // 표시 폭은 CSS 비율(소수)이고 끌기 상한은 내림한 정수라 1px 안쪽으로 줄 수는 있다 — 늘지 않는지만 본다.
      expect((await boxOf(epicPanel)).width, '에픽 패널이 최대 폭이다(더 끌어도 늘지 않는다)').toBeLessThanOrEqual(epicWidth + 0.5);

      await checkbox.check();
      const bar = page.getByTestId('issue-bulk-toolbar');
      await expect(bar).toContainText('선택 1개');
      // 좁히기 확인(WP-2153 리뷰 후속) — 아래 최소 폭 주입이 넘침을 만들어 내므로, 좁히기 단계가 깨져도 넘침 전제는 선다.
      // 그래서 주입 전에 바가 에픽 패널(최대 폭)과 AI 패널만큼 실제로 좁아졌는지 따로 본다.
      const barWidth = await bar.evaluate((el) => el.clientWidth);
      expect(barWidth, `바 폭 ${barWidth}px — 좁히기 전 목록 ${listBefore}px 에서 에픽 패널 ${epicWidth}px·AI 패널 ${aiWidth}px 만큼 줄었다`).toBeLessThanOrEqual(listBefore - epicWidth - aiWidth + 1);
      // 넘침 주입(WP-2153) — 바 자식(선택 개수·단추 넷)마다 바 폭의 1/3 을 최소 폭으로 주면 합이 바보다 항상 커서 어떤 글꼴에서도 넘친다.
      await page.addStyleTag({
        content: `[data-testid="issue-bulk-toolbar"] > * { min-width: ${Math.ceil(barWidth / 3)}px }`,
      });

      // 전제 — 단추 최소 폭 주입으로 바 내용이 바보다 넓다(넘침이 없으면 이 테스트가 아무것도 지키지 않는다).
      const size = await bar.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, h: el.getBoundingClientRect().height }));
      expect(size.sw, '바 내용이 바보다 넓다(넘침 전제 — 단추 최소 폭 주입이 먹지 않으면 테스트 장치 문제)').toBeGreaterThan(size.cw);
      // 높이 38px — 슬롯 scroll-pt-11(44px)이 이 높이에 기댄다. 스크롤바가 생겨 높이를 늘리면 안 된다.
      expect(Math.abs(size.h - 38), `바 높이 ${size.h}px`).toBeLessThanOrEqual(1);
      // 넘침 주입으로 단추가 넓어져 높이로는 줄바꿈 회귀를 못 잡으니 계산된 스타일로 본다.
      const wrapping = await bar.evaluate((el) =>
        [el, ...el.children].filter((c) => getComputedStyle(c).whiteSpace !== 'nowrap').map((c) => c.getAttribute('data-testid') ?? c.textContent),
      );
      expect(wrapping, '바와 단추 글자는 한 줄로 묶인다(whitespace-nowrap)').toEqual([]);

      // 바 사각형을 넘는 자식(넘친 단추)은 바가 잘라 담아야 한다 — 바가 overflow visible 이면 넘친 글자가 바 배경 밖으로 그려져 행과 겹친다.
      // 테스트 브라우저(headless Chromium)는 스크롤바를 그리지 않아 높이로는 못 잡으므로, 전역 `* { scrollbar-width: thin }` 을 이겨
      // 스크롤바가 숨겨졌는지(클래식 스크롤바가 바 높이를 늘리지 않는지)를 계산된 스타일로 본다.
      const clip = await bar.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const overflowing = [...el.children]
          .filter((c) => { const b = c.getBoundingClientRect(); return b.left < r.left - 0.5 || b.right > r.right + 0.5; })
          .map((c) => c.getAttribute('data-testid') ?? c.textContent);
        return { overflowing, overflowX: cs.overflowX, scrollbarWidth: cs.scrollbarWidth };
      });
      expect(clip.overflowing.length, '바 사각형을 넘는 자식이 있다(넘침 전제)').toBeGreaterThan(0);
      expect(clip.overflowX, `넘친 자식 ${clip.overflowing.join(', ')} 을 바가 잘라 담는다`).not.toBe('visible');
      expect(clip.scrollbarWidth, '바 가로 스크롤바는 숨긴다(높이 38px 유지)').toBe('none');

      // 초점이 간 바 단추가 바의 사각형 안에 보이는지(가로로 잘려 바깥에 있지 않은지) 잰다.
      const focusedInBar = () =>
        page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          const b = document.querySelector('[data-testid="issue-bulk-toolbar"]');
          if (!el || !b || !b.contains(el)) return null;
          const r = el.getBoundingClientRect();
          const br = b.getBoundingClientRect();
          return {
            id: el.getAttribute('data-testid'),
            inside: r.left >= br.left - 0.5 && r.right <= br.right + 0.5 && r.top >= br.top - 0.5 && r.bottom <= br.bottom + 0.5,
          };
        });
      const buttons = ['bulk-status-trigger', 'bulk-assignee-trigger', 'bulk-delete', 'bulk-clear'];

      // 위로: 행 체크박스에서 Shift+Tab 으로 바에 들어가 오른쪽 끝(선택 해제)부터 왼쪽으로 지나간다.
      await checkbox.focus();
      const up: { id: string | null; inside: boolean }[] = [];
      for (let i = 0; i < 40 && up.length < buttons.length; i++) {
        await page.keyboard.press('Shift+Tab');
        const r = await focusedInBar();
        if (r) up.push(r);
      }
      expect(up.map((r) => r.id)).toEqual([...buttons].reverse());
      // 아래로: 첫 단추(상태 변경)에서 Tab 으로 오른쪽 끝까지 — 왼쪽으로 스크롤된 뒤에도 오른쪽 단추가 다시 보여야 한다.
      const down = [up[up.length - 1]];
      for (let i = 1; i < buttons.length; i++) {
        await page.keyboard.press('Tab');
        down.push((await focusedInBar()) ?? { id: null, inside: false });
      }
      expect(down.map((r) => r.id)).toEqual(buttons);
      expect([...up, ...down].filter((r) => !r.inside).map((r) => r.id), '초점을 받았을 때 바 밖에 있던 단추').toEqual([]);
      expect((await bar.boundingBox())!.height).toBeCloseTo(38, 0);

      // 슬롯(목록 스크롤 영역)을 아래로 내린 채 바 단추를 키보드로 오가도 슬롯 scrollTop 은 그대로다 — 바만 가로로 스크롤해야 한다.
      // scrollIntoView 로 드러내면 조상인 슬롯까지 움직여, 슬롯의 scroll-pt-11 때문에 단추마다 목록이 약 35px 위로 튀었다.
      const slotScroll = (set?: number) =>
        bar.evaluate((el, v) => {
          let p = el.parentElement;
          while (p && !/(auto|scroll)/.test(getComputedStyle(p).overflowY)) p = p.parentElement;
          if (!p) return -1;
          if (v != null) p.scrollTop = v;
          return p.scrollTop;
        }, set);
      const slotTop = await slotScroll(300);
      expect(slotTop, '슬롯이 아래로 내려가 있다(전제)').toBeGreaterThan(100);
      const slotSteps: { id: string | null; top: number }[] = [];
      for (const [i, key] of ['Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Tab', 'Tab', 'Tab'].entries()) {
        // 돌아올 때는 바를 맨 왼쪽으로 되돌려 둔다 — 마지막 Tab 에서 잘린 「선택 해제」를 드러내는 스크롤이 슬롯을 세게 둔 채 일어나게.
        if (i === 3) await bar.evaluate((el) => { el.scrollLeft = 0; });
        await page.keyboard.press(key);
        slotSteps.push({ id: (await focusedInBar())?.id ?? null, top: await slotScroll() });
      }
      expect(slotSteps.map((s) => s.id)).toEqual([
        'bulk-delete', 'bulk-assignee-trigger', 'bulk-status-trigger', 'bulk-assignee-trigger', 'bulk-delete', 'bulk-clear',
      ]);
      expect(slotSteps.filter((s) => Math.abs(s.top - slotTop) > 1), '바 단추로 초점이 갈 때 슬롯이 움직였다').toEqual([]);
      expect((await focusedInBar())?.inside, '슬롯을 내린 채에도 Tab 으로 간 「선택 해제」가 바 안에 보인다').toBe(true);

      // 드롭다운 메뉴는 포털이라 바의 overflow 에 잘리지 않는다 — 상태 변경 메뉴가 단추 아래로, 바 높이를 넘어 온전히 펼쳐진다.
      const trigger = page.getByTestId('bulk-status-trigger');
      await trigger.focus();
      await page.keyboard.press('Enter');
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      const triggerBox = (await trigger.boundingBox())!;
      const barBox = (await bar.boundingBox())!;
      const menuBox = (await menu.boundingBox())!;
      expect(menuBox.y, '메뉴가 단추 아래에서 펼쳐진다').toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height - 1);
      expect(menuBox.y + menuBox.height, '메뉴가 바 높이에 잘리지 않고 바 아래로 이어진다').toBeGreaterThan(barBox.y + barBox.height + 20);
      expect(await menu.evaluate((m) => !m.closest('[data-testid="issue-bulk-toolbar"]')), '메뉴는 바 밖(포털)에 있다').toBe(true);

      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();

      // 메뉴 항목(포털)에 초점이 가도 바는 스크롤하지 않는다 — React onFocus 는 포털 자손의 초점에도 바로 버블된다.
      // 담당자 메뉴는 긴 이름 때문에 바 안쪽 오른쪽 선을 넘어 뻗는다 — 항목을 바의 자손으로 잘못 다루면 바가 오른쪽으로 스크롤된다.
      const barLeft = (set?: number) =>
        bar.evaluate((el, v) => {
          if (v != null) el.scrollLeft = v;
          return el.scrollLeft;
        }, set);
      const assigneeTrigger = page.getByTestId('bulk-assignee-trigger');
      await assigneeTrigger.focus();
      await page.keyboard.press('Enter');
      await expect(menu).toBeVisible();
      const leftBefore = await barLeft(0);
      const itemOut = await bar.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return [...document.querySelectorAll('[role="menuitem"]')].some((i) => {
          const b = i.getBoundingClientRect();
          return b.right > r.left + el.clientLeft + el.clientWidth - 12 || b.left < r.left + el.clientLeft + 12;
        });
      });
      expect(itemOut, '메뉴 항목이 바 안쪽 가장자리를 넘는다(전제)').toBe(true);
      for (const [key, id] of [['ArrowDown', 'bulk-assignee-option-10'], ['ArrowUp', 'bulk-assignee-option-unassign']]) {
        await page.keyboard.press(key);
        expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), '초점이 메뉴 항목에 있다').toBe(id);
        expect(await barLeft(), '메뉴 항목 초점에 바가 스크롤됐다').toBe(leftBefore);
      }
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();

      // 반쯤 잘린 「선택 해제」를 마우스로 누르면 그대로 눌린다 — mousedown 초점에 바가 스크롤되면 mouseup 이 다른 곳에 떨어져 클릭이 빗나갔다.
      // 단추 오른쪽이 바 오른쪽 밖으로 잘리게 바를 밀고(넘침이 작으면 맨 왼쪽까지), 보이는 부분의 오른쪽 끝 근처를 누른다 —
      // 마우스 초점에 바가 스크롤되면 단추가 「잘린 만큼 + 여백 12px」 왼쪽으로 가서 누른 자리에서 벗어난다.
      const target = await bar.evaluate((el) => {
        const clear = el.querySelector('[data-testid="bulk-clear"]')!;
        const innerRight = () => el.getBoundingClientRect().left + el.clientLeft + el.clientWidth;
        const c0 = clear.getBoundingClientRect();
        el.scrollLeft += c0.right - innerRight() - c0.width / 2;
        const c = clear.getBoundingClientRect();
        return { x: innerRight() - 2, y: c.top + c.height / 2, cut: c.right - innerRight(), width: c.width, left: el.scrollLeft };
      });
      expect(target.cut, '「선택 해제」 오른쪽이 바 밖으로 잘려 있다(전제)').toBeGreaterThan(4);
      expect(target.width - target.cut, '「선택 해제」 왼쪽은 바 안에 보인다(전제)').toBeGreaterThan(8);
      await page.mouse.move(target.x, target.y);
      await page.mouse.down();
      expect(await barLeft(), '마우스 초점에 바가 스크롤됐다').toBe(target.left);
      await page.mouse.up();
      await expect(bar, '「선택 해제」 클릭이 닿아 바가 사라진다').toHaveCount(0);
    },
  );
});

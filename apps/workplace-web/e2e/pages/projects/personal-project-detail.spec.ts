// 개인 프로젝트 전용 상세 화면 E2E — 브라우저가 있어야 판정되는 것만 남긴다(WP-971).
// 셸 배선(@wiring), 새로고침 유지·history 기반 행 전환(@platform), 포커스·Esc 겹침·날짜 칸 키 입력(@input),
// 헤더 아래 패널 위치·스크롤·무한 로드·글자 변환(@layout).
// 뷰 토글·패널/모달 분기·URL 상태·리다이렉트·빈/오류 상태·행 표시·완료 토글/제목 편집/빠른 추가 payload·409 회복·
// 검색/필터/그룹 쿼리 파라미터는 페이지 테스트 src/pages/projects/personalProjectDetail.test.tsx 가 지킨다.
import { createChatMessagePage, createChatThread } from '../../factories/chat.factory';
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { createLabel, toLabelSummary } from '../../factories/label.factory';
import { createProject } from '../../factories/project.factory';
import { mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';
import { boxOf, expectBelowHeader, expectHeaderBottomAt56 } from '../../fixtures/layout';
import { trackRequests } from '../../fixtures/requests';
import { expectStays } from '../../fixtures/wait';
import type { IssueStatus } from '../../../src/types/issue';

const KEY = 'PME';

// 개인 프로젝트 + 이슈 목록 공통 모킹.
// 공유 툴바(IssueFilterBar) 가 마운트 시 labels/cycles/issue-types 를 페치하므로(개인은 숨김이지만
// 훅은 항상 호출됨) 빈 기본 스텁을 깔아 백엔드 프록시(ECONNREFUSED) 누수를 막는다.
async function mockPersonal(page: import('@playwright/test').Page, issues = [createIssue({ projectKey: KEY })]) {
  const project = createProject({ id: 7, key: KEY, name: '개인 작업', type: 'PERSONAL', isDefault: true });
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}`, project);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/issues`, createIssueSearchResponse(issues));
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/labels`, []);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/cycles`, []);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/types`, []);
  return project;
}

test('개인 프로젝트는 전용 셸과 팀 툴바(개인 옵션)를 렌더한다', { tag: ['@wiring', '@smoke'] }, async ({ authenticatedPage: page }) => {
  await mockPersonal(page);
  await page.goto(`/projects/${KEY}`);

  await expect(page.getByTestId('personal-project-detail')).toBeVisible();
  // 팀 공유 툴바 — 검색 입력 + 뷰토글(체크리스트/보드, aria-pressed).
  await expect(page.getByRole('textbox', { name: '태스크 검색' })).toBeVisible();
  await expect(page.getByRole('button', { name: '체크리스트' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '보드' })).toHaveAttribute('aria-pressed', 'false');
  // 기본은 체크리스트 — 보드 컬럼은 없음.
  await expect(page.getByTestId('personal-checklist')).toBeVisible();
  await expect(page.getByTestId('board-col-1')).toHaveCount(0);
  // 개인 전용 — ＋필터 facet 목록에 상태/우선순위/라벨만 노출, 사이클·유형(팀 전용)은 부재.
  await page.getByTestId('add-filter-trigger').click();
  await expect(page.getByTestId('add-filter-facet-status')).toBeVisible();
  await expect(page.getByTestId('add-filter-facet-priority')).toBeVisible();
  await expect(page.getByTestId('add-filter-facet-label')).toBeVisible();
  await expect(page.getByTestId('add-filter-facet-cycle')).toHaveCount(0);
  await expect(page.getByTestId('add-filter-facet-type')).toHaveCount(0);
  // 완료일 기간 필터(WP-873)는 종료 이슈 기능을 옵트아웃한 개인 화면에 없다 — 팀 목록엔 있다(issue-closed-filter.spec).
  await expect(page.getByTestId('add-filter-facet-closedIn')).toHaveCount(0);
});

// 패널 진입 공통 — 단건 + chat 모킹. number 기본값=1.
async function mockTaskDetail(page: import('@playwright/test').Page, number = 1) {
  const label = createLabel({ id: 5, name: '긴급' });
  const detail = createIssueDetail({
    summary: createIssue({ projectKey: KEY, number, title: '블로그 초안', labels: [toLabelSummary(label)] }),
    body: '서론은 짧게',
  });
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/issues/${number}`, detail);
  const thread = createChatThread();
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/issues/${number}/chat/thread`, thread);
  await mockApi(page, 'GET', `/api/v1/chat/threads/${thread.threadId}/messages`, createChatMessagePage([]));
}

test('행 클릭 → 우측 패널 오픈 + URL ?task 반영 + 새로고침 유지', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
  await mockPersonal(page, [createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })]);
  await mockTaskDetail(page);
  await page.goto(`/projects/${KEY}`);

  // 행 클릭 한 번으로 패널 오픈.
  await page.getByTestId('personal-task-row-1').click();

  await expect(page.getByTestId('personal-task-panel')).toBeVisible();
  await expect(page).toHaveURL(/[?&]task=1/);
  await page.reload();
  await expect(page.getByTestId('personal-task-panel')).toBeVisible();
  await expectPanelBelowHeader(page);
});

// WP-698 — 패널 안 선택 목록을 Esc 로 닫으면 목록만 닫히고 패널은 남는다. 다음 Esc 에서 패널이 닫힌다.
test('패널 안 상태 목록을 Esc 로 닫으면 패널은 남고, 다음 Esc 에 패널이 닫힌다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await mockPersonal(page, [createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })]);
  await mockTaskDetail(page);
  await page.goto(`/projects/${KEY}?task=1`);

  const panel = page.getByTestId('personal-task-panel');
  await panel.getByTestId('issue-status-select').click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(panel).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
});

// 작업 패널은 페이지 헤더 옆(화면 맨 위)이 아니라 헤더 아래 본문 안 보조 칸이다 — 앱 사이드 패널처럼 보이지 않게.
async function expectPanelBelowHeader(page: import('@playwright/test').Page) {
  await expectHeaderBottomAt56(page.getByTestId('page-header'));
  await expectBelowHeader(page.getByTestId('personal-task-panel'));
  // 패널 상단 소제목 줄 — 보조 칸 규격(34px).
  expect((await boxOf(page.getByTestId('personal-task-panel-header'))).height).toBe(34);
}

test('?task= 딥링크 직접 진입 — 작업 패널이 페이지 헤더 아래 보조 칸으로 열린다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await mockPersonal(page, [createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })]);
  await mockTaskDetail(page);
  await page.goto(`/projects/${KEY}?task=1`);

  await expectPanelBelowHeader(page);
  // 편집 가능한 제목은 소제목 줄 아래 본문에 그대로 있다.
  await expect(page.getByTestId('personal-task-panel-title')).toContainText('블로그 초안');
});

// #817 — panel 모드는 Radix Dialog 를 쓰지 않아 열림/닫힘 시 포커스 이동이 전혀 없던 문제 회귀 방지.
test('패널 열림 시 패널로 포커스 이동, 닫힘(같은 행 재클릭) 시 트리거로 복귀한다 (#817)', { tag: '@input' }, async ({
  authenticatedPage: page,
}) => {
  await mockPersonal(page, [createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })]);
  await mockTaskDetail(page);
  await page.goto(`/projects/${KEY}`);

  const row = page.getByTestId('personal-task-row-1');
  await row.click();
  await expect(page.getByTestId('personal-task-panel')).toBeVisible();
  await expect(page.getByTestId('personal-task-panel')).toBeFocused();

  await row.click();
  await expect(page.getByTestId('personal-task-panel')).toHaveCount(0);
  await expect(row).toBeFocused();
});

// 브라우저 history 항목(state.key)으로 낡은 스냅숏을 가르는 useHistoryParam 가드를 지나야 한다 — 페이지 테스트의
// MemoryRouter 는 window.history 를 움직이지 않아 두 번째 이동부터 재현되지 않는다(같은 이유로 #817 의 재클릭 닫힘도 E2E).
test('다른 행 클릭 시 drawer가 해당 이슈로 전환된다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
  await mockPersonal(page, [
    createIssue({ projectKey: KEY, number: 1, title: '작업1', status: 'TODO' }),
    createIssue({ projectKey: KEY, number: 2, title: '작업2', status: 'TODO' }),
  ]);
  await mockTaskDetail(page, 1);
  await mockTaskDetail(page, 2);
  await page.goto(`/projects/${KEY}`);

  // 행1 클릭 → task=1.
  await page.getByTestId('personal-task-row-1').click();
  await expect(page).toHaveURL(/task=1/);
  // URL 은 history push 즉시 바뀌지만 행들은 React 가 다시 그린 뒤에야 새 위치(location.key)를 쥔다. 그 전에 행2 를 누르면
  // useHistoryParam 이 낡은 스냅숏이라 무동작한다 — 행1 이 눌림으로 그려질 때(커밋 뒤)까지 기다린다.
  await expect(page.getByTestId('personal-task-row-1')).toHaveAttribute('aria-pressed', 'true');
  // 행2 클릭 → task=2 로 전환(drawer 유지, 이슈만 교체).
  await page.getByTestId('personal-task-row-2').click();
  await expect(page).toHaveURL(/task=2/);
  await expect(page.getByTestId('personal-task-panel')).toBeVisible();
});

// 마감 편집 검증용 — 하나의 가변 issue 를 목록 GET·단건 GET·PATCH 가 공유한다(PATCH 뒤 재조회에도 새 값이 보이게).
// mockPersonal 이후 호출해 목록 라우트를 가변 버전으로 덮어쓴다(Playwright 라우트는 LIFO).
async function mockTaskDetailEditable(page: import('@playwright/test').Page, number = 1) {
  let issue = createIssue({ projectKey: KEY, number, title: '블로그 초안' });
  const patches = trackRequests(page, 'PATCH', `/api/v1/projects/${KEY}/issues/${number}`);
  // 목록 GET — 현재 issue 로 재구성(무효화 후 재조회 시 새 제목 반영).
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/issues`,
    (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill({ json: createIssueSearchResponse([issue]) });
      return route.fallback();
    },
  );
  // 단건 GET(현재 detail) + PATCH(issue 변이 후 반환).
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/issues/${number}`,
    (route) => {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON() as { title?: string; dueDate?: string };
        if (body.title) issue = { ...issue, title: body.title };
        if (body.dueDate) issue = { ...issue, dueDate: body.dueDate };
      }
      return route.fulfill({ json: createIssueDetail({ summary: issue, body: '서론은 짧게' }) });
    },
  );
  const thread = createChatThread();
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/issues/${number}/chat/thread`, thread);
  await mockApi(page, 'GET', `/api/v1/chat/threads/${thread.threadId}/messages`, createChatMessagePage([]));
  return { patches };
}

// 회귀(WP-94 코드리뷰): sentinel root 인 board-scroll 이 높이를 받지 못하면(실제로 스크롤하지 않는 overflow 요소)
// sentinel 이 늘 root 안이라 보임 판정 → 마운트만으로 전 페이지 연쇄 로드된다. 개인 보드도 높이를 받아 자체 스크롤해야 한다.
// 첫 페이지가 화면보다 길면(스크롤 전) 다음 페이지 요청이 없어야 한다.
test('개인 보드는 스크롤 전에는 컬럼 다음 페이지를 요청하지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockPersonal(page);
  // 컬럼마다 statusId 로 좁혀 조회한다 — 모든 컬럼이 화면보다 길게 채워지도록 요청 status 로 30건을 만든다
  // (빈 컬럼은 sentinel 이 화면 안이라 다음 페이지 로드가 정상 동작이다). id 는 컬럼별로 겹치지 않게 — 보드가 id 로 합친다.
  const STATUS_BASE: Partial<Record<IssueStatus, number>> = { TODO: 500, IN_PROGRESS: 600, DONE: 700 };
  const longPage = (status: IssueStatus) =>
    Array.from({ length: 30 }, (_, i) => {
      const id = (STATUS_BASE[status] ?? 800) + i;
      return createIssue({ id, number: id, projectKey: KEY, status, title: `${status} 긴 컬럼 이슈 ${i}` });
    });
  const nextPages = trackRequests(
    page,
    'GET',
    (u) => u.pathname === `/api/v1/projects/${KEY}/issues` && !!u.searchParams.get('cursor'),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/issues`,
    async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const params = new URL(route.request().url()).searchParams;
      const cursor = params.get('cursor');
      // 컬럼 쿼리는 시드 상태 id(1~3)로 좁혀 온다(WP-808) — 범주로 되돌려 쓴다.
      const status = (({ '2': 'IN_PROGRESS', '3': 'DONE' }) as Record<string, IssueStatus>)[params.get('statusId') ?? ''] ?? 'TODO';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(cursor ? createIssueSearchResponse([]) : createIssueSearchResponse(longPage(status), 'next-1')),
      });
    },
  );

  await page.goto(`/projects/${KEY}?view=board`);
  await expect(page.getByTestId('board-col-1')).toContainText('TODO 긴 컬럼 이슈 29');
  // 연쇄 로드는 sentinel 의 IntersectionObserver 판정 직후 일어난다 — 판정(화면 밖)이 한 번 돈 뒤에 창을 연다.
  const sentinel = page.getByTestId('board-col-more-1');
  await expect(sentinel).toBeAttached();
  await expect(sentinel).not.toBeInViewport();
  await expectStays(page, nextPages.count, 0);
});

// WP-903: 날짜 칸은 연도를 치는 도중에도 「0002-10-23」 같은 완성된 값을 내보낸다 — 그때마다 저장하고 칸을 잠가 마감일을 입력할 수 없었다.
test.describe('개인 작업 마감 키보드 입력 (WP-903)', { tag: '@input' }, () => {
  // 날짜 칸의 칸 순서는 브라우저 언어를 따른다 — 연도를 맨 뒤에 치는 en-US(월/일/연도)로 고정해 재현한다.
  test.use({ locale: 'en-US' });
  test('월·일·연도를 끝까지 치면 완성된 날짜 한 번만 저장한다 — 치는 도중의 연도는 보내지 않는다', async ({ authenticatedPage: page }) => {
    await mockPersonal(page, [createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })]);
    const { patches } = await mockTaskDetailEditable(page);
    await page.goto(`/projects/${KEY}?task=1`);

    const due = page.getByTestId('personal-task-due');
    await due.focus();
    // en-US 칸 순서(월/일/연도) — 연도를 한 자리씩 치는 동안 칸이 잠기지 않아야 끝까지 들어간다.
    await page.keyboard.type('10232026');
    await expect(due).toHaveValue('2026-10-23');
    await expect.poll(() => patches.bodies()).toEqual([{ dueDate: '2026-10-23' }]);
    await expect(due).toBeEnabled();
  });

  test('범위 밖 연도(1800)는 저장하지 않고, 칸에서 초점이 빠지면 안내 뒤 저장된 값으로 돌아간다', async ({ authenticatedPage: page }) => {
    await mockPersonal(page, [createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })]);
    const { patches } = await mockTaskDetailEditable(page);
    await page.goto(`/projects/${KEY}?task=1`);

    const due = page.getByTestId('personal-task-due');
    await due.focus();
    await page.keyboard.type('01011800');
    await expect(due).toHaveValue('1800-01-01');
    // Tab 은 날짜 칸 안의 칸 사이를 옮겨 다녀 칸을 떠나지 않는다 — 칸에서 초점을 뺀다.
    await due.blur();

    await expect(page.getByText('날짜는 1900-01-01 ~ 9999-12-31 사이여야 합니다')).toBeVisible();
    await expect(due).toHaveValue('');
    expect(patches.bodies()).toEqual([]);
  });
});

// ─── 개인 작업 목록 결함 수정(WP-918) ─────────────────────────────────────────────

/** 브라우저와 같은 로컬 날짜 YYYY-MM-DD — 테스트 러너와 브라우저가 같은 시간대라 「오늘」 섹션 데이터를 만들 수 있다. */
function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 커서로 두 페이지를 내주는 개인 목록 스텁 — 1페이지 100건(지남 60·오늘 40, 다음 커서 있음), 2페이지(예정 2·마감 없음 2).
 * 서버 checklist 정렬처럼 섹션 순서대로 나눠 준다. 2페이지 요청은 releasePage2 를 부를 때까지 붙잡아 「불러오는 중」 상태를 볼 수 있다.
 */
async function mockTwoPages(page: import('@playwright/test').Page) {
  const project = createProject({ id: 7, key: KEY, name: '개인 작업', type: 'PERSONAL', isDefault: true });
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}`, project);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/labels`, []);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/cycles`, []);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/types`, []);
  const today = localYmd(new Date());
  const page1 = Array.from({ length: 100 }, (_, i) =>
    createIssue({ id: i + 1, projectKey: KEY, number: i + 1, title: `작업 ${i + 1}`, priority: 'MID', dueDate: i < 60 ? '2020-01-10' : today }),
  );
  const page2 = [
    createIssue({ id: 101, projectKey: KEY, number: 101, title: '예정 작업 A', dueDate: '2099-01-01' }),
    createIssue({ id: 102, projectKey: KEY, number: 102, title: '예정 작업 B', dueDate: '2099-01-02' }),
    createIssue({ id: 103, projectKey: KEY, number: 103, title: '기한 없는 작업 A', dueDate: null }),
    createIssue({ id: 104, projectKey: KEY, number: 104, title: '기한 없는 작업 B', dueDate: null }),
  ];
  let release!: () => void;
  const page2Gate = new Promise<void>((r) => (release = r));
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/issues`,
    async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const cursor = new URL(route.request().url()).searchParams.get('cursor');
      if (!cursor) return route.fulfill({ json: createIssueSearchResponse(page1, 'c1|page2') });
      await page2Gate;
      return route.fulfill({ json: createIssueSearchResponse(page2) });
    },
  );
  return { releasePage2: () => release() };
}

/** 섹션 안 행 testid 목록(그려진 순서). */
async function rowIdsIn(page: import('@playwright/test').Page, section: string) {
  return page
    .getByTestId(`personal-section-${section}`)
    .locator('[data-testid^="personal-task-row-"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
}

/** 목록을 감싼 스크롤 컨테이너를 끝까지 내린다. */
async function scrollListToEnd(page: import('@playwright/test').Page) {
  await page.getByTestId('personal-scroll').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
}

test('스크롤 컨테이너 끝까지 내리면 다음 페이지를 부르고, 위 섹션 행 순서는 그대로다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const { releasePage2 } = await mockTwoPages(page);
  const nextPages = trackRequests(page, 'GET', (url: URL) => url.pathname === `/api/v1/projects/${KEY}/issues` && url.searchParams.has('cursor'));
  await page.goto(`/projects/${KEY}`);
  await expect(page.getByTestId('personal-task-row-100')).toBeAttached();
  // 스크롤 전엔 다음 페이지를 부르지 않는다(sentinel 이 컨테이너 밖).
  await expectStays(page, () => nextPages.count(), 0);
  const overdueBefore = await rowIdsIn(page, 'overdue');
  const todayBefore = await rowIdsIn(page, 'today');
  expect(overdueBefore).toHaveLength(60);

  await scrollListToEnd(page);
  await nextPages.waitFor(1);
  releasePage2();
  await expect(page.getByTestId('personal-task-row-101')).toBeVisible();
  await expect(page.getByTestId('personal-section-upcoming')).toContainText('예정 작업 A');
  await expect(page.getByTestId('personal-section-noDue')).toContainText('기한 없는 작업 B');
  // 위 섹션은 이미 완결 — 새 페이지가 붙어도 행이 끼어들거나 순서가 바뀌지 않는다.
  expect(await rowIdsIn(page, 'overdue')).toEqual(overdueBefore);
  expect(await rowIdsIn(page, 'today')).toEqual(todayBefore);
});

test('불러오는 중인 마지막 섹션은 건수를 숨기고, 다 받으면 보인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const { releasePage2 } = await mockTwoPages(page);
  await page.goto(`/projects/${KEY}`);
  await expect(page.getByTestId('personal-task-row-100')).toBeAttached();
  // 위 섹션(지남)은 완결이라 건수가 정확하다. 마지막 섹션(오늘)은 다음 페이지가 남아 건수를 숨긴다.
  await expect(page.getByTestId('personal-section-count-overdue')).toHaveText('60');
  await expect(page.getByTestId('personal-section-count-today')).toHaveCount(0);

  releasePage2();
  await scrollListToEnd(page);
  await expect(page.getByTestId('personal-task-row-104')).toBeVisible();
  await expect(page.getByTestId('personal-section-count-today')).toHaveText('40');
  await expect(page.getByTestId('personal-section-count-noDue')).toHaveText('2');
});

test('섹션 제목은 대문자 변환 없이 그린다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await mockPersonal(page, [createIssue({ projectKey: KEY, number: 1, title: '할 일', dueDate: null })]);
  await page.goto(`/projects/${KEY}`);
  const h3 = page.getByTestId('personal-section-noDue').locator('h3');
  await expect(h3).toBeVisible();
  expect(await h3.evaluate((el) => getComputedStyle(el).textTransform)).toBe('none');
});

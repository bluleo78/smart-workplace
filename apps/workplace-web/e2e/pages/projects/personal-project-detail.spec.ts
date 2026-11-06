// 개인 프로젝트 전용 상세 화면 E2E — 브라우저가 있어야 판정되는 것만 남긴다(WP-971).
// 셸 배선(@wiring), 새로고침 유지·history 기반 행 전환(@platform), 포커스·Esc 겹침·날짜 칸 키 입력(@input),
// 상세 모달·채팅 서랍 기하·스크롤·무한 로드·글자 변환(@layout).
// 뷰 토글·상세 모달·메모 편집·채팅 서랍 URL·URL 상태·리다이렉트·빈/오류 상태·행 표시·완료 토글/제목 편집/빠른 추가 payload·409 회복·
// 검색/필터/그룹 쿼리 파라미터는 페이지 테스트 src/pages/projects/personalProjectDetail.test.tsx 가 지킨다.
import { createChatMessagePage, createChatThread } from '../../factories/chat.factory';
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { createLabel, toLabelSummary } from '../../factories/label.factory';
import { createProject } from '../../factories/project.factory';
import { mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';
import { boxOf } from '../../fixtures/layout';
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
  await expect(page.getByRole('textbox', { name: '태스크 필터: 제목·키' })).toBeVisible();
  await expect(page.getByRole('button', { name: '체크리스트' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '보드' })).toHaveAttribute('aria-pressed', 'false');
  // 기본은 체크리스트 — 보드 컬럼은 없음.
  await expect(page.getByTestId('personal-checklist')).toBeVisible();
  await expect(page.getByTestId('board-col-1')).toHaveCount(0);
  // 개인 전용 — 빠른 필터 칩은 상태·우선순위, 「더 보기」에 상태 범주·라벨, 사이클·유형(팀 전용)은 부재(WP-1020).
  await expect(page.getByTestId('quick-filter-statusId-trigger')).toBeVisible();
  await expect(page.getByTestId('quick-filter-priority-trigger')).toBeVisible();
  await page.getByTestId('quick-filter-more').click();
  await expect(page.getByTestId('quick-filter-more-facet-status')).toBeVisible();
  await expect(page.getByTestId('quick-filter-more-facet-label')).toBeVisible();
  await expect(page.getByTestId('quick-filter-more-facet-cycle')).toHaveCount(0);
  await expect(page.getByTestId('quick-filter-more-facet-type')).toHaveCount(0);
  // 완료일 기간 필터(WP-873)는 종료 이슈 기능을 옵트아웃한 개인 화면에 없다 — 팀 목록엔 있다(issue-closed-filter.spec).
  await expect(page.getByTestId('quick-filter-more-facet-closedIn')).toHaveCount(0);
});

// 상세 진입 공통 — 단건 + chat 모킹. number 기본값=1.
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

test('행 클릭 → 상세 모달 오픈 + URL ?task 반영 + 새로고침 유지', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
  await mockPersonal(page, [createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })]);
  await mockTaskDetail(page);
  await page.goto(`/projects/${KEY}`);

  // 행 클릭 한 번으로 넓은 모달 오픈(WP-1374).
  await page.getByTestId('personal-task-row-1').click();

  await expect(page.getByTestId('personal-task-modal')).toBeVisible();
  await expect(page).toHaveURL(/[?&]task=1/);
  await page.reload();
  await expect(page.getByTestId('personal-task-modal')).toBeVisible();
  await expect(page.getByTestId('personal-task-panel-title')).toContainText('블로그 초안');
});

// WP-698 — 모달 안 선택 목록을 Esc 로 닫으면 목록만 닫히고 모달은 남는다. 다음 Esc 에서 모달이 닫힌다.
test('모달 안 상태 목록을 Esc 로 닫으면 모달은 남고, 다음 Esc 에 모달이 닫힌다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await mockPersonal(page, [createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })]);
  await mockTaskDetail(page);
  await page.goto(`/projects/${KEY}?task=1`);

  const modal = page.getByTestId('personal-task-modal');
  await modal.getByTestId('issue-status-select').click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(modal).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
});

// WP-1374 — 넓은 모달은 1440×900 화면 안에 들어오고, 메모 칸과 속성 레일은 겹치지 않는다.
// 채팅 서랍은 모달 위(겹침 순서)에서 화면 오른쪽 끝에 붙고 화면 안에 들어온다.
test('넓은 모달은 화면 안, 메모·속성 레일은 나란히 겹치지 않고, 채팅 서랍은 모달 위 오른쪽 끝에 붙는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockPersonal(page, [createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })]);
  await mockTaskDetail(page);
  await page.goto(`/projects/${KEY}?task=1`);

  const modal = page.getByTestId('personal-task-modal');
  // 열림 애니메이션(zoom-in)이 끝난 크기로 잰다.
  await expect.poll(async () => Math.round((await boxOf(modal)).width)).toBe(1120);
  const m = await boxOf(modal);
  expect(m.x).toBeGreaterThanOrEqual(0);
  expect(m.x + m.width).toBeLessThanOrEqual(1440);
  expect(m.y).toBeGreaterThanOrEqual(0);
  expect(m.y + m.height).toBeLessThanOrEqual(900);
  // 높이 85vh(765px).
  expect(Math.round(m.height)).toBe(765);

  const memo = await boxOf(page.getByTestId('personal-task-memo'));
  const rail = await boxOf(page.getByTestId('personal-task-rail'));
  // 메모는 왼쪽, 레일은 오른쪽 — 가로로 겹치지 않고 같은 줄에서 시작한다. 둘 다 모달 안.
  expect(memo.x + memo.width).toBeLessThanOrEqual(rail.x + 0.5);
  expect(Math.abs(memo.y - rail.y)).toBeLessThanOrEqual(1);
  expect(memo.width).toBeGreaterThan(rail.width);
  expect(rail.x + rail.width).toBeLessThanOrEqual(m.x + m.width + 0.5);

  // 머리의 채팅 버튼 → 서랍.
  await modal.getByTestId('issue-chat-open').click();
  const drawer = page.getByTestId('issue-chat-drawer');
  await expect(page).toHaveURL(/[?&]chat=1/);
  // 밀려 들어오는 애니메이션(slide-in)이 끝나 오른쪽 끝에 닿을 때까지.
  await expect.poll(async () => { const d = await boxOf(drawer); return Math.round(d.x + d.width); }).toBe(1440);
  const d = await boxOf(drawer);
  expect(d.x).toBeGreaterThanOrEqual(0);
  expect(d.y).toBeGreaterThanOrEqual(0);
  expect(Math.round(d.y + d.height)).toBeLessThanOrEqual(900);
  // 서랍이 모달 위 — 서랍과 모달이 겹치는 자리의 맨 위 요소가 서랍 안이다.
  const overlapX = Math.max(d.x, m.x) + 10;
  const onTop = await page.evaluate(
    ([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-testid="issue-chat-drawer"]'),
    [overlapX, m.y + m.height / 2],
  );
  expect(overlapX).toBeLessThan(m.x + m.width);
  expect(onTop).toBe(true);
});

// 포커스·ESC 순서 — 모달 위 서랍은 Esc 한 번에 서랍만 닫히고 포커스가 모달의 채팅 버튼으로 돌아온다.
// 다음 Esc 가 모달을 닫고 포커스는 연 행으로 돌아온다(#817 — 열림/닫힘 포커스 이동).
test('서랍 Esc → 서랍만 닫혀 채팅 버튼으로 포커스, 다음 Esc → 모달이 닫혀 연 행으로 포커스', { tag: '@input' }, async ({
  authenticatedPage: page,
}) => {
  await mockPersonal(page, [createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })]);
  await mockTaskDetail(page);
  await page.goto(`/projects/${KEY}`);

  const row = page.getByTestId('personal-task-row-1');
  await row.click();
  const modal = page.getByTestId('personal-task-modal');
  await expect(modal).toBeVisible();
  // 열리면 포커스가 모달 안으로 옮겨진다.
  await expect.poll(() => modal.evaluate((el) => el.contains(document.activeElement))).toBe(true);

  const chatButton = modal.getByTestId('issue-chat-open');
  await chatButton.click();
  const drawer = page.getByTestId('issue-chat-drawer');
  await expect(drawer).toBeVisible();
  await expect.poll(() => drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);

  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(modal).toBeVisible();
  await expect(page).not.toHaveURL(/[?&]chat=/);
  await expect(chatButton).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]task=/);
  await expect(row).toBeFocused();
});

// 브라우저 history 항목(state.key)으로 낡은 스냅숏을 가르는 useHistoryParam 가드를 지나야 한다 — 페이지 테스트의
// MemoryRouter 는 window.history 를 움직이지 않아 두 번째 이동부터 재현되지 않는다.
test('모달을 닫고 다른 행을 누르면 그 작업으로 다시 열린다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
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
  await expect(page.getByTestId('personal-task-modal')).toBeVisible();
  // 닫기(뒤로) → 행들이 새 위치(location.key)를 쥘 때까지(눌림 해제) 기다린다 — 그 전에 누르면 낡은 스냅숏이라 무동작한다.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('personal-task-modal')).toHaveCount(0);
  await expect(page.getByTestId('personal-task-row-1')).toHaveAttribute('aria-pressed', 'false');
  // 행2 클릭 → task=2 모달.
  await page.getByTestId('personal-task-row-2').click();
  await expect(page).toHaveURL(/task=2/);
  await expect(page.getByTestId('personal-task-modal')).toBeVisible();
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

// WP-1373 — 「몇 시간마다」를 고르면 간격·시간대·요일이 펼쳐져 「AI 에게 맡기기」 팝오버가 남은 높이보다 커진다.
// 트리거가 화면 가운데쯤(작업 패널)에 있으면 팝오버 위가 화면 밖으로 잘려 담당 AI·칩 줄이 안 보였다 —
// 팝오버는 Radix 가 주는 남은 높이 안에 머물고, 넘치는 내용은 팝오버 안에서 스크롤해야 한다.
test('「몇 시간마다」를 골라 팝오버가 커져도 화면 안에 머물고 넘치면 팝오버 안에서 스크롤한다(WP-1373)', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await mockPersonal(page, [createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })]);
  await mockTaskDetail(page);
  // 반복 없음(빈 본문) + 담당 AI 후보 하나(내 AI 비서).
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/issues/1/recurrence`, null);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/issues/1/recurrence/agents`, [
    { id: 900, username: 'my-assistant', name: '내 비서', personalAssistant: true },
  ]);
  await page.goto(`/projects/${KEY}?task=1`);

  const trigger = page.getByTestId('task-recurrence-trigger');
  await expect(trigger).toBeEnabled();
  await trigger.click();
  const popover = page.getByTestId('task-recurrence-popover');
  await popover.getByRole('button', { name: '몇 시간마다' }).click();
  await expect(popover.getByTestId('task-recurrence-hourly')).toBeVisible();
  // WP-1413: 시간대를 켜면 「[시작] ~ [끝]」 칸이 더 펼쳐진다 — 가장 키가 큰 모양에서 본다. 두 시각 칸은 시안대로 한 줄에 놓이고,
  // 간격 칩 뒤의 「시간마다」도 칩과 같은 줄이다(320px 팝오버에서 꺾이지 않는다).
  await popover.getByRole('switch', { name: '시간대 정하기' }).click();
  const [start, until, chip12, unit] = await Promise.all([
    boxOf(popover.getByTestId('task-recurrence-start')),
    boxOf(popover.getByTestId('task-recurrence-until')),
    boxOf(popover.getByRole('button', { name: '12시간마다' })),
    boxOf(popover.getByTestId('task-recurrence-hourly').getByText('시간마다', { exact: true })),
  ]);
  expect(Math.abs(start.y - until.y), `시작 y ${start.y} vs 끝 y ${until.y}`).toBeLessThanOrEqual(1);
  expect(unit.x, `「시간마다」 x ${unit.x} vs 12 칩 끝 ${chip12.x + chip12.width}`).toBeGreaterThanOrEqual(chip12.x + chip12.width);
  expect(Math.abs(unit.y + unit.height / 2 - (chip12.y + chip12.height / 2))).toBeLessThanOrEqual(2);

  // 팝오버 상자가 화면(0~900) 안에 온전히 있다 — 위가 잘리지 않는다.
  // 넓은 모달(WP-1374) 안에서는 트리거 위치가 소수 픽셀이라 아래 끝이 900.5 처럼 반 픽셀 걸칠 수 있다 — 1px 오차는 잘림이 아니다.
  const box = await boxOf(popover);
  expect(box.y, `팝오버 위 y: ${box.y}`).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, `팝오버 아래 y: ${box.y + box.height}`).toBeLessThanOrEqual(901);
  // 첫 줄(담당 AI)이 화면 안에 보인다.
  const agent = await boxOf(popover.getByTestId('task-recurrence-agent'));
  expect(agent.y).toBeGreaterThanOrEqual(0);
  // 내용이 남은 높이보다 크면 팝오버 안에서 스크롤한다 — 아니면 그냥 다 들어간다.
  const { scrollHeight, clientHeight, overflowY } = await popover.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    overflowY: getComputedStyle(el).overflowY,
  }));
  if (scrollHeight > clientHeight) expect(overflowY).toBe('auto');
  else expect(box.height).toBeGreaterThanOrEqual(scrollHeight - 1);
});

// WP-1388 — 「AI 에게 맡기기」 요약 버튼이 공용 Button 의 한 줄 고정(whitespace-nowrap·h-8)이라, 긴 담당 AI 이름 + 「몇 시간마다」 문구가
// 속성 레일(300px) 밖으로 넘쳐 잘렸다. 긴 문구는 레일 폭 안에서 줄바꿈해 모두 보이고, 짧은 문구는 예전처럼 한 줄 높이를 지킨다.
// WP-1413 — 요약을 두 줄(1줄 AI 이름, 2줄 반복 아이콘 + 일정)로 나눴다. 레일 폭에서 각 줄이 한 줄로 머물고(일정이 이름과 섞여 꺾이지 않고)
// 버튼이 레일 밖으로 넘치지 않는지 본다. jsdom 은 줄바꿈·넘침을 잴 수 없어 브라우저에서 기하로 확인한다.
for (const c of [
  {
    name: '긴 AI 이름 + 시간대 있는 몇 시간마다',
    rrule: 'FREQ=HOURLY;INTERVAL=1;BYDAY=MO,WE,FR;UNTILTIME=18:00',
    time: '09:00',
    agentName: 'AI 이슈 관리자 운영팀',
    schedule: '월·수·금 09~18시 · 1시간마다',
    short: false,
  },
  {
    name: '시안의 「평일 07~21시 · 2시간마다」',
    rrule: 'FREQ=HOURLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR;UNTILTIME=21:00',
    time: '07:00',
    agentName: 'AI 이슈 관리자',
    schedule: '평일 07~21시 · 2시간마다',
    short: false,
  },
  {
    name: '짧은 문구는 글자 폭만큼만 차지한다',
    rrule: 'FREQ=WEEKLY;BYDAY=MO',
    time: '08:30',
    agentName: '내 AI 비서',
    schedule: '매주 월 08:30',
    short: true,
  },
]) {
  test(`「AI 에게 맡기기」 요약 버튼 두 줄: ${c.name}(WP-1388·WP-1413)`, { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await mockPersonal(page, [createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })]);
    await mockTaskDetail(page);
    await mockApi(page, 'GET', `/api/v1/projects/${KEY}/issues/1/recurrence`, {
      rrule: c.rrule,
      time: c.time,
      enabled: true,
      nextRunAt: null,
      consecutiveFailures: 0,
      lastRunAt: null,
      agentUserId: 900,
      agentName: c.agentName,
      editable: true,
      testRunning: false,
    });
    await page.goto(`/projects/${KEY}?task=1`);

    const trigger = page.getByTestId('task-recurrence-trigger');
    const agentLine = trigger.getByTestId('task-recurrence-trigger-agent');
    const scheduleLine = trigger.getByTestId('task-recurrence-trigger-schedule');
    // 문구 전체가 말줄임 없이 두 줄로 들어 있다.
    await expect(agentLine).toHaveText(c.agentName);
    await expect(scheduleLine).toHaveText(c.schedule);

    // 트리거 오른쪽 끝이 레일 안쪽(오른쪽 padding 을 뺀 끝)을 넘지 않는다 — 소수 픽셀 1px 오차는 허용.
    const rail = page.getByTestId('personal-task-rail');
    const [t, r, a, sc, railPadRight, { scrollWidth, clientWidth }, lineHeights] = await Promise.all([
      boxOf(trigger),
      boxOf(rail),
      boxOf(agentLine),
      boxOf(scheduleLine),
      rail.evaluate((el) => parseFloat(getComputedStyle(el).paddingRight)),
      trigger.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth })),
      Promise.all([agentLine, scheduleLine].map((l) => l.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight)))),
    ]);
    const railInnerRight = r.x + r.width - railPadRight;
    expect(t.x + t.width, `트리거 끝 ${t.x + t.width} vs 레일 안쪽 끝 ${railInnerRight}`).toBeLessThanOrEqual(railInnerRight + 1);
    // 글자가 버튼 밖으로 넘치지 않는다(가로 스크롤 폭 = 보이는 폭).
    expect(scrollWidth, `scrollWidth ${scrollWidth} vs clientWidth ${clientWidth}`).toBeLessThanOrEqual(clientWidth + 1);
    // 각 줄은 한 줄 높이 그대로다 — 이름·일정이 레일 폭에서 꺾이지 않는다.
    expect(a.height, `이름 줄 높이 ${a.height} vs 줄 높이 ${lineHeights[0]}`).toBeLessThanOrEqual(lineHeights[0] + 1);
    expect(sc.height, `일정 줄 높이 ${sc.height} vs 줄 높이 ${lineHeights[1]}`).toBeLessThanOrEqual(lineHeights[1] + 1);
    // 일정 줄은 이름 줄 아래에 있다.
    expect(sc.y).toBeGreaterThanOrEqual(a.y + a.height - 1);
    // 짧은 문구는 레일 폭으로 늘어나지 않고 글자 폭만큼만 차지한다(옆 피커들과 같은 모양).
    if (c.short) expect(t.width, `짧은 문구 폭 ${t.width} vs 레일 안쪽 폭 ${railInnerRight - r.x}`).toBeLessThan(railInnerRight - r.x - 40);
  });
}

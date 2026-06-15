// 개인 프로젝트 전용 상세 화면 E2E — 분기/뷰 토글/패널/리다이렉트/필드 다이어트.
// 전 구간 page.route 모킹(백엔드 무관). 모킹 데이터는 실제 타입(factory) 사용.
import { createChatMessagePage, createChatThread } from '../../factories/chat.factory';
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { systemTypes } from '../../factories/issueType.factory';
import { createLabel, toLabelSummary } from '../../factories/label.factory';
import { createProject } from '../../factories/project.factory';
import { mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';

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

test('개인 프로젝트는 전용 셸과 팀 툴바(개인 옵션)를 렌더한다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await mockPersonal(page);
  await page.goto(`/projects/${KEY}`);

  await expect(page.getByTestId('personal-project-detail')).toBeVisible();
  // 팀 공유 툴바 — 검색 입력 + 뷰토글(체크리스트/보드, aria-pressed).
  await expect(page.getByRole('textbox', { name: '태스크 검색' })).toBeVisible();
  await expect(page.getByRole('button', { name: '체크리스트' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '보드' })).toHaveAttribute('aria-pressed', 'false');
  // 기본은 체크리스트 — 보드 컬럼은 없음.
  await expect(page.getByTestId('personal-checklist')).toBeVisible();
  await expect(page.getByTestId('board-col-TODO')).toHaveCount(0);
  // 개인 전용 — ＋필터 facet 목록에 상태/우선순위/라벨만 노출, 사이클·유형(팀 전용)은 부재.
  await page.getByTestId('add-filter-trigger').click();
  await expect(page.getByTestId('add-filter-facet-status')).toBeVisible();
  await expect(page.getByTestId('add-filter-facet-priority')).toBeVisible();
  await expect(page.getByTestId('add-filter-facet-label')).toBeVisible();
  await expect(page.getByTestId('add-filter-facet-cycle')).toHaveCount(0);
  await expect(page.getByTestId('add-filter-facet-type')).toHaveCount(0);
});

// 뷰 토글 — 공유 툴바 setView 는 URL 을 필터+view+group 으로 재구성한다(task 등 임시 파라미터 비보존).
// 따라서 보드↔체크리스트 전환 시 열린 drawer(task=)는 닫힌다. (additive 규율 유지 — IssueFilterBar 무변경)
test('뷰 토글 클릭 시 view 가 전환되고 열린 drawer(task)는 닫힌다', async ({ authenticatedPage: page }) => {
  await mockPersonal(page);
  await page.goto(`/projects/${KEY}?task=1`);

  // 패널은 인플로우(콘텐츠를 밀어 공존)라 뷰토글을 가리지 않는다(#231 해소).
  await page.getByRole('button', { name: '보드' }).click();
  await expect(page).toHaveURL(/view=board/);
  await expect(page).not.toHaveURL(/task=1/);

  // view=list 는 URL 키 생략(filtersToParams 기본값) → ?view= 부재.
  await page.getByRole('button', { name: '체크리스트' }).click();
  await expect(page).not.toHaveURL(/view=/);
});

test('체크리스트는 작업 행과 AI 위임 배지를 렌더한다', async ({ authenticatedPage: page }) => {
  const agent = { id: 99, username: 'ai', name: 'AI', kind: 'AGENT' as const };
  await mockPersonal(page, [
    createIssue({ projectKey: KEY, number: 1, title: '블로그 초안', status: 'IN_PROGRESS', assignees: [agent] }),
    createIssue({ projectKey: KEY, number: 2, title: '운동 계획', status: 'TODO', assignees: [] }),
    createIssue({ projectKey: KEY, number: 3, title: '주간 회고', status: 'TODO', assignees: [agent] }),
  ]);
  await page.goto(`/projects/${KEY}`);

  await expect(page.getByTestId('personal-task-row-1')).toContainText('블로그 초안');
  await expect(page.getByTestId('personal-task-row-2')).toContainText('운동 계획');
  // AGENT 담당 + 진행중 → "처리중" 아바타(텍스트 없음, title 로 상태). 비위임 행엔 배지 없음.
  await expect(page.getByTestId('ai-delegation-badge-1')).toHaveAttribute('title', /처리중/);
  await expect(page.getByTestId('ai-delegation-badge-2')).toHaveCount(0);
  // AGENT 담당 + TODO → "위임" 아바타(아직 처리 시작 전).
  await expect(page.getByTestId('ai-delegation-badge-3')).toHaveAttribute('title', /위임/);
  await expect(page.getByTestId('ai-delegation-badge-3')).not.toHaveAttribute('title', /처리중/);
});

test('보드 뷰는 팀 리치카드를 상태 3컬럼으로 배치한다(CANCELED 컬럼 부재)', async ({ authenticatedPage: page }) => {
  await mockPersonal(page, [
    createIssue({ projectKey: KEY, number: 1, title: '할일카드', status: 'TODO' }),
    createIssue({ projectKey: KEY, number: 2, title: '진행카드', status: 'IN_PROGRESS' }),
    createIssue({ projectKey: KEY, number: 3, title: '완료카드', status: 'DONE' }),
    createIssue({ projectKey: KEY, number: 4, title: '취소카드', status: 'CANCELED' }),
  ]);
  await page.goto(`/projects/${KEY}?view=board`);

  // 팀 공유 보드 컬럼(board-col-*) + 팀 리치카드(issue-card-N).
  await expect(page.getByTestId('board-col-TODO')).toContainText('할일카드');
  await expect(page.getByTestId('board-col-IN_PROGRESS')).toContainText('진행카드');
  await expect(page.getByTestId('board-col-DONE')).toContainText('완료카드');
  await expect(page.getByTestId('issue-card-1')).toBeVisible();
  // CANCELED 컬럼 자체가 없고(개인 3컬럼), 취소 카드도 렌더되지 않는다.
  await expect(page.getByTestId('board-col-CANCELED')).toHaveCount(0);
  await expect(page.getByTestId('issue-card-4')).toHaveCount(0);
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

test('행 클릭 → 우측 패널 오픈 + URL ?task 반영 + 새로고침 유지', async ({ authenticatedPage: page }) => {
  await mockPersonal(page, [createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })]);
  await mockTaskDetail(page);
  await page.goto(`/projects/${KEY}`);

  // 행 클릭 한 번으로 패널 오픈.
  await page.getByTestId('personal-task-row-1').click();

  await expect(page.getByTestId('personal-task-panel')).toBeVisible();
  await expect(page).toHaveURL(/[?&]task=1/);
  await page.reload();
  await expect(page.getByTestId('personal-task-panel')).toBeVisible();
});

test('패널은 라벨·AI 대화 노출 / 사이클·의존성·커스텀필드·watch 미노출', async ({ authenticatedPage: page }) => {
  await mockPersonal(page, [createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })]);
  await mockTaskDetail(page);
  await page.goto(`/projects/${KEY}?task=1`);

  const panel = page.getByTestId('personal-task-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('긴급'); // 라벨
  await expect(panel.getByTestId('personal-panel-chat')).toBeVisible(); // AI 대화
  await expect(panel.getByText('사이클')).toHaveCount(0);
  await expect(panel.getByText('의존성')).toHaveCount(0);
  await expect(panel.getByText('구독')).toHaveCount(0);
});

test('보드 카드(링크) 클릭 → ?task=N drawer 오픈(풀페이지 이동 아님)', async ({ authenticatedPage: page }) => {
  await mockPersonal(page, [createIssue({ projectKey: KEY, number: 1, title: '블로그 초안', status: 'TODO' })]);
  await mockTaskDetail(page);
  await page.goto(`/projects/${KEY}?view=board`);
  // 카드 제목 Link 클릭 — cardTo 가 ?view=board&task=1 로 라우팅(같은 라우트, drawer 오픈).
  await page.getByTestId('issue-card-1').getByRole('link').click();
  await expect(page).toHaveURL(/view=board/);
  await expect(page).toHaveURL(/[?&]task=1/);
  // 보드 뷰는 중앙 모달로 상세를 표시한다(인플로우 패널 아님, #231).
  await expect(page.getByTestId('personal-task-modal')).toBeVisible();
  await expect(page.getByTestId('personal-task-panel')).toHaveCount(0);
  // 풀페이지 상세 경로(/issues/1)로 이동하지 않았다.
  await expect(page).not.toHaveURL(/\/issues\/1/);
});

test('리스트/체크리스트는 인플로우 사이드 패널, 보드는 모달로 상세 표시 (#231)', async ({ authenticatedPage: page }) => {
  await mockPersonal(page, [createIssue({ projectKey: KEY, number: 1, title: '블로그 초안', status: 'TODO' })]);
  await mockTaskDetail(page);
  // 체크리스트(기본 뷰) → 인플로우 사이드 패널, 모달 부재.
  await page.goto(`/projects/${KEY}?task=1`);
  await expect(page.getByTestId('personal-task-panel')).toBeVisible();
  await expect(page.getByTestId('personal-task-modal')).toHaveCount(0);
  // 보드로 전환 → 패널은 인플로우라 뷰토글을 가리지 않으므로 정상 클릭 가능(#231 해소).
  await page.getByRole('button', { name: '보드' }).click();
  await expect(page).toHaveURL(/view=board/);

  // 보드 뷰 직접 진입 → 모달, 패널 부재
  await page.goto(`/projects/${KEY}?view=board&task=1`);
  await expect(page.getByTestId('personal-task-modal')).toBeVisible();
  await expect(page.getByTestId('personal-task-panel')).toHaveCount(0);
});

test('패널 — 존재하지 않는 task id 진입 시 오류 메시지와 닫기 버튼을 표시한다', async ({ authenticatedPage: page }) => {
  await mockPersonal(page);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/issues/999`, { message: 'not found' }, { status: 404 });
  await page.goto(`/projects/${KEY}?task=999`);
  await expect(page.getByTestId('personal-task-panel-notfound')).toBeVisible();
  await page.getByTestId('personal-task-panel-notfound').getByRole('button', { name: '닫기' }).click();
  await expect(page).not.toHaveURL(/task=/);
});

test('개인 프로젝트의 풀페이지 이슈 URL 은 패널로 리다이렉트된다', async ({ authenticatedPage: page }) => {
  await mockPersonal(page, [createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })]);
  await mockTaskDetail(page);
  // 알림/북마크가 가리키는 풀페이지 경로로 직접 진입.
  await page.goto(`/projects/${KEY}/issues/1`);
  // → /projects/PME?task=1 로 치환되고 패널이 열린다.
  await expect(page).toHaveURL(new RegExp(`/projects/${KEY}\\?task=1`));
  await expect(page.getByTestId('personal-task-panel')).toBeVisible();
});

test('체크 토글 클릭 → PATCH { status: DONE } 호출 + 완료 스타일 반영', async ({ authenticatedPage: page }) => {
  // 가변 상태 — PATCH 후 GET 재조회가 DONE 을 반영하도록 한다.
  let issue = createIssue({ projectKey: KEY, number: 1, title: '운동 계획', status: 'TODO' });
  const project = createProject({ id: 7, key: KEY, name: '개인 작업', type: 'PERSONAL', isDefault: true });
  // pathname 매칭(쿼리스트링 무시) — 글롭은 ?size=… 가 붙으면 매칭 실패하므로 predicate 사용.
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}`,
    (route) => route.fulfill({ json: project }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/issues`,
    (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill({ json: createIssueSearchResponse([issue]) });
      return route.fallback();
    },
  );
  let patchBody: unknown;
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/issues/1`,
    (route) => {
      if (route.request().method() === 'PATCH') {
        patchBody = route.request().postDataJSON();
        issue = { ...issue, status: 'DONE' };
        return route.fulfill({ json: issue });
      }
      return route.fallback();
    },
  );

  await page.goto(`/projects/${KEY}`);
  // 상태아이콘 버튼 클릭 = 완료 토글(행 클릭 이벤트 차단 → drawer 열리지 않음).
  await page.getByTestId('personal-task-check-1').click();
  await expect.poll(() => patchBody).toEqual({ status: 'DONE' });
  // 체크 후 drawer가 열리지 않아야 함.
  await expect(page.getByTestId('personal-task-panel')).toHaveCount(0);
  // DONE 이슈는 완료 섹션으로 이동 → 섹션 펼침 후 취소선 확인.
  await page.getByTestId('personal-section-done').getByRole('button').click();
  await expect(page.getByTestId('personal-task-row-1').locator('.line-through')).toContainText('운동 계획');
});

// ─── 신규 테스트 ───────────────────────────────────────────────────────────────

test('마감 기준 섹션 그룹화 — 과거=overdue, 먼미래=upcoming, 기한없음=noDue, 완료=done(접힘)', async ({ authenticatedPage: page }) => {
  await mockPersonal(page, [
    // 명확히 과거 날짜 → overdue
    createIssue({ projectKey: KEY, number: 1, title: '지난작업', status: 'TODO', dueDate: '2020-01-01' }),
    // 명확히 먼 미래 → upcoming
    createIssue({ projectKey: KEY, number: 2, title: '미래작업', status: 'TODO', dueDate: '2999-12-31' }),
    // 기한 없음 → noDue
    createIssue({ projectKey: KEY, number: 3, title: '기한없음', status: 'TODO', dueDate: undefined }),
    // 완료 → done 섹션(접힘)
    createIssue({ projectKey: KEY, number: 4, title: '완료작업', status: 'DONE', dueDate: undefined }),
    // 취소 → 숨김(어느 섹션에도 없음)
    createIssue({ projectKey: KEY, number: 5, title: '취소작업', status: 'CANCELED', dueDate: undefined }),
  ]);
  await page.goto(`/projects/${KEY}`);

  await expect(page.getByTestId('personal-section-overdue')).toContainText('지난작업');
  await expect(page.getByTestId('personal-section-upcoming')).toContainText('미래작업');
  await expect(page.getByTestId('personal-section-noDue')).toContainText('기한없음');
  // 완료는 접혀있어 기본 비표시.
  await expect(page.getByTestId('personal-section-done')).toBeVisible(); // 섹션 버튼은 보임
  await expect(page.getByTestId('personal-task-row-4')).toHaveCount(0); // 행은 숨김
  // 취소는 어느 섹션에도 없음.
  await expect(page.getByTestId('personal-task-row-5')).toHaveCount(0);
});

test('행에 우선순위(막대)·라벨·짧은 마감 텍스트가 렌더된다', async ({ authenticatedPage: page }) => {
  const label = createLabel({ id: 5, name: '긴급' });
  // 오늘 마감 — formatDueShort 가 "오늘" 출력하는지 확인용(고정 날짜 대신 오늘 기준).
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  await mockPersonal(page, [
    createIssue({
      projectKey: KEY,
      number: 1,
      title: '중요작업',
      status: 'TODO',
      priority: 'HIGH',
      dueDate: '2020-01-10', // 명확히 지난 날 → "2020년 1월 10일" + text-destructive
      labels: [toLabelSummary(label)],
    }),
    // 오늘 마감 → "오늘" 짧은 포맷.
    createIssue({ projectKey: KEY, number: 2, title: '오늘작업', status: 'TODO', priority: 'MID', dueDate: todayStr }),
  ]);
  await page.goto(`/projects/${KEY}`);

  const row = page.getByTestId('personal-task-row-1');
  await expect(row).toContainText('중요작업');
  await expect(row).toContainText('긴급'); // 라벨(outline 칩, 텍스트 유지)
  // 우선순위는 막대 아이콘으로 표현 → 텍스트 배지("높음") 없음, data-priority 로 확인.
  await expect(row).toHaveAttribute('data-priority', 'HIGH');
  await expect(row).not.toContainText('높음');
  // 지난 마감 → 짧은 포맷(연도 포함) + text-destructive 색.
  await expect(row.locator('span.text-destructive')).toContainText('2020년 1월 10일');
  // 오늘 마감 행 → "오늘" 짧은 포맷, data-priority='MID'.
  const today2 = page.getByTestId('personal-task-row-2');
  await expect(today2).toHaveAttribute('data-priority', 'MID');
  await expect(today2).toContainText('오늘');
});

test('행 data-status 속성이 이슈 상태와 일치한다', async ({ authenticatedPage: page }) => {
  await mockPersonal(page, [
    createIssue({ projectKey: KEY, number: 1, title: '진행중작업', status: 'IN_PROGRESS' }),
  ]);
  await page.goto(`/projects/${KEY}`);

  await expect(page.getByTestId('personal-task-row-1')).toHaveAttribute('data-status', 'IN_PROGRESS');
});

test('drawer ESC 키로 닫힘 + URL에서 task 제거', async ({ authenticatedPage: page }) => {
  await mockPersonal(page, [createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })]);
  await mockTaskDetail(page);
  await page.goto(`/projects/${KEY}?task=1`);

  await expect(page.getByTestId('personal-task-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('personal-task-panel')).toHaveCount(0);
  await expect(page).not.toHaveURL(/task=/);
});

test('같은 행 재클릭 시 drawer 닫힘(토글)', async ({ authenticatedPage: page }) => {
  await mockPersonal(page, [createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })]);
  await mockTaskDetail(page);
  await page.goto(`/projects/${KEY}`);

  // 첫 클릭 → 열림.
  await page.getByTestId('personal-task-row-1').click();
  await expect(page.getByTestId('personal-task-panel')).toBeVisible();
  // 같은 행 재클릭 → 닫힘.
  await page.getByTestId('personal-task-row-1').click();
  await expect(page.getByTestId('personal-task-panel')).toHaveCount(0);
});

test('다른 행 클릭 시 drawer가 해당 이슈로 전환된다', async ({ authenticatedPage: page }) => {
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
  // 행2 클릭 → task=2 로 전환(drawer 유지, 이슈만 교체).
  await page.getByTestId('personal-task-row-2').click();
  await expect(page).toHaveURL(/task=2/);
  await expect(page.getByTestId('personal-task-panel')).toBeVisible();
});

// ─── 공유 툴바 통합 테스트 (입력 → URL/처리 → 출력 파이프라인) ─────────────────────────

test('툴바 검색 입력 → ?q= URL 반영 + 이슈 API query param(q) 전달', async ({ authenticatedPage: page }) => {
  const project = createProject({ id: 7, key: KEY, name: '개인 작업', type: 'PERSONAL', isDefault: true });
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}`, project);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/labels`, []);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/cycles`, []);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/types`, []);
  // 이슈 검색 요청을 캡처해 query param(q) 전달을 검증한다.
  const issuesMock = await mockApi(
    page,
    'GET',
    `/api/v1/projects/${KEY}/issues`,
    createIssueSearchResponse([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })]),
    { capture: true },
  );
  await page.goto(`/projects/${KEY}`);
  await expect(page.getByTestId('personal-checklist')).toBeVisible();

  // 검색 입력 → debounce 후 URL ?q= 반영.
  await page.getByRole('textbox', { name: '태스크 검색' }).fill('블로그');
  await expect(page).toHaveURL(/[?&]q=/);
  await expect(page).toHaveURL(/%EB%B8%94%EB%A1%9C%EA%B7%B8|블로그/);

  // 처리 → 이슈 API 가 q=블로그 query param 으로 재조회된다.
  await expect
    .poll(() =>
      issuesMock.requests.some((r) => r.searchParams.get('q') === '블로그'),
    )
    .toBe(true);
});

test('그룹=상태 클릭 → 체크리스트가 상태 섹션(TODO/IN_PROGRESS/DONE)으로 재구성된다', async ({ authenticatedPage: page }) => {
  await mockPersonal(page, [
    createIssue({ projectKey: KEY, number: 1, title: '할일A', status: 'TODO', dueDate: '2020-01-01' }),
    createIssue({ projectKey: KEY, number: 2, title: '진행B', status: 'IN_PROGRESS', dueDate: undefined }),
    createIssue({ projectKey: KEY, number: 3, title: '완료C', status: 'DONE', dueDate: undefined }),
  ]);
  await page.goto(`/projects/${KEY}`);

  // 기본(그룹 없음) — 마감 섹션. overdue 섹션에 할일A 가 있고, 완료는 접힘.
  await expect(page.getByTestId('personal-section-overdue')).toContainText('할일A');
  await expect(page.getByTestId('personal-section-TODO')).toHaveCount(0);

  // 그룹=상태 선택 → URL ?group=status + 상태 섹션으로 재구성. (셀렉트 트리거 열고 항목 선택)
  await page.getByTestId('group-by-trigger').click();
  await page.getByTestId('group-by-status').click();
  await expect(page).toHaveURL(/group=status/);
  await expect(page.getByTestId('personal-section-TODO')).toContainText('할일A');
  await expect(page.getByTestId('personal-section-IN_PROGRESS')).toContainText('진행B');
  // 상태 모드에서는 완료가 접히지 않고 일반 섹션(DONE)으로 항상 표시된다.
  await expect(page.getByTestId('personal-section-DONE')).toContainText('완료C');
  // 마감 버킷 섹션은 더 이상 없다.
  await expect(page.getByTestId('personal-section-overdue')).toHaveCount(0);
});

test('툴바 상태 필터(할 일) 클릭 → ?status=TODO URL + 이슈 API status param 전달 + 출력 반영', async ({ authenticatedPage: page }) => {
  const project = createProject({ id: 7, key: KEY, name: '개인 작업', type: 'PERSONAL', isDefault: true });
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}`, project);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/labels`, []);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/cycles`, []);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/types`, []);
  // 상태 필터에 따라 응답을 바꿔 입력→처리→출력 전체 파이프라인을 검증한다.
  const all = [
    createIssue({ projectKey: KEY, number: 1, title: '할일작업', status: 'TODO', dueDate: '2020-01-01' }),
    createIssue({ projectKey: KEY, number: 2, title: '완료작업', status: 'DONE', dueDate: undefined }),
  ];
  const capturedStatuses: (string | null)[] = [];
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/issues`,
    (route) => {
      const status = new URL(route.request().url()).searchParams.get('status');
      capturedStatuses.push(status);
      // 백엔드 필터를 흉내 — status=TODO 면 TODO 이슈만 반환.
      const items = status === 'TODO' ? all.filter((it) => it.status === 'TODO') : all;
      return route.fulfill({ json: createIssueSearchResponse(items) });
    },
  );
  await page.goto(`/projects/${KEY}`);
  await expect(page.getByTestId('personal-task-row-1')).toContainText('할일작업');

  // 상태 필터 '할 일' 적용 → ＋필터 → 상태 facet → '할 일' → URL ?status=TODO.
  await page.getByTestId('add-filter-trigger').click();
  await page.getByTestId('add-filter-facet-status').click();
  await page.getByTestId('facet-value-status-TODO').click();
  await expect(page.getByTestId('filter-chip-status')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/[?&]status=TODO/);

  // 처리 → 이슈 API 가 status=TODO query param 으로 재조회된다.
  await expect.poll(() => capturedStatuses.includes('TODO')).toBe(true);

  // 출력 → 완료작업(DONE)은 더 이상 표시되지 않는다.
  await expect(page.getByTestId('personal-task-row-1')).toContainText('할일작업');
  await expect(page.getByText('완료작업')).toHaveCount(0);
});

// 개인 프로젝트의 ＋필터는 상태/우선순위/라벨 facet 만 노출하고 사이클/유형은 숨긴다.
test('개인 프로젝트 ＋필터는 상태/우선순위/라벨 facet 만 노출(사이클·유형 부재)', async ({ authenticatedPage: page }) => {
  await mockPersonal(page);
  await page.goto(`/projects/${KEY}`);

  await page.getByTestId('add-filter-trigger').click();
  await expect(page.getByTestId('add-filter-facet-status')).toBeVisible();
  await expect(page.getByTestId('add-filter-facet-priority')).toBeVisible();
  await expect(page.getByTestId('add-filter-facet-label')).toBeVisible();
  await expect(page.getByTestId('add-filter-facet-cycle')).toHaveCount(0);
  await expect(page.getByTestId('add-filter-facet-type')).toHaveCount(0);
});

// ─── 빠른 추가(#226: 개인은 TASK 단일 유형) ───────────────────────────────────────

test('빠른 추가 다이얼로그는 유형 select 를 숨기고 POST payload 의 typeId 가 TASK 로 고정된다', async ({ authenticatedPage: page }) => {
  const project = createProject({ id: 7, key: KEY, name: '개인 작업', type: 'PERSONAL', isDefault: true });
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}`, project);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/labels`, []);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/cycles`, []);
  // 다이얼로그 effect 가 typeId 를 name==='TASK' 인 id 로 채우도록 시스템 유형(TASK id=1 포함)을 모킹한다.
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/types`, systemTypes());
  const taskTypeId = systemTypes().find((t) => t.name === 'TASK')!.id;
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/issues`, createIssueSearchResponse([]));

  // 생성 POST 캡처 — payload.typeId 검증용 (검증된 mockApi capture 패턴).
  const createCapture = await mockApi(
    page,
    'POST',
    `/api/v1/projects/${KEY}/issues`,
    createIssue({ projectKey: KEY, number: 1, title: '새 작업' }),
    { capture: true },
  );

  await page.goto(`/projects/${KEY}`);
  await page.getByRole('button', { name: '빠른 추가' }).click();

  // 다이얼로그 오픈 + 유형 select 부재(개인 전용).
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('create-type-select')).toHaveCount(0);

  // 제목 입력 후 생성 → POST payload 의 typeId 가 TASK 로 고정되어야 한다.
  await page.getByLabel('제목').fill('새 작업');
  await page.getByRole('button', { name: '생성' }).click();

  const created = await createCapture.waitForRequest();
  expect((created.payload as { typeId?: number }).typeId).toBe(taskTypeId);
});

// ─── #252 검색/필터 결과 0건 시 빈 상태 메시지 분기 ─────────────────────────────────
test('검색어 활성 상태에서 결과 0건 → "일치하는 작업이 없습니다." (빠른 추가 유도 문구 미표시)', async ({ authenticatedPage: page }) => {
  const project = createProject({ id: 7, key: KEY, name: '개인 작업', type: 'PERSONAL', isDefault: true });
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}`, project);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/labels`, []);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/cycles`, []);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/types`, []);
  // 검색 결과 0건 응답
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/issues`, createIssueSearchResponse([]));

  // q= 파라미터가 있는 URL 직접 진입 (검색 필터 활성 상태)
  await page.goto(`/projects/${KEY}?q=zzz없는검색어`);

  // "일치하는 작업이 없습니다." 가 보여야 한다 (빈 프로젝트 메시지가 아님)
  await expect(page.getByText('일치하는 작업이 없습니다.')).toBeVisible();
  // "빠른 추가로 시작하세요." 유도 문구는 없어야 한다
  await expect(page.getByText(/빠른 추가로 시작하세요/)).toHaveCount(0);
});

test('필터 없는 빈 프로젝트 → "작업이 없습니다. + 빠른 추가로 시작하세요." 표시', async ({ authenticatedPage: page }) => {
  await mockPersonal(page, []); // 이슈 없음 + 필터 없음
  await page.goto(`/projects/${KEY}`);

  // 필터가 없으면 기존 빈 상태 메시지 유지
  await expect(page.getByText('작업이 없습니다. + 빠른 추가로 시작하세요.')).toBeVisible();
  await expect(page.getByText('일치하는 작업이 없습니다.')).toHaveCount(0);
});

test('보드+우선순위 그룹 — CANCELED 이슈는 어떤 우선순위 컬럼에도 나타나지 않는다', async ({ authenticatedPage: page }) => {
  await mockPersonal(page, [
    createIssue({ projectKey: KEY, number: 1, title: '높음활성', status: 'TODO', priority: 'HIGH' }),
    // CANCELED + HIGH — 우선순위 그룹 시 HIGH 컬럼에 누출되면 안 된다(개인 3컬럼 보드 규칙).
    createIssue({ projectKey: KEY, number: 2, title: '높음취소', status: 'CANCELED', priority: 'HIGH' }),
  ]);
  await page.goto(`/projects/${KEY}?view=board&group=priority`);

  // 활성 HIGH 카드는 렌더된다.
  await expect(page.getByTestId('issue-card-1')).toBeVisible();
  // CANCELED 카드는 우선순위 그룹 보드 어디에도 없다.
  await expect(page.getByTestId('issue-card-2')).toHaveCount(0);
});

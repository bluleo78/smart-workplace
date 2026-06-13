// 개인 프로젝트 전용 상세 화면 E2E — 분기/뷰 토글/인라인/패널/리다이렉트/필드 다이어트.
// 전 구간 page.route 모킹(백엔드 무관). 모킹 데이터는 실제 타입(factory) 사용.
import { createChatMessagePage, createChatThread } from '../../factories/chat.factory';
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { createLabel, toLabelSummary } from '../../factories/label.factory';
import { createProject } from '../../factories/project.factory';
import { mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';

const KEY = 'PME';

// 개인 프로젝트 + 이슈 목록 공통 모킹.
async function mockPersonal(page: import('@playwright/test').Page, issues = [createIssue({ projectKey: KEY })]) {
  const project = createProject({ id: 7, key: KEY, name: '개인 작업', type: 'PERSONAL', isDefault: true });
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}`, project);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/issues`, createIssueSearchResponse(issues));
  return project;
}

test('개인 프로젝트는 전용 셸과 뷰 토글을 렌더한다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await mockPersonal(page);
  await page.goto(`/projects/${KEY}`);

  await expect(page.getByTestId('personal-project-detail')).toBeVisible();
  await expect(page.getByTestId('personal-view-toggle')).toBeVisible();
  // 기본은 체크리스트 — 보드 컨테이너는 없음.
  await expect(page.getByTestId('personal-checklist')).toBeVisible();
  await expect(page.getByTestId('personal-board')).toHaveCount(0);
  // 팀 전용 헤더 버튼(사이클/설정 텍스트) 부재.
  await expect(page.getByRole('button', { name: '사이클' })).toHaveCount(0);
});

// 뷰 토글 클릭 — 다른 쿼리(task=) 보존 확인.
test('뷰 토글 클릭 시 task 쿼리를 보존하며 view만 변경한다', async ({ authenticatedPage: page }) => {
  await mockPersonal(page);
  await page.goto(`/projects/${KEY}?task=1`);

  await page.getByTestId('personal-view-board').click();
  await expect(page).toHaveURL(/view=board/);
  await expect(page).toHaveURL(/task=1/);

  await page.getByTestId('personal-view-checklist').click();
  await expect(page).not.toHaveURL(/view=/);
  await expect(page).toHaveURL(/task=1/);
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
  // AGENT 담당 + 진행중 → "처리중" 배지. 비위임 행엔 배지 없음.
  await expect(page.getByTestId('ai-delegation-badge-1')).toContainText('처리중');
  await expect(page.getByTestId('ai-delegation-badge-2')).toHaveCount(0);
  // AGENT 담당 + TODO → "위임" 배지(아직 처리 시작 전).
  await expect(page.getByTestId('ai-delegation-badge-3')).toContainText('위임');
  await expect(page.getByTestId('ai-delegation-badge-3')).not.toContainText('처리중');
});

test('보드 뷰는 상태 3컬럼으로 카드를 배치한다', async ({ authenticatedPage: page }) => {
  await mockPersonal(page, [
    createIssue({ projectKey: KEY, number: 1, title: '할일카드', status: 'TODO' }),
    createIssue({ projectKey: KEY, number: 2, title: '진행카드', status: 'IN_PROGRESS' }),
    createIssue({ projectKey: KEY, number: 3, title: '완료카드', status: 'DONE' }),
    createIssue({ projectKey: KEY, number: 4, title: '취소카드', status: 'CANCELED' }),
  ]);
  await page.goto(`/projects/${KEY}?view=board`);

  await expect(page.getByTestId('personal-board')).toBeVisible();
  await expect(page.getByTestId('personal-board-col-TODO')).toContainText('할일카드');
  await expect(page.getByTestId('personal-board-col-IN_PROGRESS')).toContainText('진행카드');
  await expect(page.getByTestId('personal-board-col-DONE')).toContainText('완료카드');
  // CANCELED 는 개인 보드에서 표시하지 않는다(문서화된 디자인 규칙).
  await expect(page.getByTestId('personal-board')).not.toContainText('취소카드');
});

test('행 클릭 시 인라인 펼침으로 빠른 편집이 열린다', async ({ authenticatedPage: page }) => {
  await mockPersonal(page, [createIssue({ projectKey: KEY, number: 1, title: '블로그 초안', status: 'TODO', priority: 'MID' })]);
  await page.goto(`/projects/${KEY}`);

  // 제목 클릭 → 그 행이 인라인 펼침(상태/우선순위/자세히보기 노출).
  await page.getByTestId('personal-task-row-1').getByText('블로그 초안').click();
  await expect(page.getByTestId('personal-task-inline-1')).toBeVisible();
  await expect(page.getByTestId('personal-task-detail-link-1')).toBeVisible();
  // 패널은 아직 열리지 않음(인라인이 먼저).
  await expect(page.getByTestId('personal-task-panel')).toHaveCount(0);
});

test('인라인 펼침에서 상태 변경 시 PATCH { status: ... } 호출', async ({ authenticatedPage: page }) => {
  let issue = createIssue({ projectKey: KEY, number: 1, title: '블로그 초안', status: 'TODO', priority: 'MID' });
  const project = createProject({ id: 7, key: KEY, name: '개인 작업', type: 'PERSONAL', isDefault: true });
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}`,
    (route) => route.fulfill({ json: project }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/issues`,
    (route) => route.fulfill({ json: createIssueSearchResponse([issue]) }),
  );
  let patchBody: unknown;
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/issues/1`,
    (route) => {
      if (route.request().method() === 'PATCH') {
        patchBody = route.request().postDataJSON();
        issue = { ...issue, status: 'IN_PROGRESS' };
        return route.fulfill({ json: issue });
      }
      return route.fallback();
    },
  );

  await page.goto(`/projects/${KEY}`);
  // 인라인 펼침 → 상태 셀렉트에서 "진행 중" 선택.
  await page.getByTestId('personal-task-row-1').getByText('블로그 초안').click();
  await expect(page.getByTestId('personal-task-inline-1')).toBeVisible();
  await page.getByTestId('personal-task-inline-1').getByRole('combobox').first().click();
  await page.getByRole('option', { name: '진행 중' }).click();
  await expect.poll(() => patchBody).toMatchObject({ status: 'IN_PROGRESS' });
});

test('"자세히 보기" 클릭 시 ?task=N 쿼리 파라미터가 설정된다', async ({ authenticatedPage: page }) => {
  await mockPersonal(page, [createIssue({ projectKey: KEY, number: 1, title: '블로그 초안', status: 'TODO', priority: 'MID' })]);
  await page.goto(`/projects/${KEY}`);

  // 인라인 펼침 → 자세히 보기 클릭 → URL에 task=1.
  await page.getByTestId('personal-task-row-1').getByText('블로그 초안').click();
  await expect(page.getByTestId('personal-task-detail-link-1')).toBeVisible();
  await page.getByTestId('personal-task-detail-link-1').click();
  await expect(page).toHaveURL(/task=1/);
});

// 패널 진입 공통 — 단건 + chat 모킹.
async function mockTaskDetail(page: import('@playwright/test').Page) {
  const label = createLabel({ id: 5, name: '긴급' });
  const detail = createIssueDetail({
    summary: createIssue({ projectKey: KEY, number: 1, title: '블로그 초안', labels: [toLabelSummary(label)] }),
    body: '서론은 짧게',
  });
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/issues/1`, detail);
  const thread = createChatThread();
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/issues/1/chat/thread`, thread);
  await mockApi(page, 'GET', `/api/v1/chat/threads/${thread.threadId}/messages`, createChatMessagePage([]));
}

test('자세히 보기 → 우측 패널 오픈 + URL ?task 반영 + 새로고침 유지', async ({ authenticatedPage: page }) => {
  await mockPersonal(page, [createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })]);
  await mockTaskDetail(page);
  await page.goto(`/projects/${KEY}`);

  await page.getByTestId('personal-task-row-1').getByText('블로그 초안').click();
  await page.getByTestId('personal-task-detail-link-1').click();

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

test('보드 카드 클릭 → 우측 패널 오픈', async ({ authenticatedPage: page }) => {
  await mockPersonal(page, [createIssue({ projectKey: KEY, number: 1, title: '블로그 초안', status: 'TODO' })]);
  await mockTaskDetail(page);
  await page.goto(`/projects/${KEY}?view=board`);
  await page.getByTestId('personal-board-card-1').click();
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
  await page.getByTestId('personal-task-check-1').click();
  await expect.poll(() => patchBody).toEqual({ status: 'DONE' });
  // 재조회 후 제목 버튼에 취소선(line-through) 적용.
  await expect(page.getByTestId('personal-task-row-1').locator('.line-through')).toContainText('운동 계획');
});

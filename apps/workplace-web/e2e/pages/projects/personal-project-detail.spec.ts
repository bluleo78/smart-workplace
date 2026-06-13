// 개인 프로젝트 전용 상세 화면 E2E — 분기/뷰 토글/패널/리다이렉트/필드 다이어트.
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

test('보드 카드 클릭 → 우측 패널 오픈', async ({ authenticatedPage: page }) => {
  await mockPersonal(page, [createIssue({ projectKey: KEY, number: 1, title: '블로그 초안', status: 'TODO' })]);
  await mockTaskDetail(page);
  await page.goto(`/projects/${KEY}?view=board`);
  await page.getByTestId('personal-board-card-1').click();
  await expect(page.getByTestId('personal-task-panel')).toBeVisible();
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

test('행에 우선순위 배지·라벨·마감 텍스트가 렌더된다', async ({ authenticatedPage: page }) => {
  const label = createLabel({ id: 5, name: '긴급' });
  await mockPersonal(page, [
    createIssue({
      projectKey: KEY,
      number: 1,
      title: '중요작업',
      status: 'TODO',
      priority: 'HIGH',
      dueDate: '2020-01-01',
      labels: [toLabelSummary(label)],
    }),
    // MID 작업 — 우선순위 배지 미노출 확인용(제목에 "보통" 미포함).
    createIssue({ projectKey: KEY, number: 2, title: '일반항목', status: 'TODO', priority: 'MID' }),
  ]);
  await page.goto(`/projects/${KEY}`);

  const row = page.getByTestId('personal-task-row-1');
  await expect(row).toContainText('중요작업');
  await expect(row).toContainText('긴급'); // 라벨
  await expect(row).toContainText('높음'); // HIGH 우선순위 배지
  // 마감 텍스트(formatDateKorean 포맷) 존재.
  await expect(row.locator('span.text-destructive')).toBeVisible();
  // MID 행에는 우선순위 배지("보통") 미노출.
  await expect(page.getByTestId('personal-task-row-2')).not.toContainText('보통');
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

// 개인 프로젝트 전용 상세 화면 E2E — 분기/뷰 토글/인라인/패널/리다이렉트/필드 다이어트.
// 전 구간 page.route 모킹(백엔드 무관). 모킹 데이터는 실제 타입(factory) 사용.
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
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
  ]);
  await page.goto(`/projects/${KEY}`);

  await expect(page.getByTestId('personal-task-row-1')).toContainText('블로그 초안');
  await expect(page.getByTestId('personal-task-row-2')).toContainText('운동 계획');
  // AGENT 담당 + 진행중 → "처리중" 배지. 비위임 행엔 배지 없음.
  await expect(page.getByTestId('ai-delegation-badge-1')).toContainText('처리중');
  await expect(page.getByTestId('ai-delegation-badge-2')).toHaveCount(0);
});

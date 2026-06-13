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

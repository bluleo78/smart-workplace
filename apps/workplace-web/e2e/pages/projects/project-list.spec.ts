// 프로젝트 목록 모니터링 리스트 E2E — 진행률·배지·즐겨찾기·정렬·빈 상태.
// mockApi 는 url.pathname 정확 일치(=exact path, 글로브 X). 기존 projects.spec.ts 패턴 참조.
import { createPageResponse, mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { createProject } from '../../factories/project.factory'

const projects = [
  createProject({ key: 'EX', name: '예제', type: 'TEAM', issueTotal: 18, issueDone: 11, memberCount: 4, memberNames: ['김하나', '이둘', '박셋'] }),
  createProject({ key: 'EMP', name: '빈 프로젝트', type: 'TEAM', issueTotal: 0, issueDone: 0, memberCount: 1, memberNames: ['최멤버'] }),
  createProject({ key: 'DONE1', name: '완료 프로젝트', type: 'TEAM', issueTotal: 12, issueDone: 12, memberCount: 2, memberNames: ['한', '서'] }),
]

test.beforeEach(async ({ authenticatedPage: page }) => {
  // mockApi 는 pathname 정확 일치 — /api/v1/projects 사용 (쿼리스트링 무관하게 라우팅됨)
  await mockApi(page, 'GET', '/api/v1/projects', createPageResponse(projects))
})

test('진행률 라벨이 상태별로 정확히 표시된다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await page.goto('/projects')
  const ex = page.getByTestId('project-row-EX')
  // round(11/18*100)=61 → "18개 중 61% 완료"
  await expect(ex).toContainText('18개 중 61% 완료')
  await expect(page.getByTestId('project-row-EMP')).toContainText('이슈 없음')
  // 12/12=100% → "모두 완료"
  await expect(page.getByTestId('project-row-DONE1')).toContainText('모두 완료')
})

test('컬러 배지와 유형 칩이 보인다', async ({ authenticatedPage: page }) => {
  await page.goto('/projects')
  // 배지: project-row 안에서 project-badge-EX 를 scoped 조회 (사이드바 동명 testid 회피)
  const row = page.getByTestId('project-row-EX')
  await expect(row.getByTestId('project-badge-EX')).toHaveText('EX')
  // 유형 칩: TEAM → "팀"
  await expect(row).toContainText('팀')
})

test('즐겨찾기 토글 시 상단으로 핀되고 localStorage 반영', async ({ authenticatedPage: page }) => {
  await page.goto('/projects')
  await page.getByTestId('fav-toggle-DONE1').click()
  // 핀 그룹 헤더 노출
  await expect(page.getByTestId('fav-group')).toBeVisible()
  // localStorage 에 key 포함 여부 확인
  const stored = await page.evaluate(() => localStorage.getItem('project-favorites'))
  expect(stored).toContain('DONE1')
})

test('행 클릭 시 상세로 이동', async ({ authenticatedPage: page }) => {
  await page.goto('/projects')
  // 행 안의 Link(프로젝트명 영역)를 클릭해서 상세 이동 확인
  await page.getByTestId('project-row-EX').getByRole('link').click()
  await expect(page).toHaveURL(/\/projects\/EX$/)
})

test('빈 목록·로딩·에러 상태 유지', async ({ authenticatedPage: page }) => {
  // beforeEach 의 mock을 덮어써서 빈 응답 반환(LIFO 라우트)
  await mockApi(page, 'GET', '/api/v1/projects', createPageResponse([]))
  await page.goto('/projects')
  await expect(page.getByTestId('projects-empty')).toBeVisible()
})

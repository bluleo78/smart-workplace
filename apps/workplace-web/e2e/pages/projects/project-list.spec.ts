// 프로젝트 목록 모니터링 리스트 E2E — 목록 API → 행(진행률) 배선 1건(@wiring)만 남긴다.
// 배지·유형 칩·즐겨찾기 핀과 사용자별 저장 키(WP-701)·행 클릭 이동·빈 상태·여러 페이지 이어 받기와 이름순(WP-863)은
// 페이지 테스트 src/pages/projects/projectList.test.tsx 가, 만들기 대화상자 유효성은 projectCreateValidation.test.tsx 가 지킨다(WP-971).
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

test('진행률 라벨이 행에 표시된다', { tag: ['@wiring', '@smoke'] }, async ({ authenticatedPage: page }) => {
  await page.goto('/projects')
  // round(11/18*100)=61 → "18개 중 61% 완료". 상태별 문구(이슈 없음·모두 완료)는 projectProgress 단위 테스트(WP-412).
  await expect(page.getByTestId('project-row-EX')).toContainText('18개 중 61% 완료')
})

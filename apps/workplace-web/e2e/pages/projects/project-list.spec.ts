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

test('진행률 라벨이 행에 표시된다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await page.goto('/projects')
  // round(11/18*100)=61 → "18개 중 61% 완료". 상태별 문구(이슈 없음·모두 완료)는 projectProgress 단위 테스트(WP-412).
  await expect(page.getByTestId('project-row-EX')).toContainText('18개 중 61% 완료')
})

test('컬러 배지와 유형 칩이 보인다', async ({ authenticatedPage: page }) => {
  await page.goto('/projects')
  // 배지: project-row 안에서 project-badge-EX 를 scoped 조회 (사이드바 동명 testid 회피)
  const row = page.getByTestId('project-row-EX')
  await expect(row.getByTestId('project-badge-EX')).toHaveText('EX')
  // 유형 칩: TEAM → "팀"
  await expect(row).toContainText('팀')
})

// WP-1001 — 즐겨찾기는 서버에 저장한다(브라우저 저장소에는 쓰지 않는다). 새로고침해도 남는다.
test('즐겨찾기 토글 시 상단으로 핀되고 서버에 저장된다', async ({ authenticatedPage: page }) => {
  await page.goto('/projects')
  const saved = page.waitForRequest((r) => r.method() === 'PUT' && r.url().endsWith('/api/v1/me/project-favorites/DONE1'))
  await page.getByTestId('fav-toggle-DONE1').click()
  // 핀 그룹 헤더 노출
  await expect(page.getByTestId('fav-group')).toBeVisible()
  await saved
  const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('project-favorites')))
  expect(stored).toEqual([])
  // 서버(목)에 남아 있어 새로고침 뒤에도 핀된다.
  await page.reload()
  await expect(page.getByTestId('fav-toggle-DONE1')).toHaveAttribute('aria-pressed', 'true')
})

// WP-701 — 같은 브라우저의 다른 사용자(또는 예전 브라우저 단위 키)가 고른 즐겨찾기는 내 목록에 보이지 않는다.
test('다른 사용자·예전 브라우저 단위로 저장된 즐겨찾기는 보이지 않는다', async ({ authenticatedPage: page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('project-favorites', JSON.stringify(['DONE1']))
    localStorage.setItem('project-favorites:99:1', JSON.stringify(['DONE1']))
  })
  await page.goto('/projects')
  await expect(page.getByTestId('project-row-DONE1')).toBeVisible()
  await expect(page.getByTestId('fav-group')).toHaveCount(0)
  await expect(page.getByTestId('fav-toggle-DONE1')).toHaveAttribute('aria-pressed', 'false')
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

// WP-863 — 첫 페이지(20개)만 받아 21번째부터 목록·이름순 정렬·즐겨찾기에서 사라졌다. 끝 페이지까지 이어 받는다.
test('프로젝트가 한 페이지를 넘어도 마지막 페이지까지 받아 목록·이름순·즐겨찾기 사이드바에 모두 보인다', async ({
  authenticatedPage: page,
}) => {
  // 최근 생성순 130개 — 가장 오래된 「가나다 기획실」(OLD)은 두 번째 페이지 끝에 있다.
  const many = [
    ...Array.from({ length: 129 }, (_, i) =>
      createProject({ id: 1000 + i, key: `T${String(i + 1).padStart(3, '0')}`, name: `팀 프로젝트 ${i + 1}`, type: 'TEAM' }),
    ),
    createProject({ id: 2000, key: 'OLD', name: '가나다 기획실 — 오래전에 만든 프로젝트', type: 'TEAM' }),
  ]
  const requested: string[] = []
  await page.route(
    (u) => u.pathname === '/api/v1/projects',
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      const url = new URL(route.request().url())
      const p = Number(url.searchParams.get('page') ?? 0)
      const size = Number(url.searchParams.get('size') ?? 20)
      requested.push(`${p}/${size}`)
      return route.fulfill({
        json: createPageResponse(many.slice(p * size, (p + 1) * size), { page: p, size, totalElements: many.length }),
      })
    },
  )
  await page.goto('/projects')

  const old = page.getByTestId('project-row-OLD')
  await expect(old).toBeVisible()
  await expect(page.locator('[data-testid^="project-row-"]')).toHaveCount(130)
  expect(requested).toEqual(expect.arrayContaining(['0/100', '1/100']))

  // 이름순은 받은 전체 기준 — 「가나다…」가 맨 위.
  await page.getByTestId('project-sort-toggle').click()
  await expect(page.locator('[data-testid^="project-row-"]').first()).toHaveAttribute('data-testid', 'project-row-OLD')

  // 즐겨찾기하면 사이드바 프로젝트 묶음에도 나온다(전에는 사이드바도 20개 안에서만 골랐다).
  await page.getByTestId('fav-toggle-OLD').click()
  await expect(page.getByTestId('team-project-OLD')).toBeVisible()
})

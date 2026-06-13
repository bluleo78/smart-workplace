// 앱 레일 상단 워크스페이스 스위처(#219 P3) E2E.
// 입력 → 처리 → 출력 전체 파이프라인 검증:
//  - 활성 테넌트 seed → 칩 렌더 + 현재 워크스페이스 표시
//  - 팝오버 열기 전엔 멤버십 미페치(lazy) → 열 때만 GET /auth/memberships
//  - 멤버십 2개 → 다른 워크스페이스 선택 시 POST /auth/select-tenant payload 검증
//  - 멤버십 1개 → 표시 전용(전환 항목 disabled)
import { createMembership } from '../factories/auth.factory'
import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'

const TENANT_A = createMembership({ tenantId: 1, tenantName: '에이콘 워크스페이스', tenantSlug: 'acorn' })
const TENANT_B = createMembership({ tenantId: 2, tenantName: '베타 워크스페이스', tenantSlug: 'beta' })

// 활성 테넌트를 localStorage 에 미리 심는다(AuthContext init 이 refresh 후 이 값을 복원).
async function seedActiveTenant(page: import('@playwright/test').Page, tenant = TENANT_A) {
  await page.addInitScript((t) => {
    window.localStorage.setItem('activeTenant', JSON.stringify(t))
  }, tenant)
}

test('활성 테넌트가 있으면 레일 상단에 현재 워크스페이스 칩이 보인다', async ({
  authenticatedPage: page,
}) => {
  await seedActiveTenant(page)
  await page.goto('/')
  const chip = page.getByTestId('workspace-switcher')
  await expect(chip).toBeVisible()
  // 모바일/넓은 뷰에서의 이름 노출과 무관하게 접근 가능한 이름은 보장된다.
  await expect(chip).toHaveAttribute('aria-label', '워크스페이스 전환')
})

test('팝오버를 열기 전에는 멤버십을 페치하지 않는다(lazy fetch)', async ({
  authenticatedPage: page,
}) => {
  await seedActiveTenant(page)
  const memberships = await mockApi(page, 'GET', '/api/v1/auth/memberships', [TENANT_A, TENANT_B], {
    capture: true,
  })

  await page.goto('/')
  await expect(page.getByTestId('workspace-switcher')).toBeVisible()
  // 페이지 마운트만으로는 멤버십 페치가 일어나지 않아야 한다.
  expect(memberships.requests).toHaveLength(0)

  // 칩 클릭 → 팝오버 열림 → 그제서야 1회 페치.
  await page.getByTestId('workspace-switcher').click()
  await memberships.waitForRequest()
  expect(memberships.requests).toHaveLength(1)
  // 두 워크스페이스가 메뉴에 노출된다.
  await expect(page.getByTestId('workspace-switch-1')).toBeVisible()
  await expect(page.getByTestId('workspace-switch-2')).toContainText('베타 워크스페이스')
})

test('다른 워크스페이스 선택 시 select-tenant API 를 호출한다(payload 검증)', async ({
  authenticatedPage: page,
}) => {
  await seedActiveTenant(page)
  await mockApi(page, 'GET', '/api/v1/auth/memberships', [TENANT_A, TENANT_B])
  const select = await mockApi(
    page,
    'POST',
    '/api/v1/auth/select-tenant',
    { accessToken: 'tok-beta', tokenType: 'Bearer', expiresIn: 3600 },
    { capture: true },
  )

  await page.goto('/')
  await page.getByTestId('workspace-switcher').click()
  // 멤버십이 2개여도 현재(활성) 워크스페이스 항목은 비활성 — 자기 자신으로 전환 불가.
  await expect(page.getByTestId('workspace-switch-1')).toHaveAttribute('data-disabled', '')
  // 다른 워크스페이스(베타) 선택.
  await page.getByTestId('workspace-switch-2').click()

  const req = await select.waitForRequest()
  // 선택한 테넌트 id 가 payload 로 전송된다.
  expect(req.payload).toEqual({ tenantId: 2 })
})

test('멤버십이 1개뿐이면 전환 항목이 비활성(표시 전용)이다', async ({
  authenticatedPage: page,
}) => {
  await seedActiveTenant(page)
  await mockApi(page, 'GET', '/api/v1/auth/memberships', [TENANT_A])

  await page.goto('/')
  await page.getByTestId('workspace-switcher').click()
  // 현재(유일) 워크스페이스 항목은 disabled — 전환 불가.
  await expect(page.getByTestId('workspace-switch-1')).toHaveAttribute('data-disabled', '')
})

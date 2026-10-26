// 앱 레일 하단 워크스페이스 스위처(#219 P3) E2E — 호버 툴팁(@input)만 남긴다.
// 칩 표시·접근 가능한 이름, 팝오버를 열 때만 멤버십 조회(lazy), 현재 워크스페이스 비활성·다른 워크스페이스 전환,
// 멤버십 1개면 표시 전용은 화면 컴포넌트 테스트 src/components/layout/appRail.test.tsx 가 지키고,
// select-tenant 요청 본문은 src/pages/authPages.test.tsx 가 지킨다(WP-971).
import { createMembership } from '../factories/auth.factory'
import { expect, test } from '../fixtures/auth.fixture'

const TENANT_A = createMembership({ tenantId: 1, tenantName: '에이콘 워크스페이스', tenantSlug: 'acorn' })

// 활성 테넌트를 localStorage 에 미리 심는다(AuthContext init 이 refresh 후 이 값을 복원).
async function seedActiveTenant(page: import('@playwright/test').Page, tenant = TENANT_A) {
  await page.addInitScript((t) => {
    window.localStorage.setItem('activeTenant', JSON.stringify(t))
  }, tenant)
}

// #336 — 데스크톱 아이콘 레일에서 WorkspaceSwitcher hover 시 툴팁 누락.
// 입력(hover) → 처리(Tooltip 200ms 딜레이) → 출력(role="tooltip" + 테넌트명) 검증.
test('데스크탑 레일 — WorkspaceSwitcher hover 시 워크스페이스명 툴팁 표시 (#336)', { tag: '@input' }, async ({
  authenticatedPage: page,
}) => {
  await seedActiveTenant(page)
  await page.goto('/')
  const chip = page.getByTestId('workspace-switcher')
  await expect(chip).toBeVisible()
  await chip.hover()
  // shadcn Tooltip 은 기본 200ms 딜레이 후 role="tooltip" 로 노출.
  await expect(page.getByRole('tooltip', { name: TENANT_A.tenantName })).toBeVisible()
})

// global-search-mobile.spec.ts — 휴대폰 전체 화면 통합 검색(WP-1354)의 브라우저 판정분.
// 헤더 🔍 위치·시작 탭·「취소」·뒤로 가기 닫기·결과 이동 뒤 뒤로 가기·목록 밀면 키보드 내리기는
// vitest(src/components/search/SearchPaletteMobile.test.tsx)가 지킨다. 여기서는 jsdom 이 잴 수 없는 기하만 본다 —
// 검색 화면이 뷰포트 전체를 덮고, 종류 탭 줄은 옆으로 넘쳐 밀리되 페이지 자체는 가로로 넘치지 않는다.
// 데스크톱 팔레트의 기하는 e2e/pages/global-search.spec.ts.
import { measureBox } from '../../fixtures/wait'
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'

test('390px 에서 🔍 로 연 검색은 뷰포트 전체를 덮고 종류 탭 줄만 옆으로 넘친다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/chat')
  await page.getByTestId('mobile-search-button').click()
  const palette = page.getByTestId('global-search')
  await expect(page.getByTestId('global-search-input')).toBeFocused()
  // 지금 앱(대화) 탭에서 시작한다.
  await expect(page.getByTestId('global-search-tab-chat')).toHaveAttribute('aria-selected', 'true')

  const viewport = page.viewportSize()!
  await expect(async () => {
    const p = await measureBox(palette, 'global-search')
    expect(Math.round(p.x)).toBe(0)
    expect(Math.round(p.y)).toBe(0)
    expect(Math.round(p.width)).toBe(viewport.width)
    expect(Math.round(p.height)).toBe(viewport.height)
  }).toPass()

  // 종류 탭 9개는 390px 에 다 들어가지 않는다 — 탭 줄 안에서만 가로로 넘쳐 밀 수 있고, 문서는 넘치지 않는다.
  const tabs = page.getByRole('tablist', { name: '검색할 앱' })
  const { scrollWidth, clientWidth } = await tabs.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
  expect(scrollWidth, `탭 줄 scrollWidth ${scrollWidth} vs clientWidth ${clientWidth}`).toBeGreaterThan(clientWidth)
  await expectNoHorizontalOverflow(page)
})

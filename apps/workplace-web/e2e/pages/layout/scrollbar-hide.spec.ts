// 가로 스크롤 줄의 스크롤바 숨김(WP-1502) — 전역 스크롤바 규칙이 @layer 밖에 있으면 Tailwind 유틸리티
// ([scrollbar-width:none] 등)가 cascade 에서 져서 칩 줄에 스크롤바가 그대로 보인다.
// 계산된 스타일(getComputedStyle)의 cascade 결과는 jsdom 이 Tailwind 레이어를 처리하지 못해 잴 수 없으므로 실제 브라우저로 본다(@layout).
// 클래스 문자열은 소스(HIDE_SCROLLBAR 등)에 있어 Tailwind 가 CSS 를 생성하므로, 페이지에 요소를 주입해 계산된 값을 읽는다.
import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'
import { HIDE_SCROLLBAR } from '../../../src/lib/scrollStyles'

test.use({ viewport: { width: 1440, height: 900 } })

/** 주입한 가로 스크롤 요소의 계산된 scrollbar-width·scrollbar-color·::-webkit-scrollbar display 를 클래스별로 읽는다. */
async function readScrollbarWidths(page: Page, classes: Record<string, string>) {
  return page.evaluate((map) => {
    const result: Record<string, { width: string; color: string; webkitDisplay: string }> = {}
    for (const [key, cls] of Object.entries(map)) {
      // @2xl: 은 컨테이너 쿼리 변형이라 @container 조상이 있어야 적용된다(FilterLine 도 @container 안에 있다).
      const wrap = document.createElement('div')
      wrap.className = '@container'
      const el = document.createElement('div')
      el.className = cls
      el.style.cssText = 'width:100px;overflow-x:auto;white-space:nowrap'
      el.innerHTML = '<div style="width:400px;height:20px"></div>'
      wrap.appendChild(el)
      document.body.appendChild(wrap)
      const style = getComputedStyle(el)
      result[key] = {
        width: style.scrollbarWidth,
        color: style.scrollbarColor,
        webkitDisplay: getComputedStyle(el, '::-webkit-scrollbar').display,
      }
      wrap.remove()
    }
    return result
  }, classes)
}

test('HIDE_SCROLLBAR 를 단 가로 스크롤 요소는 전역 규칙에 지지 않고 숨겨지고, 일반 요소는 얇은 스크롤바다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.goto('/')
  const widths = await readScrollbarWidths(page, {
    hide: HIDE_SCROLLBAR,
    // FilterLine 처럼 변형(@2xl:)이 붙은 no-scrollbar 도 1440px(컨테이너 넓은 폭)에서 숨겨져야 한다.
    hideVariant: '@2xl:no-scrollbar',
    plain: '',
  })
  expect(widths.hide.width).toBe('none')
  expect(widths.hideVariant.width).toBe('none')
  expect(widths.plain.width).toBe('thin')
  // webkit 쪽 숨김(::-webkit-scrollbar display:none)도 같이 적용되고, 일반 요소는 숨기지 않는다.
  expect(widths.hide.webkitDisplay).toBe('none')
  expect(widths.plain.webkitDisplay).not.toBe('none')
  // 일반 요소는 전역 기본 모양 그대로 — thumb 색 + 투명 트랙(base 레이어 규칙이 여전히 적용됨).
  expect(widths.plain.color).toMatch(/ transparent$|rgba\(0, 0, 0, 0\)$/)
})

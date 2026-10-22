// @vitest-environment jsdom
// 팝오버 충돌 여백 — 하단 탭바 높이만큼 아래를 더 띄우고, 탭바가 없으면 받은 값 그대로(WP-806).
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { setMobileTabBarHeight, useMobileTabBarHeight, withTabBarCollisionPadding } from './mobileTabBar'

describe('setMobileTabBarHeight · useMobileTabBarHeight', () => {
  afterEach(() => setMobileTabBarHeight(null))

  it('높이를 넣으면 변수·표식을 달고 구독자가 새 값을 받으며, null 이면 둘 다 지우고 0', () => {
    const root = document.documentElement
    const { result } = renderHook(() => useMobileTabBarHeight())
    expect(result.current).toBe(0)

    act(() => setMobileTabBarHeight(49))
    expect(result.current).toBe(49)
    expect(root.style.getPropertyValue('--mobile-tabbar-h')).toBe('49px')
    expect(root.hasAttribute('data-mobile-tabbar')).toBe(true)

    act(() => setMobileTabBarHeight(null))
    expect(result.current).toBe(0)
    expect(root.style.getPropertyValue('--mobile-tabbar-h')).toBe('')
    expect(root.hasAttribute('data-mobile-tabbar')).toBe(false)
  })

  it('높이 0 으로 그려진 탭바도 표식은 단다 — 탭바 없음(null)과 구분', () => {
    setMobileTabBarHeight(0)
    expect(document.documentElement.hasAttribute('data-mobile-tabbar')).toBe(true)
  })
})

describe('withTabBarCollisionPadding', () => {
  it('탭바가 없으면 받은 값을 그대로 돌려준다 — 데스크톱 기존 동작 유지', () => {
    expect(withTabBarCollisionPadding(undefined, 0)).toBeUndefined()
    expect(withTabBarCollisionPadding(undefined, 0, 10)).toBeUndefined()
    expect(withTabBarCollisionPadding(16, 0)).toBe(16)
    const obj = { top: 4 }
    expect(withTabBarCollisionPadding(obj, 0)).toBe(obj)
  })

  it('여백이 없으면 컴포넌트 기본값(fallback, 없으면 0)에 아래만 탭바 높이를 더한다', () => {
    expect(withTabBarCollisionPadding(undefined, 49)).toEqual({ top: 0, right: 0, bottom: 49, left: 0 })
    expect(withTabBarCollisionPadding(undefined, 49, 10)).toEqual({ top: 10, right: 10, bottom: 59, left: 10 })
  })

  it('숫자 여백은 사방에 두고 아래에 탭바 높이를 더한다', () => {
    expect(withTabBarCollisionPadding(16, 49)).toEqual({ top: 16, right: 16, bottom: 65, left: 16 })
  })

  it('변별 여백은 다른 변을 그대로 두고 아래(없으면 0)에만 더한다', () => {
    expect(withTabBarCollisionPadding({ left: 8, bottom: 4 }, 49)).toEqual({ left: 8, bottom: 53 })
    expect(withTabBarCollisionPadding({ top: 8 }, 49)).toEqual({ top: 8, bottom: 49 })
  })
})

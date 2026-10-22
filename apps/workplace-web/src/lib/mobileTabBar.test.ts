// @vitest-environment jsdom
// 팝오버 충돌 여백 — 하단 탭바 높이(--mobile-tabbar-h)만큼 아래를 더 띄우고, 변수가 없으면 가장자리 여백만.
import { afterEach, describe, expect, it } from 'vitest'

import { mobileTabBarHeight, popoverCollisionPadding } from './mobileTabBar'

describe('mobileTabBar', () => {
  afterEach(() => document.documentElement.style.removeProperty('--mobile-tabbar-h'))

  it('탭바 변수가 없으면 높이 0, 여백은 사방 같다', () => {
    expect(mobileTabBarHeight()).toBe(0)
    expect(popoverCollisionPadding()).toEqual({ top: 16, right: 16, bottom: 16, left: 16 })
  })

  it('탭바가 있으면 아래 여백에 그 높이를 더한다', () => {
    document.documentElement.style.setProperty('--mobile-tabbar-h', '49px')
    expect(mobileTabBarHeight()).toBe(49)
    expect(popoverCollisionPadding(8)).toEqual({ top: 8, right: 8, bottom: 57, left: 8 })
  })
})

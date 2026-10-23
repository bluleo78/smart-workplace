// 앱 왼쪽 목록 폭(WP-878) — 범위 맞춤과 앱별 저장값 해석. 끌기·화면 반영은 e2e/pages/layout/sidebar-resize.spec.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { memoryStorage } from '@/test/memoryStorage'

import {
  readSidebarWidth,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  sidebarMaxFor,
  writeSidebarWidth,
} from './sidebarWidth'

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))
afterEach(() => vi.unstubAllGlobals())

describe('sidebarMaxFor', () => {
  it('앱 영역의 40% 와 최대 폭 중 작은 쪽', () => {
    expect(sidebarMaxFor(1000)).toBe(400)
    expect(sidebarMaxFor(2000)).toBe(SIDEBAR_MAX_WIDTH)
  })
})

describe('readSidebarWidth', () => {
  it('저장값이 없으면 기본 폭', () => {
    expect(readSidebarWidth('wiki')).toBe(SIDEBAR_DEFAULT_WIDTH)
  })

  it('앱마다 따로 읽고, 범위 밖 저장값은 맞춘다', () => {
    localStorage.setItem('sidebar-width:wiki', '320')
    localStorage.setItem('sidebar-width:mail', '1000')
    expect(readSidebarWidth('wiki')).toBe(320)
    expect(readSidebarWidth('mail')).toBe(SIDEBAR_MAX_WIDTH)
  })

  it('숫자가 아닌 저장값이나 저장소 접근 실패는 기본 폭', () => {
    localStorage.setItem('sidebar-width:wiki', 'abc')
    expect(readSidebarWidth('wiki')).toBe(SIDEBAR_DEFAULT_WIDTH)
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') } })
    expect(readSidebarWidth('wiki')).toBe(SIDEBAR_DEFAULT_WIDTH)
  })
})

describe('writeSidebarWidth', () => {
  it('폭을 저장하고, 기본 폭이면 키를 지운다', () => {
    writeSidebarWidth('drive', 300)
    expect(localStorage.getItem('sidebar-width:drive')).toBe('300')
    writeSidebarWidth('drive', SIDEBAR_DEFAULT_WIDTH)
    expect(localStorage.getItem('sidebar-width:drive')).toBeNull()
  })

  it('저장소 쓰기가 막혀도 던지지 않는다', () => {
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('quota') } })
    expect(() => writeSidebarWidth('drive', 300)).not.toThrow()
  })
})

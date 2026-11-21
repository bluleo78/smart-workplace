// 통합 검색(WP-1353)의 앱 정의 — 경로 → 현재 앱, 「전체」 탭 그룹 순서, 탭 순서.
import { describe, expect, it } from 'vitest'

import { currentAppFromPath, groupOrder, SEARCH_TABS, visibleSearchTabs } from './searchApps'

describe('currentAppFromPath', () => {
  it.each([
    ['/wiki/spaces/1/pages/2', 'wiki'],
    ['/projects/WP/issues/3', 'issues'],
    ['/drive/spaces/1', 'drive'],
    ['/mail/5', 'mail'],
    ['/chat/channels/9', 'chat'],
    ['/contacts', 'contacts'],
    ['/calendar', 'calendar'],
    ['/', null],
    ['/settings', null],
    ['/notifications', null],
  ])('%s → %s', (path, app) => {
    expect(currentAppFromPath(path)).toBe(app)
  })
})

describe('groupOrder', () => {
  it('현재 앱을 맨 앞으로, 나머지는 탭 순서 그대로', () => {
    const order = groupOrder('drive', true)
    expect(order[0]).toBe('drive')
    expect(order.slice(1)).toEqual(['ai', 'chat', 'mail', 'calendar', 'issues', 'wiki', 'contacts'])
  })

  it('현재 앱이 없으면 탭 순서 전부(ai·calendar 포함)', () => {
    expect(groupOrder(null, true)).toEqual(['ai', 'chat', 'mail', 'calendar', 'issues', 'drive', 'wiki', 'contacts'])
  })
})

describe('SEARCH_TABS', () => {
  it('순서가 고정이다', () => {
    expect(SEARCH_TABS.map((t) => t.label)).toEqual(['전체', 'AI 대화', '대화', '메일', '캘린더', '작업', '드라이브', '노트', '연락처'])
  })
})

describe('visibleSearchTabs / groupOrder aiAvailable=false (WP-1898)', () => {
  it('AI 를 쓸 수 없으면 AI 대화 탭만 빠지고 순서는 그대로', () => {
    expect(visibleSearchTabs(false).map((t) => t.id)).toEqual(['all', 'chat', 'mail', 'calendar', 'issues', 'drive', 'wiki', 'contacts'])
  })

  it('AI 를 쓸 수 있으면 전체 탭 그대로', () => {
    expect(visibleSearchTabs(true)).toEqual(SEARCH_TABS)
  })

  it('묶음 순서에서도 ai 가 빠진다', () => {
    expect(groupOrder('wiki', false)).toEqual(['wiki', 'chat', 'mail', 'calendar', 'issues', 'drive', 'contacts'])
    expect(groupOrder(null, false)).not.toContain('ai')
  })
})

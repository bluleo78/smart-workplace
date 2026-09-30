// 탭 구성 파싱 테스트 — 손상·구버전 localStorage 값이 들어와도 크래시 없이 기본값으로 복구되는지 고정.
import { describe, expect, it } from 'vitest'

import { DEFAULT_TAB_SLOTS, parseTabSlots, replaceSlot } from './tabConfig'
import type { MobileTabId } from './tabs'

describe('parseTabSlots', () => {
  it('정상 값은 그대로', () => expect(parseTabSlots('["calendar","chat","tasks"]')).toEqual(['calendar', 'chat', 'tasks']))
  it('null 이면 기본값', () => expect(parseTabSlots(null)).toEqual(DEFAULT_TAB_SLOTS))
  it('JSON 아님 → 기본값', () => expect(parseTabSlots('{oops')).toEqual(DEFAULT_TAB_SLOTS))
  it('배열 아님 → 기본값', () => expect(parseTabSlots('{"a":1}')).toEqual(DEFAULT_TAB_SLOTS))
  it('개수가 3 이 아니면 기본값', () => expect(parseTabSlots('["home","chat"]')).toEqual(DEFAULT_TAB_SLOTS))
  it('없는 id 포함 → 기본값', () => expect(parseTabSlots('["home","chat","ai"]')).toEqual(DEFAULT_TAB_SLOTS))
  it('중복 → 기본값', () => expect(parseTabSlots('["home","home","mail"]')).toEqual(DEFAULT_TAB_SLOTS))
})

describe('replaceSlot', () => {
  it('같은 자리에 교체한다', () =>
    expect(replaceSlot(['home', 'chat', 'mail'], 'mail', 'calendar')).toEqual(['home', 'chat', 'calendar']))
  it('가운데 칸도 제자리', () =>
    expect(replaceSlot(['home', 'chat', 'mail'], 'chat', 'drive')).toEqual(['home', 'drive', 'mail']))
  it('교체 대상이 슬롯에 없으면 그대로', () =>
    expect(replaceSlot(['home', 'chat', 'mail'], 'wiki', 'drive')).toEqual(['home', 'chat', 'mail']))
  it('새 앱이 이미 슬롯에 있으면(중복) 그대로', () =>
    expect(replaceSlot(['home', 'chat', 'mail'], 'home', 'mail')).toEqual(['home', 'chat', 'mail']))
  it('원본 배열을 바꾸지 않는다', () => {
    const s: MobileTabId[] = ['home', 'chat', 'mail']
    replaceSlot(s, 'mail', 'calendar')
    expect(s).toEqual(['home', 'chat', 'mail'])
  })
})

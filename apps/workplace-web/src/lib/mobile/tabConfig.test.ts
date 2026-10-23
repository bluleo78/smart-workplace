// 탭 구성 파싱 테스트 — 손상·구버전 localStorage 값이 들어와도 크래시 없이 기본값으로 복구되는지 고정.
import { describe, expect, it } from 'vitest'

import { DEFAULT_TAB_SLOTS, mergeVisibleSlots, parseTabSlots, replaceSlot, visibleSlotCount } from './tabConfig'
import type { MobileTabId } from './tabs'

describe('parseTabSlots', () => {
  it('정상 값(5칸)은 그대로', () =>
    expect(parseTabSlots('["calendar","chat","tasks","wiki","home"]')).toEqual(['calendar', 'chat', 'tasks', 'wiki', 'home']))
  // WP-877 이전에 저장된 3칸 구성 — 고른 3개를 앞에 두고 뒤 2칸을 기본 앱으로 채운다.
  it('예전 3칸 구성은 뒤를 기본 앱(캘린더·드라이브)으로 채운다', () =>
    expect(parseTabSlots('["home","chat","mail"]')).toEqual(['home', 'chat', 'mail', 'calendar', 'drive']))
  it('예전 3칸에 기본 앱이 이미 있으면 남은 기본 앱으로 채운다', () =>
    expect(parseTabSlots('["calendar","drive","tasks"]')).toEqual(['calendar', 'drive', 'tasks', 'home', 'chat']))
  it('예전 3칸에서 뺀 기본 앱(메일)은 다시 넣지 않는다', () =>
    expect(parseTabSlots('["home","chat","wiki"]')).toEqual(['home', 'chat', 'wiki', 'calendar', 'drive']))
  it('null 이면 기본값', () => expect(parseTabSlots(null)).toEqual(DEFAULT_TAB_SLOTS))
  it('JSON 아님 → 기본값', () => expect(parseTabSlots('{oops')).toEqual(DEFAULT_TAB_SLOTS))
  it('배열 아님 → 기본값', () => expect(parseTabSlots('{"a":1}')).toEqual(DEFAULT_TAB_SLOTS))
  it('개수가 3·5 가 아니면 기본값', () => expect(parseTabSlots('["home","chat"]')).toEqual(DEFAULT_TAB_SLOTS))
  it('예전 3칸이라도 중복이면 기본값', () => expect(parseTabSlots('["home","home","mail"]')).toEqual(DEFAULT_TAB_SLOTS))
  it('없는 id 포함 → 기본값', () => expect(parseTabSlots('["home","chat","ai"]')).toEqual(DEFAULT_TAB_SLOTS))
  it('중복 → 기본값', () => expect(parseTabSlots('["home","home","mail","chat","wiki"]')).toEqual(DEFAULT_TAB_SLOTS))
})

describe('visibleSlotCount', () => {
  it('넓은 폰은 5칸, 좁은 폰은 3칸', () => {
    expect(visibleSlotCount(true)).toBe(5)
    expect(visibleSlotCount(false)).toBe(3)
  })
})

describe('mergeVisibleSlots', () => {
  const all: MobileTabId[] = ['home', 'chat', 'mail', 'calendar', 'drive']
  it('넓은 폰(5칸)은 넘긴 구성이 그대로 저장 구성', () =>
    expect(mergeVisibleSlots(all, ['wiki', 'home', 'chat', 'tasks', 'mail'])).toEqual(['wiki', 'home', 'chat', 'tasks', 'mail']))
  it('좁은 폰에서 앞 3칸만 바꾸면 뒤 2칸은 그대로', () =>
    expect(mergeVisibleSlots(all, ['home', 'chat', 'tasks'])).toEqual(['home', 'chat', 'tasks', 'calendar', 'drive']))
  it('좁은 폰에서 순서만 바꾸면 뒤 2칸은 그대로', () =>
    expect(mergeVisibleSlots(all, ['mail', 'home', 'chat'])).toEqual(['mail', 'home', 'chat', 'calendar', 'drive']))
  it('뒤 칸에 있던 앱을 앞으로 고정하면 밀려난 앱과 자리를 맞바꿔 중복이 없다', () =>
    expect(mergeVisibleSlots(all, ['home', 'chat', 'calendar'])).toEqual(['home', 'chat', 'calendar', 'mail', 'drive']))
})

describe('replaceSlot', () => {
  it('같은 자리에 교체한다', () =>
    expect(replaceSlot(['home', 'chat', 'mail'], 'mail', 'calendar')).toEqual(['home', 'chat', 'calendar']))
  it('가운데 칸도 제자리', () =>
    expect(replaceSlot(['home', 'chat', 'mail'], 'chat', 'drive')).toEqual(['home', 'drive', 'mail']))
  it('교체 대상이 슬롯에 없으면 같은 참조 그대로(변경 없음 판별용)', () => {
    const s: MobileTabId[] = ['home', 'chat', 'mail']
    expect(replaceSlot(s, 'wiki', 'drive')).toBe(s)
  })
  it('새 앱이 이미 슬롯에 있으면(중복) 같은 참조 그대로', () => {
    const s: MobileTabId[] = ['home', 'chat', 'mail']
    expect(replaceSlot(s, 'home', 'mail')).toBe(s)
  })
  it('원본 배열을 바꾸지 않는다', () => {
    const s: MobileTabId[] = ['home', 'chat', 'mail']
    replaceSlot(s, 'mail', 'calendar')
    expect(s).toEqual(['home', 'chat', 'mail'])
  })
})

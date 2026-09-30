// 탭 구성 파싱 테스트 — 손상·구버전 localStorage 값이 들어와도 크래시 없이 기본값으로 복구되는지 고정.
import { describe, expect, it } from 'vitest'

import { DEFAULT_TAB_SLOTS, parseTabSlots } from './tabConfig'

describe('parseTabSlots', () => {
  it('정상 값은 그대로', () => expect(parseTabSlots('["calendar","chat","tasks"]')).toEqual(['calendar', 'chat', 'tasks']))
  it('null 이면 기본값', () => expect(parseTabSlots(null)).toEqual(DEFAULT_TAB_SLOTS))
  it('JSON 아님 → 기본값', () => expect(parseTabSlots('{oops')).toEqual(DEFAULT_TAB_SLOTS))
  it('배열 아님 → 기본값', () => expect(parseTabSlots('{"a":1}')).toEqual(DEFAULT_TAB_SLOTS))
  it('개수가 3 이 아니면 기본값', () => expect(parseTabSlots('["home","chat"]')).toEqual(DEFAULT_TAB_SLOTS))
  it('없는 id 포함 → 기본값', () => expect(parseTabSlots('["home","chat","ai"]')).toEqual(DEFAULT_TAB_SLOTS))
  it('중복 → 기본값', () => expect(parseTabSlots('["home","home","mail"]')).toEqual(DEFAULT_TAB_SLOTS))
})

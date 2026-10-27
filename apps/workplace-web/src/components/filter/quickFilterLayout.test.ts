// 빠른 필터 칩 줄 순수 규칙(WP-1020) — 어떤 facet 이 칩으로 보이는가·고정/숨김 토글·걸린 칩 앞으로·저장값 파싱.
import { describe, expect, test } from 'vitest'

import {
  appliedFirst,
  EMPTY_QUICK_FILTER_PREFS,
  isPinnedAsChip,
  moreFacets,
  parseQuickFilterPrefs,
  quickChipKeys,
  togglePinned,
} from './quickFilterLayout'
import type { FacetDef } from './types'

const facet = (key: string): FacetDef => ({ key, label: key, options: [] })
// facet 순서는 이슈 필터 훅과 같다(상태 → 상태 범주 → 우선순위 → 라벨 → 담당자 → 사이클 → 유형 → 완료일).
const FACETS = ['statusId', 'status', 'priority', 'label', 'assignee', 'cycle', 'type', 'closedIn'].map(facet)
const DEFAULTS = ['assignee', 'statusId', 'type', 'label', 'priority']

describe('quickChipKeys', () => {
  test('설정이 없으면 기본 칩 순서 그대로, 나머지는 「더 보기」', () => {
    const keys = quickChipKeys(FACETS, {}, DEFAULTS, EMPTY_QUICK_FILTER_PREFS)
    expect(keys).toEqual(DEFAULTS)
    expect(moreFacets(FACETS, keys).map((f) => f.key)).toEqual(['status', 'cycle', 'closedIn'])
  })

  test('숨긴 기본 칩은 빠지고, 고정한 칩은 고정 순서로 뒤에 붙는다', () => {
    const keys = quickChipKeys(FACETS, {}, DEFAULTS, { pinned: ['closedIn', 'status'], hidden: ['type'] })
    expect(keys).toEqual(['assignee', 'statusId', 'label', 'priority', 'closedIn', 'status'])
  })

  test('값이 걸린 facet 은 숨겼거나 「더 보기」 소속이어도 칩으로 나온다(facet 순서로 뒤에)', () => {
    const keys = quickChipKeys(FACETS, { type: [1], cycle: [3], status: ['TODO'] }, DEFAULTS, { pinned: [], hidden: ['type'] })
    expect(keys).toEqual(['assignee', 'statusId', 'label', 'priority', 'status', 'cycle', 'type'])
  })

  test('이 화면에 없는 facet 은 기본·고정이어도 빠진다(데이터가 없어 빠진 사이클 등)', () => {
    const facets = FACETS.filter((f) => f.key !== 'cycle' && f.key !== 'type')
    expect(quickChipKeys(facets, {}, DEFAULTS, { pinned: ['cycle'], hidden: [] })).toEqual(['assignee', 'statusId', 'label', 'priority'])
  })
})

describe('togglePinned / isPinnedAsChip', () => {
  test('기본 칩은 숨김 목록을, 아닌 칩은 고정 목록을 오가며 두 번 누르면 원래대로', () => {
    let prefs = togglePinned('type', DEFAULTS, EMPTY_QUICK_FILTER_PREFS)
    expect(prefs).toEqual({ pinned: [], hidden: ['type'] })
    expect(isPinnedAsChip('type', DEFAULTS, prefs)).toBe(false)
    prefs = togglePinned('cycle', DEFAULTS, prefs)
    expect(prefs).toEqual({ pinned: ['cycle'], hidden: ['type'] })
    expect(isPinnedAsChip('cycle', DEFAULTS, prefs)).toBe(true)
    prefs = togglePinned('type', DEFAULTS, togglePinned('cycle', DEFAULTS, prefs))
    expect(prefs).toEqual(EMPTY_QUICK_FILTER_PREFS)
  })
})

describe('appliedFirst', () => {
  test('걸린 칩을 앞으로 모으고 각 묶음 안의 순서는 지킨다', () => {
    expect(appliedFirst(['assignee', 'statusId', 'type', 'label'], { label: [1], statusId: [2], type: [] })).toEqual([
      'statusId',
      'label',
      'assignee',
      'type',
    ])
  })
})

describe('parseQuickFilterPrefs', () => {
  test('저장값을 읽고, 깨진 JSON·모양이 다른 값·문자열 아닌 항목은 버린다', () => {
    expect(parseQuickFilterPrefs('{"pinned":["cycle"],"hidden":["type"]}')).toEqual({ pinned: ['cycle'], hidden: ['type'] })
    expect(parseQuickFilterPrefs(null)).toEqual(EMPTY_QUICK_FILTER_PREFS)
    expect(parseQuickFilterPrefs('{oops')).toEqual(EMPTY_QUICK_FILTER_PREFS)
    expect(parseQuickFilterPrefs('[1,2]')).toEqual(EMPTY_QUICK_FILTER_PREFS)
    expect(parseQuickFilterPrefs('"x"')).toEqual(EMPTY_QUICK_FILTER_PREFS)
    expect(parseQuickFilterPrefs('{"pinned":["a",3,null],"hidden":"type"}')).toEqual({ pinned: ['a'], hidden: [] })
  })
})

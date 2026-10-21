// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { filterSlashItems } from './wikiSlashSuggestion'

// 슬래시 메뉴 항목 거르기 — 공유 링크 화면(WP-579)은 AI 항목 없이 서식·삽입만.
describe('filterSlashItems', () => {
  const keys = (q: string, opts: { inTable: boolean; aiEnabled: boolean }) => filterSlashItems(q, opts).map((i) => i.key)

  it('AI 를 쓸 수 있으면 AI 항목이 함께 있다', () => {
    expect(keys('', { inTable: false, aiEnabled: true })).toEqual(expect.arrayContaining(['table', 'heading1', 'draft', 'continue']))
  })
  it('공유 화면(AI 못 씀)이면 AI 항목만 빠진다', () => {
    const k = keys('', { inTable: false, aiEnabled: false })
    expect(k).toEqual(expect.arrayContaining(['table', 'image', 'heading1', 'horizontalRule']))
    expect(k).not.toContain('draft')
    expect(k).not.toContain('continue')
    // 입력으로 찾아도 나오지 않는다.
    expect(keys('AI', { inTable: false, aiEnabled: false })).toEqual([])
  })
  it('표 안에서는 표 항목을 뺀다', () => {
    expect(keys('', { inTable: true, aiEnabled: true })).not.toContain('table')
  })
})

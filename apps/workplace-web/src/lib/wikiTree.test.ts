import { describe, expect, test } from 'vitest'

import { wikiPageSummary } from '../../e2e/factories/wiki.factory'
import { topLevelPages } from './wikiTree'

describe('topLevelPages', () => {
  test('부모 없는 페이지와 부모가 목록에 없는 고아를 position 순으로 돌려준다', () => {
    const pages = [
      wikiPageSummary({ id: 1, parentId: null, position: 2 }),
      wikiPageSummary({ id: 2, parentId: 1, position: 0 }),
      wikiPageSummary({ id: 3, parentId: 99, position: 1 }),
    ]
    expect(topLevelPages(pages).map((p) => p.id)).toEqual([3, 1])
  })

  test('페이지가 없으면 빈 배열', () => {
    expect(topLevelPages([])).toEqual([])
  })
})

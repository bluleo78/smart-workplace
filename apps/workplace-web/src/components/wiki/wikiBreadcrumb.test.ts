import { describe, expect, it } from 'vitest'

import type { WikiPageSummary } from '../../types/wiki'
import { buildBreadcrumb } from './wikiBreadcrumb'

const p = (id: number, parentId: number | null, title: string): WikiPageSummary => ({
  id,
  parentId,
  title,
  position: 0,
})

describe('buildBreadcrumb', () => {
  const tree = [p(1, null, '제품 문서'), p(2, 1, '기획'), p(4, 2, '요구사항'), p(5, null, '회의록')]

  it('루트 페이지는 자기 자신만', () => {
    expect(buildBreadcrumb(tree, 1)).toEqual([{ id: 1, title: '제품 문서' }])
  })

  it('중첩 페이지는 루트부터 자기까지', () => {
    expect(buildBreadcrumb(tree, 4)).toEqual([
      { id: 1, title: '제품 문서' },
      { id: 2, title: '기획' },
      { id: 4, title: '요구사항' },
    ])
  })

  it('pageId 가 null 이면 빈 경로', () => {
    expect(buildBreadcrumb(tree, null)).toEqual([])
  })

  it('부모가 목록에 없으면(고아) 그 지점에서 멈춤', () => {
    expect(buildBreadcrumb([p(9, 99, '고아')], 9)).toEqual([{ id: 9, title: '고아' }])
  })

  it('빈 제목은 "제목 없음" 폴백', () => {
    expect(buildBreadcrumb([p(1, null, '')], 1)).toEqual([{ id: 1, title: '제목 없음' }])
  })

  it('자기참조 순환도 무한루프 없이 종료', () => {
    expect(buildBreadcrumb([p(1, 1, 'A')], 1)).toEqual([{ id: 1, title: 'A' }])
  })
})

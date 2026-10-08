import { describe, expect, it } from 'vitest'

import type { WikiPageSummary } from '../../types/wiki'
import { breadcrumbOrSelf, buildBreadcrumb } from './wikiBreadcrumb'

const p = (id: number, parentId: number | null, title: string): WikiPageSummary => ({
  id,
  parentId,
  title,
  position: 0,
  aiLastUsedAt: null,
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

// 트리에서 빠진 현재 노트(삭제 SSE 뒤 트리 재조회 등) — 헤더 제목이 비거나 일반 "노트"로 바뀌지 않게 자기 제목으로 채운다(WP-296).
describe('breadcrumbOrSelf', () => {
  it('트리에 경로가 있으면 그대로', () => {
    const crumbs = [{ id: 1, title: '제품 문서' }]
    expect(breadcrumbOrSelf(crumbs, { id: 1, title: '다른 제목' }, true)).toBe(crumbs)
  })
  it('트리를 불러왔는데 경로가 비면 현재 노트 제목 하나', () => {
    expect(breadcrumbOrSelf([], { id: 9, title: '지운 회의록' }, true)).toEqual([{ id: 9, title: '지운 회의록' }])
  })
  it('제목이 비어 있으면 "제목 없음"', () => {
    expect(breadcrumbOrSelf([], { id: 9, title: '' }, true)).toEqual([{ id: 9, title: '제목 없음' }])
  })
  // 처음 열 때 트리가 오기 전 한 칸짜리 경로가 잠깐 그려졌다가 바뀌는 깜빡임을 막는다(WP-296).
  it('트리를 불러오는 중이면 채우지 않는다', () => {
    expect(breadcrumbOrSelf([], { id: 9, title: '회의록' }, false)).toEqual([])
  })
})

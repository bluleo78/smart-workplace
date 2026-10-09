import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { wikiKeys } from './queries/wikiKeys'
import { handleWikiEvent, REVISIONS_REFETCH_INTERVAL_MS } from './useWikiStream'

/** 무효화된 쿼리 키 목록. */
function invalidatedKeys(eventName: string, data: unknown): unknown[] {
  const qc = new QueryClient()
  const spy = vi.spyOn(qc, 'invalidateQueries')
  handleWikiEvent(qc, eventName, data)
  return spy.mock.calls.map(([filters]) => filters?.queryKey)
}

// wiki.page.* SSE → 캐시 무효화(WP-287). 본문은 동기화 서버가 넣지만 본문 밖 필드(제목·AI 사용 이력)는 페이지 재조회로 맞춘다.
describe('handleWikiEvent', () => {
  it('수정 이벤트는 열린 페이지를 다시 불러온다 — 헤더 "AI 생성 포함" 배지(aiLastUsedAt)가 같은 세션에서 갱신되도록', () => {
    const keys = invalidatedKeys('wiki.page.updated', { spaceId: 1, pageId: 7, title: '회의록' })
    expect(keys).toContainEqual(wikiKeys.page(7))
    expect(keys).toContainEqual(wikiKeys.tree(1))
    expect(keys).toContainEqual(wikiKeys.backlinks(7))
    expect(keys).toContainEqual(wikiKeys.mentions(7))
  })

  // 열린 화면은 재조회(404)해도 에디터를 유지한다(WP-296) — 삭제됨 안내는 동기화 세션이 띄운다.
  it('삭제 이벤트도 열린 페이지를 다시 불러온다', () => {
    expect(invalidatedKeys('wiki.page.deleted', { spaceId: 1, pageId: 7 })).toContainEqual(wikiKeys.page(7))
  })

  // 지금 아무 화면도 보고 있지 않은 지운 노트의 캐시는 버린다 — 나중에 그 노트로 돌아왔을 때 낡은 캐시를 잠깐이라도 그리지 않게(WP-296).
  it('삭제 이벤트는 보는 화면이 없는 그 페이지 캐시를 지운다', () => {
    const qc = new QueryClient()
    qc.setQueryData(wikiKeys.page(7), { id: 7 })
    qc.setQueryData(wikiKeys.page(8), { id: 8 })
    handleWikiEvent(qc, 'wiki.page.deleted', { spaceId: 1, pageId: 7 })
    expect(qc.getQueryData(wikiKeys.page(7))).toBeUndefined()
    expect(qc.getQueryData(wikiKeys.page(8))).toEqual({ id: 8 })
  })

  it('수정 이벤트는 페이지 캐시를 지우지 않는다', () => {
    const qc = new QueryClient()
    qc.setQueryData(wikiKeys.page(7), { id: 7 })
    handleWikiEvent(qc, 'wiki.page.updated', { spaceId: 1, pageId: 7 })
    expect(qc.getQueryData(wikiKeys.page(7))).toEqual({ id: 7 })
  })

  // 버전 기록 목록(WP-282) — 열린 목록만(refetchType active), 계속 타이핑해도 페이지당 간격에 한 번만 다시 받는다(첫 번은 바로, 간격 안 이벤트는 끝에 한 번).
  describe('버전 기록 목록 무효화', () => {
    afterEach(() => vi.useRealTimers())

    /** 그 페이지 버전 기록 목록 키로 부른 무효화 호출들. */
    function revisionCalls(spy: { mock: { calls: unknown[][] } }, pageId = 7) {
      const key = JSON.stringify(wikiKeys.revisions(pageId))
      return spy.mock.calls.filter(([f]) => JSON.stringify((f as { queryKey?: unknown } | undefined)?.queryKey) === key)
    }

    /** 버전 기록 목록이 캐시된(연 적 있는) QueryClient. */
    function qcWithRevisions(...pageIds: number[]) {
      const qc = new QueryClient()
      for (const id of pageIds) qc.setQueryData(wikiKeys.revisions(id), { current: null, items: [] })
      return qc
    }

    it('버전 기록 목록을 연 적 없는 페이지는 무효화하지 않는다', () => {
      const qc = new QueryClient()
      const spy = vi.spyOn(qc, 'invalidateQueries')
      handleWikiEvent(qc, 'wiki.page.updated', { spaceId: 1, pageId: 7 })
      expect(revisionCalls(spy)).toEqual([])
    })

    it('수정 이벤트는 버전 기록 목록을 보고 있을 때만 다시 받도록 무효화한다', () => {
      const qc = qcWithRevisions(7)
      const spy = vi.spyOn(qc, 'invalidateQueries')
      handleWikiEvent(qc, 'wiki.page.updated', { spaceId: 1, pageId: 7 })
      expect(revisionCalls(spy)).toEqual([[{ queryKey: wikiKeys.revisions(7), refetchType: 'active' }]])
    })

    it('간격 안에 연달아 오면 바로 한 번, 간격 끝에 한 번만 무효화한다', () => {
      vi.useFakeTimers()
      const qc = qcWithRevisions(7, 8)
      const spy = vi.spyOn(qc, 'invalidateQueries')
      handleWikiEvent(qc, 'wiki.page.updated', { spaceId: 1, pageId: 7 })
      vi.advanceTimersByTime(1000)
      handleWikiEvent(qc, 'wiki.page.updated', { spaceId: 1, pageId: 7 })
      vi.advanceTimersByTime(1000)
      handleWikiEvent(qc, 'wiki.page.updated', { spaceId: 1, pageId: 7 })
      expect(revisionCalls(spy)).toHaveLength(1)
      vi.advanceTimersByTime(REVISIONS_REFETCH_INTERVAL_MS)
      expect(revisionCalls(spy)).toHaveLength(2)
      // 다른 페이지는 따로 센다.
      handleWikiEvent(qc, 'wiki.page.updated', { spaceId: 1, pageId: 8 })
      expect(revisionCalls(spy, 8)).toHaveLength(1)
    })
  })

  it('wiki 이벤트가 아니면 아무것도 무효화하지 않는다', () => {
    expect(invalidatedKeys('wiki.ai.delta', { pageId: 7 })).toEqual([])
  })
})

// WP-301 노트 요약 캐시의 낡음(STALE) 판정 — 버전 비교·재조회·같은 버전 무시.
// E2E 에서 생성 응답 지연(3초)·부재 확인(1초씩)으로 실시간을 쓰던 분기 검증을 옮겼다(WP-410).
// 편집기 → syncWikiSummaryVersion 배선은 wiki-summary.spec 의 "저장으로 노트가 바뀌면 낡음 표시" 가 본다.
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WikiPageDetail, WikiPageSummaryState } from '../../types/wiki'
import { storeGeneratedSummary, syncWikiSummaryVersion, wikiSummaryKey, withLatestVersion } from './useWikiSummary'
import { wikiKeys } from './wikiKeys'

const PAGE_ID = 300

function ready(version: number, summary = '요약'): WikiPageSummaryState {
  return { summary, status: 'READY', summaryVersion: version, pageVersion: version, summarizedAt: '2026-10-08T00:00:00Z' }
}
function tooShort(version = 1): WikiPageSummaryState {
  return { summary: null, status: 'TOO_SHORT', summaryVersion: null, pageVersion: version, summarizedAt: null }
}
function missing(version = 1): WikiPageSummaryState {
  return { summary: null, status: 'MISSING', summaryVersion: null, pageVersion: version, summarizedAt: null }
}

describe('withLatestVersion', () => {
  it('요약 이후 노트가 저장됐으면 STALE 로 바꾸고 pageVersion 을 올린다', () => {
    expect(withLatestVersion(ready(1), 2)).toEqual({ ...ready(1), status: 'STALE', pageVersion: 2 })
  })

  it('알 수 없거나 같거나 더 오래된 버전이면 같은 객체를 돌려준다(호출측이 동일성으로 변경 여부를 판정)', () => {
    const d = ready(2)
    expect(withLatestVersion(d, undefined)).toBe(d)
    expect(withLatestVersion(d, 2)).toBe(d)
    expect(withLatestVersion(d, 1)).toBe(d)
    // 서버가 이미 STALE 로 알려 준 응답도 같은 버전이면 손대지 않는다(다른 사람의 저장 — 서버 판정을 따른다).
    const serverStale: WikiPageSummaryState = { ...ready(1), status: 'STALE', pageVersion: 2 }
    expect(withLatestVersion(serverStale, 2)).toBe(serverStale)
  })

  it('요약이 없는 상태(MISSING·TOO_SHORT)는 서버만 판정할 수 있어 그대로 둔다', () => {
    const m = missing(1)
    expect(withLatestVersion(m, 5)).toBe(m)
    const t = tooShort(1)
    expect(withLatestVersion(t, 5)).toBe(t)
  })

  it('요약 버전이 이미 새 버전 이상이면(응답의 pageVersion 만 낡음) 그대로 둔다', () => {
    const d = { ...ready(3), pageVersion: 1 }
    expect(withLatestVersion(d, 3)).toBe(d)
  })
})

describe('syncWikiSummaryVersion', () => {
  let qc: QueryClient
  beforeEach(() => {
    qc = new QueryClient()
  })

  it('요약 캐시가 없으면 아무것도 하지 않는다', () => {
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    syncWikiSummaryVersion(qc, PAGE_ID, 2)
    expect(qc.getQueryData(wikiSummaryKey(PAGE_ID))).toBeUndefined()
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('같은 버전(제목만 바뀐 알림)이나 더 오래된 버전은 캐시도 재조회도 건드리지 않는다', () => {
    const cur = ready(2)
    qc.setQueryData(wikiSummaryKey(PAGE_ID), cur)
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const set = vi.spyOn(qc, 'setQueryData')

    syncWikiSummaryVersion(qc, PAGE_ID, 2)
    syncWikiSummaryVersion(qc, PAGE_ID, 1)

    expect(qc.getQueryData(wikiSummaryKey(PAGE_ID))).toBe(cur)
    expect(invalidate).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
  })

  it('TOO_SHORT 도 같은 버전의 반복 알림에서는 다시 조회하지 않는다', () => {
    qc.setQueryData(wikiSummaryKey(PAGE_ID), tooShort(2))
    const invalidate = vi.spyOn(qc, 'invalidateQueries')

    syncWikiSummaryVersion(qc, PAGE_ID, 2)

    expect(invalidate).not.toHaveBeenCalled()
  })

  it('요약이 없는 상태(MISSING)는 새 버전이 와도 캐시를 다시 쓰지 않는다', () => {
    const cur = missing(1)
    qc.setQueryData(wikiSummaryKey(PAGE_ID), cur)
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const set = vi.spyOn(qc, 'setQueryData')

    syncWikiSummaryVersion(qc, PAGE_ID, 2)

    expect(qc.getQueryData(wikiSummaryKey(PAGE_ID))).toBe(cur)
    expect(set).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('요약이 있고 새 버전이 오면 서버를 묻지 않고 STALE 로 맞춘다', () => {
    qc.setQueryData(wikiSummaryKey(PAGE_ID), ready(1))
    const invalidate = vi.spyOn(qc, 'invalidateQueries')

    syncWikiSummaryVersion(qc, PAGE_ID, 2)

    expect(qc.getQueryData<WikiPageSummaryState>(wikiSummaryKey(PAGE_ID))).toEqual({
      ...ready(1),
      status: 'STALE',
      pageVersion: 2,
    })
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('TOO_SHORT 이면 새 버전에서 다시 조회한다 — 길어진 노트가 MISSING 이 되어 자동 생성으로 이어지게', () => {
    qc.setQueryData(wikiSummaryKey(PAGE_ID), tooShort(1))
    const invalidate = vi.spyOn(qc, 'invalidateQueries')

    syncWikiSummaryVersion(qc, PAGE_ID, 2)

    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: wikiSummaryKey(PAGE_ID) })
  })
})

describe('storeGeneratedSummary', () => {
  it('생성 중에 저장해 노트 캐시가 더 새 버전이면 도착한 요약을 STALE 로 넣는다', () => {
    const qc = new QueryClient()
    qc.setQueryData(wikiKeys.page(PAGE_ID), { version: 2 } as WikiPageDetail)

    storeGeneratedSummary(qc, PAGE_ID, ready(1, 'A 요약'))

    expect(qc.getQueryData<WikiPageSummaryState>(wikiSummaryKey(PAGE_ID))).toEqual({
      ...ready(1, 'A 요약'),
      status: 'STALE',
      pageVersion: 2,
    })
  })

  it('노트 캐시 버전과 같으면 그대로 READY 로 넣는다', () => {
    const qc = new QueryClient()
    qc.setQueryData(wikiKeys.page(PAGE_ID), { version: 1 } as WikiPageDetail)

    storeGeneratedSummary(qc, PAGE_ID, ready(1, 'A 요약'))

    expect(qc.getQueryData<WikiPageSummaryState>(wikiSummaryKey(PAGE_ID))?.status).toBe('READY')
  })
})

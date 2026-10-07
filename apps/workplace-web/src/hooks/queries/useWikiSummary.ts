// WP-301 노트 상단 AI 요약 조회·생성 훅.

import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { wikiApi } from '../../api/wiki'
import type { WikiPageDetail, WikiPageSummaryState } from '../../types/wiki'
import { useAiAvailable } from '../useAiAvailable'
import { wikiKeys } from './wikiKeys'

export const wikiSummaryKey = (pageId: number) => ['wiki-summary', pageId] as const

/**
 * 요약 응답을 클라이언트가 아는 더 새 노트 버전에 맞춘다 — 요약이 있는데 그 요약 이후 노트가 저장됐으면 STALE 로 바꾼다.
 * 응답이 오는 사이 내 저장이 끝나 응답의 pageVersion 이 이미 낡은 경우에도 카드가 "최신 요약"처럼 보이지 않게 하기 위함이다.
 * 요약이 없는 상태(TOO_SHORT·MISSING·UNAVAILABLE)는 서버만 판정할 수 있어 그대로 둔다.
 */
function withLatestVersion(data: WikiPageSummaryState, version: number | undefined): WikiPageSummaryState {
  if (version == null || version <= data.pageVersion) return data
  if (data.summary == null || data.summaryVersion == null || data.summaryVersion >= version) return data
  return { ...data, pageVersion: version, status: 'STALE' }
}

/** 노트 상세 캐시의 현재 버전 — 저장 성공 시 useSavePage 가 갱신하므로 편집기가 아는 최신 버전과 같다. */
function cachedPageVersion(qc: QueryClient, pageId: number): number | undefined {
  return qc.getQueryData<WikiPageDetail>(wikiKeys.page(pageId))?.version
}

/** 저장된 요약 조회 — AI 사용 가능할 때만. 실패해도 재시도하지 않는다(카드만 숨김). */
export function useWikiSummary(pageId: number) {
  const qc = useQueryClient()
  const aiAvailable = useAiAvailable()
  return useQuery({
    queryKey: wikiSummaryKey(pageId),
    queryFn: async () =>
      withLatestVersion((await wikiApi.getSummary(pageId)).data, cachedPageVersion(qc, pageId)),
    enabled: aiAvailable && pageId > 0,
    retry: false,
  })
}

/**
 * 편집기가 노트의 새 버전을 알게 됐을 때(내 저장 성공·원격 수정 반영) 요약 캐시를 맞춘다. 낡음 판정을 카드 상태가 아닌 캐시 한곳에 두기 위함이다.
 * - 캐시보다 새 버전이 아니면 아무것도 하지 않는다(같은 버전의 반복 호출로 재조회하지 않게).
 * - TOO_SHORT 면 다시 조회한다 — 짧던 노트가 저장으로 길어져 MISSING 이 되면 카드가 자동 생성을 시작하도록.
 * - 요약이 있고 그 이후 버전이면 서버를 다시 묻지 않고 STALE 로 표시한다.
 */
export function syncWikiSummaryVersion(qc: QueryClient, pageId: number, version: number) {
  const cur = qc.getQueryData<WikiPageSummaryState>(wikiSummaryKey(pageId))
  if (!cur || version <= cur.pageVersion) return
  if (cur.status === 'TOO_SHORT') {
    void qc.invalidateQueries({ queryKey: wikiSummaryKey(pageId) })
    return
  }
  const next = withLatestVersion(cur, version)
  if (next !== cur) qc.setQueryData(wikiSummaryKey(pageId), next)
}

/**
 * 요약 생성. pageId 를 변수로 받는다 — 생성 중 다른 노트로 이동해도 결과가 요청한 노트 캐시에만 들어가게(클로저 캡처 금지,
 * useGenerateMailSummary 와 같은 이유). 실패 토스트는 띄우지 않고 카드가 "다시 시도"로 안내한다.
 * 생성 중에 내가 저장했을 수 있으므로 결과는 노트 캐시 버전에 맞춰 넣는다.
 */
export function useGenerateWikiSummary() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (pageId: number) => (await wikiApi.generateSummary(pageId)).data,
    onSuccess: (data, pageId) => {
      qc.setQueryData(wikiSummaryKey(pageId), withLatestVersion(data, cachedPageVersion(qc, pageId)))
    },
  })
}

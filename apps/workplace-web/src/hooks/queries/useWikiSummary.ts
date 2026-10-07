// WP-301 노트 상단 AI 요약 조회·생성 훅.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { wikiApi } from '../../api/wiki'
import { useAiAvailable } from '../useAiAvailable'

export const wikiSummaryKey = (pageId: number) => ['wiki-summary', pageId] as const

/** 저장된 요약 조회 — AI 사용 가능할 때만. 실패해도 재시도하지 않는다(카드만 숨김). */
export function useWikiSummary(pageId: number) {
  const aiAvailable = useAiAvailable()
  return useQuery({
    queryKey: wikiSummaryKey(pageId),
    queryFn: async () => (await wikiApi.getSummary(pageId)).data,
    enabled: aiAvailable && pageId > 0,
    retry: false,
  })
}

/**
 * 요약 생성. pageId 를 변수로 받는다 — 생성 중 다른 노트로 이동해도 결과가 요청한 노트 캐시에만 들어가게(클로저 캡처 금지,
 * useGenerateMailSummary 와 같은 이유). 실패 토스트는 띄우지 않고 카드가 "다시 시도"로 안내한다.
 */
export function useGenerateWikiSummary() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (pageId: number) => (await wikiApi.generateSummary(pageId)).data,
    onSuccess: (data, pageId) => {
      qc.setQueryData(wikiSummaryKey(pageId), data)
    },
  })
}

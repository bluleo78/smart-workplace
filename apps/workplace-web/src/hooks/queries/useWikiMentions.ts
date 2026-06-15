import { useQuery } from '@tanstack/react-query'

import { wikiApi } from '../../api/wiki'
import type { WikiMentionRef } from '../../types/wiki'
import { wikiKeys } from './wikiKeys'

// 페이지 본문 멘션 토큰을 라벨/링크 정보로 해소 — 칩 렌더용. pageId 없으면 비활성.
export function useWikiMentions(pageId: number | null) {
  return useQuery<WikiMentionRef[]>({
    queryKey: wikiKeys.mentions(pageId ?? 0),
    queryFn: () => wikiApi.getMentions(pageId as number).then((r) => r.data),
    enabled: pageId != null,
    staleTime: 30_000, // 본문 저장 전까지 멘션 결과는 변하지 않음
  })
}

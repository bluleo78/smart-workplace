import { useQuery } from '@tanstack/react-query'

import { wikiApi } from '../../api/wiki'
import { useWikiShareToken } from '../../components/wiki/WikiShareTokenContext'
import type { WikiMentionRef } from '../../types/wiki'
import { wikiKeys } from './wikiKeys'

// 페이지 본문 멘션 토큰을 라벨/링크 정보로 해소 — 칩 렌더용. pageId 없으면 비활성.
// 공유 화면(WP-579)이면 공유 토큰을 실어 묻고, 볼 수 없는 대상은 inaccessible 로 받는다 — 멤버 응답과 모양이 달라 키에 토큰을 더한다
// (접두는 wikiKeys.mentions 그대로라 기존 무효화가 둘 다 맞힌다).
export function useWikiMentions(pageId: number | null) {
  const shareToken = useWikiShareToken()
  return useQuery<WikiMentionRef[]>({
    queryKey: [...wikiKeys.mentions(pageId ?? 0), shareToken ?? null],
    queryFn: () => wikiApi.getMentions(pageId as number, shareToken).then((r) => r.data),
    enabled: pageId != null,
    staleTime: 30_000, // 본문 저장 전까지 멘션 결과는 변하지 않음
  })
}

import { useQuery } from '@tanstack/react-query'
import { FileQuestion } from 'lucide-react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'

import { ResourceErrorState } from '@/components/layout/ResourceErrorState'
import { parseId } from '@/lib/historyParam'

import { wikiApi } from '../../api/wiki'
import { WikiPageSkeleton } from '../../components/wiki/WikiPageSkeleton'
import { isGoneError } from '../../components/wiki/wikiShareLink'
import { wikiKeys } from '../../hooks/queries/wikiKeys'
import type { WikiPageEntry } from '../../types/wiki'

/**
 * 노트 알림 입구(WP-579) — /wiki/open/:pageId. 공유받음·접근 요청·승인 알림(과 그 푸시)이 이 주소로 연다.
 * 알림은 페이지만 알고 그 사람이 어떻게 들어갈지는 모르므로, 서버(GET /wiki/pages/{id}/entry)에 물어 보낸다:
 * 스페이스 멤버면 원래 노트 주소(접근 요청 알림의 `?share=1` — 공유 창을 연 채로 — 은 그대로 넘긴다),
 * 공유 대상이면 지금 토큰의 공유 화면(재발급돼도 최신 토큰), 둘 다 아니면(해제·제외) 열 수 없다는 안내.
 */
export function WikiOpenPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const pageId = parseId(useParams().pageId ?? null)
  const entry = useQuery<WikiPageEntry>({
    queryKey: wikiKeys.entry(pageId ?? 0),
    queryFn: () => wikiApi.getPageEntry(pageId as number).then((r) => r.data),
    enabled: pageId != null,
    retry: false,
    // 알림을 누를 때마다 지금 상태로 판정한다(그사이 해제·재발급될 수 있다).
    gcTime: 0,
  })

  // 일시적 실패(5xx·네트워크)는 「열 수 없습니다」가 아니라 다시 시도 — 404 만 노트가 없거나 공유가 해제된 것이다.
  if (pageId != null && entry.isError && !isGoneError(entry.error)) {
    return (
      <div data-testid="wiki-open-load-error" className="flex flex-1 flex-col">
        <ResourceErrorState
          icon={FileQuestion}
          title="노트를 불러오지 못했습니다"
          description="잠시 후 다시 시도해 주세요."
          actionLabel="다시 시도"
          onAction={() => void entry.refetch()}
        />
      </div>
    )
  }
  if (pageId == null || entry.isError) {
    return (
      <div data-testid="wiki-open-unavailable" className="flex flex-1 flex-col">
        <ResourceErrorState
          icon={FileQuestion}
          title="노트를 열 수 없습니다"
          description="노트가 삭제됐거나 공유가 해제돼 더 이상 볼 수 없습니다."
          actionLabel="노트로 가기"
          onAction={() => navigate('/wiki')}
        />
      </div>
    )
  }
  if (!entry.data) return <WikiPageSkeleton testId="wiki-open-skeleton" />
  const { spaceId, member, shareToken } = entry.data
  if (member) return <Navigate to={`/wiki/spaces/${spaceId}/pages/${pageId}${location.search}`} replace />
  if (shareToken) return <Navigate to={`/wiki/share/${shareToken}/pages/${pageId}`} replace />
  // 서버가 멤버도 공유 대상도 아니면 404 로 답한다 — 이 갈래는 응답 모양이 어긋났을 때만.
  return <Navigate to="/wiki" replace />
}

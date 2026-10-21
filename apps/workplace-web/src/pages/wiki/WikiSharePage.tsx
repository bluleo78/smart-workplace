import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2, LinkIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'

import { ResourceErrorState } from '@/components/layout/ResourceErrorState'
import { sidebarTitleClass } from '@/components/layout/sidebar-link'
import { useAuth } from '@/hooks/useAuth'
import { useIsMobile } from '@/hooks/useIsMobile'
import { handleApiError } from '@/lib/api-error'
import { parseId } from '@/lib/historyParam'
import { openPushTarget } from '@/lib/push/openTarget'

import { wikiApi } from '../../api/wiki'
import { WikiEditor } from '../../components/wiki/WikiEditor'
import { WikiPageSkeleton } from '../../components/wiki/WikiPageSkeleton'
import {
  type AccessRequestState,
  accessRequestState,
  classifyShareLinkError,
  dropShareCaches,
  isGoneError,
  type ShareLinkFailure,
} from '../../components/wiki/wikiShareLink'
import { WikiSharePageSelect } from '../../components/wiki/WikiSharePageSelect'
import { useShowPublicShareView } from '../../components/wiki/wikiSharePublicView'
import { WikiShareLoadError, WikiShareTreeNav } from '../../components/wiki/WikiShareViewParts'
import { useWikiPage } from '../../hooks/queries/useWikiPage'
import { wikiKeys } from '../../hooks/queries/wikiKeys'
import type { WikiShareResolved } from '../../types/wiki'

/**
 * 공유 링크 화면(WP-579) — /wiki/share/:token(/pages/:pageId). 스페이스 멤버가 아닌 워크스페이스 멤버가 링크로 들어온다.
 * 노트 사이드바 없이 그 페이지(하위 포함이면 공유된 하위 트리까지)만 보이고, 페이지 머리에 누가 공유했는지 보인다.
 * 이 스페이스 멤버가 열면 원래 노트 화면으로 보낸다 — 거기서 모든 기능을 쓸 수 있다.
 *
 * 링크 열기 실패는 갈래로 나눈다(classifyShareLinkError): 다른 워크스페이스면 그곳으로 전환해 같은 주소를 다시 열고(알림 열기와 같은
 * openPushTarget), 지정한 사람이 아니면 접근 요청, 없음(404)이면 「링크가 더 이상 열리지 않습니다」, 그 밖(5xx·네트워크)은
 * 「불러오지 못했습니다 + 다시 시도」(외부 보기와 같게). 열린 뒤 공유가 해제·재발급되면
 * 동기화 서버가 연결을 닫고(4403) 에디터가 알려 와 화면을 닫는다.
 */
export function WikiSharePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const { activeTenant, selectTenant } = useAuth()
  const activeTenantId = activeTenant?.tenantId ?? null
  const { token = '', pageId: pageIdParam } = useParams()
  // 공유가 해제돼 닫힌 토큰 — 같은 화면에 머무는 동안 에디터를 다시 그리지 않는다(다른 토큰 주소로 가면 새로 판정).
  const [closedToken, setClosedToken] = useState<string | null>(null)
  const closed = closedToken === token
  const resolved = useQuery<WikiShareResolved>({
    queryKey: wikiKeys.shareLink(token),
    queryFn: () => wikiApi.resolveShare(token).then((r) => r.data),
    retry: false,
    // 닫힌 뒤엔 다시 묻지 않는다 — 닫을 때 이 캐시를 지우므로(dropShareCaches) 켜 두면 곧바로 다시 받는다.
    enabled: !closed,
  })
  const failure: ShareLinkFailure | null = resolved.isError ? classifyShareLinkError(resolved.error, activeTenantId) : null
  const switchTenantId = failure?.kind === 'switch' ? failure.tenantId : null

  const pageId = parseId(pageIdParam ?? null) ?? resolved.data?.rootPageId ?? null
  // 링크로 볼 수 있는 페이지가 아니면(하위 밖으로 옮겨졌거나 다른 주소) 읽지 않는다. 닫힌 뒤에도 다시 읽지 않는다.
  const inShare = pageId != null && (resolved.data?.pages.some((p) => p.id === pageId) ?? false)
  const page = useWikiPage(inShare && !closed ? pageId : null, token)
  const isMobile = useIsMobile()

  // 다른 워크스페이스 링크 — 그 워크스페이스로 전환(전체 새로고침)하며 같은 주소(하위 페이지 포함)를 다시 연다. 한 번만 부른다
  // (StrictMode 이중 effect·리렌더에 전환 요청이 겹치지 않게). 그 워크스페이스 멤버가 아니면 openPushTarget 이 안내 후 홈으로 보낸다.
  const switchStarted = useRef(false)
  const targetUrl = location.pathname
  useEffect(() => {
    if (switchTenantId == null || switchStarted.current) return
    switchStarted.current = true
    void openPushTarget({ tenantId: switchTenantId, url: targetUrl }, { activeTenantId, selectTenant, navigate })
  }, [switchTenantId, targetUrl, activeTenantId, selectTenant, navigate])

  // 다른 워크스페이스의 외부 링크이고 그곳 멤버가 아님 — 입구가 앱 셸 밖 외부 보기로 바꿔 그린다(비로그인과 같은 화면).
  const showPublicView = useShowPublicShareView()
  const isPublicView = failure?.kind === 'public'
  useEffect(() => {
    if (isPublicView) showPublicView?.(token)
  }, [isPublicView, showPublicView, token])

  // 공유 해제·재발급(4403) — 화면을 닫고, 그 토큰으로 받은 멘션·이미지·페이지 캐시를 버린다.
  const onClosed = useCallback(() => {
    setClosedToken(token)
    dropShareCaches(qc, token)
  }, [qc, token])

  // 전환은 전체 새로고침으로 끝난다 — 그 사이엔 자리만 둔다.
  // 외부 보기로 바뀌는 동안도 자리만 둔다.
  if (failure?.kind === 'switch' || failure?.kind === 'public') return <WikiPageSkeleton testId="wiki-share-switching" />
  if (failure?.kind === 'error') {
    return <WikiShareLoadError testId="wiki-share-load-error" onRetry={() => void resolved.refetch()} />
  }
  if (failure?.kind === 'forbidden') return <WikiShareAccessRequest failure={failure} token={token} />
  if (failure || closed) return <WikiShareClosed onBack={() => navigate('/wiki')} />
  if (resolved.data?.member && pageId != null) {
    return <Navigate to={`/wiki/spaces/${resolved.data.spaceId}/pages/${pageId}`} replace />
  }
  const data = resolved.data
  const hasChildren = data != null && data.pages.length > 1
  const openPage = (id: number) => navigate(`/wiki/share/${token}/pages/${id}`)
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" data-testid="wiki-share-page">
      {/* 휴대폰엔 왼쪽 트리 자리가 없어 외부 보기와 같은 선택 상자로 공유된 하위 페이지를 옮긴다. */}
      {hasChildren && isMobile && <WikiSharePageSelect pages={data.pages} activeId={pageId} onSelect={openPage} />}
      <div className="flex min-h-0 flex-1">
        {hasChildren && !isMobile && (
          // 공유된 하위 트리 — 하위 포함 공유일 때만. 드래그·추가·삭제 없이 읽기만 한다.
          <aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar/40" data-testid="wiki-share-tree">
            <div className={sidebarTitleClass}>
              <LinkIcon className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
              공유된 페이지
            </div>
            <WikiShareTreeNav className="min-h-0 flex-1" pages={data.pages} activeId={pageId} onOpen={openPage} />
          </aside>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {data && !inShare ? (
            <WikiShareClosed onBack={() => navigate(`/wiki/share/${token}`)} />
          ) : page.isError ? (
            isGoneError(page.error) ? (
              <WikiShareClosed onBack={() => navigate('/wiki')} />
            ) : (
              <WikiShareLoadError testId="wiki-share-load-error" onRetry={() => void page.refetch()} />
            )
          ) : !data || !page.data ? (
            <WikiPageSkeleton testId="wiki-share-skeleton" />
          ) : (
            <WikiEditor
              key={page.data.id}
              page={page.data}
              spaceId={data.spaceId}
              share={{
                token,
                permission: data.permission,
                pages: data.pages,
                sharedByName: data.sharedBy.name,
                onClosed,
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/** 접근 요청 화면의 안내 — 상태별(요청 전·요청함·거절됨). 거절은 24시간 안에 다시 요청해도 새 요청이 가지 않아 직접 문의를 안내한다. */
const ACCESS_REQUEST_TEXT: Record<AccessRequestState, string> = {
  idle: '공유한 사람이 지정한 사람만 열 수 있는 링크입니다. 접근을 요청하면 공유한 사람에게 알림이 갑니다.',
  requested: '접근을 요청했습니다. 공유한 사람이 승인하면 알림으로 알려 드립니다.',
  denied: '접근 요청이 거절되었습니다. 필요하면 공유한 사람에게 직접 문의하세요.',
}

/** 접근 요청 버튼 이름 — 요청함·거절됨은 누를 수 없다. */
const ACCESS_REQUEST_ACTION: Record<AccessRequestState, string> = {
  idle: '접근 요청',
  requested: '요청함',
  denied: '거절됨',
}

/** 링크가 더 이상 열리지 않음 — 해제·재발급·만료(404)·열린 화면의 공유가 닫힘·하위 밖으로 옮겨진 페이지. */
function WikiShareClosed({ onBack }: { onBack: () => void }) {
  return (
    <div data-testid="wiki-share-unavailable" className="flex flex-1 flex-col">
      <ResourceErrorState
        icon={Link2}
        title="링크가 더 이상 열리지 않습니다"
        description="공유가 해제됐거나 만료됐거나 새 링크로 바뀌었을 수 있습니다. 공유한 사람에게 새 링크를 요청하세요."
        actionLabel="노트로 가기"
        onAction={onBack}
      />
    </div>
  )
}

/**
 * 지정한 사람이 아님(403) — 접근 요청을 보낸다. 링크 자체는 유효해 언제나 요청할 수 있고, 이미 보냈으면 「요청함」, 같은 공유에 24시간 안에
 * 거절됐으면 「거절됨」(둘 다 다시 보낼 수 없음). 요청할 필요가 없다는 답(NOT_NEEDED — 그 사이 지정됐거나 멤버가 됨)이면 링크를 다시 열어 바로
 * 보이게 한다.
 */
function WikiShareAccessRequest({
  failure,
  token,
}: {
  failure: Extract<ShareLinkFailure, { kind: 'forbidden' }>
  token: string
}) {
  const qc = useQueryClient()
  const request = useMutation({
    mutationFn: () => wikiApi.requestShareAccess(token).then((r) => r.data),
    onSuccess: (r) => {
      if (r.status === 'NOT_NEEDED') void qc.invalidateQueries({ queryKey: wikiKeys.shareLink(token), exact: true })
    },
    onError: (e) => handleApiError(e, '접근을 요청하지 못했습니다.'),
  })
  const state = accessRequestState(failure, request.data?.status)
  return (
    <div data-testid="wiki-share-unavailable" className="flex flex-1 flex-col">
      <ResourceErrorState
        icon={Link2}
        title="이 링크를 열 수 없습니다"
        description={ACCESS_REQUEST_TEXT[state]}
        actionLabel={ACCESS_REQUEST_ACTION[state]}
        onAction={() => request.mutate()}
        actionDisabled={state !== 'idle' || request.isPending}
      />
    </div>
  )
}

import { useQuery } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { BookOpen, FileQuestion } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'

import { AiLabel } from '@/components/ai/AiLabel'
import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import { ResourceErrorState } from '@/components/layout/ResourceErrorState'
import { Button } from '@/components/ui/button'
import { buildWikiContext } from '@/lib/aiScreenContext/builders/wiki'

import { wikiApi } from '../../api/wiki'
import { useWikiPage } from '../../hooks/queries/useWikiPage'
import { useWikiSpaces } from '../../hooks/queries/useWikiSpaces'
import { wikiKeys } from '../../hooks/queries/wikiKeys'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { useWikiLastVisitedKey } from '../../hooks/useWikiLastVisitedKey'
import {
  clearWikiLastVisited,
  isWikiPageGone,
  readWikiLastVisited,
  writeWikiLastVisited,
} from '../../lib/wikiLastVisited'
import { useCreateWikiPageAndOpen } from './useCreateWikiPageAndOpen'
import { WikiEditor } from './WikiEditor'
import { WikiPageSkeleton } from './WikiPageSkeleton'
import { type ConfirmedLoadState, trackConfirmedLoad, wikiPageViewMode } from './wikiPageViewMode'
import { canEditWikiSpace, isWikiSpaceUnavailable } from './wikiSpaceUnavailable'
import { WikiSpaceUnavailableState } from './WikiSpaceUnavailableState'

/** 선택된 페이지를 로드해 에디터를 마운트. 미선택 시 DS §2.5 빈 상태(4요소) 표시. */
export function WikiPageView({ pageId, spaceId }: { pageId: number | null; spaceId: number }) {
  const { data: page, isLoading, isError, error, isSuccess, isFetching } = useWikiPage(pageId)
  // 이번 방문에서 조회 성공을 확인했는지 — 캐시만으로는 확인하지 않고, 노트가 바뀌면(노트 없음 포함) 버린다(WP-296).
  // 렌더 중 상태 갱신(바뀌었을 때만)으로 같은 렌더에 반영한다 — effect 로 미루면 한 프레임 동안 예전 확인으로 그린다.
  const [confirmState, setConfirmState] = useState<ConfirmedLoadState>({ pageId: null, confirmed: false })
  const nextConfirm = trackConfirmedLoad(confirmState, { pageId, dataId: page?.id, isSuccess, isFetching })
  if (nextConfirm !== confirmState) setConfirmState(nextConfirm)
  const { create: createPage, isPending: createPending } = useCreateWikiPageAndOpen(spaceId)
  const navigate = useNavigate()
  const lastVisitedKey = useWikiLastVisitedKey()

  // WP-54: 위키 화면 컨텍스트 — 스페이스 이름은 캐시된 스페이스 목록에서(WikiSidebar 와 같은 쿼리).
  // 스페이스 루트(pageId 없음)·로딩·에러 중에는 page=null 로 scope 만 싣는다(미로딩 데이터를 사실로 보내지 않음).
  // 스페이스 루트도 이 컴포넌트가 렌더하므로 페이지당 등록은 1개다.
  const spaces = useWikiSpaces()
  const spaceName = spaces.data?.find((s) => s.id === spaceId)?.name ?? null
  const screenContext = useMemo(
    () =>
      buildWikiContext({
        spaceId,
        spaceName,
        page: pageId != null && !isError && page ? { id: page.id, title: page.title, updatedAt: page.updatedAt } : null,
      }),
    [spaceId, spaceName, pageId, isError, page],
  )
  useRegisterAiScreenContext(screenContext)
  // 탭 제목 — 노트를 열었으면 「{노트 제목} · 노트」, 공간 첫 화면이면 「{공간} · 노트」(WP-814).
  useDocumentTitle([
    pageId != null ? (page?.id === pageId && !isError ? page.title || '제목 없음' : null) : spaceName,
    '노트',
  ])

  // 로드에 성공한 페이지를 "마지막으로 본 노트"로 기록 — /wiki 재진입 시 WikiIndexRedirect 가 복원한다.
  // 보던 중 삭제·권한 상실(404/403)된 페이지가 기록돼 있으면 지워, 에러 화면의 「노트 목록으로」가
  // 같은 페이지로 되돌아오지 않게 한다.
  const loadedPageId = isError ? undefined : page?.id
  const gone = isError && isWikiPageGone(error)
  useEffect(() => {
    if (!lastVisitedKey) return
    if (loadedPageId != null) writeWikiLastVisited(lastVisitedKey, loadedPageId)
    else if (gone && pageId != null && readWikiLastVisited(lastVisitedKey) === pageId) clearWikiLastVisited(lastVisitedKey)
  }, [lastVisitedKey, loadedPageId, gone, pageId])

  // 본문 자리 분기 — 이 화면에서 불러온 노트는 재조회가 실패해도(삭제 SSE 뒤 404) 에디터를 유지한다(WP-296).
  const mode = wikiPageViewMode({ pageId, isLoading, isError, dataId: page?.id, loadedInThisView: nextConfirm.confirmed })
  // 공간 주소만 열었는데 내 공간 목록에 없으면(남의·없는 공간) 「새 페이지 만들기」 빈 상태 대신 안내만 둔다(WP-559) —
  // 만들기를 눌러도 404 라 쓸모없고, 페이지 주소의 접근 불가 안내와 같은 모양으로 맞춘다.
  if (mode === 'empty' && isWikiSpaceUnavailable(spaces, spaceId)) {
    return <WikiSpaceUnavailableState onBack={() => navigate('/wiki')} />
  }
  if (mode === 'empty') {
    // 읽기 전용 공간(VIEWER)이면 만들기 버튼 대신 안내만 둔다(WP-602) — 눌러도 403 이다.
    const canCreate = canEditWikiSpace(spaces.data, spaceId)
    /** 빈 상태 — DS §2.5: 아이콘 + 제목 + 설명 + CTA 버튼 4요소(데스크톱 본문. 모바일 목록은 WikiNoPages, WP-179) */
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center" data-testid="wiki-empty-state">
        {/* 공간 첫 화면에는 헤더가 없어 화면 이름을 숨은 h1 로 둔다 — 스크린리더 제목 이동용(WP-816). */}
        <h1 className="sr-only">{spaceName ? `노트 — ${spaceName}` : '노트'}</h1>
        <BookOpen className="h-10 w-10 text-muted-foreground/50" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium">표시할 페이지가 없습니다</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {canCreate ? '페이지를 선택하거나 새 페이지를 만드세요' : '페이지를 선택하세요 — 이 공간은 읽기만 할 수 있어요'}
          </p>
        </div>
        {canCreate && <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => createPage(null)} disabled={createPending}>
            새 페이지 만들기
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => createPage(null, true)}
            disabled={createPending}
            data-testid="wiki-empty-state-ai-draft"
          >
            <AiLabel>AI 초안으로 시작</AiLabel>
          </Button>
        </div>}
      </div>
    )
  }
  if (mode === 'error') {
    /** #788: 존재하지 않는 페이지 ID 등 로드 실패 — 무한 skeleton 대신 ResourceErrorState(4요소) 표시. */
    // 404 면 이 페이지를 덮는 공유가 있는지 먼저 묻는다(WP-987) — 스페이스 멤버가 아닌 사람이 노트 주소를 받았으면 공유 보기로 옮겨 연다.
    if (pageId != null && isAxiosError(error) && error.response?.status === 404) {
      return <WikiPageShareFallback pageId={pageId} onBack={() => navigate('/wiki')} />
    }
    return <WikiPageUnavailableState onBack={() => navigate('/wiki')} />
  }
  // !page 는 타입 좁히기용 — 모드가 'editor' 면 page 가 있다.
  if (mode === 'loading' || !page) {
    /** 페이지 콘텐츠 형태를 미러하는 skeleton — DS §2.5 */
    return <WikiPageSkeleton testId="wiki-page-skeleton" />
  }
  // 다른 스페이스로 옮겨진 노트의 예전 주소(WP-988) — 옮긴 스페이스 주소로 연결한다. 옛 스페이스 사이드바에 남지 않게.
  if (page.spaceId !== spaceId) return <Navigate to={`/wiki/spaces/${page.spaceId}/pages/${page.id}`} replace />
  return <WikiEditor key={page.id} page={page} spaceId={spaceId} />
}

/**
 * 노트 주소로 열었는데 404(멤버가 아님·없는 페이지)일 때(WP-987) — 이 페이지를 지금 덮는 공유(워크스페이스 전체·지정한 사람)가 있으면 그 공유 보기
 * `/wiki/share/<토큰>/pages/<페이지>` 로 바꿔 연다. 없거나 묻지 못하면 지금처럼 「불러올 수 없습니다」 안내.
 */
function WikiPageShareFallback({ pageId, onBack }: { pageId: number; onBack: () => void }) {
  const entry = useQuery({
    queryKey: [...wikiKeys.entry(pageId), 'link'],
    queryFn: () => wikiApi.getPageEntry(pageId, true).then((r) => r.data),
    retry: false,
    // 열 때마다 지금 공유 상태로 판정한다(그사이 해제·재발급될 수 있다).
    gcTime: 0,
  })
  if (entry.isPending) return <WikiPageSkeleton testId="wiki-page-skeleton" />
  const token = entry.data && !entry.data.member ? entry.data.shareToken : null
  if (token) return <Navigate to={`/wiki/share/${token}/pages/${pageId}`} replace />
  return <WikiPageUnavailableState onBack={onBack} />
}

/** 없거나 볼 수 없는 노트 페이지 안내(#788) — 로드 실패와 숫자가 아닌 페이지 주소(WP-612)가 같이 쓴다. */
export function WikiPageUnavailableState({ onBack }: { onBack: () => void }) {
  return (
    <div data-testid="wiki-page-unavailable" className="flex flex-1 flex-col">
      <ResourceErrorState
        icon={FileQuestion}
        title="페이지를 불러올 수 없습니다"
        description="요청한 노트 페이지가 존재하지 않거나 접근 권한이 없습니다."
        actionLabel="노트 목록으로"
        onAction={onBack}
      />
    </div>
  )
}

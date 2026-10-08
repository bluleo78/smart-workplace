import { BookOpen, FileQuestion } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { AiLabel } from '@/components/ai/AiLabel'
import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import { ResourceErrorState } from '@/components/layout/ResourceErrorState'
import { Button } from '@/components/ui/button'
import { buildWikiContext } from '@/lib/aiScreenContext/builders/wiki'

import { useWikiPage } from '../../hooks/queries/useWikiPage'
import { useWikiSpaces } from '../../hooks/queries/useWikiSpaces'
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
  if (mode === 'empty') {
    /** 빈 상태 — DS §2.5: 아이콘 + 제목 + 설명 + CTA 버튼 4요소(데스크톱 본문. 모바일 목록은 WikiNoPages, WP-179) */
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center" data-testid="wiki-empty-state">
        <BookOpen className="h-10 w-10 text-muted-foreground/50" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium">표시할 페이지가 없습니다</p>
          <p className="mt-1 text-xs text-muted-foreground">페이지를 선택하거나 새 페이지를 만드세요</p>
        </div>
        <div className="flex items-center gap-2">
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
        </div>
      </div>
    )
  }
  if (mode === 'error') {
    /** #788: 존재하지 않는 페이지 ID 등 로드 실패 — 무한 skeleton 대신 ResourceErrorState(4요소) 표시. */
    return (
      <ResourceErrorState
        icon={FileQuestion}
        title="페이지를 불러올 수 없습니다"
        description="요청한 노트 페이지가 존재하지 않거나 접근 권한이 없습니다."
        actionLabel="노트 목록으로"
        onAction={() => navigate('/wiki')}
      />
    )
  }
  // !page 는 타입 좁히기용 — 모드가 'editor' 면 page 가 있다.
  if (mode === 'loading' || !page) {
    /** 페이지 콘텐츠 형태를 미러하는 skeleton — DS §2.5 */
    return <WikiPageSkeleton testId="wiki-page-skeleton" />
  }
  return <WikiEditor key={page.id} page={page} spaceId={spaceId} />
}

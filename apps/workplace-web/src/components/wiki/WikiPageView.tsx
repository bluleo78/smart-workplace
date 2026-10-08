import { BookOpen, FileQuestion } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

import { AiLabel } from '@/components/ai/AiLabel'
import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import { pageBodyInsetClass, pageReadingWidthClass } from '@/components/layout/Page'
import { ResourceErrorState } from '@/components/layout/ResourceErrorState'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { buildWikiContext } from '@/lib/aiScreenContext/builders/wiki'
import { cn } from '@/lib/utils'

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
import { useWikiFlushPending } from './wikiFlushRegistry'

/** 선택된 페이지를 로드해 에디터를 마운트. 미선택 시 DS §2.5 빈 상태(4요소) 표시. */
export function WikiPageView({ pageId, spaceId }: { pageId: number | null; spaceId: number }) {
  const { data: page, isLoading, isError, error } = useWikiPage(pageId)
  const { create: createPage, isPending: createPending } = useCreateWikiPageAndOpen(spaceId)
  const navigate = useNavigate()
  const lastVisitedKey = useWikiLastVisitedKey()
  // 직전 에디터 인스턴스의 언마운트 flush 저장이 진행 중이면 skeleton — 끝나면 캐시의 최신 본문·version 으로 마운트.
  const flushPending = useWikiFlushPending(pageId)

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

  if (pageId == null) {
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
  if (isError || (!isLoading && !page)) {
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
  if (isLoading || !page || flushPending) {
    /** 페이지 콘텐츠 형태를 미러하는 skeleton — DS §2.5 */
    return (
      <div className={cn(pageBodyInsetClass, pageReadingWidthClass)} data-testid="wiki-page-skeleton">
        <Skeleton className="mb-4 h-9 w-64" />
        <Skeleton className="mb-2 h-4 w-full" />
        <Skeleton className="mb-2 h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
      </div>
    )
  }
  return <WikiEditor key={page.id} page={page} spaceId={spaceId} />
}

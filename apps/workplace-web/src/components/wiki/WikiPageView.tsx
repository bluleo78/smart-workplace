import { BookOpen } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

import { useCreatePage } from '../../hooks/queries/useWikiMutations'
import { useWikiPage } from '../../hooks/queries/useWikiPage'
import { WikiEditor } from './WikiEditor'

/** 선택된 페이지를 로드해 에디터를 마운트. 미선택 시 DS §2.5 빈 상태(4요소) 표시. */
export function WikiPageView({ pageId, spaceId }: { pageId: number | null; spaceId: number }) {
  const { data: page, isLoading } = useWikiPage(pageId)
  const createPage = useCreatePage(spaceId)
  const navigate = useNavigate()

  if (pageId == null) {
    /** 빈 상태 — DS §2.5: 아이콘 + 제목 + 설명 + CTA 버튼 4요소 */
    const handleCreatePage = async () => {
      // 실제 저장값은 빈 문자열 — "제목 없음"은 표시용 폴백일 뿐 초기 상태 값이 아니다.
      const created = await createPage.mutateAsync({ parentId: null, title: '' })
      navigate(`/wiki/spaces/${spaceId}/pages/${created.id}`)
    }
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center" data-testid="wiki-empty-state">
        <BookOpen className="h-10 w-10 text-muted-foreground/50" />
        <div>
          <p className="text-sm font-medium">표시할 페이지가 없습니다</p>
          <p className="mt-1 text-xs text-muted-foreground">페이지를 선택하거나 새 페이지를 만드세요</p>
        </div>
        <Button size="sm" onClick={handleCreatePage} disabled={createPage.isPending}>
          새 페이지 만들기
        </Button>
      </div>
    )
  }
  if (isLoading || !page) {
    /** 페이지 콘텐츠 형태를 미러하는 skeleton — DS §2.5 */
    return (
      <div className="mx-auto max-w-3xl px-8 py-6" data-testid="wiki-page-skeleton">
        <Skeleton className="mb-4 h-9 w-64" />
        <Skeleton className="mb-2 h-4 w-full" />
        <Skeleton className="mb-2 h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
      </div>
    )
  }
  return <WikiEditor key={page.id} page={page} spaceId={spaceId} />
}

import { Skeleton } from '@/components/ui/skeleton'
import { useWikiPage } from '../../hooks/queries/useWikiPage'
import { WikiEditor } from './WikiEditor'

/** 선택된 페이지를 로드해 에디터를 마운트. 미선택 시 안내. */
export function WikiPageView({ pageId, spaceId }: { pageId: number | null; spaceId: number }) {
  const { data: page, isLoading } = useWikiPage(pageId)

  if (pageId == null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        왼쪽에서 페이지를 선택하거나 새 페이지를 만드세요.
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

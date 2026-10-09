import { pageBodyInsetClass } from '@/components/layout/Page'
import { cn } from '@/lib/utils'

import type { WikiRevisionHistory } from './useWikiRevisionHistory'
import { WikiPageSkeleton } from './WikiPageSkeleton'
import { WikiRevisionPreview } from './WikiRevisionPreview'

/**
 * 고른 판의 미리보기 본문(WP-282) — 본문 도착 전 스켈레톤, 실패 문구, 도착하면 읽기 전용 미리보기(변경 표시 포함).
 * 데스크톱 덮개(WikiRevisionLayer)와 모바일 전체화면(WikiRevisionMobile)이 함께 쓴다 — 스크롤 칸·폭은 호출자가 정한다.
 */
export function WikiRevisionPreviewBody({
  revisions,
  pageId,
  className,
}: {
  revisions: WikiRevisionHistory
  pageId: number
  /** 미리보기 본문 클래스(여백 위에 덧붙일 폭 제한 등). */
  className?: string
}) {
  const { detail } = revisions
  if (detail.data) {
    return (
      <WikiRevisionPreview
        pageId={pageId}
        body={detail.data.body}
        title={detail.data.title}
        compareTo={revisions.compareTo}
        showDiff={revisions.showDiff}
        className={cn(pageBodyInsetClass, className)}
      />
    )
  }
  if (detail.isError) return <p className={cn(pageBodyInsetClass, 'text-sm text-muted-foreground')}>이 버전을 불러오지 못했어요</p>
  return <WikiPageSkeleton testId="wiki-revision-preview-skeleton" />
}

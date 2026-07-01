import { BookText } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { useWikiPage } from '@/hooks/queries/useWikiPage'

import { WidgetError } from './WidgetError'
import { WidgetFrame } from './WidgetFrame'

// 마크다운 본문에서 plain text 일부를 추출한다.
// 헤딩 기호(#), 강조(*/_), 코드 블록(```) 등을 제거하고 처음 200자만 반환.
function extractPlainSnippet(markdown: string, maxLen = 200): string {
  return markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, maxLen)
}

/**
 * #460: 위키 페이지 상세 위젯 — show_wiki_page 지시를 받아 단일 위키 페이지를 표시한다.
 * params.pageId 누락 시 재시도 없는 안내 메시지를 렌더한다(정적 파라미터 오류라 재시도 무의미).
 * fetch 실패 시에는 WidgetError(onRetry) 로 재시도 허용.
 */
export default function WikiPageWidget({ params }: { params?: Record<string, unknown> }) {
  const pageId = typeof params?.pageId === 'number' ? params.pageId : null

  // pageId 누락 — 정적 파라미터 오류: 재시도 버튼 없이 안내 메시지만 표시.
  if (pageId === null) {
    return (
      <WidgetFrame title="노트 페이지">
        <div
          className="flex flex-col items-center gap-2 px-4 py-8 text-center"
          data-testid="wiki_page-error"
        >
          <BookText className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-semibold">페이지 ID가 없습니다</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            페이지 ID를 지정하여 다시 요청해 보세요.
          </p>
        </div>
      </WidgetFrame>
    )
  }

  // pageId 존재 — WikiPageContent 내부에서 훅을 호출(early return 이후 조건부 훅 금지 우회).
  return <WikiPageContent pageId={pageId} />
}

/** pageId 가 확정된 경우의 데이터 로드·렌더 분리 컴포넌트(훅 규칙 준수). */
function WikiPageContent({ pageId }: { pageId: number }) {
  const page = useWikiPage(pageId)

  if (page.isLoading) {
    return (
      <WidgetFrame title="노트 페이지">
        <Skeleton className="h-24 w-full" />
      </WidgetFrame>
    )
  }
  if (page.isError) {
    return (
      <WidgetFrame title="노트 페이지">
        <WidgetError onRetry={() => page.refetch()} testId="wiki_page-error" />
      </WidgetFrame>
    )
  }

  const detail = page.data
  if (!detail) return null

  const snippet = extractPlainSnippet(detail.body)

  return (
    <WidgetFrame title="노트 페이지">
      <div className="flex flex-col gap-2 p-1" data-testid="wiki_page-detail">
        {/* 페이지 제목 — 클릭 시 해당 페이지로 이동 */}
        <Link
          to={`/wiki/spaces/${detail.spaceId}/pages/${detail.id}`}
          className="flex items-center gap-2 font-medium hover:text-ai-accent"
          aria-label={`노트 페이지: ${detail.title}`}
        >
          <BookText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate text-sm">{detail.title}</span>
        </Link>
        {/* 본문 snippet — 마크다운 기호 제거 후 최대 200자 */}
        {snippet && (
          <p className="line-clamp-3 text-xs text-muted-foreground">{snippet}</p>
        )}
      </div>
    </WidgetFrame>
  )
}

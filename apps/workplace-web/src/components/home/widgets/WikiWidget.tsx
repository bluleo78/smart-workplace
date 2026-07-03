import { BookText } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { useWikiSpaces } from '@/hooks/queries/useWikiSpaces'
import { useWikiTree } from '@/hooks/queries/useWikiTree'
import type { WikiSpace } from '@/types/wiki'

import { WidgetError } from './WidgetError'
import { WidgetFrame } from './WidgetFrame'

/**
 * #460: 위키 목록 위젯 — show_wiki 지시를 받아 위키 스페이스 또는 페이지 목록을 표시한다.
 * - spaceId 미지정: useWikiSpaces() 로 스페이스 목록 렌더.
 * - spaceId 지정: useWikiTree(spaceId) 로 해당 스페이스의 페이지 목록 렌더.
 * - query 파라미터: YAGNI — 전용 검색 API 없으므로 클라이언트 제목 필터(있으면)만 적용.
 * 두 훅을 모두 무조건 호출(hooks-rules 준수). enabled 로 활성화 여부 제어.
 */
export default function WikiWidget({
  params,
  previewData,
}: {
  params?: Record<string, unknown>
  previewData?: WikiSpace[]
}) {
  const spaceId = typeof params?.spaceId === 'number' ? params.spaceId : null
  const query = typeof params?.query === 'string' ? params.query.trim().toLowerCase() : ''

  // spaceId 미지정이면 스페이스 목록, spaceId 지정이면 페이지 트리를 로드.
  // 두 훅을 항상 호출하되, enabled 플래그로 불필요한 fetch 를 막는다(훅 규칙 준수).
  const spaces = useWikiSpaces({ enabled: !previewData })
  const tree = useWikiTree(spaceId)

  const isSpaceMode = spaceId === null

  if (isSpaceMode) {
    if (!previewData && spaces.isLoading) {
      return (
        <WidgetFrame title="노트">
          <Skeleton className="h-24 w-full" />
        </WidgetFrame>
      )
    }
    if (!previewData && spaces.isError) {
      return (
        <WidgetFrame title="노트">
          <WidgetError onRetry={() => spaces.refetch()} testId="wiki-error" />
        </WidgetFrame>
      )
    }

    // query 있으면 이름 필터 적용.
    const items = (previewData ?? spaces.data ?? []).filter(
      (s) => !query || s.name.toLowerCase().includes(query),
    )

    return (
      <WidgetFrame title="노트">
        {items.length > 0 ? (
          <ul className="divide-y" data-testid="wiki-items">
            {items.map((s) => (
              <li key={s.id}>
                {/* 스페이스 클릭 → 해당 스페이스 페이지로 이동 */}
                <Link
                  to={`/wiki/spaces/${s.id}`}
                  aria-label={`노트 스페이스: ${s.name}`}
                  className="flex items-center gap-2 py-2 text-sm hover:text-ai-accent"
                >
                  <BookText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{s.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div
            className="flex flex-col items-center gap-2 px-4 py-8 text-center"
            data-testid="wiki-empty"
          >
            <BookText className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-semibold">노트가 없어요</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              노트 화면에서 새 스페이스를 만들어 보세요.
            </p>
          </div>
        )}
      </WidgetFrame>
    )
  }

  // spaceId 지정 모드 — 페이지 트리 표시.
  if (tree.isLoading) {
    return (
      <WidgetFrame title="노트 페이지">
        <Skeleton className="h-24 w-full" />
      </WidgetFrame>
    )
  }
  if (tree.isError) {
    return (
      <WidgetFrame title="노트 페이지">
        <WidgetError onRetry={() => tree.refetch()} testId="wiki-error" />
      </WidgetFrame>
    )
  }

  const pages = (tree.data ?? []).filter(
    (p) => !query || p.title.toLowerCase().includes(query),
  )

  return (
    <WidgetFrame title="노트 페이지">
      {pages.length > 0 ? (
        <ul className="divide-y" data-testid="wiki-items">
          {pages.map((p) => (
            <li key={p.id}>
              {/* 페이지 클릭 → 해당 노트 페이지로 이동 */}
              <Link
                to={`/wiki/spaces/${spaceId}/pages/${p.id}`}
                aria-label={`노트 페이지: ${p.title}`}
                className="flex items-center gap-2 py-2 text-sm hover:text-ai-accent"
              >
                <BookText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{p.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div
          className="flex flex-col items-center gap-2 px-4 py-8 text-center"
          data-testid="wiki-empty"
        >
          <BookText className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-semibold">페이지가 없어요</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            이 스페이스에 표시할 페이지가 없습니다.
          </p>
        </div>
      )}
    </WidgetFrame>
  )
}

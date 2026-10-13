// AI 위임 작업 빈 상태(WP-377) — 필터가 없으면 "맡긴 작업 없음" 안내, 빠른 필터·facet 이 걸려 있으면 조건 문구 + 필터 초기화.
// 조건 쪽은 프로젝트 이슈 목록의 IssueFilterEmptyState 와 같은 4요소(아이콘·제목·설명·액션) — 단 범위(scope)는 남긴다.
import { Bot, SearchX } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'

export function AiTasksEmptyState({ filtered }: { filtered: boolean }) {
  const [, setParams] = useSearchParams()

  // 빠른 필터(state)·facet(status/priority/마감 등)을 모두 지우고 범위만 유지 — 범위는 필터가 아니라 보는 대상이라서.
  function resetFilters() {
    setParams(
      (prev) => {
        const next = new URLSearchParams()
        const scope = prev.get('scope')
        if (scope) next.set('scope', scope)
        return next
      },
      { replace: true },
    )
  }

  if (filtered)
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center" data-testid="ai-row-empty">
        <SearchX className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-sm font-medium">조건에 맞는 AI 작업이 없어요</p>
          <p className="text-xs text-muted-foreground">다른 필터 조건을 사용해 보세요.</p>
        </div>
        <Button variant="outline" size="sm" onClick={resetFilters} data-testid="ai-empty-reset">
          필터 초기화
        </Button>
      </div>
    )

  // 맡긴 작업 자체가 없음 — 아이콘+제목+설명 3요소(DS §2.5).
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center" data-testid="ai-row-empty">
      <Bot className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-semibold">AI에게 맡긴 작업이 아직 없어요</p>
      <p className="max-w-xs text-xs text-muted-foreground">이슈를 만들 때 담당자를 AI로 지정하면 여기에 표시됩니다.</p>
    </div>
  )
}

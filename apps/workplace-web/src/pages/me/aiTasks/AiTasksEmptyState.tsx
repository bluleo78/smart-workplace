// AI 위임 작업 빈 상태(WP-377) — 필터가 없으면 "AI 작업 없음" 안내(AI 구성원 담당 + AI 도구로 하는 내 작업 둘 다), 빠른 필터·facet 이 걸려 있으면 조건 문구 + 필터 초기화.
// 조건 쪽은 공용 ListEmptyState 4요소(아이콘·제목·설명·액션) — 단 범위(scope)는 남긴다.
// 완료 칩만 켠 보기(doneView)는 필터로 좁힌 결과가 아니라 「완료 기록 없음」이라 초기화 없이 안내만 한다(WP-917).
import { Bot, SearchX } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'

import { ListEmptyState } from '@/components/issue/ListEmptyState'

export function AiTasksEmptyState({ filtered, doneView }: { filtered: boolean; doneView: boolean }) {
  const [, setParams] = useSearchParams()

  // 빠른 필터(state)·facet(status/priority, 이 화면이 무시하는 마감 등 잔여 키 포함)을 모두 지우고 범위만 유지 — 범위는 필터가 아니라 보는 대상이라서.
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

  if (doneView)
    return (
      <ListEmptyState
        icon={Bot}
        title="아직 완료된 AI 작업이 없습니다"
        description="AI가 작업을 끝내면 여기에 최근 종료순으로 쌓여요."
        testId="ai-row-empty"
      />
    )

  if (filtered)
    return (
      <ListEmptyState
        icon={SearchX}
        title="조건에 맞는 AI 작업이 없어요"
        description="다른 필터 조건을 사용해 보세요."
        action={{ label: '필터 초기화', onClick: resetFilters, testId: 'ai-empty-reset' }}
        testId="ai-row-empty"
      />
    )

  // AI 작업 자체가 없음 — 아이콘+제목+설명 3요소(DS §2.5).
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center" data-testid="ai-row-empty">
      <Bot className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-semibold">AI가 진행 중인 작업이 없어요</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        담당자를 AI 구성원으로 지정하거나, Claude Code 같은 AI 도구로 내 이슈를 작업하면 여기에 표시돼요.
      </p>
    </div>
  )
}

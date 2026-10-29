// AI 위임 작업 툴바(WP-377) — 범위(나와 관련/전체) + 보기마다 다른 필터 자리 + 오른쪽 끝 보기 전환(WP-1201).
// 모든 선택은 URL(scope·view)에 쓰고 읽는다 — 새로고침·링크 공유에도 같은 화면, 다른 쿼리 키(facet·state·roster)는 보존.
// 빠른 필터 칩은 보기마다 달라(이슈 AI 진행 / AI 상태) 각 보기가 툴바 아래에 ToggleChips 로 둔다.
import { Bot, List } from 'lucide-react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// 보기 전환(WP-1201) — 이슈별(기본, 이 화면의 원래 목록)과 AI별(AI 한 명이 한 줄인 명단).
const VIEWS = [
  { key: 'issues', label: '이슈별', icon: List },
  { key: 'agents', label: 'AI별', icon: Bot },
] as const

const SCOPES = [
  { key: 'mine', label: '나와 관련' },
  { key: 'all', label: '전체' },
] as const

export function AiTasksToolbar({
  view,
  scope,
  filters,
}: {
  view: 'issues' | 'agents'
  scope: 'mine' | 'all'
  /** 범위 옆 필터 — 이슈별은 facet 필터(MeTaskFilterBar), AI별은 없음(이슈 조건이라 AI 명단에는 맞지 않는다). */
  filters?: ReactNode
}) {
  const [params, setParams] = useSearchParams()

  // 한 키만 바꾸고 나머지 쿼리(facet 등)는 보존. 기본값(나와 관련·이슈별)은 키를 지워 URL 을 짧게 둔다.
  const setParam = (key: 'scope' | 'view', value: string | null) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="ai-tasks-toolbar">
      {/* 범위 — 캘린더 뷰 전환과 같은 버튼 그룹(켜짐은 채움 + aria-pressed). */}
      <div className="inline-flex items-center gap-0.5 rounded-md border p-0.5" role="group" aria-label="범위">
        {SCOPES.map((s) => (
          <Button
            key={s.key}
            size="sm"
            variant={scope === s.key ? 'default' : 'ghost'}
            // 시안 높이(그룹 테두리 안 h-7), 꺼진 쪽은 흐린 글자 — 켜진 쪽 채움과 대비되게.
            className={cn('h-7', scope !== s.key && 'text-muted-foreground')}
            aria-pressed={scope === s.key}
            data-testid={`ai-scope-${s.key}`}
            onClick={() => setParam('scope', s.key === 'all' ? 'all' : null)}
          >
            {s.label}
          </Button>
        ))}
      </div>
      {filters}
      {/* 보기 전환(WP-1201) — 프로젝트 이슈 목록의 리스트·보드 전환과 같은 아이콘 토글(오른쪽 끝, 툴팁). 기본(이슈별)은 키를 지운다. */}
      <TooltipProvider>
        <div className="ml-auto flex items-center gap-1" role="group" aria-label="뷰 전환">
          {VIEWS.map((v) => (
            <Tooltip key={v.key}>
              <TooltipTrigger asChild>
                <Button
                  variant={view === v.key ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setParam('view', v.key === 'agents' ? 'agents' : null)}
                  aria-pressed={view === v.key}
                  aria-label={v.label}
                  data-testid={`ai-view-${v.key}`}
                >
                  <v.icon className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{v.label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>
    </div>
  )
}

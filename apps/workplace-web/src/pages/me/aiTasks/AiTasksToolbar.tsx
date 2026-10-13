// AI 위임 작업 툴바(WP-377) — 1줄: 범위(나와 관련/전체) + 기존 facet 필터, 2줄: AI 진행 빠른 필터 칩(건수).
// 모든 선택은 URL(scope·state)에 쓰고 읽는다 — 새로고침·링크 공유에도 같은 화면, 다른 쿼리 키(status/priority)는 보존.
import { useSearchParams } from 'react-router-dom'

import type { AiTaskCounts } from '@/api/aiTasks'
import { Button } from '@/components/ui/button'
import { AGENT_STATE_LABEL } from '@/lib/agentWork'
import { TOGGLE_ON_CLASS } from '@/lib/selectionStyles'
import { cn } from '@/lib/utils'
import { HIDE_SCROLLBAR } from '@/pages/projects/components/mobile/chipStyles'

import { MeTaskFilterBar } from '../MeTaskFilterBar'
import { QUICK_STATES, type QuickState } from './aiTaskParams'

/** 칩 키 — testid·건수 키로 함께 쓴다(counts 응답 필드명과 같다). */
type ChipKey = 'all' | 'waiting' | 'review' | 'blocked' | 'working'

const SCOPES = [
  { key: 'mine', label: '나와 관련' },
  { key: 'all', label: '전체' },
] as const

// 전체 칩 + 상태 칩 — 상태 칩의 키는 counts 필드명(소문자)과 같다.
const CHIPS: { key: ChipKey; label: string; state: QuickState | null }[] = [
  { key: 'all', label: '전체', state: null },
  ...QUICK_STATES.map((s) => ({ key: s.toLowerCase() as ChipKey, label: AGENT_STATE_LABEL[s], state: s })),
]

export function AiTasksToolbar({
  scope,
  state,
  counts,
}: {
  scope: 'mine' | 'all'
  state: QuickState | null
  /** 칩 건수 — 아직 못 받았으면 숫자를 생략한다. */
  counts?: AiTaskCounts
}) {
  const [params, setParams] = useSearchParams()

  // 한 키만 바꾸고 나머지 쿼리(facet 등)는 보존. 기본값(나와 관련·전체 칩)은 키를 지워 URL 을 짧게 둔다.
  const setParam = (key: 'scope' | 'state', value: string | null) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  return (
    <div className="space-y-4">
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
        <MeTaskFilterBar />
      </div>
      {/* 빠른 필터 — 메일 「안 읽은 메일만」과 같은 둥근 토글. 모바일은 줄바꿈 대신 가로 스크롤. */}
      <div
        className={cn('flex items-center gap-2 overflow-x-auto', HIDE_SCROLLBAR)}
        role="group"
        aria-label="AI 진행 빠른 필터"
        data-testid="ai-quick-chips"
      >
        {CHIPS.map((c) => {
          const on = state === c.state
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={on}
              data-testid={`ai-quick-${c.key}`}
              onClick={() => setParam('state', c.state)}
              className={cn(
                // 모바일: 시각 h-9 + after 히트 영역 확장으로 터치 44px 확보(메일 토글과 동일).
                'relative inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40',
                "max-lg:h-9 max-lg:px-4 max-lg:text-sm max-lg:after:absolute max-lg:after:-inset-y-1 max-lg:after:inset-x-0 max-lg:after:content-['']",
                on ? cn(TOGGLE_ON_CLASS, 'font-medium') : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              {c.label}
              {counts && (
                <span
                  className={cn('tabular-nums', on ? 'text-primary' : 'text-muted-foreground')}
                  data-testid={`ai-quick-count-${c.key}`}
                >
                  {counts[c.key]}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

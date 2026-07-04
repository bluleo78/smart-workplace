// AI 우선순위 2x2 위젯 — 중요도·긴급도 임계값(50) 기준 4분면. 분면당 최대 3개, 항목 = 제목 + 근거
// 배지 + 소스 아이콘, 클릭 시 원본 이동. 전 분면 0건이면 SynthesisLayer 빈 상태와 동일 톤.
import { CalendarClock, CheckCircle2, Mail, MessageCircle, MessageSquare } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { PriorityItem } from '@/api/priorityItems'
import { Skeleton } from '@/components/ui/skeleton'
import { usePriorityItems } from '@/hooks/queries/usePriorityItems'

const SOURCE_ICON: Record<string, typeof CalendarClock> = {
  ISSUE_DUE: CalendarClock,
  MENTION: MessageSquare,
  MAIL_NEEDS_REPLY: Mail,
  MESSAGE_ATTENTION: MessageCircle,
}

// 분면별 색 점(dot) — 디자인 시스템은 이모지를 금지하고 Lucide 아이콘/CSS 색 토큰만 허용한다(#280).
// AgendaView.tsx 의 "size-2 rounded-full" 점 패턴을 미러 — 시맨틱 색 토큰 클래스만 사용.
// 배치(2열 그리드 순서 = 좌상단→우상단→좌하단→우하단): 긴급도를 X축(오른쪽 증가), 중요도를 Y축(위
// 증가)으로 보면 우상단이 "긴급+중요" — 통상적인 아이젠하워 매트릭스 배치와 일치.
const QUADRANTS = [
  { key: 'important', label: '중요', dotClassName: 'bg-warning', test: (i: PriorityItem) => i.importanceScore >= 50 && i.urgencyScore < 50 },
  { key: 'urgent-important', label: '긴급 + 중요', dotClassName: 'bg-destructive', test: (i: PriorityItem) => i.importanceScore >= 50 && i.urgencyScore >= 50 },
  { key: 'low', label: '낮음', dotClassName: 'bg-muted-foreground/40', test: (i: PriorityItem) => i.importanceScore < 50 && i.urgencyScore < 50 },
  { key: 'urgent', label: '긴급', dotClassName: 'bg-orange-500', test: (i: PriorityItem) => i.importanceScore < 50 && i.urgencyScore >= 50 },
] as const

const MAX_PER_QUADRANT = 3

/** count prop 은 registry Component 시그니처 통일을 위해 받지만 이 위젯은 무시한다(항목 수 고정). */
export default function PriorityQuadrantBody({
  previewData,
}: {
  count?: number
  previewData?: PriorityItem[]
}) {
  const { data: queryData, isLoading, isError } = usePriorityItems({ enabled: !previewData })
  const items = previewData ?? queryData?.items ?? []

  if (!previewData && isLoading) {
    return (
      <div className="grid grid-cols-2 gap-2" data-testid="priority-quadrant-loading">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    )
  }

  if (!previewData && isError) {
    return (
      <div className="text-sm text-muted-foreground" data-testid="priority-quadrant-error">
        우선순위 정보를 불러오지 못했습니다
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div
        className="flex items-center gap-2 rounded-md border border-border px-3 py-3 text-sm text-muted-foreground"
        data-testid="priority-quadrant-empty"
      >
        <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
        다 확인했습니다
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="priority-quadrant">
      {QUADRANTS.map((q) => {
        const bucket = items
          .filter(q.test)
          .sort((a, b) => b.importanceScore + b.urgencyScore - (a.importanceScore + a.urgencyScore))
        return (
          <div key={q.key} className="rounded-md border border-border p-2" data-testid={`priority-quadrant-${q.key}`}>
            <div className="mb-1 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <span className={`size-2 shrink-0 rounded-full ${q.dotClassName}`} aria-hidden="true" />
              {q.label}
            </div>
            {bucket.length === 0 ? (
              // 분면별 빈 상태 — 위젯 전체 빈 상태(58-67행)와 동일하게 CheckCircle2 아이콘을 붙여
              // "로딩 미완료/오류"가 아닌 "의도된 빈 상태"임을 시각적으로 통일한다(#650).
              <div className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`priority-quadrant-${q.key}-empty`}>
                <CheckCircle2 className="h-3 w-3 shrink-0" />
                항목 없음
              </div>
            ) : (
              <ul className="space-y-1">
                {bucket.slice(0, MAX_PER_QUADRANT).map((item) => {
                  const Icon = SOURCE_ICON[item.sourceType] ?? MessageSquare
                  return (
                    <li key={`${item.sourceType}-${item.sourceId}`}>
                      <Link
                        to={item.deepLink}
                        aria-label={item.title}
                        className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{item.title}</span>
                      </Link>
                      <span className="block truncate pl-5 text-xs text-ai-accent">{item.reason}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

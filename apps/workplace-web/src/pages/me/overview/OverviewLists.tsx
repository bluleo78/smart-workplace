// 개요 탭 목록(WP-1484) — 맡은 이슈(타일 넷 + 고른 타일 상위 3건). 옛 「끝낸 일」 목록은 할당 탭 완료 목록과 같아 뺐다(문구 감사 결정).
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'
import type { Upcoming, UpcomingItem } from '@/types/meOverview'

import { OverviewCard } from './OverviewCard'
import { type TileChoice, upcomingDueLabel, visibleTile } from './overviewModel'

type TileKey = 'overdue' | 'dueSoon' | 'waiting' | 'other'

/**
 * 타일 넷 — 순서·문구·점 색 고정. 마감 지남 destructive, 7일 안 마감 warning, 답변 필요 ai-accent(AI 가 질문함), 마감 여유·없음 muted.
 * 「7일 안 마감」은 홈 위젯의 「마감 임박」(오늘·내일)과 뜻이 겹치지 않게, 「답변 필요」는 앱 기존 배지(INPUT_REQUIRED)와 같은 말로 쓴다.
 */
const TILES: { key: TileKey; label: string; dot: string }[] = [
  { key: 'overdue', label: '마감 지남', dot: 'bg-destructive' },
  { key: 'dueSoon', label: '7일 안 마감', dot: 'bg-warning' },
  { key: 'waiting', label: '답변 필요', dot: 'bg-ai-accent' },
  { key: 'other', label: '마감 여유·없음', dot: 'bg-muted-foreground' },
]

const TOP_OF: Record<TileKey, (u: Upcoming) => UpcomingItem[]> = {
  overdue: (u) => u.overdueTop,
  dueSoon: (u) => u.dueSoonTop,
  waiting: (u) => u.waitingTop,
  other: (u) => u.otherTop,
}

/** 처음 고를 타일 — 급한 순(마감 지남 → 7일 안 마감 → 답변 필요 → 마감 여유·없음)으로 건수가 있는 첫 타일. */
function firstTile(u: Upcoming): TileKey {
  return TILES.find((t) => u[t.key] > 0)?.key ?? 'overdue'
}

/** AI 태그 — 함께한(지금 담당인) AI 이름. AI 마커 토큰(DS 01 §1-5). className 으로 좁은 폭에서 숨기는 등 자리별로 조정한다. */
function AiTags({ names, className }: { names: string[]; className?: string }) {
  if (names.length === 0) return null
  return (
    <span className={cn('flex shrink-0 gap-1', className)}>
      {names.map((n) => (
        <span key={n} className="rounded border border-ai-accent/40 bg-ai-accent-subtle px-1.5 text-xs text-ai-accent">
          {n}
        </span>
      ))}
    </span>
  )
}

/** 맡은 이슈 — 열린 이슈 수, 타일 넷(누르면 아래 상위 3건이 바뀐다), 「할당 탭에서 보기」. 기간과 무관. 개요 화면의 마지막 카드다. */
export function UpcomingCard({ upcoming, today }: { upcoming: Upcoming; today: string }) {
  const [choice, setChoice] = useState<TileChoice<TileKey, Upcoming> | null>(null)
  // 렌더 중에 데이터에서 파생한다 — 처음 값만 state 로 고정하면 데이터가 바뀌어도 빈 타일에 머문다.
  const tile = visibleTile(choice, upcoming, (k) => upcoming[k], firstTile(upcoming))
  const items = TOP_OF[tile](upcoming)
  const nothing = upcoming.openAssigned === 0 && upcoming.waiting === 0
  return (
    <OverviewCard testId="overview-upcoming" className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="flex items-baseline gap-2 text-sm font-semibold">
          맡은 이슈 <span className="text-xs font-normal text-muted-foreground">열린 이슈 {upcoming.openAssigned}건</span>
        </h2>
        <Link to="/me/tasks/assigned" className="text-xs font-medium text-primary hover:underline">
          할당 탭에서 보기
        </Link>
      </div>
      {nothing ? (
        <p className="py-6 text-center text-sm text-muted-foreground" data-testid="overview-upcoming-empty">
          지금 맡은 열린 이슈가 없어요
        </p>
      ) : (
        <>
          <div role="group" aria-label="맡은 이슈 분류" className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {TILES.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={tile === t.key}
                onClick={() => setChoice({ key: t.key, source: upcoming })}
                data-testid={`upcoming-tile-${t.key}`}
                className={cn(
                  'rounded-md border px-3 py-2 text-left',
                  tile === t.key ? 'border-primary ring-1 ring-primary' : 'border-border hover:bg-muted/50',
                )}
              >
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={cn('h-2 w-2 rounded-full', t.dot)} /> {t.label}
                </span>
                <span className="block text-lg font-semibold tabular-nums">{upcoming[t.key]}</span>
              </button>
            ))}
          </div>
          {items.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">해당하는 이슈가 없어요</p>
          ) : (
            <ul className="divide-y divide-border" data-testid="overview-upcoming-list">
              {items.map((i) => {
                const due = upcomingDueLabel(i, today)
                return (
                  <li key={i.issueId}>
                    <Link
                      to={`/projects/${i.projectKey}/issues/${i.number}`}
                      className="flex items-center gap-3 rounded px-1 py-2 text-sm hover:bg-muted/50"
                    >
                      {/* 좁은 폭(모바일)에선 제목이 우선 — 키 칸을 줄이고 AI 태그를 숨긴다(390px 에서 제목이 「모바일 …」로 잘렸다). */}
                      <span className="w-14 shrink-0 text-xs text-muted-foreground sm:w-20">
                        {i.projectKey}-{i.number}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{i.title}</span>
                      <AiTags names={i.aiNames} className="hidden sm:flex" />
                      <span className={cn('w-16 shrink-0 text-right text-xs', due.overdue ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                        {due.label}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </OverviewCard>
  )
}

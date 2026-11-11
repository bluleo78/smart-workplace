// 개요 탭 목록(WP-1484) — 앞으로 할 일(타일 넷 + 고른 타일 상위 3건)과 끝낸 일(날짜별 묶음, 펼치면 요청 내용·마지막 코멘트).
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'
import type { ClosedItem, MeOverviewResponse, Upcoming, UpcomingItem } from '@/types/meOverview'

import { OverviewCard } from './OverviewCard'
import {
  type BadgeTone,
  type ClosedDayGroup,
  closedListHref,
  completedInRange,
  dayLabel,
  dueBadge,
  formatDays,
  groupClosedByDate,
  groupsInRange,
  upcomingDueLabel,
} from './overviewModel'

type TileKey = 'overdue' | 'dueSoon' | 'waiting' | 'other'

/** 타일 넷 — 순서·문구·점 색 고정. 기한 지남 destructive, 마감 임박 warning, 나를 기다림 ai-accent(AI 답변 필요), 그 밖 muted. */
const TILES: { key: TileKey; label: string; dot: string }[] = [
  { key: 'overdue', label: '기한 지남', dot: 'bg-destructive' },
  { key: 'dueSoon', label: '마감 임박 · 7일', dot: 'bg-warning' },
  { key: 'waiting', label: '나를 기다림', dot: 'bg-ai-accent' },
  { key: 'other', label: '그 밖', dot: 'bg-muted-foreground' },
]

const TOP_OF: Record<TileKey, (u: Upcoming) => UpcomingItem[]> = {
  overdue: (u) => u.overdueTop,
  dueSoon: (u) => u.dueSoonTop,
  waiting: (u) => u.waitingTop,
  other: (u) => u.otherTop,
}

/** 처음 고를 타일 — 급한 순(기한 지남 → 마감 임박 → 나를 기다림 → 그 밖)으로 건수가 있는 첫 타일. */
function firstTile(u: Upcoming): TileKey {
  return TILES.find((t) => u[t.key] > 0)?.key ?? 'overdue'
}

/** 사용자가 누른 타일과 그때의 데이터 — 데이터가 바뀌었는지 참조로 알아 본다(쿼리 structural sharing 이라 안 바뀌면 같은 참조). */
type TileChoice = { key: TileKey; source: Upcoming }

/**
 * 보일 타일 — 고른 적 없으면 건수 있는 첫 타일. 고른 타일은 그 데이터 그대로면(빈 타일을 눌러 「없어요」를 보는 중이어도) 유지하고,
 * 데이터가 바뀌어 그 타일이 0건이 되면 건수 있는 첫 타일로 돌아간다(다른 탭에서 이슈를 닫아 묶음이 비었을 때 빈 칸에 멈추지 않게).
 */
function visibleTile(choice: TileChoice | null, u: Upcoming): TileKey {
  if (choice && (choice.source === u || u[choice.key] > 0)) return choice.key
  return firstTile(u)
}

/** AI 태그 — 함께한(지금 담당인) AI 이름. AI 마커 토큰(DS 01 §1-5). */
function AiTags({ names }: { names: string[] }) {
  if (names.length === 0) return null
  return (
    <span className="flex shrink-0 gap-1">
      {names.map((n) => (
        <span key={n} className="rounded border border-ai-accent/40 bg-ai-accent-subtle px-1.5 text-xs text-ai-accent">
          {n}
        </span>
      ))}
    </span>
  )
}

/** 앞으로 할 일 — 맡은 열린 이슈 수, 타일 넷(누르면 아래 상위 3건이 바뀐다), 「할당 탭에서 모두 보기」. 기간과 무관. */
export function UpcomingCard({ upcoming, today }: { upcoming: Upcoming; today: string }) {
  const [choice, setChoice] = useState<TileChoice | null>(null)
  // 렌더 중에 데이터에서 파생한다 — 처음 값만 state 로 고정하면 데이터가 바뀌어도 빈 타일에 머문다.
  const tile = visibleTile(choice, upcoming)
  const items = TOP_OF[tile](upcoming)
  const nothing = upcoming.openAssigned === 0 && upcoming.waiting === 0
  return (
    <OverviewCard testId="overview-upcoming" className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="flex items-baseline gap-2 text-sm font-semibold">
          앞으로 할 일 <span className="text-xs font-normal text-muted-foreground">맡은 열린 이슈 {upcoming.openAssigned}</span>
        </h2>
        <Link to="/me/tasks/assigned" className="text-xs font-medium text-primary hover:underline">
          할당 탭에서 모두 보기
        </Link>
      </div>
      {nothing ? (
        <p className="py-6 text-center text-sm text-muted-foreground" data-testid="overview-upcoming-empty">
          맡은 열린 이슈가 없어요
        </p>
      ) : (
        <>
          <div role="group" aria-label="앞으로 할 일 묶음" className="grid grid-cols-2 gap-2 md:grid-cols-4">
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
            <p className="py-3 text-center text-xs text-muted-foreground">이 묶음에 든 이슈가 없어요</p>
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
                      <span className="w-20 shrink-0 text-xs text-muted-foreground">
                        {i.projectKey}-{i.number}
                      </span>
                      <span className="flex-1 truncate">{i.title}</span>
                      <AiTags names={i.aiNames} />
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

const TONE_CLASS: Record<BadgeTone, string> = {
  success: 'bg-success-subtle text-success-text',
  warning: 'bg-warning-subtle text-warning-text',
  muted: 'border border-border text-muted-foreground',
}

/**
 * 끝낸 일 — 최근 끝낸 순, 날짜별 묶음(날짜 줄에 그날 끝냄·만듦). 줄을 펼치면 요청 내용과 마지막 코멘트.
 * 추이 막대로 칸을 고르면 그 칸 묶음만 보이고, 「모두 보기」는 기간 조건이 걸린 할당 탭 완료 목록으로 간다.
 */
export function ClosedListCard({
  data,
  label,
  picked,
  onClearPick,
}: {
  data: MeOverviewResponse
  label: string
  picked: { start: string; end: string } | null
  onClearPick: () => void
}) {
  const all = groupClosedByDate(data.closed, data.dailyTotals)
  const groups = groupsInRange(all, picked)
  // 서버는 최근 끝낸 50건만 싣는다 — 잘렸으면 전체 수와 함께 「모두 보기」로 안내한다.
  const truncated = data.closedTotal > data.closed.length
  const allHref = closedListHref(data.from, data.to)
  // 고른 칸에 보이는 줄은 없지만 일별 칸엔 끝낸 일이 있다 = 목록(최근 50건) 밖이라 안 보이는 것.
  const pickedBeyondList = picked != null && groups.length === 0 && truncated && completedInRange(data.dailyTotals, picked) > 0
  return (
    <OverviewCard testId="overview-closed" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-baseline gap-2 text-sm font-semibold">
          끝낸 일 <span className="text-xs font-normal text-muted-foreground">{label} {data.closedTotal}건 · 최근 끝낸 순</span>
        </h2>
        <Link to={allHref} className="text-xs font-medium text-primary hover:underline" data-testid="overview-closed-all">
          {truncated ? `모두 보기 (${data.closedTotal}건)` : '모두 보기'}
        </Link>
      </div>
      {picked && (
        <button
          type="button"
          onClick={onClearPick}
          className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs hover:bg-muted/50"
          data-testid="overview-closed-picked"
        >
          {picked.start === picked.end ? dayLabel(picked.start) : `${dayLabel(picked.start)} ~ ${dayLabel(picked.end)}`}만 보는 중
          <X className="h-3 w-3" aria-hidden />
          <span className="sr-only">전체 보기</span>
        </button>
      )}
      {pickedBeyondList ? (
        <p className="py-6 text-center text-sm text-muted-foreground" data-testid="overview-closed-beyond">
          이 칸에 끝낸 이슈는 최근 {data.closed.length}건 밖이에요 ·{' '}
          <Link to={allHref} className="font-medium text-primary hover:underline">
            모두 보기
          </Link>
        </p>
      ) : groups.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground" data-testid="overview-closed-empty">
          {picked ? '이 칸에 끝낸 이슈가 없어요' : '이 기간에 끝낸 이슈가 없어요'}
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <DayGroup key={g.date} group={g} />
          ))}
        </div>
      )}
      {truncated && groups.length > 0 && (
        <p className="pt-1 text-center text-xs text-muted-foreground" data-testid="overview-closed-truncated">
          최근 {data.closed.length}건만 보여요 ·{' '}
          <Link to={allHref} className="font-medium text-primary hover:underline">
            모두 보기 ({data.closedTotal}건)
          </Link>
        </p>
      )}
    </OverviewCard>
  )
}

/** 날짜 묶음 — 「11월 10일 (월) · 끝냄 5 · 만듦 2」 + 그날 줄들. */
function DayGroup({ group }: { group: ClosedDayGroup }) {
  return (
    <div data-testid={`closed-day-${group.date}`}>
      <p className="px-1 pb-1 text-xs text-muted-foreground">
        {dayLabel(group.date)} · 끝냄 {group.completed} · 만듦 {group.created}
      </p>
      <ul className="divide-y divide-border">
        {group.items.map((i) => (
          <ClosedRow key={i.issueId} item={i} />
        ))}
      </ul>
    </div>
  )
}

/** 끝낸 일 한 줄 — 키·제목·AI 태그·마감 배지·소요일. 펼치기 단추를 누르면 요청 내용·마지막 코멘트. */
function ClosedRow({ item }: { item: ClosedItem }) {
  const [open, setOpen] = useState(false)
  const badge = dueBadge(item)
  const hasDetail = item.request != null || item.lastComment != null
  return (
    <li data-testid={`closed-row-${item.issueId}`}>
      <div className="flex items-center gap-2 px-1 py-2 text-sm">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={!hasDetail}
          aria-expanded={open}
          aria-label={`${item.projectKey}-${item.number} 요청 내용 ${open ? '접기' : '펼치기'}`}
          className="shrink-0 rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <Link to={`/projects/${item.projectKey}/issues/${item.number}`} className="flex min-w-0 flex-1 items-center gap-3 hover:underline">
          <span className="w-20 shrink-0 text-xs text-muted-foreground">
            {item.projectKey}-{item.number}
          </span>
          <span className="truncate">{item.title}</span>
        </Link>
        <AiTags names={item.aiNames} />
        <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-xs', TONE_CLASS[badge.tone])}>{badge.label}</span>
        <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{formatDays(item.leadTimeDays)}</span>
      </div>
      {open && hasDetail && (
        <div className="mb-2 ml-7 space-y-1 rounded-md bg-muted/50 px-3 py-2 text-xs" data-testid={`closed-detail-${item.issueId}`}>
          {item.request && (
            <p>
              <span className="mr-2 text-muted-foreground">요청</span>
              {item.request}
            </p>
          )}
          {item.lastComment && (
            <p>
              <span className="mr-2 text-muted-foreground">마지막 코멘트</span>
              {item.lastComment.authorName} — {item.lastComment.text}
            </p>
          )}
        </div>
      )}
    </li>
  )
}

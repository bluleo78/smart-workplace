// 프로젝트 개요(WP-1478) 「살펴볼 이슈」 — 기한 지남·오래 멈춤·기다리는 중 타일 셋, 고른 타일의 상위 5건, 「n건 더 — 이슈 탭에서 보기」.
// 정의(서버, 이슈 탭 필터와 같은 조건 함수):
// - 기한 지남: 열린 이슈 중 마감이 오늘보다 전
// - 오래 멈춤: 진행 중인데 7일 동안 상태 변경·댓글이 없음
// - 기다리는 중: AI 가 답을 기다리거나(INPUT_REQUIRED) 닫히지 않은 선행 이슈에 막힘
// 세 묶음 상위 5건이 한 응답에 함께 와 타일을 바꿔도 다시 부르지 않는다.
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { issuePath } from '@/lib/appUrl'
import { cn } from '@/lib/utils'
import type { ProjectOverviewAttention } from '@/types/projectOverview'

import { OverviewCard } from '../../me/overview/OverviewCard'
import { type TileChoice, visibleTile } from '../../me/overview/overviewModel'
import { attentionDaysLabel, attentionHref, type AttentionKey, firstAttentionTile } from './overviewModel'
import { OverviewAvatar, OverviewIssueLink, WidgetEmpty, WidgetHeader } from './OverviewParts'

/** 타일 셋 — 순서·문구·점 색 고정. 기한 지남 destructive, 오래 멈춤 warning, 기다리는 중 muted. 일수 글 색도 같은 계열. */
const TILES: { key: AttentionKey; label: string; dot: string; daysClass: string }[] = [
  { key: 'overdue', label: '기한 지남', dot: 'bg-destructive', daysClass: 'text-destructive' },
  { key: 'stale', label: '오래 멈춤', dot: 'bg-warning', daysClass: 'text-warning-text' },
  { key: 'waiting', label: '기다리는 중', dot: 'bg-muted-foreground', daysClass: 'text-muted-foreground' },
]

export function OverviewAttention({
  className,
  projectKey,
  today,
  attention,
}: {
  className?: string
  projectKey: string
  today: string
  attention: ProjectOverviewAttention
}) {
  // 고른 타일 — 내 작업 개요 「맡은 이슈」와 같은 규칙(visibleTile): 데이터가 바뀌어 고른 묶음이 0건이 되면 건수 있는 첫 묶음으로.
  const [choice, setChoice] = useState<TileChoice<AttentionKey, ProjectOverviewAttention> | null>(null)
  const tile = visibleTile(choice, attention, (k) => attention[k].total, firstAttentionTile(attention))
  const def = TILES.find((t) => t.key === tile)!
  const group = attention[tile]
  const more = group.total - group.items.length
  return (
    <OverviewCard className={cn('flex flex-col gap-3', className)} testId="project-overview-attention">
      <WidgetHeader title="살펴볼 이슈" aside={attention.total} />
      {attention.total === 0 ? (
        <WidgetEmpty testId="attention-empty">살펴볼 이슈가 없어요</WidgetEmpty>
      ) : (
        <>
          <div role="group" aria-label="살펴볼 이슈 분류" className="grid grid-cols-3 gap-2">
            {TILES.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={tile === t.key}
                onClick={() => setChoice({ key: t.key, source: attention })}
                data-testid={`attention-tile-${t.key}`}
                className={cn(
                  'rounded-md border px-3 py-2 text-left',
                  tile === t.key ? 'border-primary ring-1 ring-primary' : 'border-border hover:bg-muted/50',
                )}
              >
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', t.dot)} /> <span className="truncate">{t.label}</span>
                </span>
                <span className="block text-lg font-semibold tabular-nums">{attention[t.key].total}</span>
              </button>
            ))}
          </div>
          {group.items.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">해당하는 이슈가 없어요</p>
          ) : (
            <ul className="divide-y divide-border" data-testid="attention-list">
              {group.items.map((i) => (
                <li key={i.issueKey}>
                  <Link to={issuePath(projectKey, i.number)} className="flex items-center gap-3 rounded px-1 py-2 text-sm hover:bg-muted/50">
                    <span className="w-16 shrink-0 text-xs text-muted-foreground sm:w-20">{i.issueKey}</span>
                    <span className="min-w-0 flex-1 truncate">{i.title}</span>
                    <span className={cn('shrink-0 text-xs font-medium', def.daysClass)}>{attentionDaysLabel(tile, i.days)}</span>
                    {/* 담당자 — 둘까지 겹쳐 보인다(AI 는 AI 표식). 없으면 자리만 둬 일수 글이 줄마다 같은 x 에 선다. */}
                    <span className="hidden w-10 shrink-0 justify-end -space-x-1 sm:flex">
                      {i.assignees.slice(0, 2).map((a) => (
                        <OverviewAvatar key={a.id} user={a} ring />
                      ))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {more > 0 && (
            <OverviewIssueLink
              to={attentionHref(projectKey, tile, today)}
              className="self-start text-xs font-medium text-primary hover:underline"
              data-testid="attention-more"
            >
              {more}건 더 — 이슈 탭에서 보기
            </OverviewIssueLink>
          )}
        </>
      )}
    </OverviewCard>
  )
}

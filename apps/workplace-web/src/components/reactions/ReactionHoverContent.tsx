// 반응 칩 호버 카드 내용(WP-106) — 큰 이모지 + "나, 이영희 외 N명이 반응했습니다" + 모두 보기.
// 카드가 열렸을 때만 마운트되므로 여기서 반응자 쿼리를 부른다(칩마다 관찰자 없음). 첫 페이지만 쓴다.
// WP-504: 대상 id·반응자 소스를 주입받아 채팅 메시지·이슈 코멘트가 함께 쓴다(testid 는 대상 id 기준 그대로).
import type { ReactionResponse, ReactorSource } from '@/components/reactions/types'
import { Skeleton } from '@/components/ui/skeleton'
import { useReactors } from '@/hooks/queries/useReactors'
import { formatReactorSummary, othersOf } from '@/lib/reactorSummary'

export function ReactionHoverContent({
  targetId,
  reaction,
  source,
  currentUserId,
  onShowAll,
}: {
  targetId: number
  reaction: ReactionResponse
  source: ReactorSource
  currentUserId: number
  onShowAll: () => void
}) {
  const q = useReactors(source, reaction.emoji)
  const first = q.data?.pages[0]?.items
  return (
    <div data-testid={`reaction-hover-${targetId}`}>
      <div className="text-3xl leading-none">{reaction.emoji}</div>
      {first ? (
        <p className="mt-2 break-keep text-sm leading-snug" data-testid={`reaction-hover-summary-${targetId}`}>
          {formatReactorSummary({
            count: reaction.count,
            reacted: reaction.reacted,
            names: othersOf(first, currentUserId).map((r) => r.name),
          })}
        </p>
      ) : q.isError ? (
        // 조회 실패(4xx 는 재시도하지 않음) — 스켈레톤이 계속 돌지 않게 한 줄로 알린다. 모두 보기는 그대로 둔다.
        <p className="mt-2 text-xs text-muted-foreground" data-testid={`reaction-hover-error-${targetId}`}>
          불러오지 못했습니다
        </p>
      ) : (
        // 불러오는 중 — 자리만 잡아 카드 크기가 튀지 않게.
        <div className="mt-2 space-y-1.5" aria-label="반응한 사람 불러오는 중">
          <Skeleton className="h-2.5 w-4/5" />
          <Skeleton className="h-2.5 w-1/2" />
        </div>
      )}
      <button
        type="button"
        className="mt-2 text-xs font-semibold text-primary hover:underline"
        data-testid={`reaction-hover-all-${targetId}`}
        onClick={onShowAll}
      >
        모두 보기
      </button>
    </div>
  )
}

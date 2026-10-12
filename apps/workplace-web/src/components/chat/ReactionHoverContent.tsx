// 반응 칩 호버 카드 내용(WP-106) — 큰 이모지 + "나, 이영희 외 N명이 반응했습니다" + 모두 보기.
// 카드가 열렸을 때만 마운트되므로 여기서 반응자 쿼리를 부른다(칩마다 관찰자 없음). 첫 페이지만 쓴다.
import { useReactors } from '@/hooks/queries/useReactors'
import { formatReactorSummary, othersOf } from '@/lib/reactorSummary'
import type { ReactionResponse } from '@/types/messaging'

export function ReactionHoverContent({
  messageId,
  reaction,
  currentUserId,
  onShowAll,
}: {
  messageId: number
  reaction: ReactionResponse
  currentUserId: number
  onShowAll: () => void
}) {
  const q = useReactors(messageId, reaction.emoji)
  const first = q.data?.pages[0]?.items
  return (
    <div data-testid={`reaction-hover-${messageId}`}>
      <div className="text-3xl leading-none">{reaction.emoji}</div>
      {first ? (
        <p className="mt-2 text-sm leading-snug" data-testid={`reaction-hover-summary-${messageId}`}>
          {formatReactorSummary({
            count: reaction.count,
            reacted: reaction.reacted,
            names: othersOf(first, currentUserId).map((r) => r.name),
          })}
        </p>
      ) : (
        // 불러오는 중(또는 실패) — 자리만 잡아 카드 크기가 튀지 않게.
        <div className="mt-2 space-y-1.5" aria-label="반응한 사람 불러오는 중">
          <div className="h-2.5 w-4/5 rounded bg-muted" />
          <div className="h-2.5 w-1/2 rounded bg-muted" />
        </div>
      )}
      <button
        type="button"
        className="mt-2 text-xs font-semibold text-primary hover:underline"
        data-testid={`reaction-hover-all-${messageId}`}
        onClick={onShowAll}
      >
        모두 보기
      </button>
    </div>
  )
}

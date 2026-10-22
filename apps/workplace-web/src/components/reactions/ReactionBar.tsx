// 반응 대상(채팅 메시지·이슈 코멘트) 하단 리액션 pill 목록. pill 클릭 = 토글. reacted 면 강조 스타일.
// WP-504: 채팅 전용이던 것을 대상(ReactionTarget)·반응자 소스(ReactorSource) 주입형으로 공용화했다.
// WP-106: 데스크톱은 pill 에 마우스를 올리면 반응자 호버 카드(요약 + 모두 보기)를 띄운다. 터치 셸은 호버 카드를 쓰지 않고
// 목록의 길게 누르기 위임(useMessageListLongPress)이 data-reaction-emoji 로 칩을 알아보고 반응자 시트를 연다.
import type { ComponentProps, ReactElement, ReactNode } from 'react'
import { useState } from 'react'

import { ReactionHoverContent } from '@/components/reactions/ReactionHoverContent'
import type { ReactionResponse, ReactionTarget, ReactorSource } from '@/components/reactions/types'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'

/** 호버 카드 열림 지연 — 칩 위를 스쳐 지나갈 때마다 요청하지 않게. */
const HOVER_OPEN_DELAY_MS = 300
/** 닫힘 지연 — 칩에서 카드로 마우스를 옮기는 동안 유지(모두 보기 클릭 가능). */
const HOVER_CLOSE_DELAY_MS = 150

interface ReactionBarProps {
  // 반응이 달린 대상(메시지·코멘트) — id 는 testid·호버 판정에, reactions 는 칩 목록에 쓴다.
  target: ReactionTarget
  // 호버 카드가 반응자를 가져올 곳.
  source: ReactorSource
  onToggle: (emoji: string) => void
  // 칩 정렬 방향. 본인 메시지(우측 말풍선) 아래에서는 'end' 로 말풍선과 같은 쪽에 붙인다.
  align?: 'start' | 'end'
  currentUserId: number
  // 반응자 전체 보기 열기(호버 카드의 모두 보기). 미전달이면 호버 카드를 붙이지 않는다(미전송 메시지·터치 셸 등).
  onOpenReactors?: (emoji: string) => void
  // 읽기 전용(보관된 채널, WP-508) — 칩은 개수만 보여 주고 눌러도 토글하지 않는다.
  readOnly?: boolean
  // testid 앞에 붙는 접두사 — 같은 화면에 다른 종류 대상(코멘트 등)이 섞여도 testid 가 겹치지 않게. 채팅은 생략(빈 문자열).
  testIdPrefix?: string
  // 칩 줄 끝에 붙는 요소(예: 반응 추가 버튼). 반응이 0개여도 이것만은 렌더한다.
  trailing?: ReactNode
}

export function ReactionBar({
  target,
  source,
  onToggle,
  align = 'start',
  currentUserId,
  onOpenReactors,
  readOnly,
  testIdPrefix = '',
  trailing,
}: ReactionBarProps) {
  // 반응도 덧붙일 요소도 없으면 아무것도 그리지 않는다(채팅은 trailing 없음 → 기존처럼 null).
  if (target.reactions.length === 0 && !trailing) return null
  // 음수 id = 낙관적 미확정 대상 — 반응자 조회가 실패하므로 호버 카드를 붙이지 않는다.
  const hover = !!onOpenReactors && target.id >= 0
  return (
    <div
      className={`mt-1 flex flex-wrap gap-1 ${align === 'end' ? 'justify-end' : ''}`}
      data-testid={`${testIdPrefix}reaction-bar-${target.id}`}
    >
      {target.reactions.map((r) => {
        const pill = (
          <ReactionPill
            key={r.emoji}
            targetId={target.id}
            testIdPrefix={testIdPrefix}
            reaction={r}
            onToggle={onToggle}
            disabled={readOnly}
          />
        )
        return hover ? (
          <ReactionHoverPill
            key={r.emoji}
            targetId={target.id}
            source={source}
            reaction={r}
            currentUserId={currentUserId}
            onShowAll={() => onOpenReactors(r.emoji)}
          >
            {pill}
          </ReactionHoverPill>
        ) : (
          pill
        )
      })}
      {trailing}
    </div>
  )
}

// onToggle 은 버튼 고유 toggle 이벤트 prop 과 이름이 겹쳐 rest 타입에서 제외한다.
/** 반응 칩 버튼 — 클릭 = 토글. data-reaction-emoji 는 길게 누르기 위임이 칩을 알아보는 표식. */
function ReactionPill({
  targetId,
  testIdPrefix,
  reaction: r,
  onToggle,
  ...rest
}: {
  targetId: number
  testIdPrefix: string
  reaction: ReactionResponse
  onToggle: (emoji: string) => void
} & Omit<ComponentProps<'button'>, 'onToggle'>) {
  return (
    <button
      type="button"
      {...rest}
      onClick={() => onToggle(r.emoji)}
      data-testid={`${testIdPrefix}reaction-pill-${targetId}-${r.emoji}`}
      data-reaction-emoji={r.emoji}
      // 반응 컨트롤 표식 — 취소로 칩이 사라지면 행이 같은 자리의 칩·반응 추가로 포커스를 잇는다(useReactionFocusRestore, WP-830).
      data-reaction-control="pill"
      aria-pressed={r.reacted}
      // 터치(coarse)에선 손가락으로 누르기 쉽게 높이 32px·좌우 여백을 키운다(L1). 마우스 환경은 그대로.
      className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs pointer-coarse:min-h-8 pointer-coarse:px-2.5 disabled:cursor-default ${
        r.reacted ? 'border-primary bg-primary/10 text-primary' : 'border-muted bg-muted/50'
      }`}
    >
      <span>{r.emoji}</span>
      <span data-testid={`${testIdPrefix}reaction-count-${targetId}-${r.emoji}`}>{r.count}</span>
    </button>
  )
}

/** 칩 하나를 호버 카드 트리거로 감싼다. 모두 보기를 누르면 카드를 닫고 전체 보기를 연다. */
function ReactionHoverPill({
  targetId,
  source,
  reaction,
  currentUserId,
  onShowAll,
  children,
}: {
  targetId: number
  source: ReactorSource
  reaction: ReactionResponse
  currentUserId: number
  onShowAll: () => void
  children: ReactElement
}) {
  const [open, setOpen] = useState(false)
  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={HOVER_OPEN_DELAY_MS} closeDelay={HOVER_CLOSE_DELAY_MS}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      {/* 칩 아래로 연다 — 위로 열면 작성자·본문 줄을 가린다. 화면 아래가 모자라면 Radix 충돌 처리가 위로 뒤집는다. */}
      <HoverCardContent side="bottom" align="start" className="w-60">
        <ReactionHoverContent
          targetId={targetId}
          reaction={reaction}
          source={source}
          currentUserId={currentUserId}
          onShowAll={() => {
            setOpen(false)
            onShowAll()
          }}
        />
      </HoverCardContent>
    </HoverCard>
  )
}

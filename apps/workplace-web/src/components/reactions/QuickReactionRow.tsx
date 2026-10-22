// 터치 시트용 반응 이모지 줄 — 빠른 6종(44px 원형) + ＋(이모지 더 보기)로 채팅 피커와 같은 40종 그리드를 같은 자리에서 펼친다.
// 채팅 메시지 작업 시트(MessageActionSheet)에 있던 마크업을 꺼냈다(WP-504) — 이슈 코멘트 반응 시트도 같은 모양·크기를 쓴다.
// 펼침 상태는 이 줄이 갖는다 — 시트(SheetContent)는 닫히면 언마운트되므로 다시 열면 늘 빠른 6종부터 보인다.
import { Plus } from 'lucide-react'
import { useState } from 'react'

import { PICKER_EMOJIS, QUICK_EMOJIS } from '@/components/reactions/emojiSets'
import { cn } from '@/lib/utils'

export function QuickReactionRow({
  onPick,
  quickTestId,
  pickTestId = quickTestId,
  moreTestId,
  className,
}: {
  onPick: (emoji: string) => void
  /** 빠른 6종 버튼 testid. */
  quickTestId: (emoji: string) => string
  /** 40종 그리드 버튼 testid — 생략하면 빠른 6종과 같은 규칙(채팅). */
  pickTestId?: (emoji: string) => string
  /** 더 보기(＋) 버튼 testid. */
  moreTestId: string
  /** 바깥 줄 추가 클래스 — 아래 구분선(border-b) 등은 호출처가 정한다(채팅 작업 시트는 작업 행과 나누고, 코멘트 반응 시트는 바닥이라 없음). */
  className?: string
}) {
  const [allEmojis, setAllEmojis] = useState(false)
  const emojiButton = (e: string, testId: string) => (
    <button
      key={e}
      type="button"
      data-testid={testId}
      aria-label={`${e} 반응`}
      onClick={() => onPick(e)}
      className="flex size-11 items-center justify-center rounded-full text-2xl active:bg-accent"
    >
      {e}
    </button>
  )
  return (
    <div className={cn('px-3 py-2', className)}>
      <div className="flex items-center justify-between">
        {QUICK_EMOJIS.map((e) => emojiButton(e, quickTestId(e)))}
        <button
          type="button"
          data-testid={moreTestId}
          aria-label="이모지 더 보기"
          aria-expanded={allEmojis}
          onClick={() => setAllEmojis((v) => !v)}
          className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground active:bg-accent"
        >
          <Plus className="size-5" />
        </button>
      </div>
      {allEmojis && (
        <div className="mt-1 grid max-h-48 grid-cols-7 justify-items-center overflow-y-auto">
          {PICKER_EMOJIS.map((e) => emojiButton(e, pickTestId(e)))}
        </div>
      )}
    </div>
  )
}

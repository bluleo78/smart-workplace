// 이모지 선택 팝오버. 퀵셋 6종 즉시 노출 + 큐레이션 그리드(약 40종). 무거운 의존성 없이 정적 목록.
import { SmilePlus } from 'lucide-react'
import { useState } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover'
import { emojiReactionLabel, PICKER_EMOJIS, QUICK_EMOJIS } from '@/components/reactions/emojiSets'
import { Button } from '@/components/ui/button'

interface EmojiPickerProps {
  onPick: (emoji: string) => void
  testIdPrefix: string // 예: `message-${id}`
}

export function EmojiPicker({ onPick, testIdPrefix }: EmojiPickerProps) {
  const [open, setOpen] = useState(false)
  const pick = (e: string) => {
    onPick(e)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          aria-label="이모지 추가"
          data-testid={`${testIdPrefix}-react`}
          // 반응 컨트롤 표식 — 칩이 모두 사라지면 포커스가 여기로 온다(useReactionFocusRestore, WP-830).
          data-reaction-control="add"
        >
          <SmilePlus className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      {/* 팝오버(role=dialog)·두 줄에 이름을 붙이고 이모지 버튼마다 한국어 이름을 단다 — 스크린리더가 이름 없는 대화상자·
          영어 이모지 이름·「버튼」만 읽지 않게(WP-1551). */}
      <PopoverContent className="w-auto p-2" aria-label="이모지 선택" data-testid={`${testIdPrefix}-emoji-popover`}>
        <div role="group" aria-label="자주 쓰는 반응" className="mb-2 flex gap-1 border-b pb-2">
          {QUICK_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              className="rounded p-1 text-lg hover:bg-muted"
              aria-label={emojiReactionLabel(e)}
              data-testid={`${testIdPrefix}-quick-${e}`}
              onClick={() => pick(e)}
            >
              {e}
            </button>
          ))}
        </div>
        <div role="group" aria-label="모든 이모지" className="grid max-h-40 grid-cols-8 gap-1 overflow-y-auto">
          {PICKER_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              className="rounded p-1 text-lg hover:bg-muted"
              aria-label={emojiReactionLabel(e)}
              data-testid={`${testIdPrefix}-pick-${e}`}
              onClick={() => pick(e)}
            >
              {e}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// 이모지 선택 팝오버. 퀵셋 6종 즉시 노출 + 큐레이션 그리드(약 40종). 무거운 의존성 없이 정적 목록.
import { SmilePlus } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

// 호버 퀵셋(자주 쓰는 6종).
export const QUICK_EMOJIS = ['👍', '❤️', '😄', '🎉', '😢', '🙏'] as const

// 전체 피커 큐레이션 목록(퀵셋 포함).
const PICKER_EMOJIS = [
  '👍', '👎', '❤️', '🔥', '🎉', '😄', '😅', '😂', '🙂', '😍',
  '🤔', '😮', '😢', '😡', '🙏', '👏', '🙌', '💪', '✅', '❌',
  '👀', '🚀', '💯', '✨', '⭐', '💡', '📌', '⚡', '🐛', '🛠️',
  '☕', '🍕', '🎈', '🥳', '😴', '🤯', '😎', '🤝', '👋', '💩',
]

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
        >
          <SmilePlus className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" data-testid={`${testIdPrefix}-emoji-popover`}>
        <div className="mb-2 flex gap-1 border-b pb-2">
          {QUICK_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              className="rounded p-1 text-lg hover:bg-muted"
              data-testid={`${testIdPrefix}-quick-${e}`}
              onClick={() => pick(e)}
            >
              {e}
            </button>
          ))}
        </div>
        <div className="grid max-h-40 grid-cols-8 gap-1 overflow-y-auto">
          {PICKER_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              className="rounded p-1 text-lg hover:bg-muted"
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

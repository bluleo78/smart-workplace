// 메시지 하단 리액션 pill 목록. pill 클릭 = 토글. reacted 면 강조 스타일.
import type { MessageResponse } from '@/types/messaging'

interface ReactionBarProps {
  message: MessageResponse
  onToggle: (emoji: string) => void
}

export function ReactionBar({ message, onToggle }: ReactionBarProps) {
  if (message.reactions.length === 0) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1" data-testid={`reaction-bar-${message.id}`}>
      {message.reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => onToggle(r.emoji)}
          data-testid={`reaction-pill-${message.id}-${r.emoji}`}
          aria-pressed={r.reacted}
          className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
            r.reacted ? 'border-blue-400 bg-blue-100 text-blue-700' : 'border-muted bg-muted/50'
          }`}
        >
          <span>{r.emoji}</span>
          <span data-testid={`reaction-count-${message.id}-${r.emoji}`}>{r.count}</span>
        </button>
      ))}
    </div>
  )
}

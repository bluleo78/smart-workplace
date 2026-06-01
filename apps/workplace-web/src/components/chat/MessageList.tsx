// 메시지 목록 — 최신이 위. infinite query 의 모든 페이지를 펼쳐 시간순(오래된→최신)으로 렌더.
import type { MessageResponse } from '@/types/messaging'

export function MessageList({ messages }: { messages: MessageResponse[] }) {
  // 페이지는 DESC 로 쌓이므로 화면에는 ASC(오래된 위)로 뒤집어 보여준다.
  const ordered = [...messages].reverse()
  return (
    <div className="flex flex-col gap-2 p-4" data-testid="message-list">
      {ordered.map((m) => (
        <div
          key={m.id}
          data-testid={`message-${m.id}`}
          data-pending={m.id < 0 ? 'true' : undefined}
          className="rounded-md px-2 py-1"
        >
          <div className="text-xs text-muted-foreground">
            {m.authorName}
            {m.authorKind === 'AGENT' && ' 🤖'}
          </div>
          <div data-testid={`message-body-${m.id}`} className="text-sm">
            {m.body}
          </div>
        </div>
      ))}
    </div>
  )
}

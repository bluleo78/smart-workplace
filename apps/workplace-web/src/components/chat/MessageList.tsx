// 메시지 목록 — 최신이 위. infinite query 의 모든 페이지를 펼쳐 시간순(오래된→최신)으로 렌더.
// 본문은 <@id> 토큰을 멘션 칩으로 렌더(chat 과 동일 스타일).
import { parseMessageSegments } from '@/components/mentions/parseMessageSegments'
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
          <div
            data-testid={`message-body-${m.id}`}
            className="text-sm whitespace-pre-wrap break-words"
          >
            {parseMessageSegments(m.body, m.mentions).map((seg, i) =>
              seg.type === 'text' ? (
                <span key={i}>{seg.value}</span>
              ) : (
                <span
                  key={i}
                  data-testid={`mention-chip-${seg.id}`}
                  className={`rounded px-1 font-medium ${
                    seg.kind === 'AGENT'
                      ? 'bg-purple-100 text-purple-700'
                      : 'bg-blue-100 text-blue-700'
                  }`}
                >
                  @{seg.name}
                </span>
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

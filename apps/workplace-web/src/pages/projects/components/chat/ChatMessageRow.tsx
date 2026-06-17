// chat 메시지 1건.
// AGENT 행은 좌측 보더(보라) + Bot 아이콘 + AgentBadge.
// 본인 메시지(canEdit) hover 시 toolbar 노출 — 실제 핸들러는 부모 ChatMessageList 에서 prop 으로 주입.
// deleted=true 면 행이 직접 '(삭제됨)' 플레이스홀더를 렌더한다 — SSE 로 도착한 삭제 이벤트는
// body 를 마스킹하지 않으므로(원본 body 가 그대로 남음) 소스(REST/SSE)와 무관하게 일관 표시.

import { Pencil, Trash2 } from 'lucide-react';

import { ChatAvatar } from '@/components/chat/ChatAvatar';
import { parseMessageSegments } from '@/components/mentions/parseMessageSegments';

import { Button } from '../../../../components/ui/button';
import { AgentBadge } from '../../../../components/users/AgentBadge';
import type { ChatMessageResponse } from '../../../../types/chat';
import { formatChatTimestamp } from './formatChatTimestamp';

interface ChatMessageRowProps {
  message: ChatMessageResponse;
  canEdit: boolean;
  isPending?: boolean;
  onEdit?: (id: number) => void;
  onDelete?: (id: number) => void;
}

export function ChatMessageRow({
  message,
  canEdit,
  isPending = false,
  onEdit,
  onDelete,
}: ChatMessageRowProps) {
  const isAgent = message.authorKind === 'AGENT';
  const showToolbar = canEdit && !message.deleted && !isPending;
  // aria-label 은 <@id> 토큰 대신 사람이 읽을 수 있는 형태(@이름)로 노출.
  const plainBody = message.deleted
    ? '(삭제됨)'
    : parseMessageSegments(message.body, message.mentions)
        .map((seg) => (seg.type === 'text' ? seg.value : `@${seg.name}`))
        .join('');

  return (
    <li
      role="article"
      aria-label={`${message.authorName}: ${plainBody.slice(0, 40)}`}
      data-testid={`chat-message-${message.id}`}
      data-agent={isAgent ? 'true' : undefined}
      data-pending={isPending ? 'true' : undefined}
      className={`group relative flex gap-2 px-3 py-2 ${
        isAgent ? 'border-l-2 border-ai-accent' : ''
      } ${isPending ? 'opacity-60' : ''}`}
    >
      {/* 팀 채팅(MessageList)과 동일한 ChatAvatar — 이니셜+결정적 색상+AGENT 뱃지 */}
      <ChatAvatar
        userId={message.authorId}
        name={message.authorName}
        kind={message.authorKind}
        className="size-6 mt-0.5"
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium">{message.authorName}</span>
          {isAgent && <AgentBadge size="xs" />}
          <span className="text-muted-foreground">
            {formatChatTimestamp(message.createdAt)}
          </span>
          {message.editedAt && (
            <span className="text-muted-foreground" aria-label="수정됨">
              (수정됨)
            </span>
          )}
        </div>
        <div
          className={`text-sm whitespace-pre-wrap break-words ${
            message.deleted ? 'italic text-muted-foreground' : ''
          }`}
          data-testid={`chat-message-body-${message.id}`}
        >
          {message.deleted
            ? '(삭제됨)'
            : parseMessageSegments(message.body, message.mentions).map((seg, i) =>
                seg.type === 'text' ? (
                  <span key={i}>{seg.value}</span>
                ) : (
                  <span
                    key={i}
                    data-testid={`chat-mention-chip-${seg.id}`}
                    // #208: AGENT 멘션칩은 ai-accent 토큰으로 통일(배지/아바타와 동일 색).
                    // 사람(HUMAN) 칩은 raw blue 팔레트(DS 위반) 대신 중립 시맨틱 토큰으로
                    // 정리해 AGENT 칩과 시각 구분을 유지하면서 다크모드도 자동 대응.
                    className={`rounded px-1 font-medium ${
                      seg.kind === 'AGENT'
                        ? 'bg-ai-accent-subtle text-ai-accent'
                        : 'bg-muted text-foreground'
                    }`}
                  >
                    @{seg.name}
                  </span>
                ),
              )}
        </div>
      </div>

      {showToolbar && (
        <div className="absolute right-2 top-1 hidden group-hover:flex gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            aria-label="수정"
            data-testid={`chat-message-edit-${message.id}`}
            onClick={() => onEdit?.(message.id)}
          >
            <Pencil className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            aria-label="삭제"
            data-testid={`chat-message-delete-${message.id}`}
            onClick={() => onDelete?.(message.id)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      )}
    </li>
  );
}

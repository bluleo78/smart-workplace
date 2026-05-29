// chat 메시지 1건.
// AGENT 행은 좌측 보더(보라) + Bot 아이콘 + AgentBadge.
// 본인 메시지(canEdit) hover 시 toolbar 노출 — 실제 핸들러는 부모 ChatMessageList 에서 prop 으로 주입.
// deleted=true 면 body 가 '(삭제됨)' 으로 마스킹돼 들어옴.

import { Bot, Pencil, Trash2, User } from 'lucide-react';

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

  return (
    <li
      role="article"
      aria-label={`${message.authorName}: ${message.body.slice(0, 40)}`}
      data-testid={`chat-message-${message.id}`}
      data-agent={isAgent ? 'true' : undefined}
      data-pending={isPending ? 'true' : undefined}
      className={`group relative flex gap-2 px-3 py-2 ${
        isAgent ? 'border-l-2 border-purple-400' : ''
      } ${isPending ? 'opacity-60' : ''}`}
    >
      <div className="flex-shrink-0 mt-0.5">
        {isAgent ? (
          <Bot className="h-5 w-5 text-purple-600" aria-hidden />
        ) : (
          <User className="h-5 w-5 text-muted-foreground" aria-hidden />
        )}
      </div>

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
          {message.body}
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

// chat 메시지 1건.
// AGENT 행은 좌측 보더(보라) + Bot 아이콘 + AgentBadge.
// #884: 본인 메시지는 우측 말풍선(아바타·이름 없음), 타인·AGENT 는 좌측. 팀 채팅(MessageList)과 같은 규칙.
// 본인 메시지(canEdit) 의 수정/삭제 toolbar 는 시각 줄에서 시각 왼쪽에 뜬다 — 핸들러는 부모 ChatMessageList 가 주입.
// deleted=true 면 행이 직접 '(삭제됨)' 플레이스홀더를 렌더한다 — SSE 로 도착한 삭제 이벤트는
// body 를 마스킹하지 않으므로(원본 body 가 그대로 남음) 소스(REST/SSE)와 무관하게 일관 표시.

import { Pencil, Trash2 } from 'lucide-react';

import { chatApi } from '@/api/chat';
import { downloadChatDriveLink } from '@/api/driveLinks';
import { MarkdownMessage } from '@/components/ai/MarkdownMessage';
import { ChatAvatar } from '@/components/chat/ChatAvatar';
import { MessageAttachmentList } from '@/components/chat/MessageAttachmentList';
import { MESSAGE_TOOLBAR_CLASS, OWN_ATTACHMENTS_CLASS } from '@/components/chat/messageToolbar';
import { parseMessageSegments } from '@/components/mentions/parseMessageSegments';
import { useTapReveal } from '@/hooks/useTapReveal';

import { Button } from '../../../../components/ui/button';
import { AgentBadge } from '../../../../components/users/AgentBadge';
import type { ChatMessageResponse } from '../../../../types/chat';
import { ChatMessageImage } from './ChatMessageImage';
import { formatChatTimestamp } from './formatChatTimestamp';

interface ChatMessageRowProps {
  message: ChatMessageResponse;
  // 작성자 본인 여부 — 우측 말풍선 레이아웃 판정.
  isOwn: boolean;
  canEdit: boolean;
  isPending?: boolean;
  onEdit?: (id: number) => void;
  onDelete?: (id: number) => void;
}

export function ChatMessageRow({
  message,
  isOwn,
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
  // 터치 기기: 행을 탭하면 툴바 노출. 행마다 독립 상태라 다른 행을 탭하면 이 행은 닫힌다.
  // 훅은 조건 없이 호출하되(훅 규칙), 툴바가 있는 본인 행에만 탭 노출 props 를 펼친다.
  const tapProps = useTapReveal()(message.id);
  // 첨부만 있고 본문이 빈 본인 메시지는 빈 말풍선을 그리지 않는다.
  const hasBody = message.deleted || message.body.trim() !== '';

  // 수정/삭제 툴바 — 본인 메시지 전용. 시각 줄 안에서 시각의 왼쪽에 떠 말풍선·윗 메시지를 가리지 않는다.
  // hidden 토글이 아니라 opacity 토글(MESSAGE_TOOLBAR_CLASS)이라 키보드 포커스로도 도달한다(#809 와 같은 규칙).
  const toolbar = showToolbar && (
    <div
      data-testid={`chat-message-toolbar-${message.id}`}
      className={`absolute bottom-0 right-full mr-1.5 ${MESSAGE_TOOLBAR_CLASS}`}
    >
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
  );

  const body = (
    <div
      className={`text-sm whitespace-pre-wrap break-words ${
        // 본인: 말풍선. 삭제된 메시지는 색 없는 점선 테두리로 자리를 유지한다.
        isOwn ? `wrap-anywhere max-w-full rounded-2xl px-3 py-1.5 ${message.deleted ? 'border border-dashed' : 'bg-primary/10'}` : ''
      } ${message.deleted ? 'italic text-muted-foreground' : ''}`}
      data-testid={`chat-message-body-${message.id}`}
    >
      {message.deleted ? (
        '(삭제됨)'
      ) : isAgent ? (
        // #356: AI(에이전트) 메시지는 마크다운 렌더(사람 메시지는 멘션칩 포함 plain text 유지).
        <MarkdownMessage>{message.body}</MarkdownMessage>
      ) : (
        parseMessageSegments(message.body, message.mentions).map((seg, i) =>
          seg.type === 'text' ? (
            <span key={i}>{seg.value}</span>
          ) : (
            <span
              key={i}
              data-testid={`chat-mention-chip-${seg.id}`}
              // #208: AGENT 멘션칩은 ai-accent 토큰으로 통일(배지/아바타와 동일 색).
              // 사람(HUMAN) 칩은 중립 시맨틱 토큰으로 AGENT 칩과 구분하면서 다크모드도 자동 대응.
              // 본인 말풍선(bg-primary/10) 안에서는 기존 칩 배경이 말풍선에 묻혀 사라지므로
              // bg-background 로 대비를 확보한다(타인 메시지는 기존 클래스 유지).
              className={`rounded px-1 font-medium ${
                // 본인 말풍선은 wrap-anywhere 라 칩이 '@' 와 이름 사이에서 끊길 수 있어 한 덩어리로 유지한다.
                isOwn ? 'whitespace-nowrap ' : ''
              }${
                seg.kind === 'AGENT'
                  ? `${isOwn ? 'bg-background' : 'bg-ai-accent-subtle'} text-ai-accent`
                  : `${isOwn ? 'bg-background' : 'bg-muted'} text-foreground`
              }`}
            >
              @{seg.name}
            </span>
          ),
        )
      )}
    </div>
  );

  // #358: 삭제되지 않은 메시지의 첨부·드라이브 링크 렌더 — 이미지는 ChatMessageImage 위임.
  const attachments = !message.deleted &&
    ((message.attachments?.length ?? 0) > 0 || (message.driveLinks?.length ?? 0) > 0) && (
      <MessageAttachmentList
        attachments={message.attachments}
        driveLinks={message.driveLinks}
        onDownloadAttachment={(att) =>
          void chatApi.downloadAttachment(message.threadId, att.messageId, att.fileId, att.originalName)
        }
        onDownloadDriveLink={(dl) =>
          void downloadChatDriveLink(message.threadId, message.id, dl.driveFileId, dl.name)
        }
        renderImage={(att) => <ChatMessageImage threadId={message.threadId} attachment={att} />}
      />
    );

  return (
    <li
      role="article"
      aria-label={`${message.authorName}: ${plainBody.slice(0, 40)}`}
      data-testid={`chat-message-${message.id}`}
      data-agent={isAgent ? 'true' : undefined}
      data-pending={isPending ? 'true' : undefined}
      data-own={isOwn ? 'true' : 'false'}
      {...(isOwn ? tapProps : {})}
      className={`group relative flex gap-2 px-3 py-2 ${
        isAgent ? 'border-l-2 border-ai-accent' : ''
      } ${isPending ? 'opacity-60' : ''} ${isOwn ? 'justify-end' : ''}`}
    >
      {isOwn ? (
        // 본인 — 우측 정렬, 말풍선 최대 폭 75%. 아바타·이름은 그리지 않는다.
        // 이슈 채팅은 그룹핑이 없어 모든 본인 메시지가 시각 줄을 가진다.
        <div className="flex min-w-0 max-w-[75%] flex-col items-end">
          <div className="relative flex items-center gap-2 text-xs text-muted-foreground">
            {toolbar}
            <span>{formatChatTimestamp(message.createdAt)}</span>
            {message.editedAt && (
              // whitespace-nowrap: 좁은 시각 줄에서 "(수정됨)" 이 단어 중간에 끊기지 않게 한다.
              <span className="whitespace-nowrap" aria-label="수정됨">
                (수정됨)
              </span>
            )}
          </div>
          {hasBody && body}
          {/* 본인 컬럼 폭(75%)에 묶는 첨부 래퍼 — 이유는 OWN_ATTACHMENTS_CLASS 주석 참조. */}
          {attachments && <div className={OWN_ATTACHMENTS_CLASS}>{attachments}</div>}
        </div>
      ) : (
        <>
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
              <span className="text-muted-foreground">{formatChatTimestamp(message.createdAt)}</span>
              {message.editedAt && (
                <span className="text-muted-foreground" aria-label="수정됨">
                  (수정됨)
                </span>
              )}
            </div>
            {body}
            {attachments}
          </div>
        </>
      )}
    </li>
  );
}

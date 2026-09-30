// 팀 채팅 메시지 한 행 — 작성자 쪽에 따라 두 레이아웃(#884 좌/우 분리).
//   타인·AGENT: 좌측 거터(아바타 또는 hover 시각) + 전폭 평문.
//   본인: 우측 말풍선(최대 75%, 아바타·이름 없음). 수정 중에는 전폭 에디터.
// 뮤테이션·편집 상태는 목록(MessageList)이 갖고, 이 컴포넌트는 콜백만 받아 그린다.
import { Bot, MessageSquare, Pencil, Trash2 } from 'lucide-react'
import type { ComponentProps, Ref } from 'react'

import { downloadMessageDriveLink } from '@/api/driveLinks'
import { messagingApi } from '@/api/messaging'
import { MarkdownMessage } from '@/components/ai/MarkdownMessage'
import { ChatAvatar } from '@/components/chat/ChatAvatar'
import { EmojiPicker } from '@/components/chat/EmojiPicker'
import { MessageAttachmentList } from '@/components/chat/MessageAttachmentList'
import { MessageImage } from '@/components/chat/MessageImage'
import {
  HOVER_TIME_REVEAL_CLASS,
  MESSAGE_TOOLBAR_CLASS,
  OWN_ATTACHMENTS_CLASS,
  TOOLBAR_POSITION,
} from '@/components/chat/messageToolbar'
import { ProposalCard } from '@/components/chat/ProposalCard'
import { ReactionBar } from '@/components/chat/ReactionBar'
import { parseMessageSegments } from '@/components/mentions/parseMessageSegments'
import { RichInput } from '@/components/mentions/RichInput'
import type { MentionCandidate } from '@/components/mentions/types'
import { Button } from '@/components/ui/button'
import type { ToolbarRowProps } from '@/hooks/useToolbarReveal'
import { formatClockTime, formatClockTimeCompact } from '@/lib/formatters'
import type { MessageResponse } from '@/types/messaging'

// 제안 승인 인자 — ProposalCard 가 정의하는 형태를 그대로 따른다.
type ProposalConfirmArg = Parameters<ComponentProps<typeof ProposalCard>['onConfirm']>[0]

interface MessageRowProps {
  message: MessageResponse
  channelId: number
  currentUserId: number
  // @멘션 후보(인라인 수정 에디터의 RichInput 용).
  members: MentionCandidate[]
  // 같은 작성자 묶음(Slack 패턴)의 첫 줄인지 — 아바타·이름·시각 헤더 표시 여부.
  startsGroup: boolean
  isEditing: boolean
  // 마지막 행에만 전달 — 목록이 viewport 진입을 관찰해 읽음 처리한다.
  rowRef?: Ref<HTMLDivElement>
  // useToolbarReveal 이 주는 행 props(터치 탭 노출·툴바 뒤집기).
  rowProps: ToolbarRowProps
  // 스레드 패널 오픈. 스레드 패널 내부 렌더 시엔 미전달(스레드 버튼·답글 링크 숨김).
  onOpenThread?: (messageId: number) => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: (body: string) => void
  onDelete: () => void
  onToggleReaction: (emoji: string) => void
  proposalBusy: boolean
  onConfirmProposal: (proposalId: number, arg: ProposalConfirmArg) => void
  onRejectProposal: (proposalId: number) => void
}

export function MessageRow({
  message: m,
  channelId,
  currentUserId,
  members,
  startsGroup,
  isEditing,
  rowRef,
  rowProps,
  onOpenThread,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onToggleReaction,
  proposalBusy,
  onConfirmProposal,
  onRejectProposal,
}: MessageRowProps) {
  const isPending = m.id < 0
  // 본인 메시지 여부 — 정렬(우측 말풍선)과 편집/삭제 권한 판정에 쓴다.
  const isOwn = m.authorId === currentUserId
  // 본인·미삭제·미전송중 메시지만 수정/삭제 노출.
  const canEdit = isOwn && !m.deleted && !isPending

  // 본인 메시지는 우측 말풍선. 수정 중에는 에디터가 말풍선 폭(75%)에 눌리지 않도록 전폭 레이아웃으로 빠진다.
  const ownBubble = isOwn && !isEditing
  // 첨부만 있고 본문이 빈 메시지는 빈 말풍선을 그리지 않는다(삭제됨은 '(삭제됨)' 을 보여야 하므로 그린다).
  const hasBody = m.deleted || m.body.trim() !== ''

  // 툴바 위치 — 양쪽 모두 "메시지 위"(Teams식). 작업 대상 본문은 가리지 않는다.
  //   타인: 행 우상단 오버레이.
  //   본인·묶음 첫 줄: 시각 줄 안에서 시각의 왼쪽(시각도 윗 메시지도 가리지 않음).
  //   본인·후속 줄: 말풍선 오른쪽 끝 위(bottom-full 이라 말풍선과 겹치지 않음).
  //   스크롤 영역 위 끝에 잘리면 아래로 뒤집힌다(TOOLBAR_POSITION 주석 참조).
  const toolbarPosition = !isOwn
    ? TOOLBAR_POSITION.peer
    : startsGroup
      ? TOOLBAR_POSITION.ownHeader
      : TOOLBAR_POSITION.ownBubble

  const toolbar = !isEditing && (
    <div
      data-testid={`message-toolbar-${m.id}`}
      data-message-toolbar=""
      className={`${toolbarPosition} ${MESSAGE_TOOLBAR_CLASS}`}
    >
      {/* 낙관적 미확정 메시지(id<0)엔 리액션 불가 — 음수 id 로 POST 하면 실패하므로 숨김. */}
      {!isPending && (
        <EmojiPicker
          testIdPrefix={`message-${m.id}`}
          onPick={onToggleReaction}
        />
      )}
      {onOpenThread && !isPending && (
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          aria-label="스레드"
          data-testid={`message-reply-${m.id}`}
          onClick={() => onOpenThread(m.id)}
        >
          <MessageSquare className="h-3 w-3" />
        </Button>
      )}
      {canEdit && (
        <>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            aria-label="수정"
            data-testid={`message-edit-${m.id}`}
            onClick={onStartEdit}
          >
            <Pencil className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            aria-label="삭제"
            data-testid={`message-delete-${m.id}`}
            onClick={onDelete}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </>
      )}
    </div>
  )

  const body = isEditing ? (
    // 인라인 수정 — RichInput 재사용. 저장 시 useUpdateMessage, 닫으면 편집 종료.
    <div data-testid={`message-editor-${m.id}`}>
      <RichInput
        members={members}
        initialBody={m.body}
        initialMentions={m.mentions}
        onSubmit={onSaveEdit}
        onCancel={onCancelEdit}
        submitLabel="저장"
        autoFocus
        disableWhenEmpty
        inputTestId={`message-editor-input-${m.id}`}
        submitTestId={`message-editor-save-${m.id}`}
        cancelTestId={`message-editor-cancel-${m.id}`}
      />
    </div>
  ) : m.proposal ? (
    // L3 위임 제안이 있는 메시지 — 본문 대신 확인 카드 렌더.
    <ProposalCard
      proposal={m.proposal}
      currentUserId={currentUserId}
      busy={proposalBusy}
      onConfirm={(arg) => onConfirmProposal(m.proposal!.id, arg)}
      onReject={() => onRejectProposal(m.proposal!.id)}
    />
  ) : ownBubble && !hasBody ? null : (
    <div
      data-testid={`message-body-${m.id}`}
      className={`text-sm whitespace-pre-wrap break-words ${
        // 본인: 말풍선. 삭제된 메시지는 색 없는 점선 테두리로 자리를 유지한다.
        // wrap-anywhere: 공백 없는 긴 문자열도 말풍선 안에서 끊어 min-content 폭을 줄인다(가로 스크롤 방지).
        ownBubble ? `wrap-anywhere rounded-2xl px-3 py-1.5 ${m.deleted ? 'border border-dashed' : 'bg-primary/10'}` : ''
      } ${m.deleted ? 'italic text-muted-foreground' : ''}`}
    >
      {m.deleted ? (
        '(삭제됨)'
      ) : m.authorKind === 'AGENT' ? (
        // #356: AI(에이전트) 메시지는 마크다운 렌더(사람 메시지는 멘션칩 포함 plain text 유지).
        <MarkdownMessage>{m.body}</MarkdownMessage>
      ) : (
        parseMessageSegments(m.body, m.mentions).map((seg, i) =>
          seg.type === 'text' ? (
            <span key={i}>{seg.value}</span>
          ) : (
            <span
              key={i}
              data-testid={`mention-chip-${seg.id}`}
              className={`rounded px-1 font-medium ${
                // 본인 말풍선은 wrap-anywhere 라 칩이 '@' 와 이름 사이에서 끊길 수 있어 한 덩어리로 유지한다.
                ownBubble ? 'whitespace-nowrap' : ''
              } ${
                ownBubble
                  ? // 본인 말풍선(bg-primary/10) 안에서는 반투명/accent 칩이 배경에 묻히므로 불투명 배경 토큰으로 띄운다.
                    seg.kind === 'AGENT'
                    ? 'bg-background text-primary'
                    : 'bg-background text-foreground'
                  : seg.kind === 'AGENT'
                    ? 'bg-primary/15 text-primary' // 에이전트: 브랜드 컬러 기반 시맨틱 토큰
                    : 'bg-accent text-accent-foreground' // 사용자: accent 시맨틱 토큰 (다크모드 자동 대응)
              }`}
            >
              @{seg.name}
            </span>
          ),
        )
      )}
      {/* 수정됨 표시 — 본문 끝에 인라인(본인은 말풍선 안). 삭제됨 메시지는 제외.
          whitespace-nowrap: 말풍선의 wrap-anywhere 때문에 '(수정'/'됨)' 으로 쪼개지는 것을 막는다. */}
      {m.editedAt && !m.deleted && (
        <span
          aria-label="수정됨"
          data-testid={`message-edited-${m.id}`}
          className="ml-1 whitespace-nowrap align-baseline text-xs text-muted-foreground"
        >
          (수정됨)
        </span>
      )}
    </div>
  )

  // #80: driveLinks 도 MessageAttachmentList 에서 함께 렌더. 팀 채팅 도메인 핸들러·이미지 렌더 주입.
  const attachments = !m.deleted &&
    ((m.attachments?.length ?? 0) > 0 || (m.driveLinks?.length ?? 0) > 0) && (
      <MessageAttachmentList
        attachments={m.attachments ?? []}
        driveLinks={m.driveLinks ?? []}
        onDownloadAttachment={(a) =>
          messagingApi.downloadAttachment(channelId, a.messageId, a.fileId, a.originalName)
        }
        onDownloadDriveLink={(dl) => void downloadMessageDriveLink(channelId, m.id, dl.driveFileId, dl.name)}
        renderImage={(a) => <MessageImage channelId={channelId} attachment={a} />}
      />
    )

  // 반응 칩 — 메시지 아래, 메시지와 같은 쪽 정렬(위는 작업 툴바, 아래는 결과).
  const reactions = (
    <ReactionBar
      message={m}
      align={isOwn ? 'end' : 'start'}
      onToggle={onToggleReaction}
    />
  )

  const threadLink = onOpenThread && m.replyCount > 0 && (
    <button
      type="button"
      className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      data-testid={`message-thread-link-${m.id}`}
      onClick={() => onOpenThread(m.id)}
    >
      <MessageSquare className="h-3.5 w-3.5" />
      답글 {m.replyCount}개
      {/* 미읽음 스레드 표시 점 — 팔로우 중이고 미읽음 있을 때만 노출. */}
      {m.unreadReplyCount > 0 && (
        <span
          data-testid={`message-unread-thread-${m.id}`}
          className="h-2 w-2 rounded-full bg-destructive"
          aria-label={`새 답글 ${m.unreadReplyCount}개`}
        />
      )}
    </button>
  )

  return (
    <div
      ref={rowRef}
      data-testid={`message-${m.id}`}
      data-pending={isPending ? 'true' : undefined}
      data-group-start={startsGroup ? 'true' : 'false'}
      data-own={isOwn ? 'true' : 'false'}
      {...rowProps}
      className={`group relative flex gap-2 rounded-md px-2 hover:bg-accent/40 ${startsGroup ? 'mt-2 pt-0.5' : ''} ${
        ownBubble ? 'justify-end' : ''
      }`}
    >
      {ownBubble ? (
        <>
          {/* 본인·후속 줄: hover 시각을 말풍선 왼쪽 옆에 둔다. 자리는 항상 예약(opacity 토글)+nowrap 이라
              hover 전후로 말풍선 위치·행 높이가 변하지 않는다(a78a39b7 회귀 방지). */}
          {!startsGroup && (
            <span
              className={`shrink-0 self-start pt-2 ${HOVER_TIME_REVEAL_CLASS}`}
              data-testid={`message-hovertime-${m.id}`}
            >
              {formatClockTimeCompact(m.createdAt)}
            </span>
          )}
          {/* 본인 컬럼 — 우측 정렬, 말풍선 최대 폭 75%. 아바타·이름은 그리지 않는다. */}
          <div className="flex min-w-0 max-w-[75%] flex-col items-end">
            {/* 화면에는 이름을 생략하지만 스크린리더에는 작성자를 알린다(묶음 첫 줄에만). */}
            {startsGroup && <span className="sr-only">{m.authorName}</span>}
            {/* 묶음 첫 줄: 말풍선 위 오른쪽에 시각(항상 표시). 툴바는 이 줄 안에서 시각 왼쪽에 뜬다. */}
            {startsGroup && (
              <div className="relative text-xs text-muted-foreground">
                {toolbar}
                <span data-testid={`message-time-${m.id}`}>{formatClockTime(m.createdAt)}</span>
              </div>
            )}
            <div className="relative max-w-full min-w-0">
              {!startsGroup && toolbar}
              {body}
            </div>
            {/* 본인 컬럼 폭(75%)에 묶는 첨부 래퍼 — 이유는 OWN_ATTACHMENTS_CLASS 주석 참조. */}
            {attachments && <div className={OWN_ATTACHMENTS_CLASS}>{attachments}</div>}
            {reactions}
            {threadLink}
          </div>
        </>
      ) : (
        <>
          {/* 좌측 거터(고정폭) — 타인·AGENT 전용. 그룹 첫 줄엔 아바타, 후속 줄엔 hover 시 컴팩트 시각.
              본인 메시지를 수정 중일 때는 거터 없이 에디터가 전폭을 쓴다. */}
          {!isOwn && (
            <div className="w-10 shrink-0 pt-0.5">
              {startsGroup ? (
                <ChatAvatar userId={m.authorId} name={m.authorName} kind={m.authorKind} />
              ) : (
                <span
                  className={`block pt-px text-right ${HOVER_TIME_REVEAL_CLASS}`}
                  data-testid={`message-hovertime-${m.id}`}
                >
                  {formatClockTimeCompact(m.createdAt)}
                </span>
              )}
            </div>
          )}

          {/* 본문 컬럼 — 전폭. 헤더/본문/첨부/toolbar/리액션/답글. */}
          <div className="min-w-0 flex-1">
            {/* 그룹 첫 줄에만 작성자 헤더(이름 + 시각). 타인·AGENT 만 해당. */}
            {!isOwn && startsGroup && (
              <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {m.authorName}
                  {/* AI 에이전트 작성자 표시 — 이모지 대신 lucide Bot 아이콘(ai-accent 토큰). */}
                  {m.authorKind === 'AGENT' && (
                    <Bot className="ml-0.5 inline h-3 w-3 align-[-0.125em] text-ai-accent" aria-label="에이전트" />
                  )}
                </span>
                <span data-testid={`message-time-${m.id}`}>{formatClockTime(m.createdAt)}</span>
              </div>
            )}
            {body}
            {attachments}
            {toolbar}
            {reactions}
            {threadLink}
          </div>
        </>
      )}
    </div>
  )
}

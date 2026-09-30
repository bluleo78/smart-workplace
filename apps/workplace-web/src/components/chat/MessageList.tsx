// 메시지 목록 — 최신이 위. infinite query 의 모든 페이지를 펼쳐 시간순(오래된→최신)으로 렌더.
// 본문은 <@id> 토큰을 멘션 칩으로 렌더(chat 과 동일 스타일).
// 본인(authorId === currentUserId) · 미삭제 메시지는 hover 시 수정/삭제 toolbar 노출.
// 수정 → 인라인 RichInput 에디터(chat 의 ChatMessageEditor 미러). 삭제됨 메시지는 '(삭제됨)' 마스킹.
// Phase 5: hover toolbar 에 이모지 피커 + 답글 버튼 추가. body 아래 ReactionBar + 답글수 링크.
// Task 5(대화 Phase A): 그룹핑(Slack 패턴) — 같은 작성자·5분 이내 연속 메시지는 한 묶음.
// #884: 좌/우 분리 — 타인·AGENT 는 좌측 거터 + 전폭 평문, 본인은 우측 말풍선(아바타·이름 없음).
import { Bot, MessageSquare, Pencil, Trash2 } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'

import { downloadMessageDriveLink } from '@/api/driveLinks'
import { messagingApi } from '@/api/messaging'
import { MarkdownMessage } from '@/components/ai/MarkdownMessage'
import { ChatAvatar } from '@/components/chat/ChatAvatar'
import { DateDivider } from '@/components/chat/DateDivider'
import { EmojiPicker } from '@/components/chat/EmojiPicker'
import { MessageAttachmentList } from '@/components/chat/MessageAttachmentList'
import { MessageImage } from '@/components/chat/MessageImage'
import { MESSAGE_TOOLBAR_CLASS } from '@/components/chat/messageToolbar'
import { ProposalCard } from '@/components/chat/ProposalCard'
import { ReactionBar } from '@/components/chat/ReactionBar'
import { UnreadDivider } from '@/components/chat/UnreadDivider'
import { parseMessageSegments } from '@/components/mentions/parseMessageSegments'
import { RichInput } from '@/components/mentions/RichInput'
import type { MentionCandidate } from '@/components/mentions/types'
import { Button } from '@/components/ui/button'
import { useDeleteMessage } from '@/hooks/queries/useDeleteMessage'
import { useMarkMessageRead } from '@/hooks/queries/useMarkMessageRead'
import { useProposalActions } from '@/hooks/queries/useProposalActions'
import { useToggleReaction } from '@/hooks/queries/useToggleReaction'
import { useUpdateMessage } from '@/hooks/queries/useUpdateMessage'
import { useTapReveal } from '@/hooks/useTapReveal'
import { deleteMessageWithUndo } from '@/lib/deleteWithUndo'
import { formatClockTime, formatClockTimeCompact, getDateKey } from '@/lib/formatters'
import { shouldStartNewGroup } from '@/lib/messageGrouping'
import type { MessageResponse } from '@/types/messaging'

interface MessageListProps {
  messages: MessageResponse[]
  channelId: number
  currentUserId: number
  // @멘션 후보(인라인 수정 에디터의 RichInput 용). 멘션 칩 표시는 본문에 이미 포함.
  members: MentionCandidate[]
  // 스레드 패널 오픈 콜백(부모 메시지 클릭/답글 버튼). 스레드 패널 내부 렌더 시엔 미전달(undefined).
  onOpenThread?: (messageId: number) => void
  // 스레드 패널처럼 답글/부모를 재렌더할 때 mark-read 를 끈다(답글 id 로 채널 watermark 가 잘못 전진하는 것 방지).
  disableMarkRead?: boolean
  // 메시지 0건일 때 보여줄 빈 상태(부모가 맥락 문구를 조립해 전달). 미전달 시 빈 화면 유지.
  emptyState?: React.ReactNode
  // 이 메시지 id 바로 앞에 "여기까지 읽음" 구분선을 그린다. null/미전달이면 안 그림.
  unreadDividerBeforeId?: number | null
  // 캐치업 카드 슬롯. 구분선 위치에 같이 렌더(구분선이 로드뷰 밖이면 목록 상단). 미전달이면 안 그림.
  catchupSlot?: React.ReactNode
}

export function MessageList({ messages, channelId, currentUserId, members, onOpenThread, disableMarkRead, emptyState, unreadDividerBeforeId, catchupSlot }: MessageListProps) {
  // 페이지는 DESC 로 쌓이므로 화면에는 ASC(오래된 위)로 뒤집어 보여준다.
  const ordered = [...messages].reverse()
  // 현재 인라인 수정 중인 메시지 id (한 번에 하나).
  const [editingId, setEditingId] = useState<number | null>(null)

  const update = useUpdateMessage(channelId)
  const remove = useDeleteMessage(channelId)
  const toggleReaction = useToggleReaction(channelId)
  // L3 위임 제안 승인/거부 뮤테이션 — 성공 시 이 채널 메시지 목록 무효화.
  const proposalActions = useProposalActions(channelId)
  // 터치 기기: 행을 탭하면 툴바 노출(hover 가 없으므로). 바깥을 탭하면 닫힌다.
  const tapRowProps = useTapReveal()

  // 마지막(최신) 메시지가 viewport 진입하면 읽음 처리(mark-read). 중복 억제는 훅 내부 ref 가 담당.
  const markRead = useMarkMessageRead(channelId)
  const lastRef = useRef<HTMLDivElement | null>(null)
  const lastId = ordered.length > 0 ? ordered[ordered.length - 1].id : null

  useEffect(() => {
    const el = lastRef.current
    if (disableMarkRead || !el || lastId === null || lastId < 0) return // 패널 렌더·낙관적·빈 목록 제외
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) markRead(lastId)
      },
      { threshold: 0.5 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [lastId, markRead, disableMarkRead])

  return (
    <div className="flex flex-col gap-2 p-4" data-testid="message-list">
      {ordered.length === 0 && emptyState}
      {/* 구분선이 로드된 메시지 범위 밖(전부 미읽음)일 땐 카드를 목록 상단에 렌더. */}
      {catchupSlot != null && unreadDividerBeforeId == null && catchupSlot}
      {ordered.map((m, idx) => {
        const isPending = m.id < 0
        // 본인 메시지 여부 — 정렬(우측 말풍선)과 편집/삭제 권한 판정에 쓴다.
        const isOwn = m.authorId === currentUserId
        // 본인·미삭제·미전송중 메시지만 수정/삭제 노출.
        const canEdit = isOwn && !m.deleted && !isPending
        const isEditing = editingId === m.id
        const isLast = idx === ordered.length - 1

        const prev = idx > 0 ? ordered[idx - 1] : null
        const startsGroup = shouldStartNewGroup(prev, m)

        // 날짜가 바뀌는 지점(또는 첫 메시지) 앞에 날짜 구분선 삽입.
        const showDateDivider = !prev || getDateKey(m.createdAt) !== getDateKey(prev.createdAt)

        // 본인 메시지는 우측 말풍선. 수정 중에는 에디터가 말풍선 폭(75%)에 눌리지 않도록 전폭 레이아웃으로 빠진다.
        const ownBubble = isOwn && !isEditing
        // 첨부만 있고 본문이 빈 메시지는 빈 말풍선을 그리지 않는다(삭제됨은 '(삭제됨)' 을 보여야 하므로 그린다).
        const hasBody = m.deleted || m.body.trim() !== ''

        // 툴바 위치 — 양쪽 모두 "메시지 위"(Teams식). 작업 대상 본문은 가리지 않는다.
        //   타인: 행 우상단 오버레이.
        //   본인·묶음 첫 줄: 시각 줄 안에서 시각의 왼쪽(시각도 윗 메시지도 가리지 않음).
        //   본인·후속 줄: 말풍선 오른쪽 끝 위(bottom-full 이라 말풍선과 겹치지 않음).
        const toolbarPosition = !isOwn
          ? 'absolute -top-3 right-2'
          : startsGroup
            ? 'absolute bottom-0 right-full mr-1.5'
            : 'absolute bottom-full right-0'

        const toolbar = !isEditing && (
          <div data-testid={`message-toolbar-${m.id}`} className={`${toolbarPosition} ${MESSAGE_TOOLBAR_CLASS}`}>
            {/* 낙관적 미확정 메시지(id<0)엔 리액션 불가 — 음수 id 로 POST 하면 실패하므로 숨김. */}
            {!isPending && (
              <EmojiPicker
                testIdPrefix={`message-${m.id}`}
                onPick={(emoji) => toggleReaction.mutate({ message: m, emoji })}
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
                  onClick={() => setEditingId(m.id)}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  aria-label="삭제"
                  data-testid={`message-delete-${m.id}`}
                  onClick={() => deleteMessageWithUndo(() => remove.mutate(m.id))}
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
              onSubmit={(next) => {
                // #124 수정: 성공 시에만 에디터 닫기. 실패 시 에디터는 입력 내용을 유지한 채 열려 있다.
                update.mutate({ messageId: m.id, body: next }, { onSuccess: () => setEditingId(null) })
              }}
              onCancel={() => setEditingId(null)}
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
            busy={proposalActions.confirm.isPending || proposalActions.reject.isPending}
            onConfirm={(arg) => proposalActions.confirm.mutate({ proposalId: m.proposal!.id, arg })}
            onReject={() => proposalActions.reject.mutate(m.proposal!.id)}
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
            onToggle={(emoji) => toggleReaction.mutate({ message: m, emoji })}
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
          <Fragment key={m.id}>
            {showDateDivider && <DateDivider date={m.createdAt} />}
            {unreadDividerBeforeId != null && m.id === unreadDividerBeforeId && (
              <>
                <UnreadDivider />
                {catchupSlot}
              </>
            )}
            <div
              ref={isLast ? lastRef : undefined}
              data-testid={`message-${m.id}`}
              data-pending={isPending ? 'true' : undefined}
              data-group-start={startsGroup ? 'true' : 'false'}
              data-own={isOwn ? 'true' : 'false'}
              {...tapRowProps(m.id)}
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
                      className="shrink-0 self-start whitespace-nowrap pt-2 text-xs leading-4 tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-data-[tap-active=true]:opacity-100"
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
                    {attachments}
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
                          className="block whitespace-nowrap pt-px text-right text-xs leading-4 tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-data-[tap-active=true]:opacity-100"
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
          </Fragment>
        )
      })}
    </div>
  )
}

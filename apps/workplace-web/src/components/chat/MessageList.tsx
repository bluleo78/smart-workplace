// 메시지 목록 — 최신이 위. infinite query 의 모든 페이지를 펼쳐 시간순(오래된→최신)으로 렌더.
// 본문은 <@id> 토큰을 멘션 칩으로 렌더(chat 과 동일 스타일).
// 본인(authorId === currentUserId) · 미삭제 메시지는 hover 시 수정/삭제 toolbar 노출.
// 수정 → 인라인 RichInput 에디터(chat 의 ChatMessageEditor 미러). 삭제됨 메시지는 '(삭제됨)' 마스킹.
// Phase 5: hover toolbar 에 이모지 피커 + 답글 버튼 추가. body 아래 ReactionBar + 답글수 링크.
// Task 5(대화 Phase A): 2-컬럼 레이아웃 — 좌측 아바타 거터 + 우측 본문 컬럼. Slack 패턴 그룹핑.
import { MessageSquare, Pencil, Trash2 } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'

import { ChatAvatar } from '@/components/chat/ChatAvatar'
import { DateDivider } from '@/components/chat/DateDivider'
import { EmojiPicker } from '@/components/chat/EmojiPicker'
import { MessageAttachmentList } from '@/components/chat/MessageAttachmentList'
import { ReactionBar } from '@/components/chat/ReactionBar'
import { parseMessageSegments } from '@/components/mentions/parseMessageSegments'
import { RichInput } from '@/components/mentions/RichInput'
import type { MentionCandidate } from '@/components/mentions/types'
import { Button } from '@/components/ui/button'
import { useDeleteMessage } from '@/hooks/queries/useDeleteMessage'
import { useMarkMessageRead } from '@/hooks/queries/useMarkMessageRead'
import { useToggleReaction } from '@/hooks/queries/useToggleReaction'
import { useUpdateMessage } from '@/hooks/queries/useUpdateMessage'
import { deleteMessageWithUndo } from '@/lib/deleteWithUndo'
import { formatClockTime, getDateKey } from '@/lib/formatters'
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
}

export function MessageList({ messages, channelId, currentUserId, members, onOpenThread, disableMarkRead, emptyState }: MessageListProps) {
  // 페이지는 DESC 로 쌓이므로 화면에는 ASC(오래된 위)로 뒤집어 보여준다.
  const ordered = [...messages].reverse()
  // 현재 인라인 수정 중인 메시지 id (한 번에 하나).
  const [editingId, setEditingId] = useState<number | null>(null)

  const update = useUpdateMessage(channelId)
  const remove = useDeleteMessage(channelId)
  const toggleReaction = useToggleReaction(channelId)

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
      {ordered.map((m, idx) => {
        const isPending = m.id < 0
        // 본인 메시지(우측 버블 정렬 대상). AGENT 는 currentUserId 와 다르므로 항상 좌측.
        const isOwn = m.authorId === currentUserId
        // 본인·미삭제·미전송중 메시지만 toolbar 노출.
        const canEdit = isOwn && !m.deleted && !isPending
        const isEditing = editingId === m.id
        const isLast = idx === ordered.length - 1

        const prev = idx > 0 ? ordered[idx - 1] : null
        const startsGroup = shouldStartNewGroup(prev, m)

        // 날짜가 바뀌는 지점(또는 첫 메시지) 앞에 날짜 구분선 삽입.
        const showDateDivider = !prev || getDateKey(m.createdAt) !== getDateKey(prev.createdAt)

        return (
          <Fragment key={m.id}>
            {showDateDivider && <DateDivider date={m.createdAt} />}
            <div
              ref={isLast ? lastRef : undefined}
              data-testid={`message-${m.id}`}
              data-pending={isPending ? 'true' : undefined}
              data-group-start={startsGroup ? 'true' : 'false'}
              data-own={isOwn ? 'true' : 'false'}
              className={`group relative flex gap-2 rounded-md px-2 hover:bg-accent/40 ${startsGroup ? 'mt-2 pt-0.5' : ''} ${isOwn ? 'justify-end' : ''}`}
            >
            {/* 좌측 거터(아바타 폭 고정) — 그룹 첫 줄엔 아바타, 후속 줄엔 hover 시 시각. 본인 메시지는 우측 정렬이라 거터 생략. */}
            {!isOwn && (
              <div className="w-8 shrink-0 pt-0.5">
                {startsGroup ? (
                  <ChatAvatar userId={m.authorId} name={m.authorName} kind={m.authorKind} />
                ) : (
                  <span
                    className="hidden pt-px text-right text-xs leading-4 text-muted-foreground group-hover:block"
                    data-testid={`message-hovertime-${m.id}`}
                  >
                    {formatClockTime(m.createdAt)}
                  </span>
                )}
              </div>
            )}

            {/* 본문 컬럼 — 헤더/본문/첨부/toolbar/리액션/답글 전체. */}
            {/* 본인 메시지: 우측 정렬 + 폭 제한(max-w) + items-end. 단, 인라인 수정 중엔 풀폭 좌측(에디터가 버블 안에서 눌리지 않도록). */}
            <div className={`min-w-0 ${isOwn && !isEditing ? 'flex max-w-[75%] flex-col items-end' : 'flex-1'}`}>
              {/* 그룹 첫 줄에만 작성자 헤더(이름 + 시각 + 수정됨 표시) 노출. 본인 메시지는 이름 생략(자명) — 시각만. */}
              {startsGroup && (
                <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
                  {!isOwn && (
                    <span className="font-semibold text-foreground">
                      {m.authorName}
                      {m.authorKind === 'AGENT' && ' 🤖'}
                    </span>
                  )}
                  <span data-testid={`message-time-${m.id}`}>{formatClockTime(m.createdAt)}</span>
                </div>
              )}

              {isEditing ? (
                // 인라인 수정 — RichInput 재사용. 저장 시 useUpdateMessage, 닫으면 편집 종료.
                <div data-testid={`message-editor-${m.id}`}>
                  <RichInput
                    members={members}
                    initialBody={m.body}
                    initialMentions={m.mentions}
                    onSubmit={(body) => {
                      // #124 수정: 성공 시에만 에디터 닫기. 실패 시 에디터는 입력 내용을 유지한 채 열려 있다.
                      update.mutate(
                        { messageId: m.id, body },
                        { onSuccess: () => setEditingId(null) },
                      )
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
              ) : (
                <div
                  data-testid={`message-body-${m.id}`}
                  className={`text-sm whitespace-pre-wrap break-words ${
                    m.deleted ? 'italic text-muted-foreground' : ''
                  } ${isOwn ? 'rounded-2xl bg-primary/10 px-3 py-1.5' : ''}`}
                >
                  {m.deleted
                    ? '(삭제됨)'
                    : parseMessageSegments(m.body, m.mentions).map((seg, i) =>
                        seg.type === 'text' ? (
                          <span key={i}>{seg.value}</span>
                        ) : (
                          <span
                            key={i}
                            data-testid={`mention-chip-${seg.id}`}
                            className={`rounded px-1 font-medium ${
                              seg.kind === 'AGENT'
                                ? 'bg-primary/15 text-primary' // 에이전트: 브랜드 컬러 기반 시맨틱 토큰
                                : 'bg-accent text-accent-foreground' // 사용자: accent 시맨틱 토큰 (다크모드 자동 대응)
                            }`}
                          >
                            @{seg.name}
                          </span>
                        ),
                      )}
                  {/* 수정됨 표시 — 그룹 첫 줄/후속 줄 모두 노출되도록 본문 끝에 인라인 렌더(삭제됨 메시지는 제외). */}
                  {m.editedAt && !m.deleted && (
                    <span
                      aria-label="수정됨"
                      data-testid={`message-edited-${m.id}`}
                      className="ml-1 align-baseline text-xs text-muted-foreground"
                    >
                      (수정됨)
                    </span>
                  )}
                </div>
              )}

              {!m.deleted && m.attachments?.length > 0 && (
                <MessageAttachmentList channelId={channelId} attachments={m.attachments} />
              )}

              {!isEditing && (
                <div data-testid={`message-toolbar-${m.id}`} className="absolute top-0 hidden gap-0.5 group-hover:flex right-2">
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
              )}

              <ReactionBar message={m} onToggle={(emoji) => toggleReaction.mutate({ message: m, emoji })} />

              {onOpenThread && m.replyCount > 0 && (
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
              )}
            </div>
          </div>
          </Fragment>
        )
      })}
    </div>
  )
}

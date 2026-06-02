// 메시지 목록 — 최신이 위. infinite query 의 모든 페이지를 펼쳐 시간순(오래된→최신)으로 렌더.
// 본문은 <@id> 토큰을 멘션 칩으로 렌더(chat 과 동일 스타일).
// 본인(authorId === currentUserId) · 미삭제 메시지는 hover 시 수정/삭제 toolbar 노출.
// 수정 → 인라인 RichInput 에디터(chat 의 ChatMessageEditor 미러). 삭제됨 메시지는 '(삭제됨)' 마스킹.
// Phase 5: hover toolbar 에 이모지 피커 + 답글 버튼 추가. body 아래 ReactionBar + 답글수 링크.
import { MessageSquare, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { EmojiPicker } from '@/components/chat/EmojiPicker'
import { ReactionBar } from '@/components/chat/ReactionBar'
import { parseMessageSegments } from '@/components/mentions/parseMessageSegments'
import { RichInput } from '@/components/mentions/RichInput'
import type { MentionCandidate } from '@/components/mentions/types'
import { Button } from '@/components/ui/button'
import { useDeleteMessage } from '@/hooks/queries/useDeleteMessage'
import { useMarkMessageRead } from '@/hooks/queries/useMarkMessageRead'
import { useToggleReaction } from '@/hooks/queries/useToggleReaction'
import { useUpdateMessage } from '@/hooks/queries/useUpdateMessage'
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
}

export function MessageList({ messages, channelId, currentUserId, members, onOpenThread, disableMarkRead }: MessageListProps) {
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
      {ordered.map((m, idx) => {
        const isPending = m.id < 0
        // 본인·미삭제·미전송중 메시지만 toolbar 노출.
        const canEdit = m.authorId === currentUserId && !m.deleted && !isPending
        const isEditing = editingId === m.id
        const isLast = idx === ordered.length - 1

        return (
          <div
            key={m.id}
            ref={isLast ? lastRef : undefined}
            data-testid={`message-${m.id}`}
            data-pending={isPending ? 'true' : undefined}
            className="group relative rounded-md px-2 py-1"
          >
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                {m.authorName}
                {m.authorKind === 'AGENT' && ' 🤖'}
              </span>
              {m.editedAt && (
                <span aria-label="수정됨" data-testid={`message-edited-${m.id}`}>
                  (수정됨)
                </span>
              )}
            </div>

            {isEditing ? (
              // 인라인 수정 — RichInput 재사용. 저장 시 useUpdateMessage, 닫으면 편집 종료.
              <div data-testid={`message-editor-${m.id}`}>
                <RichInput
                  members={members}
                  initialBody={m.body}
                  initialMentions={m.mentions}
                  onSubmit={(body) => {
                    update.mutate({ messageId: m.id, body })
                    setEditingId(null)
                  }}
                  onCancel={() => setEditingId(null)}
                  submitLabel="저장"
                  autoFocus
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
                }`}
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
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}
                        >
                          @{seg.name}
                        </span>
                      ),
                    )}
              </div>
            )}

            {!isEditing && (
              <div className="absolute right-2 top-1 hidden gap-0.5 group-hover:flex">
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
                      onClick={() => remove.mutate(m.id)}
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
                className="mt-0.5 text-xs font-medium text-blue-600 hover:underline"
                data-testid={`message-thread-link-${m.id}`}
                onClick={() => onOpenThread(m.id)}
              >
                💬 답글 {m.replyCount}개
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

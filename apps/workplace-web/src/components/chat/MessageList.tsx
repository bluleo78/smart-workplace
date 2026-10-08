// 메시지 목록 — 최신이 위. infinite query 의 모든 페이지를 펼쳐 시간순(오래된→최신)으로 렌더.
// 본문은 <@id> 토큰을 멘션 칩으로 렌더(chat 과 동일 스타일).
// 본인(authorId === currentUserId) · 미삭제 메시지는 hover 시 수정/삭제 toolbar 노출.
// 수정 → 인라인 RichInput 에디터(chat 의 ChatMessageEditor 미러). 삭제됨 메시지는 '(삭제됨)' 마스킹.
// Phase 5: hover toolbar 에 이모지 피커 + 답글 버튼 추가. body 아래 ReactionBar + 답글수 링크.
// Task 5(대화 Phase A): 그룹핑(Slack 패턴) — 같은 작성자·5분 이내 연속 메시지는 한 묶음.
// #884: 좌/우 분리 — 행 렌더는 MessageRow. 이 목록은 그룹핑·구분선·편집 상태·뮤테이션·읽음 처리를 맡는다.
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'

import { ChatAttachmentViewerHost } from '@/components/chat/ChatAttachmentViewer'
import { DateDivider } from '@/components/chat/DateDivider'
import { MessageActionSheet } from '@/components/chat/MessageActionSheet'
import { MessageRow } from '@/components/chat/MessageRow'
import { buildMessageSheetActions, messagePreview,type MessageSheetHandlers } from '@/components/chat/messageSheetActions'
import { UnreadDivider } from '@/components/chat/UnreadDivider'
import type { MentionCandidate } from '@/components/mentions/types'
import { findChatBundle, teamChatBundle } from '@/components/viewer/viewerItems'
import { useDeleteMessage } from '@/hooks/queries/useDeleteMessage'
import { useMarkMessageRead } from '@/hooks/queries/useMarkMessageRead'
import { useProposalActions } from '@/hooks/queries/useProposalActions'
import { useToggleReaction } from '@/hooks/queries/useToggleReaction'
import { useUpdateMessage } from '@/hooks/queries/useUpdateMessage'
import { useIsTouchShell } from '@/hooks/useIsTouchShell'
import { useMessageListLongPress } from '@/hooks/useMessageListLongPress'
import { useMessageSheet } from '@/hooks/useMessageSheet'
import { useToolbarReveal } from '@/hooks/useToolbarReveal'
import { CATCHUP_TOP_ANCHOR_ID } from '@/lib/chatEntryAnchor'
import { deleteMessageWithUndo } from '@/lib/deleteWithUndo'
import { getDateKey } from '@/lib/formatters'
import { shouldStartNewGroup } from '@/lib/messageGrouping'
import type { MessageResponse } from '@/types/messaging'

/** 팀 채팅 첨부 뷰어 열림 router state 키(WP-279) — 이슈 채팅·메인 AI 채팅 키와 나눠 서로의 열림을 자기 것으로 읽지 않게. */
const TEAM_CHAT_PREVIEW_KEY = 'teamChatPreview'

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
  // WP-279: 열린 첨부 키(msg:{메시지}:…) → 이 목록에 그린 그 메시지의 묶음. 앞으로가기·드라이브에서 돌아오기 뒤에도 키만으로 다시 연다.
  const resolveAttachment = useCallback(
    (key: string) => findChatBundle(key, 'msg', messages, (m) => teamChatBundle(channelId, m)),
    [messages, channelId],
  )
  // 현재 인라인 수정 중인 메시지 id (한 번에 하나).
  const [editingId, setEditingId] = useState<number | null>(null)

  const update = useUpdateMessage(channelId)
  const remove = useDeleteMessage(channelId)
  const toggleReaction = useToggleReaction(channelId)
  // L3 위임 제안 승인/거부 뮤테이션 — 성공 시 이 채널 메시지 목록 무효화.
  const proposalActions = useProposalActions(channelId)
  // 터치 기기: 행을 탭하면 툴바 노출(hover 가 없으므로). 바깥을 탭하면 닫힌다.
  // 드러날 때마다 스크롤 영역 위 끝에 잘리는지 재서 툴바를 아래로 뒤집는다.
  const toolbarRowProps = useToolbarReveal()
  // 모바일 터치 셸: hover 툴바 대신 길게 누르기 → 작업 시트(목록에 하나).
  const touchShell = useIsTouchShell()
  const sheet = useMessageSheet(ordered)

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

  const startDelete = (m: MessageResponse) => deleteMessageWithUndo(() => remove.mutate(m.id))
  const toggle = (m: MessageResponse, emoji: string) => toggleReaction.mutate({ message: m, emoji })

  // 시트 작업 — 권한·순서는 messageSheetActions 가 정한다(툴바와 같은 규칙 + 복사).
  const sheetHandlers: MessageSheetHandlers<MessageResponse> = {
    currentUserId,
    onThread: onOpenThread ? (m) => onOpenThread(m.id) : undefined,
    onEdit: (m) => setEditingId(m.id),
    onDelete: startDelete,
  }
  // 확정 메시지는 반응 줄이 늘 있으므로 시트를 열 수 있다. 수정 중인 행은 제외(C2 — 에디터의 선택·붙여넣기 메뉴 유지).
  // 미전송(음수 id) 행은 위임 훅이 먼저 걸러낸다.
  const sheetOpenable = (m: MessageResponse) => m.id >= 0 && m.id !== editingId
  const longPress = useMessageListLongPress(
    touchShell,
    (id) => ordered.some((m) => m.id === id && sheetOpenable(m)),
    sheet.show,
  )
  const target = sheet.target

  return (
    // WP-279: 첨부 썸네일·카드 → 통합 뷰어. 호스트가 목록 div 바깥(형제)에 뷰어를 그려 길게 누르기 위임 핸들러로 이벤트가 새지 않는다.
    // 채널·DM·스레드 패널(두 목록)이 같은 키를 읽어도 클릭한 목록의 호스트만 묶음을 들고 있어 뷰어는 하나다.
    <ChatAttachmentViewerHost historyKey={TEAM_CHAT_PREVIEW_KEY} resolve={resolveAttachment}>
      {/* 모바일(lg 미만)은 좌우 여백을 줄여 말풍선·본문 폭을 확보한다(L1).
          터치 셸이면 길게 누르기를 목록 하나가 위임으로 받는다(행은 data-message-id 만 단다). 아니면 핸들러 없음. */}
      <div className="flex flex-col gap-2 p-4 max-lg:px-3" data-testid="message-list" {...longPress}>
        {ordered.length === 0 && emptyState}
        {/* 구분선이 로드된 메시지 범위 밖(전부 미읽음)일 땐 카드를 목록 상단에 렌더.
            래퍼 id 는 진입 스크롤 앵커(start 정렬) — 바닥에서 시작하면 카드가 화면 밖이 된다(WP-256). */}
        {catchupSlot != null && unreadDividerBeforeId == null && (
          <div id={CATCHUP_TOP_ANCHOR_ID}>{catchupSlot}</div>
        )}
        {ordered.map((m, idx) => {
          const isLast = idx === ordered.length - 1
          const prev = idx > 0 ? ordered[idx - 1] : null
          const startsGroup = shouldStartNewGroup(prev, m)
          // 날짜가 바뀌는 지점(또는 첫 메시지) 앞에 날짜 구분선 삽입.
          const showDateDivider = !prev || getDateKey(m.createdAt) !== getDateKey(prev.createdAt)

          return (
            <Fragment key={m.id}>
              {showDateDivider && <DateDivider date={m.createdAt} />}
              {unreadDividerBeforeId != null && m.id === unreadDividerBeforeId && (
                <>
                  <UnreadDivider />
                  {catchupSlot}
                </>
              )}
              <MessageRow
                message={m}
                channelId={channelId}
                currentUserId={currentUserId}
                members={members}
                startsGroup={startsGroup}
                isEditing={editingId === m.id}
                rowRef={isLast ? lastRef : undefined}
                rowProps={toolbarRowProps(m.id)}
                // 스크린리더용 "메시지 작업" 버튼(A1) — 길게 누르기와 같은 조건일 때만.
                onOpenActions={touchShell && sheetOpenable(m) ? () => sheet.show(m.id) : undefined}
                onOpenThread={onOpenThread}
                onStartEdit={() => setEditingId(m.id)}
                onCancelEdit={() => setEditingId(null)}
                // #124 수정: 성공 시에만 에디터 닫기. 실패 시 에디터는 입력 내용을 유지한 채 열려 있다.
                onSaveEdit={(next) =>
                  update.mutate({ messageId: m.id, body: next }, { onSuccess: () => setEditingId(null) })
                }
                onDelete={() => startDelete(m)}
                onToggleReaction={(emoji) => toggle(m, emoji)}
                proposalBusy={proposalActions.confirm.isPending || proposalActions.reject.isPending}
                onConfirmProposal={(proposalId, arg) => proposalActions.confirm.mutate({ proposalId, arg })}
                onRejectProposal={(proposalId) => proposalActions.reject.mutate(proposalId)}
              />
            </Fragment>
          )
        })}
        {touchShell && (
          <MessageActionSheet
            open={sheet.open}
            onClose={sheet.close}
            onReact={target && target.id >= 0 ? (emoji) => toggle(target, emoji) : undefined}
            actions={target ? buildMessageSheetActions(target, sheetHandlers) : []}
            preview={target ? messagePreview(target.authorName, target.body, target.mentions) : undefined}
          />
        )}
      </div>
    </ChatAttachmentViewerHost>
  )
}

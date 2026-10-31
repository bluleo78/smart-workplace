// 팀 채팅 메시지 한 행 — 작성자 쪽에 따라 두 레이아웃(#884 좌/우 분리).
//   타인·AGENT: 좌측 거터(아바타 또는 hover 시각) + 전폭 평문.
//   본인: 우측 말풍선(최대 75%, 아바타·이름 없음). 수정 중에는 전폭 에디터.
// 뮤테이션·편집 상태는 목록(MessageList)이 갖고, 이 컴포넌트는 콜백만 받아 그린다.
import { Bot, MessageSquare, MoreHorizontal, Pencil, Trash2, Users } from 'lucide-react'
import { type ComponentProps, type Ref, useCallback, useMemo, useRef, useState } from 'react'

import { MarkdownMessage } from '@/components/ai/MarkdownMessage'
import { ChatAvatar } from '@/components/chat/ChatAvatar'
import { ChatMarkdownText } from '@/components/chat/ChatMarkdownText'
import { LinkPreviewList } from '@/components/chat/LinkPreviewCard'
import { MessageActionsButton } from '@/components/chat/MessageActionsButton'
import { MessageAttachmentList } from '@/components/chat/MessageAttachmentList'
import { MessageImage } from '@/components/chat/MessageImage'
import {
  HOVER_TIME_REVEAL_CLASS,
  MESSAGE_TOOLBAR_CLASS,
  OWN_ATTACHMENTS_CLASS,
  TOOLBAR_POSITION,
  TOUCH_NO_SELECT_CLASS,
} from '@/components/chat/messageToolbar'
import { ProposalCard } from '@/components/chat/ProposalCard'
import { ReadReceipts } from '@/components/chat/ReadReceipts'
import { renderIssueKeyRef } from '@/components/issues/renderIssueKeyRef'
import { stripChatMarkdown } from '@/components/mentions/chatMarkdown'
import type { RenderMention } from '@/components/mentions/parseMessageSegments'
import { RichInput } from '@/components/mentions/RichInput'
import type { MentionCandidate } from '@/components/mentions/types'
import { EmojiPicker } from '@/components/reactions/EmojiPicker'
import { ReactionBar } from '@/components/reactions/ReactionBar'
import { useReactionFocusRestore } from '@/components/reactions/useReactionFocusRestore'
import { RowLinkMenu } from '@/components/share/RowLinkMenu'
import {
  type RowLinkMenuAnchor,
  rowLinkMenuAnchorFromButton,
  rowLinkMenuAnchorFromContextMenu,
} from '@/components/share/rowLinkMenuAnchor'
import { Button } from '@/components/ui/button'
import { teamChatBundle } from '@/components/viewer/viewerItems'
import { messageReactorSource } from '@/hooks/queries/messageReactorSource'
import { useAppHosts } from '@/hooks/queries/useAppLinks'
import { useIsTouchShell } from '@/hooks/useIsTouchShell'
import { useRestoreFocusOnExit } from '@/hooks/useRestoreFocusOnExit'
import type { ToolbarRowProps } from '@/hooks/useToolbarReveal'
import { parseAppLink, visibleAppLinks } from '@/lib/appLinks'
import { formatClockTime, formatClockTimeCompact } from '@/lib/formatters'
import { itemActionLabel } from '@/lib/itemActionLabel'
import { messageDomId } from '@/lib/messageLinkJump'
import type { ShareTarget } from '@/lib/shareTarget'
import type { ChannelReadState, MessageResponse } from '@/types/messaging'

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
  // 작업 시트 열기 — 스크린리더용 "메시지 작업" 버튼(A1)이 쓴다. 터치 셸이 아니거나 시트를 열 수 없는 행이면 미전달.
  // 길게 누르기 자체는 목록이 위임으로 판정한다(useMessageListLongPress, 행의 data-message-id).
  onOpenActions?: () => void
  // 스레드 패널 오픈. 스레드 패널 내부 렌더 시엔 미전달(스레드 버튼·답글 링크 숨김).
  onOpenThread?: (messageId: number) => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: (body: string) => void
  onDelete: () => void
  // 링크 미리보기 지우기(WP-874). 작성자 본인 확정 메시지에만 쓴다 — 데스크톱은 카드 ✕, 터치 셸은 작업 시트가 맡는다.
  onDismissPreviews: () => void
  onToggleReaction: (emoji: string) => void
  // 반응자 전체 보기 열기(WP-106) — 호버 카드의 모두 보기·툴바의 반응한 사람 보기. 목록(MessageList)이 오버레이 상태를 가진다.
  onOpenReactors: (emoji: string) => void
  proposalBusy: boolean
  onConfirmProposal: (proposalId: number, arg: ProposalConfirmArg) => void
  onRejectProposal: (proposalId: number) => void
  // 보관된 채널 등 읽기 전용(WP-508) — 리액션 추가·토글, 수정·삭제를 숨긴다. 스레드 보기·반응한 사람 보기는 남긴다.
  readOnly?: boolean
  // DM 읽음 표시(WP-1176) — 이 내 메시지까지 읽은 사람들. 비었거나 없으면 그리지 않는다. 본인 말풍선 아래에만 그린다.
  readers?: ChannelReadState[]
  // 이 메시지의 링크 대상을 만든다(WP-1236) — 있으면 데스크톱 툴바 ⋯·우클릭이 「링크 복사·채팅·이슈로 보내기」 메뉴를 연다.
  // 메뉴를 열 때만 부른다(본문 멘션 풀이를 행마다 하지 않게). 이슈 챗 등 링크가 없는 목록은 미전달.
  linkTarget?: () => ShareTarget
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
  onOpenActions,
  onOpenThread,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onDismissPreviews,
  onToggleReaction,
  onOpenReactors,
  proposalBusy,
  onConfirmProposal,
  onRejectProposal,
  readOnly = false,
  readers,
  linkTarget,
}: MessageRowProps) {
  const isPending = m.id < 0
  // 본인 메시지 여부 — 정렬(우측 말풍선)과 편집/삭제 권한 판정에 쓴다.
  const isOwn = m.authorId === currentUserId
  // 본인·미삭제·미전송중 메시지만 수정/삭제 노출.
  const canEdit = !readOnly && isOwn && !m.deleted && !isPending
  // 우리 앱 링크 카드(WP-896) — 보낸 사람이 미리보기를 지웠으면 함께 감춘다. 같은 본문은 appLinksOf 캐시가 같은 배열을 돌려준다.
  const appHosts = useAppHosts()
  const appLinks = visibleAppLinks(m, appHosts)
  // 앱 카드로 그리는 주소의 외부 미리보기는 뺀다 — 서버가 공개 웹 주소를 몰라(설정 누락) 앱 껍데기 OG 카드를 만들었어도 카드가 겹치지 않게.
  const ogPreviews = useMemo(
    () => (m.linkPreviews ?? []).filter((p) => !parseAppLink(p.url, appHosts)),
    [m.linkPreviews, appHosts],
  )

  // 본인 메시지는 우측 말풍선. 수정 중에는 에디터가 말풍선 폭(75%)에 눌리지 않도록 전폭 레이아웃으로 빠진다.
  const ownBubble = isOwn && !isEditing

  // 멘션 칩 — 사람 글·AI 글이 같은 모양을 쓴다(WP-1009).
  // useCallback: MarkdownMessage 가 칩 렌더러로 components 를 만들므로, 매 렌더 새 함수면 칩·링크가 다시 마운트된다.
  const renderMention = useCallback<RenderMention>(
    (seg, key) => (
      <span
        key={key}
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
    [ownBubble],
  )

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

  // 수정을 끝내면(Esc 취소·저장) 편집기와 함께 툴바가 사라져 있어 포커스가 body 로 빠졌다 — 「수정」 버튼으로 돌린다(WP-813).
  const editButtonRef = useRef<HTMLButtonElement | null>(null)
  useRestoreFocusOnExit(isEditing, editButtonRef)

  // 내 반응만 있던 칩을 취소해 칩이 사라지면 같은 메시지의 다음 칩·「이모지 추가」로 포커스를 잇는다(WP-830).
  // 행 요소는 목록이 넘긴 rowRef(마지막 행 스크롤용)와 함께 잡는다.
  const hostRef = useRef<HTMLDivElement | null>(null)
  useReactionFocusRestore(hostRef, m.reactions)
  const setRowRef = useCallback(
    (node: HTMLDivElement | null) => {
      hostRef.current = node
      assignRef(rowRef, node)
    },
    [rowRef],
  )

  // 모바일 터치 셸 — hover 툴바를 그리지 않고, 길게 누르면 목록이 가진 작업 시트가 열린다.
  const touchShell = useIsTouchShell()
  // 링크 메뉴(WP-1236) — 데스크톱 툴바 ⋯·우클릭. 확정·미삭제 메시지만(전송 중 메시지는 아직 주소가 없다). 터치 셸은 길게 누르기 시트가 맡는다.
  const [linkMenuAt, setLinkMenuAt] = useState<RowLinkMenuAnchor | null>(null)
  const linkMenuTarget = !touchShell && !isPending && !m.deleted ? linkTarget : undefined

  // 터치 셸에선 툴바 자체를 그리지 않는다 — 같은 작업은 길게 누르기 시트가 맡는다(탭 한 번으로 툴바가 뜨던 #884 터치 경로 대체).
  const toolbar = !isEditing && !touchShell && (
    <div
      data-testid={`message-toolbar-${m.id}`}
      data-message-toolbar=""
      className={`${toolbarPosition} ${MESSAGE_TOOLBAR_CLASS}`}
    >
      {/* 낙관적 미확정 메시지(id<0)엔 리액션 불가 — 음수 id 로 POST 하면 실패하므로 숨김. 삭제된 메시지도 서버가 새 리액션을 거절한다(WP-665). */}
      {!isPending && !readOnly && !m.deleted && (
        <EmojiPicker
          testIdPrefix={`message-${m.id}`}
          onPick={onToggleReaction}
        />
      )}
      {/* 반응한 사람 보기(WP-106) — 호버 카드 안 링크는 키보드로 닿지 않고(Radix 가 tabindex=-1), 넓은 터치 기기엔 호버가 없어
          툴바(키보드 포커스·터치 탭으로 드러남)에 같은 경로를 둔다. 첫 이모지 탭으로 연다. 반응이 있는 확정 메시지만. */}
      {!isPending && m.reactions.length > 0 && (
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          aria-label="반응한 사람 보기"
          title="반응한 사람 보기"
          data-testid={`message-reactors-${m.id}`}
          onClick={() => onOpenReactors(m.reactions[0].emoji)}
        >
          <Users className="h-3 w-3" />
        </Button>
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
            ref={editButtonRef}
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            aria-label={itemActionLabel(stripChatMarkdown(m.body), '메시지', '수정')}
            data-testid={`message-edit-${m.id}`}
            onClick={onStartEdit}
          >
            <Pencil className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            aria-label={itemActionLabel(stripChatMarkdown(m.body), '메시지', '삭제')}
            data-testid={`message-delete-${m.id}`}
            onClick={onDelete}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </>
      )}
      {linkMenuTarget && (
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          aria-label="더 보기"
          title="더 보기"
          aria-haspopup="menu"
          data-testid={`message-more-${m.id}`}
          onClick={(e) => setLinkMenuAt(rowLinkMenuAnchorFromButton(e.currentTarget))}
        >
          <MoreHorizontal className="h-3 w-3" />
        </Button>
      )}
    </div>
  )

  const body = isEditing ? (
    // 인라인 수정 — RichInput 재사용. 저장 시 useUpdateMessage, 닫으면 편집 종료.
    <div data-testid={`message-editor-${m.id}`}>
      <RichInput
        ariaLabel="메시지 수정"
        members={members}
        initialBody={m.body}
        initialMentions={m.mentions}
        onSubmit={onSaveEdit}
        onCancel={onCancelEdit}
        submitLabel="저장"
        autoFocus
        disableWhenEmpty
        // 서식 입력(WP-101) — 작성창과 같은 서식 도구·단축키. 본문 마크다운을 서식으로 복원해 편집한다.
        formatting
        // 작성 입력창과 같은 서버 상한(4000자) — 넘으면 카운터를 보이고 저장을 막는다(WP-513).
        maxLength={4000}
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
      className={`text-sm break-words whitespace-pre-wrap ${
        // 본인: 말풍선. 삭제된 메시지는 색 없는 점선 테두리로 자리를 유지한다.
        // wrap-anywhere: 공백 없는 긴 문자열도 말풍선 안에서 끊어 min-content 폭을 줄인다(가로 스크롤 방지).
        ownBubble ? `wrap-anywhere rounded-2xl px-3 py-1.5 ${m.deleted ? 'border border-dashed' : 'bg-primary/10'}` : ''
      } ${m.deleted ? 'italic text-muted-foreground' : ''}`}
    >
      {m.deleted ? (
        '(삭제됨)'
      ) : m.authorKind === 'AGENT' ? (
        // #356: AI(에이전트) 메시지는 마크다운 렌더. 멘션은 사람 글과 같은 칩(WP-1009).
        <MarkdownMessage mentions={m.mentions} renderMention={renderMention} renderIssueRef={renderIssueKeyRef}>{m.body}</MarkdownMessage>
      ) : (
        // 사람 메시지 — 채팅 마크다운 부분집합(굵게·목록·코드 등, WP-101). 서식 없는 예전 평문은 예전과 같게 보인다.
        // 본문 URL 은 새 탭 링크(WP-874), 멘션 토큰은 칩, 평문 이슈 키는 이슈 링크 + 미리보기(WP-1237).
        <ChatMarkdownText body={m.body} mentions={m.mentions} linkTestId="chat-link" renderMention={renderMention} renderIssueRef={renderIssueKeyRef} />
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
      {/* 링크 미리보기 카드(WP-874) — 본문(본인은 말풍선) 안 아래. 삭제·미전송 메시지엔 없다.
          ✕ 는 작성자 본인·데스크톱만(터치 셸은 작업 시트의 「미리보기 지우기」). */}
      {/* 수정 중엔 숨긴다 — 본문이 바뀌면 다시 계산될 낡은 카드와, 누르면 영구히 지우는 ✕ 를 에디터 옆에 두지 않는다.
          (지금 구조에선 수정 중이면 이 본문 블록 대신 에디터를 그리지만, 블록이 바뀌어도 지켜지게 조건으로 둔다.) */}
      {!m.deleted && !isPending && !isEditing && (
        <LinkPreviewList
          messageId={m.id}
          previews={ogPreviews}
          appLinks={appLinks}
          onDismiss={canEdit && !touchShell ? onDismissPreviews : undefined}
        />
      )}
    </div>
  )

  // #80: driveLinks 도 MessageAttachmentList 에서 함께 렌더. 팀 채팅 뷰어 어댑터·이미지 렌더 주입(WP-279).
  // 미확정 메시지(id<0)는 서버 경로가 없어 열지 않는다(어댑터를 넘기지 않음).
  const attachments = !m.deleted &&
    ((m.attachments?.length ?? 0) > 0 || (m.driveLinks?.length ?? 0) > 0) && (
      <MessageAttachmentList
        attachments={m.attachments ?? []}
        driveLinks={m.driveLinks ?? []}
        bundle={isPending ? undefined : () => teamChatBundle(channelId, m)}
        renderImage={(a, onOpen) => <MessageImage channelId={channelId} attachment={a} onOpen={onOpen} />}
      />
    )

  // 반응 칩 — 메시지 아래, 메시지와 같은 쪽 정렬(위는 작업 툴바, 아래는 결과).
  const reactions = (
    <ReactionBar
      target={m}
      source={messageReactorSource(m.id)}
      align={isOwn ? 'end' : 'start'}
      currentUserId={currentUserId}
      onToggle={onToggleReaction}
      // 삭제된 메시지에 남은 칩은 보여 주기만 한다 — 누르면 새로 다는 경우 서버가 거절한다(WP-665).
      readOnly={readOnly || m.deleted}
      // 터치 셸은 호버 카드를 쓰지 않는다 — 길게 누르기 위임이 칩에서 반응자 시트를 연다.
      onOpenReactors={touchShell ? undefined : onOpenReactors}
    />
  )

  const threadLink = onOpenThread && m.replyCount > 0 && (
    <button
      type="button"
      // 「답글 N개」는 16px 높이라 터치에서는 버튼 자체를 24px 로 키운다(WP-734). 보이지 않는 ::after 로 위로 넓히면 바로 위 본문의
      // 멘션 칩을 탭해도 브라우저 터치 보정이 이 링크로 옮겨 스레드가 열린다 — 아래로만 자리를 더 쓴다.
      className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline pointer-coarse:min-h-6"
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
    <>
      <div
        ref={setRowRef}
        // 메시지 링크(?message)의 진입 앵커 — useStickToBottom 이 id 로 찾는다(WP-1236).
        id={messageDomId(m.id)}
        data-testid={`message-${m.id}`}
        data-pending={isPending ? 'true' : undefined}
        data-group-start={startsGroup ? 'true' : 'false'}
        data-own={isOwn ? 'true' : 'false'}
        // 목록 위임 길게 누르기의 대상 표식. 수정 중에도 단다 — 에디터 안 길게 누르기가 작업 시트를 여는 것은 목록의 canOpen(수정 중 false)이
        // 막고(C2), 에디터 밖 반응 칩은 반응자 시트를 열 수 있어야 하기 때문이다(WP-106).
        data-message-id={m.id}
        {...rowProps}
        onContextMenu={
          linkMenuTarget && !isEditing
            ? (e) => {
                const at = rowLinkMenuAnchorFromContextMenu(e)
                if (!at) return
                e.preventDefault()
                setLinkMenuAt(at)
              }
            : undefined
        }
        className={`group relative flex gap-2 rounded-md px-2 hover:bg-accent/40 ${startsGroup ? 'mt-2 pt-0.5' : ''} ${
          ownBubble ? 'justify-end' : ''
        } ${
          // 터치 셸: 선택·콜아웃 억제(이유는 TOUCH_NO_SELECT_CLASS 주석). 수정 중인 행은 풀어 둔다(C2).
          touchShell && !isEditing ? TOUCH_NO_SELECT_CLASS : ''
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
            {/* 모바일(lg 미만)은 화면이 좁아 75% 면 한 줄 글자 수가 너무 적다 — 85% 로 넓힌다(L1). */}
            <div className="flex min-w-0 max-w-[75%] max-lg:max-w-[85%] flex-col items-end">
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
              {readers && <ReadReceipts readers={readers} />}
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
        {onOpenActions && <MessageActionsButton onOpen={onOpenActions} />}
      </div>
      {/* 링크 메뉴는 행 밖(형제)에, 열린 동안만 둔다 — 포털 안 클릭·우클릭도 React 트리로는 행 핸들러(우클릭·탭 툴바)에 올라온다.
          행마다 메뉴를 늘 마운트하지 않게(목록 50줄 = 메뉴 50개) 열 때만 그린다. */}
      {linkMenuTarget && linkMenuAt && (
        <RowLinkMenu target={linkMenuTarget()} anchor={linkMenuAt} onClose={() => setLinkMenuAt(null)} testId={`message-link-menu-${m.id}`} />
      )}
    </>
  )
}

/** 목록이 넘긴 ref(객체·함수 모두)에 행 요소를 넣는다 — 행이 자기 ref 와 함께 잡을 때 쓴다. */
function assignRef(ref: Ref<HTMLDivElement> | undefined, node: HTMLDivElement | null) {
  if (typeof ref === 'function') ref(node)
  else if (ref) ref.current = node
}

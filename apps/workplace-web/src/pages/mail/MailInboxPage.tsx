import { useQueryClient } from '@tanstack/react-query'
import { Archive, Check, CheckCheck, FolderInput, Forward, Inbox, Loader2, Mail, MailOpen, MailX, Moon, Paperclip, RefreshCw, Reply, ReplyAll, Search, Sparkles, Sun, Trash2 } from 'lucide-react'
import { type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { AiContent } from '@/components/ai/AiContent'
import { AiSignalBadge } from '@/components/ai/AiSignalBadge'
import { AiSummarySkeleton } from '@/components/ai/AiSummarySkeleton'
import { MessageActionSheet, type MessageSheetAction } from '@/components/chat/MessageActionSheet'
import { Breadcrumb } from '@/components/layout/Breadcrumb'
import { Page } from '@/components/layout/Page'
import { ResourceErrorState } from '@/components/layout/ResourceErrorState'
import { useHideTabBar } from '@/components/mobile/MobileChromeContext'
import { MobileEmptyState } from '@/components/mobile/MobileEmptyState'
import { CopyLinkButton } from '@/components/share/CopyLinkButton'
import { RowLinkMenu } from '@/components/share/RowLinkMenu'
import { type RowLinkMenuAnchor, rowLinkMenuAnchorFromContextMenu } from '@/components/share/rowLinkMenuAnchor'
import { rowLinkActions } from '@/components/share/shareSheetActions'
import { ShareSheetButton } from '@/components/share/ShareSheetButton'
import { useRegisterShareTarget } from '@/components/share/useRegisterShareTarget'
import { Button } from '@/components/ui/button'
import { LoadMoreFooter } from '@/components/ui/load-more-footer'
import { useAiAvailable } from '@/hooks/useAiAvailable'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useHistoryParam } from '@/hooks/useHistoryParam'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useIsTouchShell } from '@/hooks/useIsTouchShell'
import { useMailDarkHtml } from '@/hooks/useMailDarkHtml'
import { useMarkReadOnOpen } from '@/hooks/useMarkReadOnOpen'
import { useMessageListLongPress } from '@/hooks/useMessageListLongPress'
import { useMessageSheet } from '@/hooks/useMessageSheet'
import { useSearchDraft } from '@/hooks/useSearchDraft'
import { handleApiError } from '@/lib/api-error'
import { appUrl, mailMessagePath } from '@/lib/appUrl'
import { formatDateTime, formatFileSize, formatRelativeTime } from '@/lib/formatters'
import { hasOpenMark, parseId } from '@/lib/historyParam'
import { forwardAttachments } from '@/lib/mailComposeAttachments'
import { folderRangeDays } from '@/lib/mailFolders'
import { markSeenInKept, mergeKeptRows, withOpenRow } from '@/lib/mailKeepRows'
import { serverOlderFolder } from '@/lib/mailListPages'
import { formatReceivedAt } from '@/lib/mailListTime'
import { type MailMoveAvailability, mailMoveAvailability, type MailMoveTargetOption, mailMoveTargets, mailMoveToastMessage } from '@/lib/mailMoveActions'
import { scheduleMailMove, useMailMoveHidden } from '@/lib/mailMoveQueue'
import { isNeedsReply } from '@/lib/mailNeedsReply'
import { buildQuote, plainTextToMailHtml } from '@/lib/mailQuote'
import { replyAllCc } from '@/lib/mailRecipients'
import { mailSubjectText } from '@/lib/mailSubject'
import { firstSummaryLine } from '@/lib/mailSummary'
import { mailBreadcrumbItems, mailBreadcrumbText, mailViewHref, resolveMailView, unreadCountForView } from '@/lib/mailView'
import { SELECTED_BG_CLASS, TOGGLE_ON_CLASS } from '@/lib/selectionStyles'
import type { ShareTarget } from '@/lib/shareTarget'
import { cn } from '@/lib/utils'

import { getMessage, getViewUnreadCount, type MailViewScope } from '../../api/mailMessages'
import { FileTypeIcon } from '../../components/drive/FileTypeIcon'
import { MailCalendarInviteCard } from '../../components/mail/MailCalendarInviteCard'
import { type ComposeDraft,useMailCompose } from '../../components/mail/MailComposeContext'
import { MailMarkAllReadDialog } from '../../components/mail/MailMarkAllReadDialog'
import { MailMoveMenu, MailMoveTargetSheet } from '../../components/mail/MailMoveMenu'
import { SandboxedHtmlFrame } from '../../components/SandboxedHtmlFrame'
import { mailAttachmentMime, mailAttachmentName } from '../../components/viewer/viewerItems'
import { splitName } from '../../components/viewer/viewerNav'
import { mailMessageKeys } from '../../hooks/queries/mailMessageKeys'
import { useMailAccounts } from '../../hooks/queries/useMailAccounts'
import {
  useFetchOlderMail,
  useGenerateMailSummary,
  useInlineMailHtml,
  useIssueDraft,
  useLinkedIssue,
  useMailFolders,
  useMailMessage,
  useMailMessages,
  useMailMessageSeen,
  useMailSummary,
  useMarkAllRead,
  useReplyDraft,
  useSyncMailbox,
  useSyncMailFolder,
  useSyncStatus,
  useToggleRead,
  useUnreadCounts,
} from '../../hooks/queries/useMailMessages'
import type { MailMoveTarget, MailServerFolder } from '../../types/mailFolder'
import type { EmailAttachmentMeta, EmailMessageDetail, EmailMessageSummary, MailCategory, MailFolder, MailIssueDraft } from '../../types/mailMessage'
import { MailDraftsPage } from './MailDraftsPage'
import { MAIL_DETAIL_PARAM } from './mailHistory'
import { MailMobileDetail, MailMobileDetailBar, MailMobileSummaryButton } from './MailMobileDetail'
import { MailToIssueDialog } from './MailToIssueDialog'
import { useMailAttachmentViewer } from './useMailAttachmentViewer'
import { useMailScreenContext } from './useMailScreenContext'

// 목록 로딩 중 시트·길게 누르기에 넘길 빈 목록 — 렌더마다 새 배열을 만들지 않게 모듈에 하나만 둔다.
const EMPTY_MESSAGES: EmailMessageSummary[] = []

/** WP-962 한 메일에 대한 보관·옮기기·삭제 — 목록 행·상세가 같은 묶음을 받는다. */
interface MailMoveActions {
  avail: MailMoveAvailability
  targets: readonly MailMoveTargetOption[]
  onArchive: () => void
  onTrash: () => void
  onMove: (target: MailMoveTarget) => void
}

/** 행 hover 아이콘 버튼 공통 모양 — 읽음 전환 버튼과 같은 크기·테두리. */
const ROW_ICON_BUTTON_CLASS =
  'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40'

/** 메일 한 통의 링크 대상(WP-1236) — 목록 줄 길게 누르기·우클릭이 쓴다. 상세의 대상(MailDetail)과 같은 주소·이름. */
function mailShareTarget(accountId: number, m: Pick<EmailMessageSummary, 'id' | 'subject'>): ShareTarget {
  return { kind: 'mail', url: appUrl(mailMessagePath(accountId, m.id)), title: mailSubjectText(m.subject) }
}

/**
 * WP-962 목록 행 hover 작업(데스크톱) — 보관 · 옮기기(메뉴) · 삭제. 읽음 전환 버튼 왼쪽에 둔다. 평소에는 폭 0 으로 접어 자리를
 * 차지하지 않고(보낸사람 이름이 줄지 않게), hover·키보드 포커스·메뉴가 열린 동안에만 펼친다. display 가 아니라 폭으로 접어 탭 순서에 남는다
 * (Tab 으로 들어오면 focus-within 으로 펼쳐진다).
 * 행 열기와 분리하려고 클릭·키 입력을 멈춘다. 터치(coarse) 태블릿에선 숨은 채 탭이 닿지 않게 pointer-events 를 끈다(WP-237).
 */
function MailRowMoveActions({ id, actions }: { id: number; actions: MailMoveActions }) {
  const stop = { onClick: (e: ReactMouseEvent) => e.stopPropagation(), onKeyDown: (e: ReactKeyboardEvent) => e.stopPropagation() }
  return (
    <span
      data-testid={`mail-row-move-actions-${id}`}
      className="flex w-0 shrink-0 items-center gap-1 overflow-hidden opacity-0 group-hover:w-auto group-hover:opacity-100 focus-within:w-auto focus-within:opacity-100 has-[[data-state=open]]:w-auto has-[[data-state=open]]:opacity-100 pointer-coarse:pointer-events-none"
      {...stop}
    >
      {actions.avail.archive && (
        <button
          type="button"
          data-testid={`mail-row-archive-${id}`}
          aria-label="보관"
          title="보관"
          onClick={actions.onArchive}
          className={ROW_ICON_BUTTON_CLASS}
        >
          <Archive className="h-3.5 w-3.5" />
        </button>
      )}
      {actions.avail.move && (
        <MailMoveMenu
          targets={actions.targets}
          onPick={actions.onMove}
          trigger={
            <button type="button" data-testid={`mail-row-move-${id}`} aria-label="옮기기" title="옮기기" className={ROW_ICON_BUTTON_CLASS}>
              <FolderInput className="h-3.5 w-3.5" />
            </button>
          }
        />
      )}
      {actions.avail.trash && (
        <button
          type="button"
          data-testid={`mail-row-trash-${id}`}
          aria-label="삭제"
          title="삭제"
          onClick={actions.onTrash}
          // 삭제는 위험 색(디자인 시스템 07 — 위험/삭제 아이콘 text-destructive). 행 hover 묶음 안이라 평소엔 보이지 않는다.
          className={cn(ROW_ICON_BUTTON_CLASS, 'text-destructive hover:text-destructive')}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  )
}

// 목록 한 행 — 안 읽음은 굵게, 첨부 클립 표시.
function MessageRow({
  m,
  open,
  sheetTarget,
  onSelect,
  pendingVisible,
  aiSignalsVisible,
  showToggle,
  onToggleRead,
  moveActions,
  linkTarget,
}: {
  m: EmailMessageSummary
  /** 읽기 창에 열린 메일인가 — 선택 배경 + aria-current. */
  open: boolean
  /** 길게 누르기 시트의 대상인가 — 어느 메일에 대한 작업인지 선택 배경으로 강조만 하고, 열린 것으로 알리지는 않는다(M4). */
  sheetTarget: boolean
  onSelect: () => void
  /** "분류 전" 배지 노출 여부 — 받은편지함 계열이고 AI 분류가 켜진 계정일 때만. */
  pendingVisible: boolean
  /** AI 분류·답장필요 배지 노출 — 서버 메일함 보기(WP-961)는 받은편지함 AI 분석 대상이 아니라 끈다. */
  aiSignalsVisible: boolean
  /** WP-187 hover 읽음 전환 버튼 노출 — 터치 셸에는 hover 가 없어 렌더하지 않는다(길게 누르기 시트가 담당). */
  showToggle: boolean
  /** WP-187 읽음↔안읽음 전환(행 열기와 별개). */
  onToggleRead: () => void
  /** WP-962 hover 보관·옮기기·삭제 — 터치 셸·보낸편지함에선 없다(null). 터치는 길게 누르기 시트가 맡는다. */
  moveActions: MailMoveActions | null
  /** 우클릭 링크 메뉴의 대상을 만든다(WP-1236) — 데스크톱만(터치 셸은 길게 누르기 시트가 맡는다). 메뉴를 열 때만 부른다. */
  linkTarget?: () => ShareTarget
}) {
  const navigate = useNavigate()
  const [linkMenuAt, setLinkMenuAt] = useState<RowLinkMenuAnchor | null>(null)
  // WP-146: 회신필요 판정은 행마다 한 번만 계산. 서버 메일함 보기에서는 AI 배지를 모두 끈다(WP-961).
  const needsReply = aiSignalsVisible && isNeedsReply(m)
  const aiCategory = aiSignalsVisible ? m.aiCategory : null
  return (
    // div role="button" — 내부 AiSignalBadge 가 실제 <button>이므로 바깥을 <button>으로
    // 감싸면 버튼 중첩(HTML 유효성 위반 + a11y 위험, #577)이 발생해 카드형 클릭 영역 패턴으로 전환.
    <>
      <div
        role="button"
        tabIndex={0}
        data-testid={`mail-row-${m.id}`}
        // WP-187: 길게 누르기 등 행 단위 위임 처리에서 메시지 id 를 찾기 위한 표식.
        data-message-id={m.id}
        // a11y(#699): 발신자+제목만으로 accessible name 구성 — 스니펫/AI배지/날짜까지
        // 자식 텍스트가 섞이면 장문화되어 SR 청취성 저하(WCAG 1.3.1/4.1.2). 날짜는
        // 식별에 필수가 아니므로 간결함 우선으로 제외.
        aria-label={`${m.fromName || m.fromAddress || '(보낸사람 없음)'} ${mailSubjectText(m.subject)}`}
        aria-current={open ? 'true' : undefined}
        onClick={onSelect}
        onContextMenu={
          linkTarget
            ? (e) => {
                const at = rowLinkMenuAnchorFromContextMenu(e)
                if (!at) return
                e.preventDefault()
                setLinkMenuAt(at)
              }
            : undefined
        }
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelect()
          }
        }}
        className={cn(
          // group — 안의 읽음 전환 버튼을 행 hover 에 맞춰 드러낸다(WP-187).
          'group relative flex w-full cursor-pointer flex-col gap-0.5 border-b px-4 py-3 text-left transition-colors',
          // 선택은 배경만 — 막대는 안 읽음 표시(아래, 같은 자리·같은 색)와 겹치고, 굵기도 안 읽음 표시라 둘 다 쓰지 않는다.
          open || sheetTarget ? SELECTED_BG_CLASS : 'hover:bg-accent/50',
        )}
      >
        {/* WP-155: 안 읽음은 굵기만으로는 훑어볼 때 잘 안 보여 왼쪽 primary 막대로 보강.
            글자색은 바꾸지 않는다(AI 배지 색과 경쟁 방지). 장식이라 SR 에서 제외. */}
        {!m.seen && (
          <span
            aria-hidden="true"
            data-testid={`mail-unread-bar-${m.id}`}
            className="absolute inset-y-0 left-0 w-[3px] bg-primary"
          />
        )}
        <span className="flex items-center gap-2">
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-sm',
              m.seen ? 'text-foreground' : 'font-semibold',
            )}
          >
            {m.fromName || m.fromAddress || '(보낸사람 없음)'}
          </span>
          {m.hasAttachment && <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          {moveActions && <MailRowMoveActions id={m.id} actions={moveActions} />}
          {showToggle && (
            // WP-187: hover 시 읽음/안읽음 전환 — 행 열기와 분리(stopPropagation).
            // display 대신 opacity 로 숨겨 탭 순서에 남긴다 — 키보드 포커스 시에도 드러난다(접근성).
            // onKeyDown 도 멈춘다 — 행의 Enter/Space 처리(preventDefault)가 버튼 키보드 활성화를 삼키지 않게.
            // WP-237: 터치(coarse) ≥1024 태블릿에선 숨은 채로 남으므로 탭이 닿지 않게 pointer-events 를 끈다 — 탭은 행 열기로 간다.
            // (휴대폰 폭은 showToggle=false 로 아예 렌더 안 함. 읽음 전환은 메일 열기·상세 툴바로 대신한다.)
            <button
              type="button"
              data-testid={`mail-row-toggle-read-${m.id}`}
              aria-label={m.seen ? '안 읽음으로 표시' : '읽음으로 표시'}
              title={m.seen ? '안 읽음으로 표시' : '읽음으로 표시'}
              onClick={(e) => {
                e.stopPropagation()
                onToggleRead()
              }}
              onKeyDown={(e) => e.stopPropagation()}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground opacity-0 outline-none transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/40 group-hover:opacity-100 pointer-coarse:pointer-events-none"
            >
              {m.seen ? <Mail className="h-3.5 w-3.5" /> : <MailOpen className="h-3.5 w-3.5" />}
            </button>
          )}
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatReceivedAt(m.receivedAt)}
          </span>
        </span>
        <span className={cn('truncate text-sm', m.seen ? 'text-muted-foreground' : 'font-medium')}>
          {mailSubjectText(m.subject)}
        </span>
        {m.snippet && (
          <span
            data-testid={`mail-snippet-${m.id}`}
            // a11y(#699): 시각적으로는 유지하되 행 accessible name(aria-label)에 중복 포함되지
            // 않도록 SR 에서 제외.
            aria-hidden="true"
            className="truncate text-xs text-muted-foreground"
          >
            {m.snippet}
          </span>
        )}
        {/* WP-146: 회신필요 = AI 판정 && 안 읽음 — 읽으면 배지 숨김. 분류 배지는 클릭 필터. */}
        {(aiCategory || needsReply || (pendingVisible && m.categoryPending)) && (
          <span className="mt-0.5 flex items-center gap-1">
            {/* AI 분류 배지 — 클릭 시 해당 분류 필터로 이동(onClick + stopPropagation 으로 행 선택과 분리). */}
            {aiCategory && (
              <AiSignalBadge
                variant="info"
                data-testid={`mail-badge-category-${m.id}`}
                onClick={(e) => {
                  e.stopPropagation()
                  navigate(mailViewHref(m.accountId, aiCategory as MailCategory, false))
                }}
              >
                {aiCategory}
              </AiSignalBadge>
            )}
            {pendingVisible && m.categoryPending && (
              // WP-186: 아직 분류를 시도하지 않은 메일 — 업무 보기에 섞여 있는 이유를 알려 주는 점선 배지(클릭 없음).
              <span
                data-testid={`mail-badge-pending-${m.id}`}
                className="rounded-full border border-dashed border-muted-foreground/50 px-2 py-0.5 text-xs leading-4 text-muted-foreground dark:border-muted-foreground/70"
              >
                분류 전
              </span>
            )}
            {/* 회신필요 배지 — action 변형으로 사용자 행동 필요를 강조. 읽으면 숨김. */}
            {needsReply && (
              <AiSignalBadge variant="action" data-testid={`mail-badge-needsreply-${m.id}`}>
                답장필요
              </AiSignalBadge>
            )}
          </span>
        )}
      </div>
      {/* 행 밖(형제)에 둔다 — 포털 안 클릭도 React 트리로는 행에 올라와 행 열기(onClick)가 함께 불린다. */}
      {/* 열린 동안만 그린다 — 줄마다 메뉴를 늘 마운트하지 않게. */}
      {linkTarget && linkMenuAt && (
        <RowLinkMenu target={linkTarget()} anchor={linkMenuAt} onClose={() => setLinkMenuAt(null)} testId={`mail-row-link-menu-${m.id}`} />
      )}
    </>
  )
}

/**
 * WP-961 서버 메일함 상태 줄 — 「최근 N일 · M분 전에 가져옴」 + 새로 고침 + 더 가져오기(앞의 90일).
 * 기간은 가져온 시각과 가장 오래된 경계의 차이라 더 가져올 때마다 늘어난다. 처음 가져오는 동안은 「메일함을 가져오는 중…」.
 * 메일함 목록을 아직 못 받았거나 열 수 없는 메일함이면 버튼을 끈다.
 */
function MailFolderStatusRow({
  folder,
  missing,
  syncing,
  olderSyncing,
  onRefresh,
  onFetchOlder,
}: {
  folder: MailServerFolder | undefined
  /** 메일함 목록은 받았는데 이 id 가 없다(지워진 메일함·옛 링크) — 「가져오는 중」에 머물지 않게 따로 알린다. */
  missing: boolean
  syncing: boolean
  olderSyncing: boolean
  onRefresh: () => void
  onFetchOlder: () => void
}) {
  const at = folder?.folderSyncedAt ?? null
  const days = folder ? folderRangeDays(folder) : null
  const text = missing
    ? '메일함을 찾을 수 없어요'
    : at
    ? `${days != null ? `최근 ${days}일 · ` : ''}${formatRelativeTime(at)}에 가져옴`
    : syncing || !folder
      ? '메일함을 가져오는 중…'
      : '아직 가져오지 않았어요'
  const disabled = syncing || !folder?.selectable
  return (
    <div data-testid="mail-box-status" className="flex items-center gap-2 border-b py-1.5 pl-4 pr-3 text-xs text-muted-foreground">
      <span data-testid="mail-box-status-text" title={at ? formatDateTime(at) : undefined} className="min-w-0 flex-1 truncate">
        {text}
      </span>
      <button
        type="button"
        data-testid="mail-box-refresh"
        aria-label="메일함 새로 고침"
        title="메일함 새로 고침"
        onClick={onRefresh}
        disabled={disabled}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md outline-none hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 max-lg:h-10 max-lg:w-10"
      >
        <RefreshCw className={cn('h-4 w-4', syncing && !olderSyncing && 'animate-spin')} />
      </button>
      <button
        type="button"
        data-testid="mail-box-older"
        onClick={onFetchOlder}
        disabled={disabled}
        className="relative inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-foreground outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 max-lg:h-9 max-lg:px-4 max-lg:text-sm"
      >
        {olderSyncing && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
        더 가져오기
      </button>
    </div>
  )
}

function withPrefix(prefix: string, subject: string | null): string {
  const s = subject ?? ''
  return s.toLowerCase().startsWith(prefix.toLowerCase()) ? s : `${prefix} ${s}`
}

/**
 * 답장·전체답장 작성 초안. 전체답장 참조는 원본 받는사람·참조에서 나(selfAddress)와 보낸 사람을 뺀 나머지 —
 * 따옴표 안 쉼표를 지키며 사람 단위로 나눈다(WP-400).
 */
function buildReplyDraft(detail: EmailMessageDetail, all: boolean, accountId: number, selfAddress: string): ComposeDraft {
  return {
    mode: 'reply',
    accountId,
    to: detail.fromAddress ? [detail.fromAddress] : [],
    cc: all ? replyAllCc(detail.toAddresses, detail.ccAddresses, selfAddress, detail.fromAddress) : [],
    bcc: [],
    subject: withPrefix('Re:', detail.subject),
    initialHtml: '',
    // 인용문은 에디터 밖 raw HTML/text 로 보관 — AI 개선본 교체(setContent)가 지우지 않는다.
    quote: buildQuote(detail, 'reply'),
    inReplyToMessageId: detail.id,
    // 임시저장을 다시 열 때 인용문을 원본으로 다시 만든다(WP-577).
    sourceMessageId: detail.id,
  }
}

// 첨부 파일 목록 — 칩을 누르면 통합 첨부 뷰어로 연다(WP-280). 다운로드는 뷰어의 ⬇ 가 맡는다.
// compact(모바일 상세, WP-400) — 첨부가 첫 화면을 차지하지 않게 가로로 스크롤되는 한 줄 작은 칩. 화면 가장자리까지 스크롤되게
// 좌우 여백(px-4)만큼 바깥으로 넓힌다. 칩은 32px 높이로 보이고, 위아래 투명 영역으로 44px 터치를 맞춘다(한 줄이라 이웃과 겹치지 않는다).
function AttachmentList({
  attachments,
  onPreview,
  compact = false,
}: {
  attachments: EmailAttachmentMeta[]
  onPreview: (a: EmailAttachmentMeta) => void
  compact?: boolean
}) {
  return (
    <ul
      data-testid="mail-attachments"
      className={cn(
        'mt-2 flex gap-2',
        compact ? '-mx-4 flex-nowrap overflow-x-auto px-4 py-1.5 [scrollbar-width:none]' : 'flex-wrap',
      )}
    >
      {attachments.map((a) => {
        const name = mailAttachmentName(a)
        // 확장자를 잃지 않게 앞부분만 말줄임하고 꼬리(확장자 포함)는 늘 보인다 — 뷰어 제목과 같은 규칙(splitName).
        const [head, tail] = splitName(name)
        return (
          // min-w-0·max-w-full — flex-wrap 줄 폭을 넘지 않아야 360px 에서도 이름이 줄바꿈 대신 말줄임된다.
          <li key={a.id} className={compact ? 'max-w-[14rem] shrink-0' : 'min-w-0 max-w-full'}>
            {/* 칩 전체가 미리보기 버튼(WP-280) — 이슈 첨부 칩과 같은 형식 아이콘·크기 표시, 테두리가 바뀌는 hover 로 누를 수 있음을 알린다.
                포커스 링은 공용 Button 과 같은 토큰(border-ring + ring-ring/50 3px) — 다크에서도 테두리와 구분된다. */}
            <button
              type="button"
              data-testid={`mail-attachment-open-${a.id}`}
              aria-label={`${name} 미리보기`}
              title={`${name} 미리보기`}
              onClick={() => onPreview(a)}
              className={cn(
                'flex max-w-full cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border bg-muted px-2 py-1 text-left text-xs outline-none transition-colors hover:border-foreground/30 hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
                compact
                  ? "relative h-8 after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-['']"
                  : 'sm:max-w-[18rem] pointer-coarse:min-h-11',
              )}
            >
              <FileTypeIcon mimeType={mailAttachmentMime(a)} className="size-3.5" />
              {/* whitespace-pre — 잘리는 자리 끝 공백이 flex 항목 끝에서 사라지지 않게(ViewerTitle 과 같은 이유). */}
              <span className="flex min-w-0" data-testid={`mail-attachment-name-${a.id}`}>
                <span className="min-w-0 truncate whitespace-pre">{head}</span>
                <span className="shrink-0 whitespace-pre">{tail}</span>
              </span>
              <span className="shrink-0 text-muted-foreground">{formatFileSize(a.sizeBytes)}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// 선택한 메시지의 본문 패널 — text 우선, HTML 만 있으면 스크립트 차단 iframe 으로 렌더.
function MessageDetailPanel({
  messageId,
  accountId,
  aiEnabled,
  onReply,
  onReplyAll,
  onForward,
  onAiReplyDraft,
  aiDraftPending,
  onAiIssue,
  issueDraftPending,
  onMarkUnread,
  onBack,
  moveActions,
  onOpenMoveSheet,
}: {
  messageId: number | null
  /** 열린 메일의 계정(WP-1234) — 메일 링크(/mail/:accountId?messageId=)를 만든다. 상세 응답에는 계정이 없다. */
  accountId: number | undefined
  aiEnabled: boolean
  onReply: (detail: EmailMessageDetail) => void
  onReplyAll: (detail: EmailMessageDetail) => void
  onForward: (detail: EmailMessageDetail) => void
  onAiReplyDraft: (detail: EmailMessageDetail) => void
  aiDraftPending: boolean
  onAiIssue: (detail: EmailMessageDetail) => void
  issueDraftPending: boolean
  /** WP-187 열린 메일을 안읽음으로 표시하고 상세를 닫는다. */
  onMarkUnread: () => void
  /** 모바일 상단바 ‹ — 상세를 닫고 목록으로(WP-400 부터 상단바를 이 패널이 그린다: ⋯ 메뉴가 패널 상태를 쓴다). */
  onBack: () => void
  /** WP-962 열린 메일의 보관·옮기기·삭제 — 보낸편지함 등 옮길 수 없는 보기면 null. */
  moveActions: MailMoveActions | null
  /** WP-962 모바일 ⋯ 「옮기기」 — 바텀 시트로 메일함을 고른다(시트는 메일함 화면이 그린다). */
  onOpenMoveSheet: () => void
}) {
  const { data: detail, isLoading, isError, refetch } = useMailMessage(messageId)
  // 비서가 있을 때만 요약 조회 — aiAvailable false면 fetch 자체를 생략해 불필요한 API 호출을 막는다.
  const aiAvailable = useAiAvailable()
  // 휴대폰 폭 판정 — 모바일은 상단바·하단 액션 바 배치(WP-400)로 그린다. 조기 return 앞(훅 순서 고정).
  const isMobile = useIsMobile()
  const { data: summaryData, isFetching: summaryFetching } = useMailSummary(messageId, aiAvailable)
  // WP-1234 지금 보는 메일 — 데스크톱 동작 줄 끝 🔗·모바일 상단바 ⬆︎·⇧⌘, 가 쓴다. 상세를 받은 뒤에만 등록한다.
  const detailId = detail?.id
  const detailSubject = detail?.subject
  const shareTarget = useMemo<ShareTarget | null>(
    () =>
      detailId != null && accountId != null
        ? { kind: 'mail', url: appUrl(mailMessagePath(accountId, detailId)), title: mailSubjectText(detailSubject) }
        : null,
    [detailId, detailSubject, accountId],
  )
  useRegisterShareTarget(shareTarget)
  // WP-149 요약 생략 메일의 "AI 요약" 버튼 — 누를 때만 생성(결과는 요약 캐시에 바로 반영)
  const generateSummary = useGenerateMailSummary()
  // 생성 중 표시는 이 메일을 생성 중일 때만 — 다른 메일로 옮겨도 스켈레톤이 따라오지 않게
  const generatingThis = generateSummary.isPending && generateSummary.variables === messageId
  const summaryLoading = summaryFetching || generatingThis
  const showSummaryButton =
    aiAvailable && !summaryLoading && !summaryData?.summary && summaryData?.status === 'SKIPPED'
  // WP-400 모바일: 「AI 요약 보기」를 누른 메일 — 생성된 요약을 펼친 채 보여 준다. 열린 메일이 바뀌면 렌더 중에 비워
  // 다른 메일을 갔다 돌아오면 다른 요약처럼 접힌 채 나온다(mutation 의 variables 는 다음 요청 전까지 남아 판정에 쓰지 않는다).
  const [summaryRequestedId, setSummaryRequestedId] = useState<number | null>(null)
  if (summaryRequestedId != null && summaryRequestedId !== messageId) setSummaryRequestedId(null)
  // #520 연결된 이슈 키 조회 — issueKey 있으면 배지 표시.
  const linked = useLinkedIssue(messageId, aiEnabled)
  // HTML 본문은 text 본문이 없을 때만 iframe 으로 보인다 — 다크 변환·인라인 치환·첨부 숨김 모두 이때만 적용.
  // 아래 훅들은 조기 return 이전에 호출(훅 순서 고정).
  const rawHtml = detail?.bodyHtml ?? null
  const attachments = detail?.attachments
  const showsHtml = !!rawHtml && !detail?.bodyText
  // WP-103·WP-159 다크 테마면 HTML 메일을 색 단위로 어둡게 변환 — base64 치환 전 원문에 적용해 파싱 비용을 줄인다.
  // 변환된 메일(다크 테마의 HTML 본문)에는 "원본 보기" 토글을 둔다(Outlook 의 배경 전환과 같은 역할).
  // 원본 보기는 해당 메시지에만 유효 — id 로 기억해 다른 메일을 열면 effect 없이 다크 기본값으로 돌아간다.
  const darkHtml = useMailDarkHtml(showsHtml ? rawHtml : null)
  const [originalShownId, setOriginalShownId] = useState<number | null>(null)
  const darkened = showsHtml && darkHtml !== rawHtml
  const showOriginal = darkened && originalShownId === messageId
  // WP-65 본문 인라인 이미지(cid:)를 data URI 로 치환 — 다크 변환 결과(또는 원본 보기 시 원문)에 적용
  const { html: bodyHtml, inlinedIds } = useInlineMailHtml(showOriginal ? rawHtml : darkHtml, attachments, showsHtml)
  // WP-70 본문 cid 로 표시되는 인라인 이미지(서명 로고 등)는 첨부 목록에서 뺀다. 매칭되지 않았거나 조회에 실패한 첨부는
  // 그대로 표시 — 본문에서도 목록에서도 사라지지 않게.
  const listedAttachments = useMemo(
    () => (attachments ?? []).filter((a) => !inlinedIds.has(a.id)),
    [attachments, inlinedIds],
  )
  // WP-280 첨부 뷰어 — 묶음은 목록에 보이는 첨부(인라인 이미지 제외). 상세 조회가 끝났거나(실패 포함) 열린 메일이 없으면
  // "찾을 수 없음"을 판정한다 — 메일 없이·조회 실패로 남은 ?preview 가 뷰어도 안내도 없이 URL 에 남지 않게(다른 호스트와 같은 규칙).
  const attachmentViewer = useMailAttachmentViewer(messageId, listedAttachments, messageId == null || detail != null || isError)
  // 모든 분기(빈 상태·로딩·오류·상세)를 같은 Fragment 의 같은 자리에 뷰어 노드와 함께 그린다 — 분기가 바뀌어도 뷰어가 리마운트되지 않게.
  const withViewer = (body: ReactNode) => (
    <>
      {body}
      {attachmentViewer.viewerNode}
    </>
  )

  if (!messageId) {
    /** 빈 상태 — DS §2.5: 아이콘 + 제목 + 설명 (CTA는 단순 안내이므로 생략) */
    return withViewer(
      <div
        data-testid="mail-detail-empty"
        className="flex h-full flex-col items-center justify-center gap-3 text-center"
      >
        <Mail className="h-10 w-10 text-muted-foreground/50" />
        <div>
          <p className="text-sm font-medium">메일을 선택하세요</p>
          <p className="mt-1 text-xs text-muted-foreground">
            왼쪽 목록에서 메일을 클릭하면 내용이 표시됩니다
          </p>
        </div>
      </div>,
    )
  }
  // 모바일은 로딩·오류 화면에도 상단바(‹·안 읽음)를 둔다 — 상세가 화면 전체라 바가 없으면 돌아갈 길이 없다.
  const withMobileBar = (body: ReactNode) =>
    isMobile ? (
      <>
        <MailMobileDetailBar onBack={onBack} onMarkUnread={onMarkUnread} />
        {body}
      </>
    ) : (
      body
    )
  if (isLoading) {
    return withViewer(withMobileBar(<div className="p-6 text-sm text-muted-foreground">불러오는 중…</div>))
  }
  if (isError || !detail) {
    return withViewer(
      withMobileBar(
        <div className="p-6 text-center">
          <p className="text-sm text-destructive mb-2">메일을 불러오지 못했습니다</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>다시 시도</Button>
        </div>,
      ),
    )
  }

  // #520 이슈 승격 배지 — issueKey 있을 때만 표시. AI 표면이므로 ai-accent 시맨틱 토큰 사용. 데스크톱·모바일 공용.
  const linkedBadge = linked.data?.issueKey ? (
    <span
      data-testid="mail-linked-issue"
      className="inline-flex items-center gap-1 rounded bg-ai-accent-subtle px-1.5 py-0.5 text-xs text-ai-accent"
    >
      이슈로 만듦: {linked.data.issueKey}
    </span>
  ) : null
  const attachmentList =
    listedAttachments.length > 0 ? (
      <AttachmentList attachments={listedAttachments} onPreview={attachmentViewer.onPreview} />
    ) : null
  const aiActions = aiAvailable && aiEnabled
  // WP-986 일정 초대 카드 — 초대·취소 메일일 때만. 데스크톱(본문 위)·모바일(본문 슬롯 위) 공용.
  const inviteCard = detail.calendarInvite ? (
    <MailCalendarInviteCard messageId={detail.id} invite={detail.calendarInvite} />
  ) : null

  // WP-400 모바일 — 첫 화면에 본문이 보이게 메타를 접고, 액션은 하단 고정 바·⋯ 메뉴로 옮긴다(데스크톱은 아래 원래 마크업).
  if (isMobile) {
    const mobileSummary = !aiAvailable ? null : summaryData?.summary || summaryLoading ? (
      <AiContent
        label="AI 요약"
        collapsible
        defaultOpen={summaryRequestedId === messageId}
        preview={summaryData?.summary ? firstSummaryLine(summaryData.summary) : '요약을 만드는 중…'}
        data-testid="mail-ai-summary"
      >
        {summaryData?.summary ? (
          <span>{summaryData.summary}</span>
        ) : (
          <AiSummarySkeleton testId="mail-ai-summary-loading" />
        )}
      </AiContent>
    ) : showSummaryButton ? (
      <MailMobileSummaryButton
        onClick={() => {
          // 눌렀는데 접힌 카드만 남지 않게 — 이 메일을 펼침 대상으로 기억한다.
          setSummaryRequestedId(messageId)
          generateSummary.mutate(messageId)
        }}
      />
    ) : null
    // HTML 본문 iframe 은 스크롤 영역 높이(100cqh, 위아래 여백 1rem 제외)를 차지한다 — MailMobileDetail 주석 참조.
    const mobileBody = detail.bodyText ? (
      <pre className="whitespace-pre-wrap break-words font-sans text-sm">{detail.bodyText}</pre>
    ) : bodyHtml ? (
      <SandboxedHtmlFrame
        data-testid="mail-body-html"
        title="메일 본문"
        html={bodyHtml}
        className="block h-[calc(100cqh-1rem)] min-h-[300px] w-full border-0"
      />
    ) : (
      <div className="text-sm text-muted-foreground">본문이 없습니다</div>
    )
    return withViewer(
      <MailMobileDetail
        key={detail.id}
        detail={detail}
        share={shareTarget && <ShareSheetButton target={shareTarget} />}
        invite={inviteCard}
        onBack={onBack}
        onMarkUnread={onMarkUnread}
        menuItems={
          <>
            {/* WP-962 보관·옮기기 — 하단 바(답장 계열)에 자리가 없어 ⋯ 메뉴로. 삭제는 메뉴 맨 아래(아래 참고). */}
            {moveActions?.avail.archive && (
              <button type="button" data-testid="mail-archive" onClick={moveActions.onArchive}>
                <Archive aria-hidden className="h-4 w-4" />
                보관
              </button>
            )}
            {moveActions?.avail.move && (
              <button type="button" data-testid="mail-move" onClick={onOpenMoveSheet}>
                <FolderInput aria-hidden className="h-4 w-4" />
                옮기기
              </button>
            )}
            {/* AI 이슈 생성 — 하단 바에 자리가 없어 메뉴로. AI 기능은 아이콘 색으로 구분(디자인 시스템 §7.2). */}
            {aiActions && (
              <button
                type="button"
                data-testid="mail-ai-issue"
                disabled={issueDraftPending}
                onClick={() => onAiIssue(detail)}
              >
                {issueDraftPending ? (
                  <Loader2 aria-hidden className="h-4 w-4 animate-spin text-ai-accent" />
                ) : (
                  <Sparkles aria-hidden className="h-4 w-4 text-ai-accent" />
                )}
                {issueDraftPending ? '이슈 작성 중…' : 'AI로 이슈 만들기'}
              </button>
            )}
            {/* 원본 배경 보기 — 체크 항목(aria-pressed → 메뉴가 menuitemcheckbox 로 알린다). 다크 변환된 HTML 본문에만. */}
            {darkened && (
              <button
                type="button"
                data-testid="mail-body-theme-toggle"
                aria-pressed={showOriginal}
                onClick={() => setOriginalShownId(showOriginal ? null : messageId)}
              >
                <Sun aria-hidden className="h-4 w-4" />
                원본 배경으로 보기
                {showOriginal && <Check aria-hidden className="ml-auto h-4 w-4" />}
              </button>
            )}
            {/* WP-962 삭제(서버 휴지통) — 파괴적 항목이라 메뉴 맨 아래, 빨간 글자. */}
            {moveActions?.avail.trash && (
              <button type="button" data-testid="mail-trash" className="text-destructive" onClick={moveActions.onTrash}>
                <Trash2 aria-hidden className="h-4 w-4" />
                삭제
              </button>
            )}
          </>
        }
        summary={mobileSummary}
        linkedIssue={linkedBadge}
        attachments={
          listedAttachments.length > 0 ? (
            <AttachmentList compact attachments={listedAttachments} onPreview={attachmentViewer.onPreview} />
          ) : null
        }
        body={mobileBody}
        onReply={() => onReply(detail)}
        onReplyAll={() => onReplyAll(detail)}
        onForward={() => onForward(detail)}
        aiReply={aiActions ? { onClick: () => onAiReplyDraft(detail), pending: aiDraftPending } : undefined}
      />,
    )
  }

  return withViewer(
    <div data-testid="mail-detail" className="flex h-full flex-col overflow-y-auto">
      <div className="border-b p-4">
        {/* AI 요약 카드 — 비서 있을 때만. 객관 요약은 동의 불필요. 조회·생성 중에는 스켈레톤. */}
        {aiAvailable && (summaryData?.summary || summaryLoading) && (
          <AiContent
            label="AI 요약"
            collapsible
            defaultOpen
            className="mb-3"
            data-testid="mail-ai-summary"
          >
            {summaryData?.summary ? (
              <span>{summaryData.summary}</span>
            ) : (
              <AiSummarySkeleton testId="mail-ai-summary-loading" />
            )}
          </AiContent>
        )}
        {/* WP-149 요약을 생략한 메일(자동 발송 등) — 카드 대신 버튼. 서버가 SKIPPED 일 때만 내려준다(새 본문 400자 이하는 EMPTY). */}
        {showSummaryButton && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="mail-ai-summary-generate"
            className="mb-3 border-ai-accent/50 text-ai-accent hover:bg-ai-accent-subtle hover:text-ai-accent"
            onClick={() => messageId && generateSummary.mutate(messageId)}
          >
            <Sparkles className="h-3.5 w-3.5" /> AI 요약
          </Button>
        )}
        <h2 className="text-lg font-semibold">{mailSubjectText(detail.subject)}</h2>
        {linkedBadge}
        <div className="mt-1 text-sm text-muted-foreground">
          {detail.fromName ? `${detail.fromName} <${detail.fromAddress}>` : detail.fromAddress}
        </div>
        {detail.toAddresses && (
          <div className="mt-0.5 text-xs text-muted-foreground">받는사람: {detail.toAddresses}</div>
        )}
        {detail.ccAddresses && (
          <div className="mt-0.5 text-xs text-muted-foreground">참조: {detail.ccAddresses}</div>
        )}
        {detail.bccAddresses && (
          <div className="mt-0.5 text-xs text-muted-foreground">숨은참조: {detail.bccAddresses}</div>
        )}
        {/* 답장/전체답장/전달 버튼 — shadcn Button으로 앱 전체 버튼 스타일 일관성 유지.
            좁은 상세(lg 1024 등)에서 버튼이 상세 폭을 넘지 않게 줄바꿈한다. */}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            data-testid="mail-reply"
            onClick={() => onReply(detail)}
          >
            <Reply className="h-3.5 w-3.5" /> 답장
          </Button>
          <Button
            variant="outline"
            size="sm"
            data-testid="mail-reply-all"
            onClick={() => onReplyAll(detail)}
          >
            <ReplyAll className="h-3.5 w-3.5" /> 전체답장
          </Button>
          <Button
            variant="outline"
            size="sm"
            data-testid="mail-forward"
            onClick={() => onForward(detail)}
          >
            <Forward className="h-3.5 w-3.5" /> 전달
          </Button>
          {/* WP-187 안 읽음으로 표시(데스크톱) — 형제 버튼처럼 아이콘+글자(모바일 ⋯ 메뉴와 같은 문구).
              누르면 상세가 닫힌다(열린 상세가 재조회되면 다시 읽음 처리되므로). 모바일은 위에서 따로 그려 여기 오지 않는다. */}
          <Button
            variant="outline"
            size="sm"
            data-testid="mail-mark-unread"
            title="안 읽음으로 표시"
            onClick={onMarkUnread}
          >
            <Mail className="h-3.5 w-3.5" /> 안 읽음
          </Button>
          {/* WP-962 보관·옮기기·삭제 — 누르면 상세가 닫히고 목록에서 빠진다(실행 취소 토스트). 보낸편지함에선 없다. */}
          {moveActions?.avail.archive && (
            <Button variant="outline" size="sm" data-testid="mail-archive" onClick={moveActions.onArchive}>
              <Archive className="h-3.5 w-3.5" /> 보관
            </Button>
          )}
          {moveActions?.avail.move && (
            <MailMoveMenu
              targets={moveActions.targets}
              onPick={moveActions.onMove}
              align="start"
              trigger={
                <Button variant="outline" size="sm" data-testid="mail-move">
                  <FolderInput className="h-3.5 w-3.5" /> 옮기기
                </Button>
              }
            />
          )}
          {moveActions?.avail.trash && (
            <Button
              variant="outline"
              size="sm"
              data-testid="mail-trash"
              className="text-destructive hover:text-destructive"
              onClick={moveActions.onTrash}
            >
              <Trash2 className="h-3.5 w-3.5" /> 삭제
            </Button>
          )}
          {/* AI 답장 초안 버튼 — 비서 있고 AI 사용 계정에서만 노출. AI 기능이므로 ai-accent 보조 컬러(아이콘+색, 디자인시스템 §7.2). */}
          {aiActions && (
            <Button
              variant="outline"
              size="sm"
              data-testid="mail-ai-reply-draft"
              className="border-ai-accent/50 text-ai-accent hover:bg-ai-accent-subtle hover:text-ai-accent"
              disabled={aiDraftPending}
              onClick={() => onAiReplyDraft(detail)}
            >
              {aiDraftPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> 초안 작성 중…
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" /> AI 답장 초안
                </>
              )}
            </Button>
          )}
          {/* AI 이슈 생성 버튼 — 비서 있고 AI 사용 계정에서만 노출. #520. AI 기능이므로 ai-accent 보조 컬러(아이콘+색, 디자인시스템 §7.2). */}
          {aiActions && (
            <Button
              variant="outline"
              size="sm"
              data-testid="mail-ai-issue"
              className="border-ai-accent/50 text-ai-accent hover:bg-ai-accent-subtle hover:text-ai-accent"
              disabled={issueDraftPending}
              onClick={() => onAiIssue(detail)}
            >
              {issueDraftPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> 이슈 작성 중…
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" /> AI 이슈 생성
                </>
              )}
            </Button>
          )}
          {/* WP-1234 🔗 — 동작 줄 끝. 이 메일 링크를 바로 복사한다. */}
          {shareTarget && <CopyLinkButton target={shareTarget} className="size-8" />}
        </div>
        {attachmentList}
      </div>
      <div className="flex-1 p-4">
        {/* WP-986 일정 초대 카드 — 헤더와 본문 사이(초대 메일일 때만). */}
        {inviteCard && <div className="mb-4">{inviteCard}</div>}
        {detail.bodyText ? (
          <pre className="whitespace-pre-wrap break-words font-sans text-sm">{detail.bodyText}</pre>
        ) : bodyHtml ? (
          <div className="flex h-full flex-col gap-2">
            {darkened && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                data-testid="mail-body-theme-toggle"
                className="self-end text-muted-foreground"
                onClick={() => setOriginalShownId(showOriginal ? null : messageId)}
              >
                {showOriginal ? <Moon aria-hidden /> : <Sun aria-hidden />}
                {showOriginal ? '다크 배경으로 보기' : '원본 배경으로 보기'}
              </Button>
            )}
            <SandboxedHtmlFrame
              data-testid="mail-body-html"
              title="메일 본문"
              html={bodyHtml}
              className="min-h-[300px] w-full flex-1 border-0"
            />
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">본문이 없습니다</div>
        )}
      </div>
    </div>,
  )
}

/**
 * 메일 라우트 — ?folder=drafts 면 임시보관함(WP-577, 앱 서버 임시저장 — 메시지 목록 API 를 쓰지 않는다)을, 그 밖에는 메일함을 그린다.
 * 화면을 나눠 임시보관함에서는 메일함의 목록·동기화·읽음 훅이 돌지 않게 한다. 계정이 없으면 메일함이 첫 계정으로 보낸다.
 */
export function MailInboxPage() {
  const { accountId } = useParams()
  const [params] = useSearchParams()
  const { data: accounts, isLoading: accountsLoading } = useMailAccounts()
  // 주소의 계정이 내 계정 목록에 없으면(없는 번호·남의 계정·/mail/abc) 메일함을 열지 않는다 — 열면 빈 목록의
  // 「동기화를 눌러보세요」나 소용없는 「다시 시도」만 보인다(WP-926). 계정 목록을 못 불러온 경우는 판단하지 않고 그대로 둔다.
  if (accountId) {
    if (accountsLoading) return <div className="p-6 text-sm text-muted-foreground">불러오는 중…</div>
    if (accounts && !accounts.some((a) => String(a.id) === accountId)) {
      // 연결된 계정이 하나도 없으면 /mail 의 「연결된 메일 계정이 없습니다」 안내로 보낸다.
      if (accounts.length === 0) return <Navigate to="/mail" replace />
      return <MailAccountNotFound />
    }
  }
  if (accountId && params.get('folder') === 'drafts') return <MailDraftsPage accountId={Number(accountId)} />
  return <MailInbox />
}

/** 주소의 메일 계정이 내 계정이 아닐 때의 안내 — 다른 없는 리소스 화면(이슈·프로젝트)과 같은 모양(WP-926). */
function MailAccountNotFound() {
  const navigate = useNavigate()
  useDocumentTitle(['메일 계정을 찾을 수 없음', '메일'])
  return (
    <Page>
      <Page.Header title="메일" mobileHideSheetTrigger />
      <ResourceErrorState
        icon={MailX}
        title="메일 계정을 찾을 수 없습니다"
        description="연결이 해제되었거나 내 메일 계정이 아닙니다."
        actionLabel="메일함으로 돌아가기"
        onAction={() => navigate('/mail')}
      />
    </Page>
  )
}

/**
 * 받은편지함/보낸편지함 — 좌측 메시지 목록(검색·동기화) + 우측 본문(마스터-디테일).
 * 계정은 /mail/:accountId 로 선택하며, accountId 가 없으면 첫 계정으로 리다이렉트한다.
 * 폴더 토글: ?folder=sent → SENT, 기본 INBOX.
 */
function MailInbox() {
  const { accountId } = useParams()
  const isMobile = useIsMobile()
  const [params, setParams] = useSearchParams()
  const search = params.get('q') ?? ''
  // 검색 입력 draft — 타이핑은 즉시 반영하되 URL(및 그 값을 쓰는 useMailMessages 쿼리)은
  // 300ms debounce 후에만 갱신해 키 입력마다 목록 API 가 재요청되지 않게 한다(#814).
  // 내가 쓴 q 가 되돌아올 때 더 친 글자를 덮지 않는 것까지 연락처·이슈 필터와 같은 공용 훅이 맡는다(WP-1003).
  const { draft: searchDraft, setDraft: setSearchDraft } = useSearchDraft(search, (value) =>
    setParams(
      (prev) => {
        const sp = new URLSearchParams(prev)
        if (value) sp.set('q', value)
        else sp.delete('q')
        return sp
      },
      { replace: true },
    ),
  )
  // 열린 메일 = URL ?messageId(상태의 단일 원천, WP-206). 행 클릭은 push 라 시스템 뒤로가기가 상세만 닫는다.
  // 홈 위젯 딥링크(#447)·푸시 알림도 같은 키 — 마운트 1회 읽기가 아니라 URL 실시간 파생이라 forward 재열림도 자연스럽다.
  // MAIL_DETAIL_PARAM: 다른 메일로 바꿀 때 앞 메일의 첨부 뷰어 키(?preview, WP-280)도 함께 지운다.
  const mailParam = useHistoryParam('messageId', MAIL_DETAIL_PARAM)
  const selectedId = parseId(mailParam.value)
  // 모바일: 본문(상세)이 열려 있으면 하단 탭바를 숨긴다(WP-125).
  useHideTabBar(selectedId != null)

  // 폴더 파라미터: ?folder=sent → SENT, 기본 INBOX.
  const folderParam = (params.get('folder') === 'sent' ? 'SENT' : 'INBOX') as MailFolder

  // 계정·폴더 전환은 사이드바 navigate 가 search 를 새로 쓰며 messageId 를 함께 지운다 — 별도 리셋 이펙트 불요(WP-206).

  const { data: accounts, isLoading: accountsLoading } = useMailAccounts()
  const accountIdNum = accountId ? Number(accountId) : undefined

  // WP-186: URL → 보기 해석(사이드바와 같은 규칙). 계수 로딩·실패 중에는 분류 활성으로 본다(사이드바와 동일).
  const { data: unreadCounts } = useUnreadCounts(accountIdNum)
  const classificationActive = unreadCounts?.classificationActive ?? true
  // 앱 안에서 연 메일(열림 마크)은 딥링크로 보지 않는다 — 사이드바도 같은 판정(WP-218).
  const location = useLocation()
  // WP-961 서버 메일함(보관·내 메일함) — ?box 보기의 제목·경로·안 읽은 수·가져온 시각.
  const { data: folders } = useMailFolders(accountIdNum)
  const view = resolveMailView(params, classificationActive, { inAppSelection: hasOpenMark(location.state, 'messageId'), folders })
  const crumbItems = mailBreadcrumbItems(view, Number(accountId), params, search !== '')
  const folderView = view.kind === 'folder'
  const currentFolder = folderView ? folders?.find((f) => f.id === view.folderId) : undefined
  // 탭 제목 — 「{폴더} · 메일」(WP-814). 계정이 없으면(연결 안내 화면) 폴더가 없으니 「메일」만.
  useDocumentTitle([(accounts?.length ?? 0) > 0 && view.title, '메일'])

  const {
    data: fetchedMessages, isLoading, isError, refetch: refetchMessages,
    fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError, isFetching: listFetching,
  } = useMailMessages(
    accountIdNum, folderParam, search, view.unreadOnly, view.apiCategory, view.kind === 'needsReply',
    { folderId: view.folderId },
  )
  // WP-186: 안 읽은 메일만 보기에서 연 메일은 보기·토글을 바꾸기 전까지 유지 — 보기 key 가 바뀌면 초기화.
  // 키에 계정·검색어를 포함한다 — 같은 페이지 인스턴스가 계정/검색만 바뀌어도 유지 집합이 새어 나가지 않게.
  const keepKey = `${accountId ?? ''}|${search}|${view.key}`
  // 연 행의 스냅샷(읽음 처리본)을 읽음 처리 시점에 보관 — 서버가 읽음으로 빼도 mergeKeptRows 가 그대로 되살린다(applyToggle).
  const [kept, setKept] = useState<{ key: string; rows: ReadonlyMap<number, EmailMessageSummary> }>({ key: keepKey, rows: new Map() })
  // 키가 바뀌면 렌더 중에 실제로 비운다(숨기기만 하면 같은 키로 돌아올 때 되살아난다).
  if (kept.key !== keepKey) setKept({ key: keepKey, rows: new Map() })
  const keptRows = kept.key === keepKey ? kept.rows : undefined
  // WP-230: 고르는 순간의 목록 행을 잡아 두고 열려 있는 동안 목록에 끼운다 — 읽음 판정(상세 조회 완료 후) 전에 재조회가 행을 빼도
  // 남게. 판정 때 유지 집합으로 옮기고, 판정 전에 떠나면 자연히 빠진다. 선택이 바뀔 때만 잡는다(보기만 바뀌면 낡은 캐시 행을 잡지 않게).
  const [selection, setSelection] = useState<{ id: number | null; key: string; row?: EmailMessageSummary }>({ id: selectedId, key: keepKey })
  if (selection.id !== selectedId) {
    const row = view.unreadOnly && selectedId != null ? fetchedMessages?.find((r) => r.id === selectedId) : undefined
    setSelection({ id: selectedId, key: keepKey, row })
  }
  const openRow = selection.id === selectedId && selection.key === keepKey ? selection.row : undefined
  // WP-962 보관·옮기기·삭제 대기 중인 메일은 숨긴다 — 유지 스냅샷·열린 행이 되살리지 않게 합친 뒤에 거른다.
  const movingIds = useMailMoveHidden()
  const messages = useMemo(() => {
    const merged = mergeKeptRows(fetchedMessages, withOpenRow(keptRows, openRow))
    return movingIds.size === 0 ? merged : merged?.filter((m) => !movingIds.has(m.id))
  }, [fetchedMessages, keptRows, openRow, movingIds])
  // 유지 집합의 한 행을 넣거나 바꾼다(키가 바뀐 뒤 늦게 와도 새 보기에 새지 않게 현재 키로 쓴다).
  const putKept = (id: number, row: EmailMessageSummary) =>
    setKept((k) => ({ key: keepKey, rows: new Map(k.key === keepKey ? k.rows : []).set(id, row) }))
  // 유지 스냅샷 → 서버 목록(최신) → 열린 행 스냅샷(서버가 이미 뺀 경우) 순으로 행을 찾는다.
  const findRow = (id: number) =>
    keptRows?.get(id) ?? fetchedMessages?.find((r) => r.id === id) ?? (openRow?.id === id ? openRow : undefined)
  // WP-187 읽음/안읽음 전환 — 새 훅은 모두 아래 !accountId 조기 return 보다 앞에 둔다(훅 순서).
  const toggleRead = useToggleRead()
  // 터치 셸에는 hover 가 없어 행 전환 버튼을 렌더하지 않는다.
  const touchShell = useIsTouchShell()
  /**
   * 한 통 읽음 전환 + "안 읽은 메일만" 유지 스냅샷 동기화(F19).
   * - 유지 중인 행이면 스냅샷 seen 도 바꾼다 — 서버 목록에 없는 행은 낙관 갱신이 닿지 않아 스냅샷이 화면 값이다.
   * - 안 읽은 메일만 보기에서 읽음 처리한 행은 열람과 같이 유지 집합에 넣는다(재조회로 즉시 사라지지 않게).
   * 실패하면 훅이 목록 캐시를 되돌리고, 여기서는 스냅샷만 이전 값으로 되돌린다.
   */
  const applyToggle = (id: number, seen: boolean) => {
    const prevKept = keptRows?.get(id)
    const row = findRow(id)
    if (row && (prevKept || (view.unreadOnly && seen))) putKept(id, { ...row, seen })
    toggleRead.mutate(
      { id, seen },
      {
        onError: () =>
          setKept((k) => {
            if (k.key !== keepKey) return k
            const rows = new Map(k.rows)
            if (prevKept) rows.set(id, prevKept)
            else rows.delete(id)
            return { key: keepKey, rows }
          }),
      },
    )
  }
  // WP-214 첫 열람 읽음 처리 — 상세 조회는 읽음 처리하지 않으므로 안 읽은 메일을 열 때 한 번만 읽음 요청을 보낸다(판정 규칙은 훅 주석).
  // applyToggle 이라 "안 읽은 메일만" 보기에서도 연 행이 유지 집합에 들어가 재조회로 사라지지 않는다. 이미 읽음으로 보이던 행도
  // 그 보기에서 열었다면 읽음으로 맞춰 보기·토글을 바꾸기 전까지 유지한다(WP-186).
  const openedDetail = useMailMessageSeen(selectedId)
  useMarkReadOnOpen(
    selectedId,
    openedDetail.isFetching ? undefined : openedDetail.data,
    (id, seen) => {
      if (!seen) {
        applyToggle(id, true)
        return
      }
      const row = findRow(id)
      if (view.unreadOnly && row) putKept(id, { ...row, seen: true })
    },
  )
  /**
   * 상세의 "안읽음으로 표시" — 안읽음 처리 후 상세를 닫고 목록으로 돌아간다(스펙 §C 상세 동작).
   * 목록 행·작업 시트의 전환은 열린 메일이어도 상세를 그대로 둔다(조회가 읽음 처리하지 않으므로 닫을 필요가 없다, WP-214).
   */
  const markUnreadAndClose = (id: number) => {
    mailParam.close()
    applyToggle(id, false)
  }
  // 행 버튼·작업 시트 공통 읽음 전환.
  const toggleRow = (m: EmailMessageSummary) => applyToggle(m.id, !m.seen)
  // WP-187 모두 읽음 — 버튼 → 건수 조회(+asOf) → 확인 다이얼로그 → 실행.
  // asOf 는 서버(DB 시계)가 준 문자열을 그대로 되돌려 보낸다 — 확인 뒤 새로 들어온 메일은 읽음 처리하지 않게.
  const markAll = useMarkAllRead(accountIdNum)
  const markAllScope: MailViewScope = { category: view.apiCategory, needsReply: view.kind === 'needsReply', query: search, folderId: view.folderId }
  // 누른 시점의 계정·범위 — 건수 조회 중 보기/계정을 바꾸면 이 키가 달라져 응답·다이얼로그를 버린다(다른 보기를 읽음 처리하지 않게).
  // 서버 메일함끼리는 분류가 모두 비어 있어 메일함 id 까지 넣어야 메일함을 옮길 때 다이얼로그가 비워진다(WP-961).
  const markAllKey = `${accountIdNum ?? ''}|${markAllScope.category}|${markAllScope.needsReply}|${markAllScope.query}|${view.folderId ?? ''}`
  // 다이얼로그 상태는 누른 시점의 범위·표시 이름과 건수·asOf 를 함께 묶어 둔다 — 확인 시 이 값만 쓴다.
  const [markAllPending, setMarkAllPending] = useState<{
    key: string
    scope: MailViewScope
    label: string
    count: number
    asOf: string
  } | null>(null)
  // 보기/계정이 바뀌면(뒤로 가기 등) 열린 다이얼로그를 렌더 중에 비운다.
  if (markAllPending && markAllPending.key !== markAllKey) setMarkAllPending(null)
  // 비동기 응답 시점의 현재 키 — 늦게 도착한 옛 보기 응답이 새 보기 다이얼로그를 덮거나 토스트를 띄우지 않게 버린다.
  const markAllKeyRef = useRef(markAllKey)
  useEffect(() => {
    markAllKeyRef.current = markAllKey
  }, [markAllKey])
  // 검색 중이 아니면 사이드바와 같은 숫자로 0 을 미리 알 수 있어 버튼을 끈다(검색 중엔 눌러서 건수를 조회).
  // 서버 메일함은 그 메일함의 안 읽은 수 — 모르면(null) 끄지 않는다.
  const markAllKnownZero = !search && unreadCounts != null && unreadCountForView(view, unreadCounts, folders) === 0
  const startMarkAll = async () => {
    if (accountIdNum == null) return
    // 검색 중이면 건수는 검색 결과만 센다 — 표시 이름에도 검색어를 붙여 보기 전체로 오해하지 않게 한다.
    const label = mailBreadcrumbText(view) + (markAllScope.query ? ` · "${markAllScope.query}"` : '')
    const captured = { key: markAllKey, scope: markAllScope, label }
    try {
      const r = await getViewUnreadCount(accountIdNum, captured.scope)
      if (markAllKeyRef.current !== captured.key) return
      if (r.count === 0) {
        toast('안 읽은 메일이 없어요')
        return
      }
      setMarkAllPending({ ...captured, count: r.count, asOf: r.asOf })
    } catch (e) {
      if (markAllKeyRef.current !== captured.key) return
      handleApiError(e, '안 읽은 메일 수를 불러오지 못했어요')
    }
  }
  const sync = useSyncMailbox(accountIdNum)
  // WP-961 서버 메일함 가져오기 — 메일함을 열 때(또는 다른 메일함으로 옮길 때) 한 번, 새로 고침, 더 가져오기(older).
  const syncFolder = useSyncMailFolder(accountIdNum)
  const { mutate: runFolderSync } = syncFolder
  // 열 수 있는 메일함일 때만 자동으로 가져온다 — 묶음 메일함·없는 id 는 서버가 400/404 로 거절한다.
  const autoSyncFolderId = currentFolder?.selectable ? currentFolder.id : null
  // 마지막으로 자동 가져오기를 보낸 계정:메일함 — StrictMode 이중 실행·메일함 목록 재조회로 다시 보내지 않게.
  const autoSyncedRef = useRef<string | null>(null)
  useEffect(() => {
    // 메일함 보기를 떠나면 기억을 지운다 — 같은 메일함으로 다시 돌아오면(받은편지함 → 보관 → 받은편지함 → 보관) 다시 가져온다.
    if (accountIdNum == null || autoSyncFolderId == null) {
      if (!folderView) autoSyncedRef.current = null
      return
    }
    const target = `${accountIdNum}:${autoSyncFolderId}`
    if (autoSyncedRef.current === target) return
    autoSyncedRef.current = target
    runFolderSync({ folderId: autoSyncFolderId, older: false })
  }, [accountIdNum, autoSyncFolderId, folderView, runFolderSync])
  // 지금 보는 메일함을 가져오는 중인가 — 빠르게 다른 메일함으로 옮겨도 앞 메일함 요청을 이 메일함 것으로 보지 않게 대상 id 를 맞춘다.
  const folderSyncing = syncFolder.isPending && syncFolder.variables?.folderId === view.folderId
  const olderSyncing = folderSyncing && syncFolder.variables?.older === true
  // 「더 가져오기」 — 직접 누른 것이라 결과를 토스트로 알린다(열 때 자동 가져오기는 조용히).
  const fetchOlder = () => {
    if (!currentFolder) return
    runFolderSync(
      { folderId: currentFolder.id, older: true },
      {
        onSuccess: (r) => {
          if (r.running) return
          toast(r.saved > 0 ? `이전 메일 ${r.saved}통을 더 가져왔어요` : '이전 90일에는 가져올 메일이 없어요')
        },
      },
    )
  }
  // WP-965 목록 이어 보기 — 끝까지 내리면 로컬 다음 페이지, 로컬이 바닥나면 받은편지함(전체·업무)·보낸편지함은 서버에서 이전 90일을 더 가져온다.
  // 서버에 더 없음·실패는 계정·폴더 키별로 기억한다 — 다른 계정·폴더로 옮기면 그 키의 기록이 없어 처음부터 다시 본다.
  const olderFolder = serverOlderFolder(view, search)
  const olderKey = `${accountIdNum ?? ''}|${olderFolder ?? ''}`
  const [olderEnded, setOlderEnded] = useState<Record<string, 'done' | 'failed'>>({})
  const olderStatus = olderEnded[olderKey]
  const olderMail = useFetchOlderMail(accountIdNum)
  const fetchOlderMail = (key: string) => {
    if (olderFolder == null || olderMail.isPending) return
    olderMail.mutate(olderFolder, {
      onSuccess: (r) => { if (!r.hasMore) setOlderEnded((m) => ({ ...m, [key]: 'done' })) },
      onError: () => setOlderEnded((m) => ({ ...m, [key]: 'failed' })),
    })
  }
  // 목록 스크롤 칸 — 공용 푸터 sentinel 의 root(미리 부르기 여유가 스크롤 칸 클리핑에 먹히지 않게, useLoadMoreSentinel).
  const [listScrollEl, setListScrollEl] = useState<HTMLDivElement | null>(null)
  // 공용 목록 끝 푸터(LoadMoreFooter) 어댑터 — 로컬 다음 페이지가 있으면 그것을, 없으면 서버 이전 메일을 「다음 페이지」로 본다(캘린더 목록과 같은 방식).
  const olderFailed = !hasNextPage && olderStatus === 'failed'
  const footerQuery = {
    hasNextPage: !!hasNextPage || (olderFolder != null && olderStatus !== 'done'),
    isFetching: listFetching || olderMail.isPending,
    isFetchNextPageError: hasNextPage ? isFetchNextPageError : olderFailed,
    isFetchingNextPage: isFetchingNextPage || olderMail.isPending,
    fetchNextPage: () => {
      if (hasNextPage) return fetchNextPage({ cancelRefetch: false })
      // 실패 뒤 다시 시도 — 실패 기록을 지우고 다시 부른다(자동 로드는 실패 동안 멈춰 있다).
      if (olderFailed) {
        setOlderEnded((m) => {
          const next = { ...m }
          delete next[olderKey]
          return next
        })
      }
      fetchOlderMail(olderKey)
    },
  }
  const listEnd = (
    <>
      <LoadMoreFooter
        query={footerQuery}
        root={listScrollEl}
        errorLabel={olderFailed ? '이전 메일을 가져오지 못했습니다 — 다시 시도' : undefined}
        data-testid="mail-list-end"
      />
      {olderFolder != null && olderStatus === 'done' && !hasNextPage && (
        <div data-testid="mail-list-no-older" className="py-3 text-center text-xs text-muted-foreground">더 이전 메일 없음</div>
      )}
    </>
  )
  const { openCompose } = useMailCompose()
  const replyDraft = useReplyDraft()
  // #520 AI 이슈 초안 — 버튼 클릭 시 모달 오픈 후 초안 로드.
  const issueDraft = useIssueDraft()
  const [issueDialog, setIssueDialog] = useState<{ messageId: number; subject: string } | null>(null)
  const [draftData, setDraftData] = useState<MailIssueDraft | null>(null)

  // 동기화 진행 상태 구독 — 동기화 트리거(성공/진행 중) 동안만 폴링.
  const syncStatus = useSyncStatus(accountIdNum, sync.isSuccess || sync.isPending)
  // 본문 보충 진행률 노출 여부 — 진행률 표시와 동기화 시각 숨김이 같은 판정을 쓴다.
  const bodiesProgress = syncStatus.data?.phase === 'BODIES' && syncStatus.data.total > 0
  const qc = useQueryClient()
  // WP-962 보관·옮기기·삭제 — 보기별 노출(보낸편지함 없음·보관 보기엔 보관 없음)과 「옮기기」 대상(지금 메일함 제외).
  const moveTargets = useMemo(() => mailMoveTargets(view, folders), [view, folders])
  const moveAvail = mailMoveAvailability(view, folders)
  const canMove = moveAvail.archive || moveAvail.move || moveAvail.trash
  // 모바일 「옮기기」 바텀 시트의 대상 메일(길게 누르기 시트·상세 ⋯ 메뉴에서 연다).
  const [moveSheetIds, setMoveSheetIds] = useState<number[] | null>(null)
  /**
   * 옮기기 예약 — 열린 메일이면 상세를 닫고, 유지 스냅샷에서도 빼 행이 되살아나지 않게 한 뒤 대기열에 넣는다.
   * 서버 요청은 실행 취소 토스트가 닫힐 때 나간다(lib/mailMoveQueue).
   */
  const startMove = (ids: number[], target: MailMoveTarget) => {
    if (accountIdNum == null) return
    if (selectedId != null && ids.includes(selectedId)) mailParam.close()
    setKept((k) => (k.key !== keepKey ? k : { key: keepKey, rows: new Map([...k.rows].filter(([id]) => !ids.includes(id))) }))
    scheduleMailMove({ qc, accountId: accountIdNum, messageIds: ids, target, message: mailMoveToastMessage(target, folders, ids.length) })
  }
  const moveActionsFor = (id: number): MailMoveActions | null =>
    canMove
      ? {
          avail: moveAvail,
          targets: moveTargets,
          onArchive: () => startMove([id], { kind: 'ARCHIVE' }),
          onTrash: () => startMove([id], { kind: 'TRASH' }),
          onMove: (t) => startMove([id], t),
        }
      : null
  // 본문 보충(running)이 끝나는 순간 목록을 다시 불러와 snippet 등을 갱신.
  const prevRunning = useRef(false)
  useEffect(() => {
    const running = syncStatus.data?.running ?? false
    if (prevRunning.current && !running) {
      qc.invalidateQueries({ queryKey: ['mail-messages', accountIdNum] })
    }
    prevRunning.current = running
  }, [syncStatus.data?.running, accountIdNum, qc])

  // 현재 계정 객체 — 이메일 주소·AI 활성화 여부·마지막 동기화 시각에 사용.
  const currentAccount = accounts?.find((a) => a.id === accountIdNum)
  // 본인 이메일 주소 — 화면 컨텍스트와 전체답장(자신을 수신자에서 제외)이 같은 원시값을 쓴다.
  const accountEmail = currentAccount?.emailAddress ?? null
  // 현재 계정의 AI 사용 여부 — 요약 스트립 표시 여부에 사용.
  const aiEnabled = currentAccount?.aiEnabled ?? false

  // WP-187 모바일: hover 대신 길게 누르기 → 작업 시트(채팅과 같은 패턴). 행에는 data-message-id 가 있다.
  // 훅이므로 !accountId 조기 return 보다 앞에 둔다.
  const aiAvailable = useAiAvailable()
  const sheetMessages = messages ?? EMPTY_MESSAGES
  const sheet = useMessageSheet(sheetMessages)
  const longPress = useMessageListLongPress(touchShell, (id) => sheetMessages.some((m) => m.id === id), sheet.show)
  // 답장·전달·AI 이슈 초안은 본문이 필요하다 — 상세를 받아 기존 핸들러로 넘긴다. 상세 조회는 읽음 처리하지 않으므로(WP-214)
  // 안 읽은 메일이면 여는 것과 같이 읽음 요청을 따로 보낸다(F21 — 목록·안 읽은 수·홈 요약 갱신은 applyToggle 이 맡는다).
  // 실패는 다른 메일 작업과 같이 토스트로 알린다(시트는 이미 닫혀 있다).
  const withDetail = async (m: EmailMessageSummary, fn: (d: EmailMessageDetail) => void) => {
    let d: EmailMessageDetail
    try {
      d = await qc.fetchQuery({ queryKey: mailMessageKeys.detail(m.id), queryFn: () => getMessage(m.id) })
    } catch (e) {
      handleApiError(e, '메일을 불러오지 못했어요')
      return
    }
    if (!m.seen) applyToggle(m.id, true)
    fn(d)
  }
  // 시트 작업 — 첫 항목(읽음 전환)이 primary.
  const sheetActions = (m: EmailMessageSummary): MessageSheetAction[] => [
    {
      key: 'toggle-read',
      label: m.seen ? '안 읽음으로 표시' : '읽음으로 표시',
      icon: m.seen ? <Mail /> : <MailOpen />,
      primary: true,
      onSelect: () => toggleRow(m),
    },
    { key: 'reply', label: '답장', icon: <Reply />, onSelect: () => void withDetail(m, onReply) },
    { key: 'forward', label: '전달', icon: <Forward />, onSelect: () => void withDetail(m, onForward) },
    // 링크(WP-1236) — 이 메일의 앱 링크. 메일은 계정 주인만 열 수 있어 남에게 보내면 「볼 수 없는 메일」로 보인다(나중에 내가 다시 찾기용).
    ...(accountIdNum != null ? rowLinkActions(mailShareTarget(accountIdNum, m)) : []),
    ...(aiAvailable && aiEnabled
      ? [{ key: 'ai-issue', label: 'AI 이슈 초안', icon: <Sparkles />, onSelect: () => void withDetail(m, onAiIssue) }]
      : []),
    // WP-962 보관·옮기기·삭제 — 옮기기는 메일함 고르기 시트를 연다. 삭제는 파괴적 항목이라 맨 아래.
    ...(moveAvail.archive ? [{ key: 'archive', label: '보관', icon: <Archive />, onSelect: () => startMove([m.id], { kind: 'ARCHIVE' }) }] : []),
    ...(moveAvail.move ? [{ key: 'move', label: '옮기기', icon: <FolderInput />, onSelect: () => setMoveSheetIds([m.id]) }] : []),
    ...(moveAvail.trash
      ? [{ key: 'trash', label: '삭제', icon: <Trash2 />, destructive: true, onSelect: () => startMove([m.id], { kind: 'TRASH' }) }]
      : []),
  ]

  // WP-54: 메일함 화면 컨텍스트 — 계정·폴더·필터 + 열린 메일(목록 행 요약으로 라벨 구성).
  // 훅이므로 아래 !accountId 조기 return 보다 앞에 둔다. 목록에 없는 메일(딥링크 등)은 focus 없이 scope 만 싣는다.
  // 회신필요 필터(?needsReply=true)에서는 메일을 열면 읽음 처리돼 다음 목록 refetch 에서 목록을 빠져나간다 —
  // 상세 패널은 열려 있는데 AI 컨텍스트만 사라지지 않도록, 마지막으로 본 목록 행을 기억해 두었다가 쓴다.
  // ref 를 렌더 중에 읽지 않도록 state 로 두고, 행이 바뀐 경우에만 렌더 중 갱신한다(React 의 "이전 값 보관" 패턴).
  const found = messages?.find((m) => m.id === selectedId) ?? null
  const [remembered, setRemembered] = useState<EmailMessageSummary | null>(null)
  if (found && found !== remembered) setRemembered(found)
  const selectedSummary = found ?? (remembered?.id === selectedId ? remembered : null)
  // 모바일에서 본문이 열리면 목록 헤더(폴더명·🔍·☰·🔔)·동기화 줄 대신 상세 헤더 한 줄만 둔다(U1-1).
  const showListChrome = !(isMobile && selectedId != null)
  useMailScreenContext({
    accountId: accountIdNum ?? null,
    accountEmail,
    folder: folderParam,
    // WP-961 서버 메일함 보기 — 경로 이름(보관·프로젝트 › 견적 — 사이드바 구역 이름 「내 메일함」은 넣지 않는다, WP-979). 메일함 목록 전이면 이름 없이 「메일함」(받은편지함으로 싣지 않게).
    serverFolder: folderView ? (currentFolder ? mailBreadcrumbText(view) : '메일함') : null,
    q: search,
    category: view.apiCategory || null,
    needsReply: view.kind === 'needsReply',
    count: messages?.length,
    selected: selectedSummary,
  })

  // 답장 draft 생성(조립은 모듈 함수 buildReplyDraft).
  const buildReply = (detail: EmailMessageDetail, all: boolean) =>
    buildReplyDraft(detail, all, accountIdNum as number, accountEmail ?? '')
  function onReply(d: EmailMessageDetail) { openCompose(buildReply(d, false)) }
  function onReplyAll(d: EmailMessageDetail) { openCompose(buildReply(d, true)) }
  function onForward(d: EmailMessageDetail) {
    const quote = buildQuote(d, 'forward')
    // 원본 첨부를 칩으로 미리 넣는다(WP-574). 인용문이 cid 로 다시 붙이는 본문 이미지는 빼 같은 그림이 두 번 붙지 않게 한다.
    const inlined = new Set(quote.inlineImages.map((i) => i.attachment.id))
    openCompose({
      mode: 'forward',
      accountId: accountIdNum as number,
      to: [], cc: [], bcc: [],
      subject: withPrefix('Fwd:', d.subject),
      initialHtml: '',
      quote,
      attachments: forwardAttachments(d.attachments ?? [], inlined),
      inReplyToMessageId: null,
      // 전달은 답장 대상이 없어 원본 id 를 따로 둔다 — 임시저장을 다시 열 때 인용문을 다시 만든다(WP-577).
      sourceMessageId: d.id,
    })
  }
  // AI 답장 초안 — 인용문은 buildReply 가 이미 담은 것을 승계하고, 초안 본문만 얹는다.
  async function onAiReplyDraft(d: EmailMessageDetail) {
    const base = buildReply(d, false)
    try {
      const { draftBody } = await replyDraft.mutateAsync(d.id)
      // draftBody 는 plain text — 새 메일 AI 초안(WP-576)과 같은 변환으로 escape 후 문단 HTML 로 넣는다(HTML 주입 방지).
      openCompose({ ...base, initialHtml: plainTextToMailHtml(draftBody) })
    } catch {
      /* 토스트는 훅 onError 가 처리 */
    }
  }
  // #520 AI 이슈 생성 — 모달을 열고 AI 초안을 로드해 사전채움.
  async function onAiIssue(d: EmailMessageDetail) {
    setDraftData(null)
    setIssueDialog({ messageId: d.id, subject: d.subject ?? '' })
    try {
      const draft = await issueDraft.mutateAsync(d.id)
      setDraftData(draft)
    } catch {
      /* 토스트는 훅 onError 가 처리 */
    }
  }
  // accountId 미지정 → 첫 계정으로 이동. 계정이 없으면 안내.
  if (!accountId) {
    if (accountsLoading) {
      return <div className="p-6 text-sm text-muted-foreground">불러오는 중…</div>
    }
    if (accounts && accounts.length > 0) {
      return <Navigate to={`/mail/${accounts[0].id}`} replace />
    }
    if (isMobile) {
      // 모바일(U1-4): 탭 루트 헤더("메일" + 🔔)는 유지하고, 알림 빈 상태와 같은 공용 빈 화면(U3-R11) + 44pt 주 버튼.
      // 헤더가 사라지면 탭 루트인데도 제목·알림 진입점이 없는 빈 화면이 된다.
      // ☰ 는 숨긴다(U3-R12) — 계정이 없으면 시트(폴더 목록)에 볼 것이 없다.
      return (
        <Page>
          <Page.Header title="메일" mobileHideSheetTrigger />
          <MobileEmptyState
            data-testid="mail-empty-accounts"
            className="flex-1"
            icon={Mail}
            title="연결된 메일 계정이 없습니다"
            description="메일 계정을 연결하면 받은편지함을 여기서 볼 수 있어요."
            action={
              <Button asChild className="h-11 px-5" data-testid="mail-connect-account">
                <Link to="/settings/mail">메일 계정 연결</Link>
              </Button>
            }
          />
        </Page>
      )
    }
    return (
      <div data-testid="mail-empty-accounts" className="p-8 text-sm text-muted-foreground">
        {/* 계정이 없으면 헤더가 없어 화면 이름을 숨은 h1 로 둔다 — 스크린리더 제목 이동용(WP-816). */}
        <h1 className="sr-only">메일</h1>
        연결된 메일 계정이 없습니다.{' '}
        <Link to="/settings/mail" className="text-primary underline">
          설정에서 메일 계정을 추가
        </Link>
        하세요.
      </div>
    )
  }

  return (
    <Page>
      {/* 전폭 헤더 — 폴더명 + 동기화(받은편지함) + 검색. 기존 목록 툴바 대체. */}
      {showListChrome && (
        <Page.Header
          // 모바일은 「현재 이름」 한 줄(§B-1 「모바일 헤더」), 데스크톱은 제목 자리에 경로(공용 Breadcrumb, WP-979).
          title={isMobile ? view.title : undefined}
          srTitle={isMobile ? undefined : view.title}
          leadingGrow={!isMobile}
          leading={<Breadcrumb items={crumbItems} aria-label="메일함 경로" data-testid="mail-breadcrumb" />}
          actions={
            <>
              <input
                type="search"
                data-testid="mail-search"
                aria-label="메일 검색"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder="제목·보낸사람 검색"
                className="w-48 rounded-md border bg-background px-3 py-1.5 text-sm"
              />
            </>
          }
          // 모바일: 메뉴 내용이 검색 입력 하나뿐이라 ⋯ 대신 🔍 트리거로 의미를 드러낸다(U1-2).
          mobileMenuIcon={<Search className="h-5 w-5" />}
          mobileMenuLabel="메일 검색"
        />
      )}
      {/* 리스트 툴바 — INBOX 전용: 아이콘 새로고침 + 마지막 동기화 상대시각 + 진행률.
          서버 메일함 보기(WP-961)도 INBOX 로 해석되지만 계정 동기화 대신 목록 위 상태 줄이 메일함 가져오기를 맡아 오른쪽 그룹만 둔다. */}
      {showListChrome && folderParam === 'INBOX' && (
        // overflow-x-clip — 혹시 넘쳐도 포커스·클릭이 바깥 셸을 가로로 스크롤해 화면이 밀린 채 남지 않게(clip 은 스크롤 대상이 아니다).
        <div className="flex items-center overflow-x-clip border-b py-1.5">
          {/* 패딩을 안쪽 상자에 둬서(pl-3 pr-4) 오른쪽 끝이 목록 행의 시각 끝선(px-4)에 맞는다.
              lg 폭은 목록 열과 같은 min(절반, max-w-md) — flex-1 끼리 나누면 패딩만큼 목록 열보다 넓어져 구분선을 넘는다. */}
          <div className="flex min-w-0 flex-1 items-center gap-2 pl-3 pr-4 lg:w-1/2 lg:max-w-md lg:flex-none">
            {!folderView && (
              <>
                <button
                  type="button"
                  data-testid="mail-sync"
                  aria-label="지금 새로고침"
                  onClick={() => sync.mutate()}
                  disabled={sync.isPending || (syncStatus.data?.running ?? false)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 max-lg:h-10 max-lg:w-10"
                >
                  <RefreshCw
                    className={cn('h-4 w-4', (sync.isPending || syncStatus.data?.running) && 'animate-spin')}
                  />
                </button>
                {/* 마지막 성공 동기화 시각 — null이면 회색 점+"동기화 안 됨", 있으면 녹색 점+상대시각 표시.
                    한 줄 유지 — 폭이 모자라면 말줄임(절대 시각은 title). 진행률이 보이는 동안은 숨긴다(진행률이 더 새 정보, 좁은 목록 열에서 넘침 방지). */}
                <span
                  data-testid="mail-synced-at"
                  title={currentAccount?.lastSyncedAt ? formatDateTime(currentAccount.lastSyncedAt) : undefined}
                  className={cn(
                    'flex min-w-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground',
                    bodiesProgress && 'hidden',
                  )}
                >
                  {currentAccount?.lastSyncedAt ? (
                    <>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" aria-hidden />
                      <span className="truncate">{`${formatRelativeTime(currentAccount.lastSyncedAt)} 동기화됨`}</span>
                    </>
                  ) : (
                    <>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" aria-hidden />
                      <span className="truncate">동기화 안 됨</span>
                    </>
                  )}
                </span>
                {/* 본문 보충 진행률 — 두 줄로 꺾여 툴바 높이가 바뀌지 않게 한 줄 고정. */}
                {bodiesProgress && (
                  <span data-testid="mail-sync-progress" className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                    본문 {syncStatus.data?.done}/{syncStatus.data?.total}
                  </span>
                )}
              </>
            )}
            {/* 오른쪽 그룹 — "안 읽은 메일만" 토글(회신필요엔 없음) + 모두 읽음. 감싼 div 가 ml-auto 를 가져 회신필요에서도 오른쪽에 붙는다(F24). */}
            <div className="ml-auto flex items-center gap-2">
              {view.unreadToggleVisible && (
                <button
                  type="button"
                  data-testid="mail-unread-toggle"
                  aria-pressed={view.unreadOnly}
                  onClick={() => {
                    const next = new URLSearchParams(params)
                    if (view.unreadOnly) next.delete('unread')
                    else next.set('unread', 'true')
                    setParams(next)
                  }}
                  className={cn(
                    // 모바일: 시각 h-9 + after 히트 영역 확장으로 터치 44px 확보. 포커스 링은 디자인 시스템 규칙.
                    'relative inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40',
                    "max-lg:h-9 max-lg:px-4 max-lg:text-sm max-lg:after:absolute max-lg:after:-inset-y-1 max-lg:after:inset-x-0 max-lg:after:content-['']",
                    view.unreadOnly ? cn(TOGGLE_ON_CLASS, 'font-semibold') : 'text-foreground hover:bg-accent/50',
                  )}
                >
                  {/* 켜짐을 색에만 의존하지 않도록 점 표시(목업). */}
                  {view.unreadOnly && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary" />}
                  안 읽은 메일만
                </button>
              )}
              {/* 툴바는 INBOX 전용이라 보낸편지함엔 렌더되지 않지만, 보기 종류로도 한 번 더 막는다. */}
              {view.kind !== 'sent' && (
                <button
                  type="button"
                  data-testid="mail-mark-all-read"
                  disabled={markAllKnownZero || markAll.isPending}
                  onClick={() => void startMarkAll()}
                  aria-label="모두 읽음"
                  className={cn(
                    // 모바일은 아이콘만 둔 원형 버튼(시각 36px + after 사방 4px 확장 = 터치 44px) — 360px 에서도 툴바가 넘치지 않게.
                    'relative inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-foreground outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50',
                    "max-lg:h-9 max-lg:w-9 max-lg:justify-center max-lg:px-0 max-lg:after:absolute max-lg:after:-inset-1 max-lg:after:content-['']",
                  )}
                >
                  <CheckCheck aria-hidden className="h-3.5 w-3.5 max-lg:h-4 max-lg:w-4" />
                  <span className="max-lg:sr-only">모두 읽음</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {/* 본문 — 목록·상세 마스터-디테일이라 스크롤·여백은 각 칸이 소유(padded=false), 행은 px-4 페이지 여백. */}
      <Page.Body padded={false}>
        {/* 목록 (마스터) — 좁은 화면 + 선택 시 숨김 */}
        <div
          className={cn(
            'flex min-w-0 flex-1 flex-col border-r lg:max-w-md',
            selectedId != null && 'hidden lg:flex',
          )}
          data-testid="mail-list"
        >
          {folderView && (
            // WP-961 서버 메일함 상태 줄 — 가져온 기간·시각 + 새로 고침 + 더 가져오기. 목록이 비어 있어도 보인다.
            <MailFolderStatusRow
              folder={currentFolder}
              missing={folders != null && currentFolder == null}
              syncing={folderSyncing}
              olderSyncing={olderSyncing}
              onRefresh={() => currentFolder && runFolderSync({ folderId: currentFolder.id, older: false })}
              onFetchOlder={fetchOlder}
            />
          )}
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">불러오는 중…</div>
          ) : isError ? (
            <div className="p-6 text-center">
              <p className="text-sm text-destructive mb-2">목록을 불러오지 못했습니다</p>
              <Button variant="outline" size="sm" onClick={() => refetchMessages()}>다시 시도</Button>
            </div>
          ) : !messages || messages.length === 0 ? (
            // P2: 필터별 정직 빈 상태 — needsReply 긍정, category 중립, 그 외 일반.
            view.kind === 'needsReply' ? (
              <div data-testid="mail-needsreply-empty" className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
                <Check className="h-8 w-8 text-primary" />
                <p className="text-sm font-medium">회신이 필요한 안 읽은 메일이 없어요 🎉</p>
                {/* WP-146: 처리완료가 없어졌으므로 "열면 빠진다"는 규칙을 빈 상태에서 알려 준다. */}
                <p className="text-xs">메일을 열면 회신필요에서 빠져요.</p>
              </div>
            ) : view.unreadOnly ? (
              // WP-186: 안 읽은 메일만 보기 0건 — 보기별 문구.
              <div data-testid="mail-view-empty" className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
                <Check className="h-8 w-8 text-primary" />
                <p className="text-sm font-medium">
                  {view.kind === 'all' ? '안 읽은 메일이 없어요.' : `${view.title} 메일 중 안 읽은 메일이 없어요.`}
                </p>
                <Button
                  variant="link"
                  size="sm"
                  data-testid="mail-view-empty-show-all"
                  onClick={() => {
                    const next = new URLSearchParams(params)
                    next.delete('unread')
                    setParams(next)
                  }}
                >
                  모든 메일 보기
                </Button>
              </div>
            ) : folderView && !search ? (
              // WP-961 서버 메일함 0건 — 처음 가져오는 중이면 그렇게, 아니면 중립 문구(「동기화를 눌러보세요」는 받은편지함 안내).
              <div data-testid="mail-box-empty" className="p-6 text-sm text-muted-foreground">
                {folderSyncing ? '메일함을 가져오는 중…' : '이 메일함에 메일이 없습니다.'}
              </div>
            ) : view.kind === 'category' ? (
              // 분류 필터 적용 중 0건 — "받은 메일 없음" 과 구분되는 중립 문구.
              <div data-testid="mail-category-empty" className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
                <Inbox className="h-8 w-8" />
                <p className="text-sm font-medium">이 분류에 해당하는 메일이 없어요.</p>
              </div>
            ) : (
              <>
                <div data-testid="mail-list-empty" className="p-6 text-sm text-muted-foreground">
                  {search
                    ? '검색 결과가 없습니다'
                    : folderParam === 'SENT'
                      ? '보낸 메일이 없습니다.'
                      : '받은 메일이 없습니다. 동기화를 눌러보세요.'}
                </div>
                {/* WP-965 최근 범위에 메일이 없어도 그 이전 메일은 서버에 있을 수 있다 — 빈 목록에서도 이어 받는다. */}
                {olderFolder != null && listEnd}
              </>
            )
          ) : (
            <div ref={setListScrollEl} data-testid="mail-list-scroll" className="flex-1 overflow-y-auto" {...longPress}>
              {messages.map((m) => (
                <MessageRow
                  key={m.id}
                  m={m}
                  open={selectedId === m.id}
                  sheetTarget={sheet.open && sheet.target?.id === m.id}
                  onSelect={() => mailParam.open(String(m.id))}
                  pendingVisible={view.kind !== 'sent' && !folderView && classificationActive}
                  aiSignalsVisible={!folderView}
                  showToggle={!touchShell}
                  // 상태만 뒤집는다 — 열린 메일이어도 상세는 그대로 둔다(조회가 읽음 처리하지 않는다, WP-214).
                  onToggleRead={() => toggleRow(m)}
                  moveActions={touchShell ? null : moveActionsFor(m.id)}
                  linkTarget={!touchShell && accountIdNum != null ? () => mailShareTarget(accountIdNum, m) : undefined}
                />
              ))}
              {listEnd}
            </div>
          )}
        </div>

        {/* WP-187 모바일 길게 누르기 작업 시트 — 터치 셸에서만 렌더(데스크톱은 hover 토글) */}
        {touchShell && (
          <MessageActionSheet
            open={sheet.open}
            onClose={sheet.close}
            actions={sheet.target ? sheetActions(sheet.target) : []}
            previewVisible
            preview={sheet.target ? `${sheet.target.fromName || sheet.target.fromAddress || ''} · ${mailSubjectText(sheet.target.subject)}` : undefined}
          />
        )}

        {/* 본문 (디테일) — 좁은 화면은 선택 시 전체폭, 미선택 시 숨김 */}
        <div
          className={cn(
            'min-w-0 flex-1',
            selectedId == null ? 'hidden lg:block' : 'flex flex-col lg:block',
          )}
          data-testid="mail-detail-pane"
        >
          {/* 모바일 상세 헤더(‹·제목·⋯·✦)는 MessageDetailPanel 이 그린다 — ⋯ 메뉴(원본 배경·AI 이슈)가 패널 상태를 쓴다(WP-400). */}
          <MessageDetailPanel
            messageId={selectedId}
            accountId={accountIdNum}
            aiEnabled={aiEnabled}
            aiDraftPending={replyDraft.isPending}
            onReply={onReply}
            onReplyAll={onReplyAll}
            onForward={onForward}
            onAiReplyDraft={onAiReplyDraft}
            onAiIssue={onAiIssue}
            issueDraftPending={issueDraft.isPending}
            onMarkUnread={() => {
              if (selectedId != null) markUnreadAndClose(selectedId)
            }}
            onBack={mailParam.close}
            moveActions={selectedId != null ? moveActionsFor(selectedId) : null}
            onOpenMoveSheet={() => selectedId != null && setMoveSheetIds([selectedId])}
          />
        </div>
        {/* WP-962 모바일 「옮기기」 메일함 고르기 — 길게 누르기 시트·상세 ⋯ 메뉴에서 연다. */}
        <MailMoveTargetSheet
          open={moveSheetIds != null}
          onClose={() => setMoveSheetIds(null)}
          targets={moveTargets}
          onPick={(t) => moveSheetIds && startMove(moveSheetIds, t)}
        />
      </Page.Body>
      {/* WP-187 모두 읽음 확인 — 실행 취소 대신 확인을 거친다. */}
      <MailMarkAllReadDialog
        pending={markAllPending}
        scopeLabel={markAllPending?.label ?? ''}
        mobile={isMobile}
        onCancel={() => setMarkAllPending(null)}
        onConfirm={() => {
          // Radix 가 닫으며 onCancel 도 부르므로 pending 을 먼저 캡처한다.
          const p = markAllPending
          setMarkAllPending(null)
          // 누른 시점의 범위·asOf 만 쓴다(키가 같을 때만 열려 있으므로 계정도 같다).
          if (!p) return
          const keptKeyAtRun = keepKey
          markAll.mutate(
            { ...p.scope, asOf: p.asOf },
            {
              // 유지 스냅샷도 읽음으로 맞춘다 — 재조회 목록에서 빠진 행이 옛 스냅샷(안읽음)으로 되살아나 굵게 보이지 않게.
              onSuccess: () =>
                setKept((k) => (k.key !== keptKeyAtRun ? k : { key: k.key, rows: markSeenInKept(k.rows, 'all', true) })),
            },
          )
        }}
      />
      {/* #520 메일→이슈 승격 모달 */}
      {issueDialog && (
        <MailToIssueDialog
          open
          messageId={issueDialog.messageId}
          mailSubject={issueDialog.subject}
          draft={draftData}
          onOpenChange={(v) => { if (!v) setIssueDialog(null) }}
          onCreated={() => { /* linked-issue 무효화는 usePromoteToIssue 훅이 처리 */ }}
        />
      )}
    </Page>
  )
}

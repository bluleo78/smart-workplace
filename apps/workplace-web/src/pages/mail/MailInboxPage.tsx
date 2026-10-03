import { useQueryClient } from '@tanstack/react-query'
import { Check, CheckCheck, Download, Forward, Inbox, Loader2, Mail, MailOpen, Moon, Paperclip, RefreshCw, Reply, ReplyAll, Search, Sparkles, Sun } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { AiContent } from '@/components/ai/AiContent'
import { AiSignalBadge } from '@/components/ai/AiSignalBadge'
import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import { MessageActionSheet, type MessageSheetAction } from '@/components/chat/MessageActionSheet'
import { PageHeader } from '@/components/layout/PageHeader'
import { useHideTabBar } from '@/components/mobile/MobileChromeContext'
import { MobileDetailBar } from '@/components/mobile/MobileDetailBar'
import { MobileEmptyState } from '@/components/mobile/MobileEmptyState'
import { Button } from '@/components/ui/button'
import { useAiAvailable } from '@/hooks/useAiAvailable'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useIsTouchShell } from '@/hooks/useIsTouchShell'
import { useMailDarkHtml } from '@/hooks/useMailDarkHtml'
import { useMessageListLongPress } from '@/hooks/useMessageListLongPress'
import { useMessageSheet } from '@/hooks/useMessageSheet'
import { buildMailContext } from '@/lib/aiScreenContext/builders/mail'
import { handleApiError } from '@/lib/api-error'
import { formatClockTimePadded, formatDateMonthDayPadded, formatRelativeTime, parseUtcDate } from '@/lib/formatters'
import { markSeenInKept, mergeKeptRows } from '@/lib/mailKeepRows'
import { isNeedsReply } from '@/lib/mailNeedsReply'
import { buildQuote, escapeHtml } from '@/lib/mailQuote'
import { mailViewHref, resolveMailView, unreadCountForView } from '@/lib/mailView'
import { cn } from '@/lib/utils'

import { downloadMailAttachment, getMessage, getViewUnreadCount, type MailViewScope } from '../../api/mailMessages'
import { type ComposeDraft,useMailCompose } from '../../components/mail/MailComposeContext'
import { MailMarkAllReadDialog } from '../../components/mail/MailMarkAllReadDialog'
import { mailMessageKeys } from '../../hooks/queries/mailMessageKeys'
import { useMailAccounts } from '../../hooks/queries/useMailAccounts'
import {
  syncReadCaches,
  useGenerateMailSummary,
  useInlineMailHtml,
  useIssueDraft,
  useLinkedIssue,
  useMailMessage,
  useMailMessages,
  useMailMessageSubject,
  useMailSummary,
  useMarkAllRead,
  useReplyDraft,
  useSyncMailbox,
  useSyncStatus,
  useToggleRead,
  useUnreadCounts,
} from '../../hooks/queries/useMailMessages'
import type { EmailMessageDetail, EmailMessageSummary, MailCategory, MailFolder, MailIssueDraft } from '../../types/mailMessage'
import { MailToIssueDialog } from './MailToIssueDialog'

// 목록 로딩 중 시트·길게 누르기에 넘길 빈 목록 — 렌더마다 새 배열을 만들지 않게 모듈에 하나만 둔다.
const EMPTY_MESSAGES: EmailMessageSummary[] = []

// 수신 시각을 간략 표기(오늘=시각, 그 외=월/일).
function formatReceivedAt(iso: string | null): string {
  if (!iso) return ''
  const d = parseUtcDate(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay ? formatClockTimePadded(iso) : formatDateMonthDayPadded(iso)
}

// 목록 한 행 — 안 읽음은 굵게, 첨부 클립 표시.
function MessageRow({
  m,
  active,
  onSelect,
  pendingVisible,
  showToggle,
  onToggleRead,
}: {
  m: EmailMessageSummary
  active: boolean
  onSelect: () => void
  /** "분류 전" 배지 노출 여부 — 받은편지함 계열이고 AI 분류가 켜진 계정일 때만. */
  pendingVisible: boolean
  /** WP-187 hover 읽음 전환 버튼 노출 — 터치 셸에는 hover 가 없어 렌더하지 않는다(길게 누르기 시트가 담당). */
  showToggle: boolean
  /** WP-187 읽음↔안읽음 전환(행 열기와 별개). */
  onToggleRead: () => void
}) {
  const navigate = useNavigate()
  // WP-146: 회신필요 판정은 행마다 한 번만 계산.
  const needsReply = isNeedsReply(m)
  return (
    // div role="button" — 내부 AiSignalBadge 가 실제 <button>이므로 바깥을 <button>으로
    // 감싸면 버튼 중첩(HTML 유효성 위반 + a11y 위험, #577)이 발생해 카드형 클릭 영역 패턴으로 전환.
    <div
      role="button"
      tabIndex={0}
      data-testid={`mail-row-${m.id}`}
      // WP-187: 길게 누르기 등 행 단위 위임 처리에서 메시지 id 를 찾기 위한 표식.
      data-message-id={m.id}
      // a11y(#699): 발신자+제목만으로 accessible name 구성 — 스니펫/AI배지/날짜까지
      // 자식 텍스트가 섞이면 장문화되어 SR 청취성 저하(WCAG 1.3.1/4.1.2). 날짜는
      // 식별에 필수가 아니므로 간결함 우선으로 제외.
      aria-label={`${m.fromName || m.fromAddress || '(보낸사람 없음)'} ${m.subject || '(제목 없음)'}`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        // group — 안의 읽음 전환 버튼을 행 hover 에 맞춰 드러낸다(WP-187).
        'group relative flex w-full cursor-pointer flex-col gap-0.5 border-b px-4 py-3 text-left transition-colors',
        active ? 'bg-accent' : 'hover:bg-accent/50',
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
        {showToggle && (
          // WP-187: hover 시 읽음/안읽음 전환 — 행 열기와 분리(stopPropagation).
          // display 대신 opacity 로 숨겨 탭 순서에 남긴다 — 키보드 포커스 시에도 드러난다(접근성).
          // onKeyDown 도 멈춘다 — 행의 Enter/Space 처리(preventDefault)가 버튼 키보드 활성화를 삼키지 않게.
          <button
            type="button"
            data-testid={`mail-row-toggle-read-${m.id}`}
            aria-label={m.seen ? '안읽음으로 표시' : '읽음으로 표시'}
            title={m.seen ? '안읽음으로 표시' : '읽음으로 표시'}
            onClick={(e) => {
              e.stopPropagation()
              onToggleRead()
            }}
            onKeyDown={(e) => e.stopPropagation()}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground opacity-0 outline-none transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/40 group-hover:opacity-100"
          >
            {m.seen ? <Mail className="h-3.5 w-3.5" /> : <MailOpen className="h-3.5 w-3.5" />}
          </button>
        )}
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatReceivedAt(m.receivedAt)}
        </span>
      </span>
      <span className={cn('truncate text-sm', m.seen ? 'text-muted-foreground' : 'font-medium')}>
        {m.subject || '(제목 없음)'}
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
      {(m.aiCategory || needsReply || (pendingVisible && m.categoryPending)) && (
        <span className="mt-0.5 flex items-center gap-1">
          {/* AI 분류 배지 — 클릭 시 해당 분류 필터로 이동(onClick + stopPropagation 으로 행 선택과 분리). */}
          {m.aiCategory && (
            <AiSignalBadge
              variant="info"
              data-testid={`mail-badge-category-${m.id}`}
              onClick={(e) => {
                e.stopPropagation()
                navigate(mailViewHref(m.accountId, m.aiCategory as MailCategory, false))
              }}
            >
              {m.aiCategory}
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
  )
}

function withPrefix(prefix: string, subject: string | null): string {
  const s = subject ?? ''
  return s.toLowerCase().startsWith(prefix.toLowerCase()) ? s : `${prefix} ${s}`
}
// "이름" <a@b> / a@b 모두에서 순수 이메일만 추출.
function extractEmail(token: string): string {
  const m = token.match(/<([^>]+)>/)
  return m ? m[1].trim() : token.trim()
}

// 첨부 파일 목록 — 파일명·아이콘 + 다운로드 버튼. Bearer 인증이 필요해 단순 <a href> 대신 axios 를 사용한다.
function AttachmentList({
  attachments,
}: {
  attachments: { id: number; filename: string | null; contentType: string | null; sizeBytes: number; contentId: string | null }[]
}) {
  const [downloadingId, setDownloadingId] = useState<number | null>(null)

  const handleDownload = async (attachmentId: number, filename: string | null) => {
    if (downloadingId !== null) return
    setDownloadingId(attachmentId)
    try {
      await downloadMailAttachment(attachmentId, filename || `attachment-${attachmentId}`)
    } catch {
      toast.error('첨부 파일 다운로드에 실패했습니다')
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <ul data-testid="mail-attachments" className="mt-2 flex flex-wrap gap-2">
      {attachments.map((a) => (
        <li
          key={a.id}
          className="flex items-center gap-1 rounded border bg-muted px-2 py-1 text-xs"
        >
          <Paperclip className="h-3 w-3 shrink-0" />
          <span>{a.filename || '첨부파일'}</span>
          <button
            type="button"
            data-testid={`mail-attachment-download-${a.id}`}
            aria-label={`${a.filename || '첨부파일'} 다운로드`}
            disabled={downloadingId === a.id}
            onClick={() => handleDownload(a.id, a.filename)}
            className="ml-1 rounded p-0.5 hover:bg-accent disabled:opacity-50"
          >
            <Download className="h-3 w-3" />
          </button>
        </li>
      ))}
    </ul>
  )
}

// 선택한 메시지의 본문 패널 — text 우선, HTML 만 있으면 스크립트 차단 iframe 으로 렌더.
function MessageDetailPanel({
  messageId,
  aiEnabled,
  onReply,
  onReplyAll,
  onForward,
  onAiReplyDraft,
  aiDraftPending,
  onAiIssue,
  issueDraftPending,
  onMarkUnread,
}: {
  messageId: number | null
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
}) {
  const { data: detail, isLoading, isError, refetch } = useMailMessage(messageId)
  // 비서가 있을 때만 요약 조회 — aiAvailable false면 fetch 자체를 생략해 불필요한 API 호출을 막는다.
  const aiAvailable = useAiAvailable()
  // WP-187: 데스크톱 상세의 "안읽음" 아이콘 판정 — 모바일은 상세 헤더 바(trailing)가 맡는다. 조기 return 앞(훅 순서 고정).
  const isMobile = useIsMobile()
  const { data: summaryData, isFetching: summaryFetching } = useMailSummary(messageId, aiAvailable)
  // WP-149 요약 생략 메일의 "AI 요약" 버튼 — 누를 때만 생성(결과는 요약 캐시에 바로 반영)
  const generateSummary = useGenerateMailSummary()
  // 생성 중 표시는 이 메일을 생성 중일 때만 — 다른 메일로 옮겨도 스켈레톤이 따라오지 않게
  const generatingThis = generateSummary.isPending && generateSummary.variables === messageId
  const summaryLoading = summaryFetching || generatingThis
  const showSummaryButton =
    aiAvailable && !summaryLoading && !summaryData?.summary && summaryData?.status === 'SKIPPED'
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

  if (!messageId) {
    /** 빈 상태 — DS §2.5: 아이콘 + 제목 + 설명 (CTA는 단순 안내이므로 생략) */
    return (
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
      </div>
    )
  }
  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">불러오는 중…</div>
  }
  if (isError || !detail) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-destructive mb-2">메일을 불러오지 못했습니다</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>다시 시도</Button>
      </div>
    )
  }

  return (
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
              <div data-testid="mail-ai-summary-loading" className="mt-2 flex flex-col gap-1.5">
                <div className="h-2 w-full animate-pulse rounded bg-ai-accent/20" />
                <div className="h-2 w-3/4 animate-pulse rounded bg-ai-accent/20" />
                <div className="h-2 w-1/2 animate-pulse rounded bg-ai-accent/20" />
              </div>
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
        <h2 className="text-lg font-semibold">{detail.subject || '(제목 없음)'}</h2>
        {/* #520 이슈 승격 배지 — issueKey 있을 때만 표시. AI 표면이므로 ai-accent 시맨틱 토큰 사용. */}
        {linked.data?.issueKey && (
          <span
            data-testid="mail-linked-issue"
            className="inline-flex items-center gap-1 rounded bg-ai-accent-subtle px-1.5 py-0.5 text-xs text-ai-accent"
          >
            이슈로 만듦: {linked.data.issueKey}
          </span>
        )}
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
        {/* 답장/전체답장/전달 버튼 — shadcn Button으로 앱 전체 버튼 스타일 일관성 유지. */}
        <div className="mt-2 flex gap-2">
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
          {/* WP-187 안읽음으로 표시(데스크톱 아이콘) — 누르면 상세가 닫힌다(열린 상세가 재조회되면 다시 읽음 처리되므로). */}
          {!isMobile && (
            <Button
              variant="outline"
              size="sm"
              data-testid="mail-mark-unread"
              aria-label="안읽음으로 표시"
              title="안읽음으로 표시"
              onClick={onMarkUnread}
            >
              <Mail className="h-3.5 w-3.5" />
            </Button>
          )}
          {/* AI 답장 초안 버튼 — 비서 있고 AI 사용 계정에서만 노출. AI 기능이므로 ai-accent 보조 컬러(아이콘+색, 디자인시스템 §7.2). */}
          {aiAvailable && aiEnabled && (
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
          {aiAvailable && aiEnabled && (
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
        </div>
        {listedAttachments.length > 0 && (
          <AttachmentList attachments={listedAttachments} />
        )}
      </div>
      <div className="flex-1 p-4">
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
            <iframe
              data-testid="mail-body-html"
              title="메일 본문"
              sandbox=""
              srcDoc={bodyHtml}
              className="min-h-[300px] w-full flex-1 border-0"
            />
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">본문이 없습니다</div>
        )}
      </div>
    </div>
  )
}

/**
 * 받은편지함/보낸편지함 — 좌측 메시지 목록(검색·동기화) + 우측 본문(마스터-디테일).
 * 계정은 /mail/:accountId 로 선택하며, accountId 가 없으면 첫 계정으로 리다이렉트한다.
 * 폴더 토글: ?folder=sent → SENT, 기본 INBOX.
 */
export function MailInboxPage() {
  const { accountId } = useParams()
  const isMobile = useIsMobile()
  const [params, setParams] = useSearchParams()
  const search = params.get('q') ?? ''
  // 검색 입력 draft — 타이핑은 즉시 반영하되 URL(및 그 값을 쓰는 useMailMessages 쿼리)은
  // 300ms debounce 후에만 갱신해 키 입력마다 목록 API 가 재요청되지 않게 한다(#814).
  // IssueFilterBar 의 q debounce 패턴과 동일.
  const [searchDraft, setSearchDraft] = useState(search)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearchDraft(search)
  }, [search])
  useEffect(() => {
    if (searchDraft === search) return
    const t = setTimeout(() => {
      setParams(
        (prev) => {
          const sp = new URLSearchParams(prev)
          if (searchDraft) sp.set('q', searchDraft)
          else sp.delete('q')
          return sp
        },
        { replace: true },
      )
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft])
  // URL ?messageId=N 으로 초기 선택(홈 위젯 딥링크). 없으면 null.
  const [selectedId, setSelectedId] = useState<number | null>(
    () => Number(params.get('messageId')) || null,
  )
  // 모바일: 본문(상세)이 열려 있으면 하단 탭바를 숨긴다(WP-125).
  useHideTabBar(selectedId != null)

  // 폴더 파라미터: ?folder=sent → SENT, 기본 INBOX.
  const folderParam = (params.get('folder') === 'sent' ? 'SENT' : 'INBOX') as MailFolder

  // 계정·폴더 전환 시 이전 선택 메시지가 남지 않도록 초기화.
  // prevRef 로 이전값을 추적해 "실제로 바뀐 경우"에만 초기화 — 마운트·StrictMode 이중실행 모두 안전.
  const prevRef = useRef<{ accountId: string | undefined; folderParam: string } | null>(null)
  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = { accountId, folderParam }
    // 이전값이 없으면(최초 마운트) 건너뜀 — ?messageId 초기 선택 보호
    if (!prev) return
    // 실제로 값이 바뀐 경우에만 초기화
    if (prev.accountId !== accountId || prev.folderParam !== folderParam) {
      setSelectedId(null)
    }
  }, [accountId, folderParam])

  const { data: accounts, isLoading: accountsLoading } = useMailAccounts()
  const accountIdNum = accountId ? Number(accountId) : undefined

  // WP-186: URL → 보기 해석(사이드바와 같은 규칙). 계수 로딩·실패 중에는 분류 활성으로 본다(사이드바와 동일).
  const { data: unreadCounts } = useUnreadCounts(accountIdNum)
  const classificationActive = unreadCounts?.classificationActive ?? true
  const view = resolveMailView(params, classificationActive)

  const { data: fetchedMessages, isLoading, isError, refetch: refetchMessages } = useMailMessages(
    accountIdNum, folderParam, search, view.unreadOnly, view.apiCategory, view.kind === 'needsReply',
  )
  // WP-186: 안 읽은 메일만 보기에서 연 메일은 보기·토글을 바꾸기 전까지 유지 — 보기 key 가 바뀌면 초기화.
  // 키에 계정·검색어를 포함한다 — 같은 페이지 인스턴스가 계정/검색만 바뀌어도 유지 집합이 새어 나가지 않게.
  const keepKey = `${accountId ?? ''}|${search}|${view.key}`
  // 선택한 행의 스냅샷(읽음 처리본)을 선택 시점에 보관 — 서버가 읽음으로 빼도 mergeKeptRows 가 그대로 되살린다.
  const [kept, setKept] = useState<{ key: string; rows: Map<number, EmailMessageSummary> }>({ key: keepKey, rows: new Map() })
  // 키가 바뀌면 렌더 중에 실제로 비운다(숨기기만 하면 같은 키로 돌아올 때 되살아난다).
  if (kept.key !== keepKey) setKept({ key: keepKey, rows: new Map() })
  const messages = useMemo(
    () => mergeKeptRows(fetchedMessages, kept.key === keepKey ? kept.rows : undefined),
    [fetchedMessages, kept, keepKey],
  )
  const selectRow = (id: number) => {
    setSelectedId(id)
    const row = fetchedMessages?.find((r) => r.id === id)
    if (view.unreadOnly && row) {
      setKept((k) => ({ key: keepKey, rows: new Map(k.key === keepKey ? k.rows : []).set(id, { ...row, seen: true }) }))
    }
  }
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
    const prevKept = kept.key === keepKey ? kept.rows.get(id) : undefined
    const row = prevKept ?? fetchedMessages?.find((r) => r.id === id)
    if (row && (prevKept || (view.unreadOnly && seen))) {
      setKept((k) => ({ key: keepKey, rows: new Map(k.key === keepKey ? k.rows : []).set(id, { ...row, seen }) }))
    }
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
  /**
   * 안읽음으로 표시 + 상세 닫기 — 먼저 선택을 풀어 상세 쿼리를 비활성으로 만든다.
   * 열린 상세가 메일 변경 이벤트로 무효화되면 GET /messages/{id}(markSeen) 재조회로 다시 읽음 처리되기 때문(R5).
   */
  const markUnreadAndClose = (id: number) => {
    setSelectedId(null)
    applyToggle(id, false)
  }
  // 행 버튼·작업 시트 공통 읽음 전환 — 열린 메일을 안읽음으로 바꿀 때만 상세도 닫는다(R5).
  const toggleRow = (m: EmailMessageSummary) =>
    m.seen && m.id === selectedId ? markUnreadAndClose(m.id) : applyToggle(m.id, !m.seen)
  // WP-187 모두 읽음 — 버튼 → 건수 조회(+asOf) → 확인 다이얼로그 → 실행.
  // asOf 는 서버(DB 시계)가 준 문자열을 그대로 되돌려 보낸다 — 확인 뒤 새로 들어온 메일은 읽음 처리하지 않게.
  const markAll = useMarkAllRead(accountIdNum)
  const markAllScope: MailViewScope = { category: view.apiCategory, needsReply: view.kind === 'needsReply', query: search }
  // 누른 시점의 계정·범위 — 건수 조회 중 보기/계정을 바꾸면 이 키가 달라져 응답·다이얼로그를 버린다(다른 보기를 읽음 처리하지 않게).
  const markAllKey = `${accountIdNum ?? ''}|${markAllScope.category}|${markAllScope.needsReply}|${markAllScope.query}`
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
  const markAllKnownZero = !search && unreadCounts != null && unreadCountForView(view, unreadCounts) === 0
  const startMarkAll = async () => {
    if (accountIdNum == null) return
    // 검색 중이면 건수는 검색 결과만 센다 — 표시 이름에도 검색어를 붙여 보기 전체로 오해하지 않게 한다.
    const label = view.breadcrumb.join(' › ') + (markAllScope.query ? ` · "${markAllScope.query}"` : '')
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
  const { openCompose } = useMailCompose()
  const replyDraft = useReplyDraft()
  // #520 AI 이슈 초안 — 버튼 클릭 시 모달 오픈 후 초안 로드.
  const issueDraft = useIssueDraft()
  const [issueDialog, setIssueDialog] = useState<{ messageId: number; subject: string } | null>(null)
  const [draftData, setDraftData] = useState<MailIssueDraft | null>(null)

  // 동기화 진행 상태 구독 — 동기화 트리거(성공/진행 중) 동안만 폴링.
  const syncStatus = useSyncStatus(accountIdNum, sync.isSuccess || sync.isPending)
  const qc = useQueryClient()
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
  // 본인 이메일 주소(전체답장에서 자신을 수신자에서 제외).
  const selfAddress = currentAccount?.emailAddress ?? ''
  // 현재 계정의 AI 사용 여부 — 요약 스트립 표시 여부에 사용.
  const aiEnabled = currentAccount?.aiEnabled ?? false

  // WP-187 모바일: hover 대신 길게 누르기 → 작업 시트(채팅과 같은 패턴). 행에는 data-message-id 가 있다.
  // 훅이므로 !accountId 조기 return 보다 앞에 둔다.
  const aiAvailable = useAiAvailable()
  const sheetMessages = messages ?? EMPTY_MESSAGES
  const sheet = useMessageSheet(sheetMessages)
  const longPress = useMessageListLongPress(touchShell, (id) => sheetMessages.some((m) => m.id === id), sheet.show)
  // 답장·전달·AI 이슈 초안은 본문이 필요하다 — 상세를 받아(서버에서 열람 처리돼 읽음) 기존 핸들러로 넘긴다.
  // 상세 성공 effect 와 같은 syncReadCaches 로 목록 캐시를 읽음으로 맞추고 안 읽은 수·홈 요약을 다시 받는다(F21).
  // 실패는 다른 메일 작업과 같이 토스트로 알린다(시트는 이미 닫혀 있다).
  const withDetail = async (id: number, fn: (d: EmailMessageDetail) => void) => {
    let d: EmailMessageDetail
    try {
      d = await qc.fetchQuery({ queryKey: mailMessageKeys.detail(id), queryFn: () => getMessage(id) })
    } catch (e) {
      handleApiError(e, '메일을 불러오지 못했어요')
      return
    }
    syncReadCaches(qc, id)
    fn(d)
  }
  // 시트 작업 — 첫 항목(읽음 전환)이 primary. 열린 메일을 안읽음으로 바꿀 때는 상세도 닫는다(R5).
  const sheetActions = (m: EmailMessageSummary): MessageSheetAction[] => [
    {
      key: 'toggle-read',
      label: m.seen ? '안읽음으로 표시' : '읽음으로 표시',
      icon: m.seen ? <Mail /> : <MailOpen />,
      primary: true,
      onSelect: () => toggleRow(m),
    },
    { key: 'reply', label: '답장', icon: <Reply />, onSelect: () => void withDetail(m.id, onReply) },
    { key: 'forward', label: '전달', icon: <Forward />, onSelect: () => void withDetail(m.id, onForward) },
    ...(aiAvailable && aiEnabled
      ? [{ key: 'ai-issue', label: 'AI 이슈 초안', icon: <Sparkles />, onSelect: () => void withDetail(m.id, onAiIssue) }]
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
  // 모바일 상세 헤더 제목 = 열린 메일 제목(채팅·노트와 같은 "‹ 항목 이름" 규칙). 상세 패널과 같은 쿼리를 공유한다.
  const openSubject = useMailMessageSubject(selectedId)
  const detailTitle = openSubject.isSuccess ? openSubject.data || '(제목 없음)' : undefined
  // 모바일에서 본문이 열리면 목록 헤더(폴더명·🔍·☰·🔔)·동기화 줄 대신 상세 헤더 한 줄만 둔다(U1-1).
  const showListChrome = !(isMobile && selectedId != null)
  const screenContext = useMemo(
    () =>
      accountIdNum != null
        ? buildMailContext({
            accountId: accountIdNum,
            accountEmail: currentAccount?.emailAddress ?? null,
            folder: folderParam,
            q: search,
            category: view.apiCategory || null,
            needsReply: view.kind === 'needsReply',
            count: messages?.length,
            selected: selectedSummary
              ? {
                  id: selectedSummary.id,
                  subject: selectedSummary.subject,
                  fromName: selectedSummary.fromName,
                  fromAddress: selectedSummary.fromAddress ?? '',
                  receivedAt: selectedSummary.receivedAt ?? '',
                  aiCategory: selectedSummary.aiCategory,
                  aiNeedsReply: selectedSummary.aiNeedsReply,
                }
              : null,
          })
        : null,
    [accountIdNum, currentAccount?.emailAddress, folderParam, search, view.apiCategory, view.kind, messages?.length, selectedSummary],
  )
  useRegisterAiScreenContext(screenContext)

  // 답장 draft 생성.
  function buildReply(detail: EmailMessageDetail, all: boolean): ComposeDraft {
    const to = detail.fromAddress ? [detail.fromAddress] : []
    const cc = all
      ? [detail.toAddresses, detail.ccAddresses]
          .filter(Boolean)
          .join(', ')
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter((a) => {
            const email = extractEmail(a)
            return email && email !== selfAddress && email !== detail.fromAddress
          })
      : []
    return {
      accountId: accountIdNum as number,
      to,
      cc,
      bcc: [],
      subject: withPrefix('Re:', detail.subject),
      initialHtml: '',
      // 인용문은 에디터 밖 raw HTML/text 로 보관 — AI 개선본 교체(setContent)가 지우지 않는다.
      quote: buildQuote(detail, 'reply'),
      inReplyToMessageId: detail.id,
    }
  }
  function onReply(d: EmailMessageDetail) { openCompose(buildReply(d, false)) }
  function onReplyAll(d: EmailMessageDetail) { openCompose(buildReply(d, true)) }
  function onForward(d: EmailMessageDetail) {
    openCompose({
      accountId: accountIdNum as number,
      to: [], cc: [], bcc: [],
      subject: withPrefix('Fwd:', d.subject),
      initialHtml: '',
      quote: buildQuote(d, 'forward'),
      inReplyToMessageId: null,
    })
  }
  // AI 답장 초안 — 인용문은 buildReply 가 이미 담은 것을 승계하고, 초안 본문만 얹는다.
  async function onAiReplyDraft(d: EmailMessageDetail) {
    const base = buildReply(d, false)
    try {
      const { draftBody } = await replyDraft.mutateAsync(d.id)
      // draftBody 는 plain text — escape 후 개행만 <br/> 로 바꿔 넣는다(HTML 주입 방지).
      const escaped = escapeHtml(draftBody).replace(/\n/g, '<br/>')
      openCompose({ ...base, initialHtml: `<p>${escaped}</p>` })
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
        <div className="flex h-full min-h-0 flex-col">
          <PageHeader title="메일" mobileHideSheetTrigger />
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
        </div>
      )
    }
    return (
      <div data-testid="mail-empty-accounts" className="p-8 text-sm text-muted-foreground">
        연결된 메일 계정이 없습니다.{' '}
        <Link to="/settings/mail" className="text-primary underline">
          설정에서 메일 계정을 추가
        </Link>
        하세요.
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 전폭 헤더 — 폴더명 + 동기화(받은편지함) + 검색. 기존 목록 툴바 대체. */}
      {showListChrome && (
        <PageHeader
          title={
            isMobile ? (
              view.title
            ) : (
              // 데스크톱: 계층 구분자 "›" 를 작고 흐리게(스크린리더는 구분자를 읽지 않고 항목만 읽는다). 상위 항목은 흐린 색.
              view.breadcrumb.map((seg, i) => (
                <span key={seg} className={i < view.breadcrumb.length - 1 ? 'font-medium text-muted-foreground' : undefined}>
                  {i > 0 && (
                    <span aria-hidden className="mx-1.5 text-muted-foreground">
                      ›
                    </span>
                  )}
                  {seg}
                </span>
              ))
            )
          }
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
      {/* 리스트 툴바 — INBOX 전용: 아이콘 새로고침 + 마지막 동기화 상대시각 + 진행률. */}
      {showListChrome && folderParam === 'INBOX' && (
        <div className="flex items-center border-b py-1.5">
          {/* 패딩을 안쪽 상자에 둬서(pl-3 pr-4) 오른쪽 끝이 목록 행의 시각 끝선(px-4)에 맞고 목록/상세 구분선을 넘지 않는다. */}
          <div className="flex min-w-0 flex-1 items-center gap-2 pl-3 pr-4 lg:max-w-md">
            <button
              type="button"
              data-testid="mail-sync"
              aria-label="지금 새로고침"
              onClick={() => sync.mutate()}
              disabled={sync.isPending || (syncStatus.data?.running ?? false)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 max-lg:h-10 max-lg:w-10"
            >
              <RefreshCw
                className={cn('h-4 w-4', (sync.isPending || syncStatus.data?.running) && 'animate-spin')}
              />
            </button>
            {/* 마지막 성공 동기화 시각 — null이면 회색 점+"동기화 안 됨", 있으면 녹색 점+상대시각 표시. */}
            <span data-testid="mail-synced-at" className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {currentAccount?.lastSyncedAt ? (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden />
                  {`${formatRelativeTime(currentAccount.lastSyncedAt)} 동기화됨`}
                </>
              ) : (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" aria-hidden />
                  동기화 안 됨
                </>
              )}
            </span>
            {/* 본문 보충 진행률 — 기존 로직 유지 */}
            {syncStatus.data?.phase === 'BODIES' && syncStatus.data.total > 0 && (
              <span data-testid="mail-sync-progress" className="text-xs text-muted-foreground">
                본문 {syncStatus.data.done}/{syncStatus.data.total}
              </span>
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
                    view.unreadOnly ? 'border-primary/40 bg-primary/10 font-semibold text-primary' : 'text-foreground hover:bg-accent/50',
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
                  className={cn(
                    // 모바일 터치 규격은 토글과 같다(시각 h-9 + after 히트 영역 확장).
                    'relative inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-foreground outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50',
                    "max-lg:h-9 max-lg:px-4 max-lg:text-sm max-lg:after:absolute max-lg:after:-inset-y-1 max-lg:after:inset-x-0 max-lg:after:content-['']",
                  )}
                >
                  <CheckCheck aria-hidden className="h-3.5 w-3.5 max-lg:h-4 max-lg:w-4" />
                  모두 읽음
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {/* 목록 (마스터) — 좁은 화면 + 선택 시 숨김 */}
        <div
          className={cn(
            'flex min-w-0 flex-1 flex-col border-r lg:max-w-md',
            selectedId != null && 'hidden lg:flex',
          )}
          data-testid="mail-list"
        >
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
            ) : view.kind === 'category' ? (
              // 분류 필터 적용 중 0건 — "받은 메일 없음" 과 구분되는 중립 문구.
              <div data-testid="mail-category-empty" className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
                <Inbox className="h-8 w-8" />
                <p className="text-sm font-medium">이 분류에 해당하는 메일이 없어요.</p>
              </div>
            ) : (
              <div data-testid="mail-list-empty" className="p-6 text-sm text-muted-foreground">
                {search
                  ? '검색 결과가 없습니다'
                  : folderParam === 'SENT'
                    ? '보낸 메일이 없습니다.'
                    : '받은 메일이 없습니다. 동기화를 눌러보세요.'}
              </div>
            )
          ) : (
            <div className="flex-1 overflow-y-auto" {...longPress}>
              {messages.map((m) => (
                <MessageRow
                  key={m.id}
                  m={m}
                  active={selectedId === m.id}
                  onSelect={() => selectRow(m.id)}
                  pendingVisible={view.kind !== 'sent' && classificationActive}
                  showToggle={!touchShell}
                  // 열린 메일을 안읽음으로 바꾸면 상세도 닫는다(R5) — 그 외에는 상태만 뒤집는다.
                  onToggleRead={() => toggleRow(m)}
                />
              ))}
            </div>
          )}
        </div>

        {/* WP-187 모바일 길게 누르기 작업 시트 — 터치 셸에서만 렌더(데스크톱은 hover 토글) */}
        {touchShell && (
          <MessageActionSheet
            open={sheet.open}
            onClose={sheet.close}
            actions={sheet.target ? sheetActions(sheet.target) : []}
            preview={sheet.target ? `${sheet.target.fromName || sheet.target.fromAddress || ''} · ${sheet.target.subject || '(제목 없음)'}` : undefined}
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
          {/* 모바일 상세 헤더 — ‹·메일 제목·✦ 한 줄(탭바가 숨으므로 ✦ 포함). URL 이 탭 루트라 레이아웃 상세 분기 대신 직접 그린다. */}
          {/* WP-187: ✦ 바로 왼쪽(trailing)에 "안읽음" — 누르면 목록으로 돌아간다. */}
          {isMobile && (
            <MobileDetailBar
              data-testid="mail-back"
              title={detailTitle}
              onBack={() => setSelectedId(null)}
              trailing={
                selectedId != null && (
                  <button
                    type="button"
                    data-testid="mobile-mark-unread"
                    onClick={() => markUnreadAndClose(selectedId)}
                    className="flex h-11 shrink-0 items-center gap-1 px-3 text-sm text-primary"
                  >
                    <Mail className="h-4 w-4" /> 안읽음
                  </button>
                )
              }
            />
          )}
          <MessageDetailPanel
            messageId={selectedId}
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
          />
        </div>
      </div>
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
    </div>
  )
}

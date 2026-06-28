import { useQueryClient } from '@tanstack/react-query'
import { Check, Download, Forward, Loader2, Paperclip, RefreshCw, Reply, ReplyAll, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { AiContent } from '@/components/ai/AiContent'
import { AiSignalBadge } from '@/components/ai/AiSignalBadge'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { formatRelativeTime } from '@/lib/formatters'
import { cn } from '@/lib/utils'

import { downloadMailAttachment } from '../../api/mailMessages'
import { type ComposeDraft,useMailCompose } from '../../components/mail/MailComposeContext'
import { useMailAccounts } from '../../hooks/queries/useMailAccounts'
import {
  useIssueDraft,
  useLinkedIssue,
  useMailMessage,
  useMailMessages,
  useMailSummary,
  useMarkNeedsReplyDone,
  useReplyDraft,
  useSyncMailbox,
  useSyncStatus,
} from '../../hooks/queries/useMailMessages'
import type { EmailMessageDetail, EmailMessageSummary, MailFolder, MailIssueDraft } from '../../types/mailMessage'
import { MailToIssueDialog } from './MailToIssueDialog'

// 수신 시각을 간략 표기(오늘=시각, 그 외=월/일).
function formatReceivedAt(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })
}

// 목록 한 행 — 안 읽음은 굵게, 첨부 클립 표시.
// P2: onResolve — 회신필요(미처리) 행 호버 시 처리완료 pill 클릭 핸들러.
function MessageRow({
  m,
  active,
  onSelect,
  onResolve,
}: {
  m: EmailMessageSummary
  active: boolean
  onSelect: () => void
  onResolve: (id: number) => void
}) {
  const navigate = useNavigate()
  return (
    // group/relative: 호버 처리완료 pill 의 절대 위치와 group-hover 표시에 필요.
    <button
      type="button"
      data-testid={`mail-row-${m.id}`}
      onClick={onSelect}
      className={cn(
        'group relative flex w-full flex-col gap-0.5 border-b px-4 py-3 text-left transition-colors',
        active ? 'bg-accent' : 'hover:bg-accent/50',
      )}
    >
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
          className="truncate text-xs text-muted-foreground"
        >
          {m.snippet}
        </span>
      )}
      {/* P2: 배지 술어 통일 — needsReplyDoneAt 있으면 답장필요 배지 숨김. 분류 배지는 클릭 필터. */}
      {(m.aiCategory || (m.aiNeedsReply && !m.needsReplyDoneAt)) && (
        <span className="mt-0.5 flex items-center gap-1">
          {/* AI 분류 배지 — 클릭 시 해당 분류 필터로 이동(onClick + stopPropagation 으로 행 선택과 분리). */}
          {m.aiCategory && (
            <AiSignalBadge
              variant="info"
              data-testid={`mail-badge-category-${m.id}`}
              onClick={(e) => {
                e.stopPropagation()
                navigate(`/mail/${m.accountId}?category=${encodeURIComponent(m.aiCategory!)}`)
              }}
            >
              {m.aiCategory}
            </AiSignalBadge>
          )}
          {/* 회신필요 배지 — action 변형으로 사용자 행동 필요를 강조. 처리완료된 경우 숨김. */}
          {m.aiNeedsReply && !m.needsReplyDoneAt && (
            <AiSignalBadge variant="action" data-testid={`mail-badge-needsreply-${m.id}`}>
              답장필요
            </AiSignalBadge>
          )}
        </span>
      )}
      {/* P2: 회신필요(미처리) 행에만 호버 처리완료 pill — outline/secondary 톤으로 "답장필요" 채움 배지와 시각 구분. */}
      {m.aiNeedsReply && !m.needsReplyDoneAt && (
        <button
          type="button"
          data-testid={`mail-resolve-${m.id}`}
          onClick={(e) => { e.stopPropagation(); onResolve(m.id) }}
          className="absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm hover:bg-accent group-hover:inline-flex"
        >
          <Check className="h-3.5 w-3.5" /> 처리완료
        </button>
      )}
    </button>
  )
}

// 답장/전달 인용 원문 HTML 생성.
function quoteHtml(detail: EmailMessageDetail): string {
  const who = detail.fromName || detail.fromAddress || ''
  const body = detail.bodyHtml ?? (detail.bodyText ? `<pre>${escapeHtml(detail.bodyText)}</pre>` : '')
  return `<p></p><blockquote>${who} 님이 작성:<br/>${body}</blockquote>`
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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
}) {
  const { data: detail, isLoading, isError, refetch } = useMailMessage(messageId)
  // AI 사용 계정 + messageId 가 있을 때만 요약 자동 조회. isFetching 으로 생성 중 스켈레톤 표시.
  const { data: summaryData, isFetching: summaryFetching } = useMailSummary(messageId, aiEnabled)
  // #520 연결된 이슈 키 조회 — issueKey 있으면 배지 표시.
  const linked = useLinkedIssue(messageId, aiEnabled)

  if (!messageId) {
    return (
      <div
        data-testid="mail-detail-empty"
        className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground"
      >
        메일을 선택하세요
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
        {/* AI 요약 강조 카드 — AiContent 아우라로 마킹. AI 사용 계정이고 요약이 있거나 생성 중일 때 표시. */}
        {aiEnabled && (summaryData?.summary || summaryFetching) && (
          <AiContent
            label="AI 요약"
            collapsible
            defaultOpen
            className="mb-3"
            data-testid="mail-ai-summary"
          >
            {summaryData?.summary ? (
              // 요약 본문 — 줄바꿈 보존.
              <span>{summaryData.summary}</span>
            ) : (
              // 생성 중 스켈레톤 — 레이아웃 점프 없이 자리 예약.
              <div data-testid="mail-ai-summary-loading" className="mt-2 flex flex-col gap-1.5">
                {/* AI 표면이므로 스켈레톤도 ai-accent 토큰 사용(primary 하드코딩 금지) */}
                <div className="h-2 w-full animate-pulse rounded bg-ai-accent/20" />
                <div className="h-2 w-3/4 animate-pulse rounded bg-ai-accent/20" />
                <div className="h-2 w-1/2 animate-pulse rounded bg-ai-accent/20" />
              </div>
            )}
          </AiContent>
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
          {/* AI 답장 초안 버튼 — AI 사용 계정에서만 노출. */}
          {aiEnabled && (
            <Button
              variant="outline"
              size="sm"
              data-testid="mail-ai-reply-draft"
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
          {/* AI 이슈 생성 버튼 — AI 사용 계정에서만 노출. #520 */}
          {aiEnabled && (
            <Button
              variant="outline"
              size="sm"
              data-testid="mail-ai-issue"
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
        {detail.attachments.length > 0 && (
          <AttachmentList attachments={detail.attachments} />
        )}
      </div>
      <div className="flex-1 p-4">
        {detail.bodyText ? (
          <pre className="whitespace-pre-wrap break-words font-sans text-sm">{detail.bodyText}</pre>
        ) : detail.bodyHtml ? (
          <iframe
            data-testid="mail-body-html"
            title="메일 본문"
            sandbox=""
            srcDoc={detail.bodyHtml}
            className="h-full min-h-[300px] w-full border-0"
          />
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
  const [params, setParams] = useSearchParams()
  const search = params.get('q') ?? ''
  // URL ?messageId=N 으로 초기 선택(홈 위젯 딥링크). 없으면 null.
  const [selectedId, setSelectedId] = useState<number | null>(
    () => Number(params.get('messageId')) || null,
  )

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

  // P2: URL ?category=업무, ?needsReply=true → 목록 필터로 전달(사이드바 nav 가 설정).
  const categoryParam = params.get('category') ?? ''
  const needsReplyParam = params.get('needsReply') === 'true'

  const { data: messages, isLoading, isError, refetch: refetchMessages } = useMailMessages(
    accountIdNum, folderParam, search, false, categoryParam, needsReplyParam,
  )
  // P2: 회신필요 처리완료 mutation — 행 hover pill 에서 사용.
  const markDone = useMarkNeedsReplyDone(accountIdNum)
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
      initialHtml: quoteHtml(detail),
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
      initialHtml: quoteHtml(d),
      inReplyToMessageId: null,
    })
  }
  // AI 답장 초안 — 생성된 본문을 인용문 위 단락으로 넣어 답장 도크 오픈.
  async function onAiReplyDraft(d: EmailMessageDetail) {
    const base = buildReply(d, false)
    try {
      const { draftBody } = await replyDraft.mutateAsync(d.id)
      openCompose({ ...base, initialHtml: `<p>${draftBody.replace(/\n/g, '<br/>')}</p>${base.initialHtml}` })
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
      <PageHeader
        title={folderParam === 'SENT' ? '보낸편지함' : '받은편지함'}
        actions={
          <>
            <input
              type="search"
              data-testid="mail-search"
              aria-label="메일 검색"
              value={search}
              onChange={(e) =>
                setParams(
                  (prev) => {
                    const sp = new URLSearchParams(prev)
                    if (e.target.value) sp.set('q', e.target.value)
                    else sp.delete('q')
                    return sp
                  },
                  { replace: true },
                )
              }
              placeholder="제목·보낸사람 검색"
              className="w-48 rounded-md border bg-background px-3 py-1.5 text-sm"
            />
          </>
        }
      />
      {/* 리스트 툴바 — INBOX 전용: 아이콘 새로고침 + 마지막 동기화 상대시각 + 진행률. */}
      {folderParam === 'INBOX' && (
        <div className="flex items-center gap-2 border-b px-3 py-1.5">
          <button
            type="button"
            data-testid="mail-sync"
            aria-label="지금 새로고침"
            onClick={() => sync.mutate()}
            disabled={sync.isPending || (syncStatus.data?.running ?? false)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground disabled:opacity-50"
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
            needsReplyParam ? (
              <div data-testid="mail-needsreply-empty" className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
                <Check className="h-8 w-8 text-primary" />
                <p className="text-sm font-medium">회신필요를 다 처리했어요 🎉</p>
              </div>
            ) : categoryParam ? (
              // 분류 필터 적용 중 0건 — "받은 메일 없음" 과 구분되는 중립 문구.
              <div data-testid="mail-category-empty" className="p-6 text-sm text-muted-foreground">
                이 분류에 해당하는 메일이 없습니다.
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
            <div className="flex-1 overflow-y-auto">
              {messages.map((m) => (
                <MessageRow
                  key={m.id}
                  m={m}
                  active={selectedId === m.id}
                  onSelect={() => setSelectedId(m.id)}
                  onResolve={(id) => markDone.mutate(id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* 본문 (디테일) — 좁은 화면은 선택 시 전체폭, 미선택 시 숨김 */}
        <div
          className={cn(
            'min-w-0 flex-1',
            selectedId == null ? 'hidden lg:block' : 'flex flex-col lg:block',
          )}
          data-testid="mail-detail-pane"
        >
          {/* 좁은 화면 뒤로가기 버튼 — 선택 상태에서만 표시 */}
          <button
            type="button"
            data-testid="mail-back"
            onClick={() => setSelectedId(null)}
            className="flex items-center gap-1 border-b px-4 py-2 text-sm text-primary lg:hidden"
          >
            ‹ 목록
          </button>
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
          />
        </div>
      </div>
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

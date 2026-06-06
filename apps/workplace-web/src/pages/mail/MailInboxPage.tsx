import { useQueryClient } from '@tanstack/react-query'
import { Forward, Paperclip, RefreshCw, Reply, ReplyAll } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'

import { PageHeader } from '@/components/layout/PageHeader'
import { cn } from '@/lib/utils'

import { type ComposeDraft,useMailCompose } from '../../components/mail/MailComposeContext'
import { useMailAccounts } from '../../hooks/queries/useMailAccounts'
import {
  useMailMessage,
  useMailMessages,
  useMailSummary,
  useReplyDraft,
  useSyncMailbox,
  useSyncStatus,
} from '../../hooks/queries/useMailMessages'
import type { EmailMessageDetail, EmailMessageSummary, MailFolder } from '../../types/mailMessage'

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
function MessageRow({
  m,
  active,
  onSelect,
}: {
  m: EmailMessageSummary
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      data-testid={`mail-row-${m.id}`}
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col gap-0.5 border-b px-4 py-3 text-left transition-colors',
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
      {(m.aiCategory || m.aiNeedsReply) && (
        <span className="mt-0.5 flex items-center gap-1">
          {m.aiCategory && (
            <span
              data-testid={`mail-badge-category-${m.id}`}
              className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {m.aiCategory}
            </span>
          )}
          {m.aiNeedsReply && (
            <span
              data-testid={`mail-badge-needsreply-${m.id}`}
              className="inline-flex items-center gap-0.5 text-[10px] font-medium text-primary"
            >
              ● 답장필요
            </span>
          )}
        </span>
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

// 선택한 메시지의 본문 패널 — text 우선, HTML 만 있으면 스크립트 차단 iframe 으로 렌더.
function MessageDetailPanel({
  messageId,
  aiEnabled,
  onReply,
  onReplyAll,
  onForward,
  onAiReplyDraft,
}: {
  messageId: number | null
  aiEnabled: boolean
  onReply: (detail: EmailMessageDetail) => void
  onReplyAll: (detail: EmailMessageDetail) => void
  onForward: (detail: EmailMessageDetail) => void
  onAiReplyDraft: (detail: EmailMessageDetail) => void
}) {
  const { data: detail, isLoading, isError } = useMailMessage(messageId)
  // AI 사용 계정 + messageId 가 있을 때만 요약 자동 조회.
  const { data: summaryData } = useMailSummary(messageId, aiEnabled)

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
    return <div className="p-6 text-sm text-destructive">메일을 불러오지 못했습니다</div>
  }

  return (
    <div data-testid="mail-detail" className="flex h-full flex-col overflow-y-auto">
      <div className="border-b p-4">
        {/* AI 요약 스트립 — AI 사용 계정 + 요약 있을 때만 표시. */}
        {aiEnabled && summaryData?.summary && (
          <details data-testid="mail-ai-summary" open className="mb-2 rounded border bg-muted/40 p-2 text-xs">
            <summary className="cursor-pointer font-medium text-muted-foreground">요약 (AI)</summary>
            <div className="mt-1 whitespace-pre-wrap">{summaryData.summary}</div>
          </details>
        )}
        <h2 className="text-lg font-semibold">{detail.subject || '(제목 없음)'}</h2>
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
        {/* 답장/전체답장/전달 버튼 */}
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            data-testid="mail-reply"
            onClick={() => onReply(detail)}
            className="flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-accent"
          >
            <Reply className="h-3.5 w-3.5" /> 답장
          </button>
          <button
            type="button"
            data-testid="mail-reply-all"
            onClick={() => onReplyAll(detail)}
            className="flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-accent"
          >
            <ReplyAll className="h-3.5 w-3.5" /> 전체답장
          </button>
          <button
            type="button"
            data-testid="mail-forward"
            onClick={() => onForward(detail)}
            className="flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-accent"
          >
            <Forward className="h-3.5 w-3.5" /> 전달
          </button>
          {/* AI 답장 초안 버튼 — AI 사용 계정에서만 노출. */}
          {aiEnabled && (
            <button
              type="button"
              data-testid="mail-ai-reply-draft"
              onClick={() => onAiReplyDraft(detail)}
              className="flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-accent"
            >
              ✨ AI 답장 초안
            </button>
          )}
        </div>
        {detail.attachments.length > 0 && (
          <ul data-testid="mail-attachments" className="mt-2 flex flex-wrap gap-2">
            {detail.attachments.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-1 rounded border bg-muted px-2 py-1 text-xs"
              >
                <Paperclip className="h-3 w-3" />
                {a.filename || '첨부파일'}
              </li>
            ))}
          </ul>
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
  const [selectedId, setSelectedId] = useState<number | null>(null)

  // 폴더 파라미터: ?folder=sent → SENT, 기본 INBOX.
  const folderParam = (params.get('folder') === 'sent' ? 'SENT' : 'INBOX') as MailFolder

  // 계정·폴더 전환 시 이전 선택 메시지가 남지 않도록 초기화.
  // (좁은 화면에서 폴더 전환 후에도 디테일 패널이 강제로 열려 있는 문제 방지)
  useEffect(() => {
    setSelectedId(null)
  }, [accountId, folderParam])

  const { data: accounts, isLoading: accountsLoading } = useMailAccounts()
  const accountIdNum = accountId ? Number(accountId) : undefined
  const { data: messages, isLoading, isError } = useMailMessages(accountIdNum, folderParam, search)
  const sync = useSyncMailbox(accountIdNum)
  const { openCompose } = useMailCompose()
  const replyDraft = useReplyDraft()

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

  // 본인 이메일 주소(전체답장에서 자신을 수신자에서 제외).
  const selfAddress = accounts?.find((a) => a.id === accountIdNum)?.emailAddress ?? ''
  // 현재 계정의 AI 사용 여부 — 요약 스트립 표시 여부에 사용.
  const aiEnabled = accounts?.find((a) => a.id === accountIdNum)?.aiEnabled ?? false

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
            {folderParam === 'INBOX' && (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  data-testid="mail-sync"
                  onClick={() => sync.mutate()}
                  disabled={sync.isPending || (syncStatus.data?.running ?? false)}
                  className="flex items-center gap-1 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent/50 disabled:opacity-50"
                >
                  <RefreshCw
                    className={cn(
                      'h-4 w-4',
                      (sync.isPending || syncStatus.data?.running) && 'animate-spin',
                    )}
                  />
                  동기화
                </button>
                {/* 본문 보충 진행률 — BODIES 단계 + total 이 있을 때만. */}
                {syncStatus.data?.phase === 'BODIES' && syncStatus.data.total > 0 && (
                  <span data-testid="mail-sync-progress" className="text-xs text-muted-foreground">
                    본문 {syncStatus.data.done}/{syncStatus.data.total}
                  </span>
                )}
              </div>
            )}
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
            <div className="p-6 text-sm text-destructive">목록을 불러오지 못했습니다</div>
          ) : !messages || messages.length === 0 ? (
            <div data-testid="mail-list-empty" className="p-6 text-sm text-muted-foreground">
              {search
                ? '검색 결과가 없습니다'
                : folderParam === 'SENT'
                  ? '보낸 메일이 없습니다.'
                  : '받은 메일이 없습니다. 동기화를 눌러보세요.'}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {messages.map((m) => (
                <MessageRow
                  key={m.id}
                  m={m}
                  active={selectedId === m.id}
                  onSelect={() => setSelectedId(m.id)}
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
            onReply={onReply}
            onReplyAll={onReplyAll}
            onForward={onForward}
            onAiReplyDraft={onAiReplyDraft}
          />
        </div>
      </div>
    </div>
  )
}

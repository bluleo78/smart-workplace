import { Paperclip, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router-dom'

import { cn } from '@/lib/utils'

import { useMailAccounts } from '../../hooks/queries/useMailAccounts'
import {
  useMailMessage,
  useMailMessages,
  useSyncMailbox,
} from '../../hooks/queries/useMailMessages'
import type { EmailMessageSummary } from '../../types/mailMessage'

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
      <span className="truncate text-xs text-muted-foreground">{m.snippet}</span>
    </button>
  )
}

// 선택한 메시지의 본문 패널 — text 우선, HTML 만 있으면 스크립트 차단 iframe 으로 렌더.
function MessageDetailPanel({ messageId }: { messageId: number | null }) {
  const { data: detail, isLoading, isError } = useMailMessage(messageId)

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
        <h2 className="text-lg font-semibold">{detail.subject || '(제목 없음)'}</h2>
        <div className="mt-1 text-sm text-muted-foreground">
          {detail.fromName ? `${detail.fromName} <${detail.fromAddress}>` : detail.fromAddress}
        </div>
        {detail.toAddresses && (
          <div className="mt-0.5 text-xs text-muted-foreground">받는사람: {detail.toAddresses}</div>
        )}
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
 * 받은편지함 — 좌측 메시지 목록(검색·동기화) + 우측 본문(마스터-디테일). 계정은 /mail/:accountId 로 선택하며, accountId 가 없으면 첫 계정으로
 * 리다이렉트한다. 읽기 전용(v1).
 */
export function MailInboxPage() {
  const { accountId } = useParams()
  const [params, setParams] = useSearchParams()
  const search = params.get('q') ?? ''
  const [selectedId, setSelectedId] = useState<number | null>(null)

  // 계정 전환 시 이전 계정의 선택 메시지가 남지 않도록 초기화.
  useEffect(() => {
    setSelectedId(null)
  }, [accountId])

  const { data: accounts, isLoading: accountsLoading } = useMailAccounts()
  const accountIdNum = accountId ? Number(accountId) : undefined
  const { data: messages, isLoading, isError } = useMailMessages(accountIdNum, search)
  const sync = useSyncMailbox(accountIdNum)

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
        <a href="/profile" className="text-primary underline">
          프로필에서 메일 계정을 추가
        </a>
        하세요.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      {/* 목록 (마스터) */}
      <div className="flex min-w-0 flex-1 flex-col border-r lg:max-w-md" data-testid="mail-list">
        {/* 툴바: 동기화 + 검색. 동기화 버튼은 좌측(레일 인접) — 상단 중앙의 전역 AI 칩과 겹치지 않게. */}
        <div className="flex items-center gap-2 border-b p-3">
          <button
            type="button"
            data-testid="mail-sync"
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
            className="flex shrink-0 items-center gap-1 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent/50 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-4 w-4', sync.isPending && 'animate-spin')} />
            동기화
          </button>
          <input
            type="search"
            data-testid="mail-search"
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
            className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>

        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">불러오는 중…</div>
        ) : isError ? (
          <div className="p-6 text-sm text-destructive">목록을 불러오지 못했습니다</div>
        ) : !messages || messages.length === 0 ? (
          <div data-testid="mail-list-empty" className="p-6 text-sm text-muted-foreground">
            {search ? '검색 결과가 없습니다' : '받은 메일이 없습니다. 동기화를 눌러보세요.'}
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

      {/* 본문 (디테일) */}
      <div className="hidden min-w-0 flex-1 lg:block" data-testid="mail-detail-pane">
        <MessageDetailPanel messageId={selectedId} />
      </div>
    </div>
  )
}

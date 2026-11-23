import { Mail, Paperclip } from 'lucide-react'
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'

import { AiSignalBadge } from '@/components/ai/AiSignalBadge'
import { relTime } from '@/components/ai/relTime'
import { MailConfidentialBadge } from '@/components/mail/MailConfidentialBadge'
import { Skeleton } from '@/components/ui/skeleton'
import { useMailSummary } from '@/hooks/queries/useMailSummary'
import { mailDisplaySubject, mailOpenLabel } from '@/lib/mailConfidentialSubject'
import { isNeedsReply } from '@/lib/mailNeedsReply'
import { showsLoadError } from '@/lib/queryFailure'
import type { MailSummaryItem } from '@/types/dashboard'

import { WidgetError } from '../WidgetError'
import { mailSender } from './bodyRules'
import { WidgetEmptyState } from './WidgetEmptyState'

// 아바타 이니셜 — 발신자명(bodyRules.mailSender — 모바일 요약과 같은 규칙) 첫 글자.
function initial(item: MailSummaryItem): string {
  return mailSender(item).charAt(0)
}

/**
 * 안 읽은 메일 위젯 — "회신 의무로 분류한 받은편지함 엿보기".
 * 회신필요(AI 판정 && 안 읽음) 먼저 → 최신순. 발신자·제목·미리보기·시각·배지/첨부.
 * 행 클릭 = 해당 메일 딥링크(/mail/{accountId}?messageId={id}) — MailInboxPage 가
 * ?messageId 를 읽어 상세 패널을 자동으로 연다(#447). 헤더/프레임은 Dashboard 담당.
 */
export default function UnreadMailBody({
  count = 5,
  previewData,
}: {
  count?: number
  previewData?: MailSummaryItem[]
}) {
  // WP-1899: 행 설명 id 접두 — 훅 규칙상 early return 전에 둔다.
  const base = useId()
  const query = useMailSummary({ enabled: !previewData })
  const { data: queryData, isLoading, refetch } = query
  // "회신 필요" 토글 — 켜면 회신필요(AI 판정 && 안 읽음) 메일만 필터(헤더 칩 클릭). 위젯 로컬 상태.
  const [needsReplyOnly, setNeedsReplyOnly] = useState(false)

  // 실패 안내는 로딩보다 먼저 본다 — 다시 부르는 동안에도 안내를 그대로 둬야 다시 시도의 초점이 남는다(WP-881).
  if (!previewData && showsLoadError(query))
    return <WidgetError onRetry={() => refetch()} retrying={query.isFetching} testId="dash-mail-error" />
  // I3(a11y): 로딩 영역에 aria-busy + 라벨.
  if (!previewData && isLoading)
    return (
      <div aria-busy="true" aria-label="불러오는 중">
        <Skeleton className="h-20 w-full" />
      </div>
    )

  const recent = previewData ?? queryData?.recent ?? []
  const unreadCount = previewData ? previewData.filter((m) => !m.seen).length : (queryData?.unreadCount ?? 0)
  const needsReplyCount = previewData ? previewData.filter(isNeedsReply).length : (queryData?.needsReplyCount ?? 0)
  const classificationActive = previewData ? true : (queryData?.classificationActive ?? false)

  // 빈 상태: 설명 + 다음 행동(메일함 열기) CTA(WP-1853). 메일 화면으로 보낸다 — 작성 도크를 바로 여는 딥링크가 없고,
  // 계정을 연결하지 않은 사용자도 같은 빈 상태를 보므로(요약 응답에 계정 유무가 없다) 「작성」이 아닌 「메일함 열기」로 둔다.
  // 메일 화면은 계정이 없으면 연결 안내를 보여 준다.
  if (recent.length === 0)
    return (
      <WidgetEmptyState
        icon={Mail}
        title="새 메일이 없어요"
        description="읽지 않은 메일이 오면 여기에 모여요"
        cta={{ label: '메일함 열기', to: '/mail' }}
        testId="dash-mail-empty"
      />
    )

  // 회신필요(분류 활성 시) 먼저 → 최신순. receivedAt nullsLast.
  const rows = [...recent].sort((a, b) => {
    if (classificationActive) {
      const ar = a.aiNeedsReply ? 1 : 0
      const br = b.aiNeedsReply ? 1 : 0
      if (ar !== br) return br - ar
    }
    const at = a.receivedAt ? new Date(a.receivedAt).getTime() : -Infinity
    const bt = b.receivedAt ? new Date(b.receivedAt).getTime() : -Infinity
    return bt - at
  })

  // WP-146: 단일 술어 — 회신필요 = AI 판정 && 안 읽음.
  // 토글 켜짐 → 회신 필요만. recent 는 회신필요 우선 정렬이라 상단부터 채워진다.
  const visible = needsReplyOnly ? rows.filter(isNeedsReply) : rows

  return (
    <div data-testid="dash-mail">
      <div className="mb-2 text-sm text-muted-foreground" data-testid="dash-mail-hint">
        {classificationActive && needsReplyCount > 0 ? (
          <>
            {/* 회신 필요 칩 = 필터 토글. 활성 시 ai-accent 채움으로 "필터 켜짐" 표시. */}
            <button
              type="button"
              onClick={() => setNeedsReplyOnly((v) => !v)}
              aria-pressed={needsReplyOnly}
              data-testid="dash-mail-filter"
              className={`rounded px-1.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                needsReplyOnly
                  ? 'bg-ai-accent text-ai-accent-foreground'
                  : 'text-ai-accent hover:bg-ai-accent/10'
              }`}
            >
              회신 필요 {needsReplyCount}
            </button>{' '}
            · 안읽음 {unreadCount}
          </>
        ) : (
          <>안읽음 {unreadCount}</>
        )}
      </div>
      <ul className="space-y-0.5">
        {visible.slice(0, count).map((m) => {
          // WP-1899: 이름(aria-label)은 제목만 짧게 두고, 보이는 보조 정보(보낸 사람·회신필요·시간·미리보기)는
          // aria-describedby 로 이어 설명으로 읽힌다. 늘 그리는 span 은 id 를 늘 달고, 내용이 없으면 설명에 잇지만 않는다.
          const fromId = `${base}-${m.id}-from`
          const badgeId = `${base}-${m.id}-badge`
          const timeId = `${base}-${m.id}-time`
          const snippetId = `${base}-${m.id}-snippet`
          const showBadge = classificationActive && isNeedsReply(m)
          const hasSnippet = !!m.snippet?.trim()
          // 첨부 아이콘의 스크린리더용 글자(attachId)는 화면 순서(미리보기 뒤)대로 마지막에 잇는다.
          const attachId = `${base}-${m.id}-attach`
          const describedBy = [
            fromId,
            showBadge && badgeId,
            m.receivedAt && timeId,
            hasSnippet && snippetId,
            m.hasAttachment && attachId,
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <li key={m.id}>
              <Link
                to={`/mail/${m.accountId}?messageId=${m.id}`}
                data-testid="dash-mail-row"
                aria-label={mailOpenLabel(m)}
                aria-describedby={describedBy || undefined}
                className="flex gap-2 rounded px-1 py-1.5 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-muted text-xs font-medium">
                  {initial(m)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span id={fromId} className="truncate text-sm font-medium">
                      {mailSender(m)}
                    </span>
                    {/* 회신필요 배지 — AI action 스타일(빨강 제거). 비-AI 멘션/회신대기 배지와 시각적으로 구분. */}
                    {/* WP-1899: 배지 root 에 id 를 직접 단다(AiSignalBadge id prop) — 감싸는 요소 없이 레이아웃 그대로. */}
                    {showBadge && (
                      <AiSignalBadge id={badgeId} variant="action" data-testid="dash-mail-badge-reply">
                        회신필요
                      </AiSignalBadge>
                    )}
                    <span id={timeId} className="ml-auto flex-none text-xs text-muted-foreground">
                      {m.receivedAt ? relTime(m.receivedAt) : ''}
                    </span>
                  </span>
                  {/* 제목 줄 — 받은 기밀 메일이면 머리말을 빼고 뒤에 「기밀」 배지(WP-2030 리뷰 후속) */}
                  <span className="flex items-center gap-1">
                    <span className="min-w-0 truncate text-sm text-foreground/90">{mailDisplaySubject(m)}</span>
                    {m.confidential && <MailConfidentialBadge className="py-0" />}
                  </span>
                  <span className="flex items-center gap-1">
                    <span id={snippetId} className="block min-w-0 truncate text-xs text-muted-foreground">
                      {m.snippet?.trim() || ''}
                    </span>
                    {m.hasAttachment && (
                      // 아이콘은 시각 전용이라 곁에 스크린리더용 글자를 둔다. 아이콘(svg)에 이름을 달아 가리키면
                      // 접근 설명 계산이 svg 를 건너뛰는 구현이 있어(jsdom 에서 설명이 통째로 비었다) 글자 span 을 가리킨다.
                      <>
                        <Paperclip aria-hidden="true" className="h-3 w-3 flex-none text-muted-foreground" />
                        <span id={attachId} className="sr-only">
                          첨부 있음
                        </span>
                      </>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

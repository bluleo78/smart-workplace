// 카탈로그 위젯 모바일 타일 요약 한 줄(WP-142) — 각 위젯(chatWidgetRegistry 컴포넌트)이 params 로 부르는 쿼리 훅을
// 같은 인자로 불러 같은 쿼리 키를 쓴다. 카탈로그 위젯은 모바일에서 모두 타일형이라 본문 대신 이 한 줄만 보인다.
import { useCalendarEvents } from '@/hooks/queries/useCalendarEvents'
import { useContacts } from '@/hooks/queries/useContacts'
import { useDriveSpaces } from '@/hooks/queries/useDriveSpaces'
import { useActivity,useMyIssues } from '@/hooks/queries/useHomeQueries'
import { useMailAccounts } from '@/hooks/queries/useMailAccounts'
import { useMailMessages } from '@/hooks/queries/useMailMessages'
import { useMessagingSummary } from '@/hooks/queries/useMessagingSummary'
import { useMyChannels } from '@/hooks/queries/useMyChannels'
import { useProjects } from '@/hooks/queries/useProjects'
import { useWikiSpaces } from '@/hooks/queries/useWikiSpaces'
import { resolveCalendarRange } from '@/lib/calendarRange'
import type { ContactTypeFilter } from '@/types/contact'
import type { MailFolder } from '@/types/mailMessage'

import type { MobileSummaryProps } from '../types'
import { Muted } from './Muted'
import { eventTimeLabel, joinNames, mailSender, pickBusiestChannel, pickNextEvent, totalUnread } from './summaryLogic'

/** 이슈 목록 — 건수 + 최상위 1건(키·제목). IssueListWidget 과 같은 params 기본값. */
export function IssueListSummary({ params, render }: MobileSummaryProps) {
  const q = useMyIssues(params ?? { assignee: 'me' })
  if (q.isLoading) return render({ status: 'loading' })
  if (q.isError) return render({ status: 'error' })
  const items = q.data?.items ?? []
  const top = items[0]
  if (!top) return render({ status: 'ready', text: <Muted>이슈 없음</Muted> })
  return render({
    status: 'ready',
    count: items.length,
    prefix: (
      <span className="text-xs text-muted-foreground">
        {top.projectKey}-{top.number}
      </span>
    ),
    text: top.title,
  })
}

/** 메일 목록 — 폴더 최신 1건(발신자·제목). MailListWidget 과 같은 계정·폴더·필터 해석. */
export function MailListSummary({ params, render }: MobileSummaryProps) {
  const folder = ((params?.folder as string) || 'INBOX') as MailFolder
  const query = (params?.query as string) || ''
  const unreadOnly = params?.unreadOnly === true
  const accounts = useMailAccounts()
  const accountId = (params?.accountId as number | undefined) ?? accounts.data?.[0]?.id ?? undefined
  const messages = useMailMessages(accountId, folder, query, unreadOnly, '', false)
  if (accounts.isLoading || (accountId && messages.isLoading)) return render({ status: 'loading' })
  if (accounts.isError || messages.isError) return render({ status: 'error' })
  if (!accountId) return render({ status: 'ready', text: <Muted>연결된 메일 계정 없음</Muted> })
  const first = messages.data?.[0]
  if (!first) return render({ status: 'ready', text: <Muted>메일 없음</Muted> })
  return render({
    status: 'ready',
    text: (
      <>
        <span className="font-medium">{mailSender(first)}</span> · {first.subject ?? '(제목 없음)'}
      </>
    ),
  })
}

/** 캘린더 — 다음 일정 1건(시각·제목). CalendarWidget 과 같은 범위 계산. */
export function CalendarSummary({ params, render }: MobileSummaryProps) {
  const { from, to } = resolveCalendarRange(params)
  const q = useCalendarEvents(from, to)
  if (q.isLoading) return render({ status: 'loading' })
  if (q.isError) return render({ status: 'error' })
  const next = pickNextEvent(q.data ?? [], new Date())
  if (!next) return render({ status: 'ready', text: <Muted>예정된 일정 없음</Muted> })
  return render({
    status: 'ready',
    prefix: <span className="text-muted-foreground tabular-nums">{eventTimeLabel(next)}</span>,
    text: next.title,
  })
}

/** 활동 피드 — 최신 활동 1건(행위자·이슈 제목). */
export function ActivitySummary({ params, render }: MobileSummaryProps) {
  const q = useActivity(params?.actorKind as string | undefined)
  if (q.isLoading) return render({ status: 'loading' })
  if (q.isError) return render({ status: 'error' })
  const a = q.data?.items[0]
  if (!a) return render({ status: 'ready', text: <Muted>최근 활동 없음</Muted> })
  return render({
    status: 'ready',
    text: (
      <>
        <span className="text-muted-foreground">{a.actorName}</span> {a.issueTitle}
      </>
    ),
  })
}

/** 노트 — 스페이스 이름 나열. */
export function WikiSummary({ render }: MobileSummaryProps) {
  const q = useWikiSpaces()
  if (q.isLoading) return render({ status: 'loading' })
  if (q.isError) return render({ status: 'error' })
  const names = joinNames((q.data ?? []).map((s) => s.name))
  return render({ status: 'ready', text: names || <Muted>노트 스페이스 없음</Muted> })
}

/** 연락처 — 이름 나열. ContactsWidget 과 같은 검색·유형·조직·직함 인자. */
export function ContactsSummary({ params, render }: MobileSummaryProps) {
  const search = (params?.search as string) ?? ''
  const typeFilter = ((params?.type as ContactTypeFilter) || 'ALL') as ContactTypeFilter
  const org = (params?.org as string) || undefined
  const title = (params?.title as string) || undefined
  const q = useContacts(search, typeFilter, org, title)
  if (q.isLoading) return render({ status: 'loading' })
  if (q.isError) return render({ status: 'error' })
  const names = joinNames((q.data?.pages?.[0]?.items ?? []).map((c) => c.name))
  return render({ status: 'ready', text: names || <Muted>연락처 없음</Muted> })
}

/** 프로젝트 — 이름 나열(ProjectsWidget 과 같은 첫 페이지 20건). */
export function ProjectsSummary({ render }: MobileSummaryProps) {
  const q = useProjects(0, 20)
  if (q.isLoading) return render({ status: 'loading' })
  if (q.isError) return render({ status: 'error' })
  const names = joinNames((q.data?.content ?? []).map((p) => p.name))
  return render({ status: 'ready', text: names || <Muted>프로젝트 없음</Muted> })
}

/** 드라이브 — 공간 이름 나열. */
export function DriveSummary({ render }: MobileSummaryProps) {
  const q = useDriveSpaces()
  if (q.isLoading) return render({ status: 'loading' })
  if (q.isError) return render({ status: 'error' })
  const names = joinNames((q.data ?? []).map((s) => s.name))
  return render({ status: 'ready', text: names || <Muted>드라이브 공간 없음</Muted> })
}

/**
 * 채널 — 안 읽음 합계 배지 + 최신 채널·마지막 메시지 미리보기. 미리보기는 홈 대화 요약(useMessagingSummary.recent)의
 * 첫 채널 항목에서 가져오고(새 API 없음), recent 에 채널이 없으면 안 읽음이 가장 많은 채널명만 보인다.
 */
export function ChannelsSummary({ render }: MobileSummaryProps) {
  const q = useMyChannels()
  const messaging = useMessagingSummary()
  if (q.isLoading || messaging.isLoading) return render({ status: 'loading' })
  if (q.isError) return render({ status: 'error' })
  const channels = q.data ?? []
  const latest = messaging.data?.recent.find((c) => c.kind === 'CHANNEL')
  const busiest = pickBusiestChannel(channels)
  if (!latest && !busiest) return render({ status: 'ready', text: <Muted>참여 중인 채널 없음</Muted> })
  return render({
    status: 'ready',
    count: totalUnread(channels),
    text: latest ? (
      <>
        <span className="font-medium">#{latest.label}</span>{' '}
        <span className="text-muted-foreground">{latest.lastMessagePreview}</span>
      </>
    ) : (
      <span className="font-medium">#{busiest?.name}</span>
    ),
    meta:
      !latest && busiest && busiest.unreadCount > 0 ? (
        <span className="text-xs text-muted-foreground">안 읽음 {busiest.unreadCount}</span>
      ) : undefined,
  })
}

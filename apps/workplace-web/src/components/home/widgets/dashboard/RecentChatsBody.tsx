import { MessageSquare } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { useMyChannels } from '@/hooks/queries/useMyChannels'
import { useMyDms } from '@/hooks/queries/useMyDms'
import type { DmResponse } from '@/types/messaging'

import { WidgetError } from '../WidgetError'

// DM 은 name 이 없어 참여자 표시명을 합쳐 파생(본인 포함 — 셀프 DM 대비).
function dmLabel(dm: DmResponse): string {
  const names = dm.participants.map((p) => p.name)
  return names.length > 0 ? names.join(', ') : '대화'
}

/** 최근 대화 요약 본문 — 안 읽은 합계 + 안 읽은 채널/DM 상위 3건. 프레임/딥링크는 Dashboard 담당. */
export default function RecentChatsBody({ count = 5 }: { count?: number }) {
  const channels = useMyChannels()
  const dms = useMyDms()
  const loading = channels.isLoading || dms.isLoading
  const isError = channels.isError || dms.isError

  // I3(a11y): 로딩 영역에 aria-busy + 라벨.
  if (loading)
    return (
      <div aria-busy="true" aria-label="불러오는 중">
        <Skeleton className="h-20 w-full" />
      </div>
    )
  if (isError)
    return (
      <WidgetError
        onRetry={() => {
          channels.refetch()
          dms.refetch()
        }}
        testId="dash-chats-error"
      />
    )

  const chList = channels.data ?? []
  const dmList = dms.data ?? []
  const totalUnread =
    chList.reduce((s, c) => s + c.unreadCount, 0) + dmList.reduce((s, d) => s + d.unreadCount, 0)

  // 안 읽은 항목 우선 상위 count 건(채널 → DM 순). 없으면 빈 상태.
  // to 는 채널/DM 별 상세 라우트(App.tsx: /chat/channels/:id · /chat/dms/:id).
  const rows: { key: string; label: string; unread: number; to: string }[] = [
    ...chList
      .filter((c) => c.unreadCount > 0)
      .map((c) => ({
        key: `ch-${c.id}`,
        label: `# ${c.name}`,
        unread: c.unreadCount,
        to: `/chat/channels/${c.id}`,
      })),
    ...dmList
      .filter((d) => d.unreadCount > 0)
      .map((d) => ({
        key: `dm-${d.id}`,
        label: dmLabel(d),
        unread: d.unreadCount,
        to: `/chat/dms/${d.id}`,
      })),
  ].slice(0, count)

  if (rows.length === 0)
    return (
      <div
        // I3(a11y): 빈 상태 role="status".
        role="status"
        className="flex flex-col items-center gap-2 py-6 text-center"
        data-testid="dash-chats-empty"
      >
        <MessageSquare className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">안 읽은 대화가 없어요</p>
      </div>
    )

  return (
    <div data-testid="dash-chats">
      <div className="mb-2 text-sm text-muted-foreground">안 읽음 {totalUnread}건</div>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          // 행 클릭/Enter → 해당 채널/DM 으로 이동.
          <li key={r.key}>
            <Link
              to={r.to}
              aria-label={`대화 열기: ${r.label}`}
              className="flex min-h-6 items-center justify-between gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span className="truncate">{r.label}</span>
              <span className="shrink-0 rounded-full bg-ai-accent/10 px-1.5 text-xs text-ai-accent">
                {r.unread}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

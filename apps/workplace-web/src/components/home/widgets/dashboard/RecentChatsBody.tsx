import { MessageSquare } from 'lucide-react'

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
export default function RecentChatsBody() {
  const channels = useMyChannels()
  const dms = useMyDms()
  const loading = channels.isLoading || dms.isLoading
  const isError = channels.isError || dms.isError

  if (loading) return <Skeleton className="h-20 w-full" />
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

  // 안 읽은 항목 우선 상위 3건(채널 → DM 순). 없으면 빈 상태.
  const rows: { key: string; label: string; unread: number }[] = [
    ...chList
      .filter((c) => c.unreadCount > 0)
      .map((c) => ({ key: `ch-${c.id}`, label: `# ${c.name}`, unread: c.unreadCount })),
    ...dmList
      .filter((d) => d.unreadCount > 0)
      .map((d) => ({ key: `dm-${d.id}`, label: dmLabel(d), unread: d.unreadCount })),
  ].slice(0, 3)

  if (rows.length === 0)
    return (
      <div
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
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate">{r.label}</span>
            <span className="shrink-0 rounded-full bg-ai-accent/10 px-1.5 text-xs text-ai-accent">
              {r.unread}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

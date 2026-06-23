import { Calendar, MessageSquare, RefreshCw, UserPlus } from 'lucide-react'
import { Link } from 'react-router-dom'

import { formatRelativeTime } from '@/lib/formatters'
import type { NotifGroup } from '@/lib/notifGrouping'
import type { NotificationResponse } from '@/types/notification'

// 대표 알림 종류별 아이콘.
const TYPE_ICON: Record<NotificationResponse['type'], typeof UserPlus> = {
  ASSIGNED: UserPlus,
  COMMENTED: MessageSquare,
  STATUS_CHANGED: RefreshCw,
  REMINDER: Calendar,
}

/**
 * 알림 그룹 한 행 — 아이콘 + 객체 제목(primary) + 행위자(AI배지)·델타·시간 메타(secondary) + ✓.
 * 제목을 맨 위에 두고 메타를 한 줄로 합쳐 시각적 위계를 명확히 한다(오늘 일정 위젯과 제목 크기 일치).
 * 행 본문 클릭은 딥링크 이동, ✓ 는 제자리 확인(그룹 내 미읽음 read).
 */
export function NotificationGroupRow({
  group,
  onAck,
}: {
  group: NotifGroup
  onAck: (ids: number[]) => void
}) {
  const Icon = TYPE_ICON[group.repType]
  return (
    <li
      className="group flex items-start gap-2 rounded px-1 py-1.5 hover:bg-muted/50"
      data-testid="dash-notif-row"
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <Link
        to={group.target}
        aria-label={`알림 열기: ${group.label}`}
        // 열기 = 읽음 처리(InboxPanel과 동일). 이동과 함께 그룹 미읽음을 read 처리.
        onClick={() => onAck(group.unreadIds)}
        className="min-w-0 flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {/* primary: 객체 제목(미읽음이면 medium). */}
        <span className={`block truncate text-sm ${group.read ? 'text-muted-foreground' : 'font-medium'}`}>
          {group.title}
        </span>
        {/* secondary: 행위자 + AI배지 + 델타 + 상대시간 한 줄(muted). */}
        <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
          {group.actorName && <span className="truncate">{group.actorName}</span>}
          {group.hasAgent && <span className="rounded bg-primary/10 px-1 text-primary">AI</span>}
          <span className="truncate">{group.deltaSummary} · {formatRelativeTime(group.latestAt)}</span>
        </span>
      </Link>
      {group.unreadIds.length > 0 && (
        // 제자리 읽음 — 평소 숨김, hover/포커스 시 노출되는 라벨 버튼(맨 체크표시의 affordance 모호함 해소).
        <button
          type="button"
          data-testid="dash-notif-ack"
          aria-label={`읽음 처리: ${group.label}`}
          title="읽음 처리"
          onClick={() => onAck(group.unreadIds)}
          className="mt-0.5 shrink-0 rounded border px-2 py-0.5 text-xs text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100"
        >
          읽음
        </button>
      )}
    </li>
  )
}

import { Bell } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { useMarkAllNotificationsRead } from '@/hooks/queries/useMarkAllNotificationsRead'
import { useMarkNotificationRead } from '@/hooks/queries/useMarkNotificationRead'
import { flattenNotificationPages, useNotifications } from '@/hooks/queries/useNotifications'
import { groupNotifications } from '@/lib/notifGrouping'
import type { NotificationResponse } from '@/types/notification'

import { WidgetError } from '../WidgetError'
import { NotificationGroupRow } from './NotificationGroupRow'

/**
 * 알림 위젯 — "캐치업" 모델.
 * 알림 = 변화 스트림(델타). 객체별로 묶고 '내 차례(행동 필요)/업데이트(참고)'로 분류,
 * 미읽음 그룹만 보여주고 홈에서 바로 확인(acknowledge)한다. (할 일 큐는 '내 작업' 위젯 담당)
 */
export default function NotificationsBody({
  count = 5,
  previewData,
}: {
  count?: number
  previewData?: NotificationResponse[]
}) {
  // 대시보드 위젯은 항상 표시되므로 enabled=true 로 최근 알림을 가져온다.
  // 프리뷰 모드(previewData 지정)에서는 훅을 비활성화(enabled=false)해 실제 API 호출을 막는다.
  const list = useNotifications(!previewData)
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()
  // 위젯은 요약이므로 첫 페이지(최근 20건)만 사용 — 무한스크롤은 InboxPanel 담당(#610).
  const rawItems = previewData ?? flattenNotificationPages(list.data?.pages)

  // I3(a11y): 로딩 영역에 aria-busy + 라벨.
  if (!previewData && list.isLoading)
    return (
      <div aria-busy="true" aria-label="불러오는 중">
        <Skeleton className="h-20 w-full" />
      </div>
    )
  if (!previewData && list.isError)
    return <WidgetError onRetry={() => list.refetch()} testId="dash-notif-error" />

  const grouped = groupNotifications(rawItems ?? [])
  // 캐치업: 미읽음 그룹만 노출(읽은 이력은 인박스 패널 담당).
  const mine = grouped.mine.filter((g) => g.unreadIds.length > 0)
  // 업데이트(FYI)는 표시 개수로 제한하되, 카운트/초과 안내는 '전체' 기준으로 정직하게.
  const updatesAll = grouped.updates.filter((g) => g.unreadIds.length > 0)
  const updates = updatesAll.slice(0, count)
  const updatesHidden = updatesAll.length - updates.length
  const hasUnread = mine.length > 0 || updatesAll.length > 0

  // 그룹의 미읽음 id 들을 read 처리(낙관적 — 훅이 invalidate 후 재조회).
  const ack = (ids: number[]) => ids.forEach((id) => markRead.mutate(id))

  // 정직한 빈 상태: 미읽음이 전혀 없을 때만 축하형.
  if (!hasUnread)
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-2 py-6 text-center"
        data-testid="dash-notif-empty"
      >
        <Bell className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">다 따라잡았어요 🎉</p>
        <p className="text-xs text-muted-foreground">새로운 알림이 생기면 여기에 모여요</p>
      </div>
    )

  return (
    <div data-testid="dash-notif">
      {/* 상단 우측: 전체 읽음 처리 — InboxPanel과 동일 카피("모두 읽음")로 통일 (#665) */}
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          data-testid="dash-notif-ack-all"
          onClick={() => markAll.mutate()}
          disabled={!hasUnread || markAll.isPending}
          className="text-sm text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          모두 읽음
        </button>
      </div>

      {/* 🔴 내 차례 — 행동 필요(ASSIGNED). 비었으면 섹션 자체를 생략(반쪽 빈 상태 방지). */}
      {mine.length > 0 && (
        <div data-testid="dash-notif-mine">
          <div className="mb-1 text-sm font-medium text-muted-foreground">
            내 차례 <span className="text-ai-accent">{mine.length}</span>
          </div>
          <ul className="space-y-0.5">
            {mine.map((g) => (
              <NotificationGroupRow key={g.key} group={g} onAck={ack} />
            ))}
          </ul>
        </div>
      )}

      {/* ⚪ 업데이트 — 참고(FYI). 다른 위젯과 동일하게 그냥 펼친 리스트(접힘 UI 없음). */}
      {updatesAll.length > 0 && (
        <div className={mine.length > 0 ? 'mt-3' : undefined}>
          <div
            className="mb-1 text-sm font-medium text-muted-foreground"
            data-testid="dash-notif-updates-header"
          >
            업데이트 <span className="text-ai-accent">{updatesAll.length}</span>
          </div>
          <ul className="space-y-0.5" data-testid="dash-notif-updates">
            {updates.map((g) => (
              <NotificationGroupRow key={g.key} group={g} onAck={ack} />
            ))}
            {/* 표시 개수 초과분 — 숨은 더미를 정직하게 알리고 전체 인박스로 안내. */}
            {updatesHidden > 0 && (
              <li className="px-1 pt-1 text-xs text-muted-foreground" data-testid="dash-notif-overflow">
                +{updatesHidden}건 더 — 알림에서 모두 보기
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

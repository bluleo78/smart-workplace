// 메일 목록 필터 줄(WP-1355)의 슬롯 내용 — MailInboxPage 의 FilterLine 호출을 짧게 두려고 뗐다.
// 사람이 정한 배치: [▽ 제목·보낸사람] [↻ 3분 전 동기화됨] ···· [안 읽은 메일만] [모두 읽음]
//  - 동기화 버튼·상태는 왼쪽 chips 슬롯(키워드 뒤) — MailSyncControls
//  - 안 읽은 메일만·모두 읽음은 오른쪽 end 슬롯 — MailListActions
// 두 컴포넌트는 렌더만 한다. 상태·동작(동기화 요청·URL 갱신·모두 읽음 확인)은 페이지가 넘긴다.
import { CheckCheck, RefreshCw } from 'lucide-react'

import { formatDateTime, formatRelativeTime } from '@/lib/formatters'
import { TOGGLE_ON_CLASS } from '@/lib/selectionStyles'
import { cn } from '@/lib/utils'

/** 지금 새로고침 버튼 + 마지막 동기화 시각(또는 본문 보충 진행률). 받은편지함 계정 동기화 화면에서만 쓴다. */
export function MailSyncControls({
  onSync,
  busy,
  lastSyncedAt,
  progress,
}: {
  onSync: () => void
  /** 동기화 요청 중이거나 서버가 이미 동기화 중 — 아이콘이 돌고 버튼은 눌리지 않는다 */
  busy: boolean
  /** 마지막 성공 동기화 시각(ISO). 없으면 「동기화 안 됨」 */
  lastSyncedAt: string | null | undefined
  /** 본문 보충 진행률 — 있으면 동기화 시각 대신 보인다 */
  progress: { done: number; total: number } | null
}) {
  return (
    <>
      <button
        type="button"
        data-testid="mail-sync"
        aria-label="지금 새로고침"
        onClick={onSync}
        disabled={busy}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 @max-2xl:h-10 @max-2xl:w-10"
      >
        <RefreshCw className={cn('h-4 w-4', busy && 'animate-spin')} />
      </button>
      {/* 마지막 성공 동기화 시각 — null이면 회색 점+"동기화 안 됨", 있으면 녹색 점+상대시각 표시(절대 시각은 title).
          한 줄 유지. 좁은 줄은 가로 스크롤 줄이라 줄어들지 않으므로, 필터 줄이 좁을 때(FilterLine 의 @2xl 분기와 같은 컨테이너 폭
          기준 — 모바일·데스크톱 좁은 메일 열 모두)만 폭 상한을 둬 넘치면 말줄임한다 — 그래야 360px 에서도 오른쪽 끝 「모두 읽음」이 화면 안에 남는다.
          진행률이 보이는 동안은 숨긴다(진행률이 더 새 정보, 좁은 목록 열에서 넘침 방지). */}
      <span
        data-testid="mail-synced-at"
        title={lastSyncedAt ? formatDateTime(lastSyncedAt) : undefined}
        className={cn(
          'flex min-w-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground @max-2xl:max-w-28',
          progress && 'hidden',
        )}
      >
        {lastSyncedAt ? (
          <>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" aria-hidden />
            <span className="truncate">{`${formatRelativeTime(lastSyncedAt)} 동기화됨`}</span>
          </>
        ) : (
          <>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" aria-hidden />
            <span className="truncate">동기화 안 됨</span>
          </>
        )}
      </span>
      {/* 본문 보충 진행률 — 두 줄로 꺾여 필터 줄 높이가 바뀌지 않게 한 줄 고정. */}
      {progress && (
        <span data-testid="mail-sync-progress" className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
          본문 {progress.done}/{progress.total}
        </span>
      )}
    </>
  )
}

/** 안 읽은 메일만 토글 + 모두 읽음. 어느 쪽도 보일 게 없으면 호출부가 이 컴포넌트를 넘기지 않는다(FilterLine 슬롯 계약). */
export function MailListActions({
  showUnreadToggle,
  unreadOnly,
  onToggleUnread,
  showMarkAll,
  markAllDisabled,
  onMarkAll,
}: {
  showUnreadToggle: boolean
  unreadOnly: boolean
  onToggleUnread: () => void
  showMarkAll: boolean
  markAllDisabled: boolean
  onMarkAll: () => void
}) {
  return (
    <>
      {showUnreadToggle && (
        <button
          type="button"
          data-testid="mail-unread-toggle"
          aria-pressed={unreadOnly}
          onClick={onToggleUnread}
          className={cn(
            // 모바일: 시각 h-9 + after 히트 영역 확장으로 터치 44px 확보. 포커스 링은 디자인 시스템 규칙.
            'relative inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40',
            "max-lg:h-9 max-lg:px-4 max-lg:text-sm max-lg:after:absolute max-lg:after:-inset-y-1 max-lg:after:inset-x-0 max-lg:after:content-['']",
            unreadOnly ? cn(TOGGLE_ON_CLASS, 'font-semibold') : 'text-foreground hover:bg-accent/50',
          )}
        >
          {/* 켜짐을 색에만 의존하지 않도록 점 표시(목업). */}
          {unreadOnly && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary" />}
          안 읽은 메일만
        </button>
      )}
      {showMarkAll && (
        <button
          type="button"
          data-testid="mail-mark-all-read"
          disabled={markAllDisabled}
          onClick={onMarkAll}
          aria-label="모두 읽음"
          className={cn(
            // 모바일은 아이콘만 둔 원형 버튼(시각 36px + after 사방 4px 확장 = 터치 44px) — 360px 에서도 필터 줄이 넘치지 않게.
            'relative inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-foreground outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50',
            "max-lg:h-9 max-lg:w-9 max-lg:justify-center max-lg:px-0 max-lg:after:absolute max-lg:after:-inset-1 max-lg:after:content-['']",
          )}
        >
          <CheckCheck aria-hidden className="h-3.5 w-3.5 max-lg:h-4 max-lg:w-4" />
          <span className="max-lg:sr-only">모두 읽음</span>
        </button>
      )}
    </>
  )
}

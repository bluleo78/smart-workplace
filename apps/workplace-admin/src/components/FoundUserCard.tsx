import type { ReactNode } from 'react'

import type { PlatformUserLookup } from '../types/platform'

interface FoundUserCardProps {
  user: PlatformUserLookup
  testId: string
  /** 오른쪽 끝 표시(예: 확인됨 체크) */
  trailing?: ReactNode
}

// 이메일 확인으로 찾은 사용자 카드 — 이름·이메일과 플랫폼 관리자 배지. 소유자 지정·멤버 추가 공용(WP-337).
export function FoundUserCard({ user, testId, trailing }: FoundUserCardProps) {
  return (
    <div className="flex items-center gap-2.5 rounded-md border px-3 py-2 text-sm" data-testid={testId}>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{user.name}</p>
        <p className="text-muted-foreground truncate text-xs">{user.email}</p>
      </div>
      {user.isPlatformAdmin && (
        <span
          className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800"
          data-testid="platform-admin-badge"
        >
          플랫폼 관리자
        </span>
      )}
      {trailing}
    </div>
  )
}

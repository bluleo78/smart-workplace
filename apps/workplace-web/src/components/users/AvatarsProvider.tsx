// 아바타 주소 표 공급자(WP-1222) — 앱 루트에서 한 번 목록을 받아 AvatarMapContext 로 내려 준다.
import { type ReactNode, useMemo } from 'react'

import { AvatarMapContext } from '@/hooks/avatar-map-context'
import { useAvatars } from '@/hooks/queries/useAvatars'
import { useAuth } from '@/hooks/useAuth'

/**
 * 목록(`GET /users/avatars`) 위에 내 아바타는 현재 사용자(`/users/me` 의 avatarUrl)로 덮어쓴다.
 * 왜: 내가 바꾸거나 지운 직후 목록 재조회보다 refreshUser 가 먼저 끝나도 레일 메뉴·내 메시지가 바로 새 모습이 되게.
 */
export function AvatarsProvider({ children }: { children: ReactNode }) {
  const list = useAvatars()
  const { user } = useAuth()
  const meId = user?.id
  const myUrl = user?.avatarUrl
  const map = useMemo(() => {
    if (meId == null || myUrl === undefined || (list.get(meId) ?? null) === myUrl) return list
    const merged = new Map(list)
    if (myUrl) merged.set(meId, myUrl)
    else merged.delete(meId)
    return merged
  }, [list, meId, myUrl])
  return <AvatarMapContext value={map}>{children}</AvatarMapContext>
}

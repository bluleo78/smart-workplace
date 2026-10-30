// 아바타 주소 표(WP-1222) — userId → avatarUrl. 앱 루트의 AvatarsProvider 가 `GET /users/avatars` 결과를 한 번 받아 내려 준다.
// 아바타를 그리는 곳(UserAvatar·ChatAvatar·접속자·레일 메뉴 …)은 이 표만 읽는다 — 화면마다 조회하지 않고, 공급자가 없는
// 화면 테스트에서는 빈 표라 이니셜로 그린다(요청도 나가지 않는다).
import { createContext, useContext } from 'react'

/** 공급자 밖의 기본값 — 아무도 아바타가 없다. */
const EMPTY: ReadonlyMap<number, string> = new Map()

export const AvatarMapContext = createContext<ReadonlyMap<number, string>>(EMPTY)

/** 이 사용자의 아바타 주소(크기 없는 기본 주소). 없거나 userId 를 모르면 null. */
export function useAvatarUrl(userId: number | null | undefined): string | null {
  const map = useContext(AvatarMapContext)
  return userId == null ? null : (map.get(userId) ?? null)
}

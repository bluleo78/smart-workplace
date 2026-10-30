// 아바타 목록 조회(WP-1222) — 지금 워크스페이스에서 아바타가 있는 구성원(사람·AI)의 주소를 한 번 받아 캐시한다.
// 사용처는 앱 루트의 AvatarsProvider 하나다 — 화면들은 AvatarMapContext 로 읽는다(hooks/avatar-map-context).

import { useQuery, useQueryClient } from '@tanstack/react-query'

import { usersApi } from '@/api/users'
import { useAuth } from '@/hooks/useAuth'
import type { AvatarEntry } from '@/types/avatar'

import { avatarKeys } from './avatarKeys'

/** 5분 — 남의 아바타 변경은 resource.changed 「avatar」 이벤트로 무효화돼 바로 다시 받는다(WP-1226). 자주 다시 받을 까닭이 없다. */
const AVATARS_STALE_MS = 5 * 60_000

const EMPTY: ReadonlyMap<number, string> = new Map()

// 모듈 수준 함수 — select 참조가 바뀌지 않아 react-query 가 같은 응답이면 같은 Map 을 돌려준다(쓰는 곳이 다시 그려지지 않게).
function toMap(list: AvatarEntry[]): ReadonlyMap<number, string> {
  return new Map(list.map((a) => [a.userId, a.avatarUrl]))
}

/**
 * userId → avatarUrl 표. 로그인 전에는 부르지 않는다(인증이 필요한 API) — 그동안과 실패 시는 빈 표라 모두 이니셜로 그린다.
 */
export function useAvatars(): ReadonlyMap<number, string> {
  const { user } = useAuth()
  const { data } = useQuery({
    queryKey: avatarKeys.all,
    queryFn: async () => (await usersApi.listAvatars()).data,
    enabled: user != null,
    staleTime: AVATARS_STALE_MS,
    select: toMap,
  })
  return data ?? EMPTY
}

/**
 * 아바타를 바꾸거나 지운 뒤 화면을 새로 받는 함수를 돌려준다 — 프로필(내 아바타)과 에이전트 관리(AI 아바타)가 같이 쓴다.
 * 아바타 표(avatarKeys.all)를 무효화하고, `extra`(예: 내 정보 refreshUser)가 있으면 함께 기다린다. 끝날 때까지 기다려 미리보기가 바로 새 모습이 되게.
 * 갱신 실패는 삼킨다(console.warn) — 저장(PUT·DELETE)은 이미 성공했으니 실패 안내를 띄우거나 자르기 창을 남기면 사용자가 같은 그림을 또 올리게 된다.
 * 화면은 다음 갱신(포커스·재방문) 때 맞춰진다.
 */
export function useAfterAvatarChange(extra?: () => Promise<unknown>): () => Promise<void> {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([queryClient.invalidateQueries({ queryKey: avatarKeys.all }), extra?.()]).then(
      () => undefined,
      (err: unknown) => console.warn('아바타 저장 뒤 화면 갱신 실패(무시)', err),
    )
}

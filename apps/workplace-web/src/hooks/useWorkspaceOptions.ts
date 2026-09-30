// 워크스페이스(테넌트) 전환 후보 목록 — 데스크톱 레일 WorkspaceSwitcher 와 모바일 계정 시트가 공유한다.
// 매 페이지 마운트마다 멤버십을 부르지 않도록 enabled(메뉴·시트 열림)일 때 한 번만 lazy fetch 한다.
import { useEffect, useState } from 'react'

import { authApi } from '@/api/auth'
import { useAuth } from '@/hooks/useAuth'
import type { Membership } from '@/types/auth'

/**
 * enabled 가 처음 true 가 될 때 멤버십 목록을 불러온다. 실패하면 현재 워크스페이스만 두어 전환 불가 상태로 둔다.
 * - list: 불러오기 전·실패 시 [activeTenant] (활성 테넌트가 없으면 빈 배열)
 * - loading: 열린 상태에서 아직 응답이 오지 않음
 * - isCurrent: 현재 활성 워크스페이스인가
 */
export function useWorkspaceOptions(enabled: boolean) {
  const { activeTenant } = useAuth()
  const [options, setOptions] = useState<Membership[] | null>(null)

  useEffect(() => {
    if (!enabled || !activeTenant || options !== null) return
    // 닫힘·언마운트 뒤 늦게 온 응답은 버린다(다음 열림에 다시 부른다).
    let ignore = false
    authApi.memberships()
      .then(({ data }) => { if (!ignore) setOptions(data) })
      .catch(() => { if (!ignore) setOptions([activeTenant]) })
    return () => { ignore = true }
  }, [enabled, activeTenant, options])

  return {
    activeTenant,
    list: options ?? (activeTenant ? [activeTenant] : []),
    loading: enabled && !!activeTenant && options === null,
    isCurrent: (m: Membership) => m.tenantId === activeTenant?.tenantId,
  }
}

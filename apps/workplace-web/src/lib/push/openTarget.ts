// src/lib/push/openTarget.ts
// 알림 탭 목적지로 이동 — 다른 테넌트 알림이면 전환(토큰 재발급 + 목적지로 리로드), 소속이 아니면 안내 후 홈.
// /push-open·SW postMessage·로그인 후 대기 목적지 세 경로가 공유한다.
import { toast } from 'sonner'

import { authApi } from '../../api/auth'
import type { AuthContextValue } from '../../hooks/auth-context-value'
import { safeTarget } from '../../sw/logic'

/** 알림 탭 목적지 — tenantId 는 알림이 속한 테넌트(없으면 null), url 은 safeTarget 을 거친 같은 origin 상대경로. */
export interface PushTarget {
  tenantId: number | null
  url: string
}

export const PENDING_PUSH_TARGET_KEY = 'pendingPushTarget'

/** 미로그인 상태에서 탭한 알림의 목적지를 sessionStorage 에 보관 — 로그인 후 AppLayout 이 1회 소비한다. */
export function savePendingPushTarget(t: PushTarget) {
  try {
    sessionStorage.setItem(PENDING_PUSH_TARGET_KEY, JSON.stringify(t))
  } catch {
    // 저장 불가 — 로그인 후 홈으로
  }
}

/** 보관된 대기 목적지를 꺼내고 지운다(1회성). 없거나 형식이 어긋나면 null. */
export function takePendingPushTarget(): PushTarget | null {
  try {
    const raw = sessionStorage.getItem(PENDING_PUSH_TARGET_KEY)
    if (!raw) return null
    sessionStorage.removeItem(PENDING_PUSH_TARGET_KEY)
    const o = JSON.parse(raw) as { tenantId?: unknown; url?: unknown }
    return { tenantId: typeof o.tenantId === 'number' ? o.tenantId : null, url: safeTarget(o.url) }
  } catch {
    return null
  }
}

/**
 * 알림 탭 목적지로 실제 이동. 알림 없는 테넌트거나 현재 테넌트와 같으면 그대로 navigate 하고,
 * 다른 테넌트면 소속 확인 후 selectTenant(전체 리로드)로 전환하며 목적지를 함께 넘긴다.
 * 소속이 아니거나 전환 실패 시 토스트로 안내하고 홈으로 보낸다.
 */
export async function openPushTarget(
  target: PushTarget,
  deps: {
    activeTenantId: number | null
    selectTenant: AuthContextValue['selectTenant']
    navigate: (to: string) => void
  },
): Promise<void> {
  const url = safeTarget(target.url)
  if (target.tenantId == null || target.tenantId === deps.activeTenantId) {
    deps.navigate(url)
    return
  }
  try {
    const { data: memberships } = await authApi.memberships()
    const m = memberships.find((x) => x.tenantId === target.tenantId)
    if (!m) {
      toast.error('해당 워크스페이스에 접근할 수 없습니다')
      deps.navigate('/')
      return
    }
    await deps.selectTenant(m, url)
  } catch {
    toast.error('워크스페이스를 전환하지 못했습니다')
    deps.navigate('/')
  }
}

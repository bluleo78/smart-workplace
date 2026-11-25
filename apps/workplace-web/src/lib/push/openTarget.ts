// src/lib/push/openTarget.ts
// 알림 탭 목적지로 이동 — 다른 테넌트 알림이면 전환(토큰 재발급 + 목적지로 리로드), 소속이 아니면 안내 후 홈.
// /push-open·SW postMessage·로그인 후 대기 목적지 세 경로가 공유한다.
import { toast } from 'sonner'

import { authApi } from '../../api/auth'
import type { AuthContextValue } from '../../hooks/auth-context-value'
import { safeTarget } from '../../sw/logic'
import { CONNECTED_APPS_PATH } from '../connectedApps'

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

/** 보관된 대기 목적지를 지우지 않고 읽는다. 없거나 형식이 어긋나면 null — 셸이 미리 요청할 때 엿보는 데 쓴다(WP-2116). */
export function peekPendingPushTarget(): PushTarget | null {
  try {
    const raw = sessionStorage.getItem(PENDING_PUSH_TARGET_KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as { tenantId?: unknown; url?: unknown }
    return { tenantId: typeof o.tenantId === 'number' ? o.tenantId : null, url: safeTarget(o.url) }
  } catch {
    return null
  }
}

/** 보관된 대기 목적지를 꺼내고 지운다(1회성). 없거나 형식이 어긋나면 null. */
export function takePendingPushTarget(): PushTarget | null {
  const target = peekPendingPushTarget()
  try {
    sessionStorage.removeItem(PENDING_PUSH_TARGET_KEY)
  } catch {
    // 지우지 못해도 목적지는 돌려준다
  }
  return target
}

/**
 * 어느 워크스페이스에서 열어도 같은 내용을 보이는 사용자 단위 목적지 — 알림이 다른 테넌트 것이어도 전환하지 않는다.
 * 「새 앱 연결」(WP-1686) 푸시는 연결한 워크스페이스의 tenantId 를 싣지만, 「연결된 앱」 절(WP-1687)은 모든 워크스페이스의 연결을
 * 한 목록으로 보여 전환(전체 새로고침)이 필요 없다. 서버 푸시 계약(tenantId 는 늘 숫자)은 모든 종류가 같이 쓰므로 이 목적지만 여기서 거른다.
 */
function isUserScopedTarget(url: string): boolean {
  return url === CONNECTED_APPS_PATH
}

/**
 * 전환(전체 리로드) 없이 지금 문서에서 바로 이동하는 목적지인가 — 알림 테넌트가 없거나 현재 테넌트와 같거나 사용자 단위 목적지.
 * openPushTarget 과 셸 첫 미리 요청(useInitialIssuePrefetch, WP-2116)이 같은 규칙을 쓰게 한 곳에 둔다.
 */
export function navigatesInPlace(target: PushTarget, activeTenantId: number | null): boolean {
  return target.tenantId == null || target.tenantId === activeTenantId || isUserScopedTarget(target.url)
}

/**
 * 알림 탭 목적지로 실제 이동. 알림 없는 테넌트거나 현재 테넌트와 같거나 사용자 단위 목적지면 그대로 navigate 하고,
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
  if (navigatesInPlace({ tenantId: target.tenantId, url }, deps.activeTenantId)) {
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

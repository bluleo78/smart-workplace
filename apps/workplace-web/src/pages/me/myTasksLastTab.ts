// 내 작업 「마지막에 본 탭」 기억(WP-1484) — 처음 들어오면 개요, 그다음은 마지막에 본 탭으로 연다.
// 프로젝트 이슈 화면의 조건 기억(useRememberedIssueQuery, WP-1035)과 같은 규칙: 내 브라우저의 사용자·워크스페이스별 localStorage
// (userScopedKey + storageWithFallback — 저장소가 막혔으면 이 탭에서만 기억).
import { useAuth } from '@/hooks/useAuth'
import { readStored, writeStored } from '@/lib/storageWithFallback'
import { type StorageOwner, userScopedKey } from '@/lib/userScopedKey'

import type { MyTasksTab } from './myTasksQuery'

/** 탭 순서 — 화면 탭 줄과 같다(개요가 맨 앞). */
export const MY_TASKS_TABS: readonly MyTasksTab[] = ['overview', 'assigned', 'reported', 'watched']

/** 기억이 없을 때(첫 방문) 여는 탭. */
export const DEFAULT_MY_TASKS_TAB: MyTasksTab = 'overview'

const STORAGE_BASE = 'my-tasks-tab'

/** 알려진 탭 이름인가 — 주소·저장값 검증 공용. */
export function isMyTasksTab(v: string | null | undefined): v is MyTasksTab {
  return (MY_TASKS_TABS as readonly string[]).includes(v ?? '')
}

/** 주인별 저장 키. 로그인 전(owner 없음)은 null — 누구의 기억도 읽거나 쓰지 않는다. */
export function myTasksTabKey(owner: StorageOwner | null): string | null {
  return owner ? userScopedKey(STORAGE_BASE, owner) : null
}

/** 마지막에 본 탭 — 기억이 없거나 깨진 값이면 개요. */
export function readLastMyTasksTab(key: string | null): MyTasksTab {
  const v = key ? readStored(key) : null
  return isMyTasksTab(v) ? v : DEFAULT_MY_TASKS_TAB
}

/** 지금 보는 탭을 기억한다. */
export function writeLastMyTasksTab(key: string | null, tab: MyTasksTab): void {
  if (key) writeStored(key, tab)
}

/** 로그인 사용자·지금 워크스페이스의 저장 키 — 화면(MyTasksPage)과 첫 진입 길(/me/tasks)이 같은 키를 쓴다. */
export function useMyTasksTabKey(): string | null {
  const { user, activeTenant } = useAuth()
  return myTasksTabKey(user ? { userId: user.id, tenantId: activeTenant?.tenantId ?? null } : null)
}

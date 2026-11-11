// 프로젝트 마지막 탭 기억(WP-1477) — 탭 길에 있을 때 지금 탭을 저장하고, 조건 없이 /projects/:key 에 들어오면 기억한 탭으로 보낸다.
// 저장 위치는 내 브라우저의 사용자·워크스페이스·프로젝트별 localStorage(useRememberedIssueQuery 와 같은 키 규칙).
import { useEffect, useMemo } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

import { useAuth } from '@/hooks/useAuth'
import { readStored, writeStored } from '@/lib/storageWithFallback'
import { userScopedKey } from '@/lib/userScopedKey'

import { DEFAULT_PROJECT_TAB, parseTab, type ProjectTabId, projectTabPath, shouldRememberTab, shouldRestoreTab, tabFromPath } from './projectTabs'

const STORAGE_BASE = 'project-tab'

/**
 * 프로젝트 탭 레이아웃이 부른다.
 * @param enabled 프로젝트를 불러왔고 팀 프로젝트이며 로그인했을 때만 읽고 쓴다.
 * @returns redirectTo 가 있으면 레이아웃이 그 길로 replace 이동한다(그동안 이슈 목록을 그리지 않는다).
 *   tab 은 지금 주소의 탭(탭 길이 아니면 null) — enabled 와 상관없이 늘 계산해, 레이아웃이 탭 줄·개인 분기에 다시 해석하지 않고 쓴다.
 */
export function useRememberedProjectTab(key: string, enabled: boolean): { redirectTo: string | null; tab: ProjectTabId | null } {
  const { user, activeTenant } = useAuth()
  const storageKey = user && enabled
    ? userScopedKey(`${STORAGE_BASE}:${key}`, { userId: user.id, tenantId: activeTenant?.tenantId ?? null })
    : null
  const { pathname, search, key: locationKey, state } = useLocation()
  const navigationType = useNavigationType()
  const tab = tabFromPath(pathname, key)

  // 이슈 탭(index) 진입이고 되돌릴 조건이면 기억한 탭(없으면 기본 탭 DEFAULT_PROJECT_TAB — 지금은 이슈라 그대로 머문다)으로.
  // 기억은 이동(location.key)마다 한 번만 읽는다 — 같은 주소에서 다시 그려질 때마다 저장소를 읽지 않게.
  // 되돌릴 조건일 때만 읽으므로(개인·없는 프로젝트, 이슈 탭이 아닌 주소에서는 읽지 않는다) 조건까지 메모 안에서 따진다.
  const fromTab = (state as { projectTab?: boolean } | null)?.projectTab === true
  const restore = storageKey != null && tab === 'issues' && shouldRestoreTab({ search, navigationType, locationKey, fromTab })
  const target = useMemo(
    () => (restore && storageKey ? (parseTab(readStored(storageKey)) ?? DEFAULT_PROJECT_TAB) : null),
    // locationKey 가 바뀌면(새 이동) 다시 읽는다 — 같은 이동 안의 다시 그리기는 처음 읽은 값을 쓴다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [restore, storageKey, locationKey],
  )
  const redirectTo = target && target !== 'issues' ? projectTabPath(key, target) : null

  // 탭 길에 있으면 지금 탭을 저장한다. 되돌리는 렌더와 뒤로·앞으로 가기(POP) 도착에서는 저장하지 않는다(기억을 덮어쓰지 않게).
  // POP 으로 지나간 탭이 아니라 사용자가 고른 탭만 남긴다 — POP 뒤 같은 탭을 다시 누르면(REPLACE) remember 가 바뀌어 그때 저장한다.
  const remember = shouldRememberTab({ navigationType, locationKey })
  useEffect(() => {
    if (!storageKey || redirectTo || !tab || !remember) return
    writeStored(storageKey, tab)
  }, [storageKey, redirectTo, tab, remember])

  return { redirectTo, tab }
}

// 프로젝트 마지막 탭 기억(WP-1477) — 탭 길에 있을 때 지금 탭을 저장하고, 조건 없이 /projects/:key 에 들어오면 기억한 탭으로 보낸다.
// 저장 위치는 내 브라우저의 사용자·워크스페이스·프로젝트별 localStorage(useRememberedIssueQuery 와 같은 키 규칙).
import { useEffect, useState } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

import { useAuth } from '@/hooks/useAuth'
import { readStored, writeStored } from '@/lib/storageWithFallback'
import { userScopedKey } from '@/lib/userScopedKey'

import {
  DEFAULT_PROJECT_TAB,
  parseTab,
  type ProjectTabId,
  projectTabPath,
  readProjectNavState,
  shouldRememberTab,
  shouldRestoreTab,
  tabFromPath,
} from './projectTabs'

const STORAGE_BASE = 'project-tab'

/**
 * 프로젝트 탭 레이아웃이 부른다.
 * @param enabled 프로젝트를 불러왔고 팀 프로젝트이며 로그인했을 때만 읽고 쓴다.
 * @param notesVisible 노트 탭을 쓸 수 있는지 — true 보임, false 없음, null 조회 중.
 * @param workflowVisible 워크플로우 탭을 쓸 수 있는지 — 같은 세 가지 상태를 쓴다.
 * @returns redirectTo 가 있으면 레이아웃이 그 길로 replace 이동한다(그동안 이슈 목록을 그리지 않는다).
 *   waitingVisibility 는 기억한 탭의 가시성 조회가 안 끝나 판정을 미루는 중 — 레이아웃이 이슈 목록 대신 대기 표시를 그린다.
 *   tab 은 지금 주소의 탭(탭 길이 아니면 null) — enabled 와 상관없이 늘 계산해, 레이아웃이 탭 줄·개인 분기에 다시 해석하지 않고 쓴다.
 */
export function useRememberedProjectTab(
  key: string,
  enabled: boolean,
  notesVisible: boolean | null = false,
  workflowVisible: boolean | null = false,
): { redirectTo: string | null; tab: ProjectTabId | null; waitingVisibility: boolean } {
  const { user, activeTenant } = useAuth()
  const storageKey = user && enabled
    ? userScopedKey(`${STORAGE_BASE}:${key}`, { userId: user.id, tenantId: activeTenant?.tenantId ?? null })
    : null
  // 읽고 쓸 수 있는 상태 — 불러온 팀 프로젝트 + 로그인. 읽기·고정·저장이 모두 이 하나로 가드한다.
  const canPersist = storageKey != null
  const { pathname, search, key: locationKey, state } = useLocation()
  const navigationType = useNavigationType()
  const tab = tabFromPath(pathname, key)

  // 이슈 탭(index) 진입이고 되돌릴 조건이면 기억한 탭(없으면 기본 탭 DEFAULT_PROJECT_TAB = 개요)으로.
  // 되돌릴 조건일 때만 읽으므로(개인·없는 프로젝트, 이슈 탭이 아닌 주소에서는 읽지 않는다) 조건까지 따진다.
  const fromTab = readProjectNavState(state).projectTab
  const restore = canPersist && tab === 'issues' && shouldRestoreTab({ search, navigationType, locationKey, fromTab })
  // 한 진입(locationKey)의 판정 재료를 한 번만 정해 고정한다 — 렌더 중 state 조정 패턴(effect 로 setState 하지 않는다).
  // raw: 기억한 값 — 이동마다 한 번만 읽는다(같은 주소에서 다시 그릴 때마다 저장소를 읽지 않게).
  // 기억한 조건부 탭의 첫 확정 값을 고정한다 — 뒤늦은 재조회로 다른 탭에 있던 사용자를 끌고 가지 않게 한다.
  const [latch, setLatch] = useState<{ locationKey: string; storageKey: string; raw: string | null; visible: boolean | null } | null>(null)
  const current = latch?.locationKey === locationKey && latch.storageKey === storageKey ? latch : null
  const raw = current ? current.raw : restore ? readStored(storageKey) : null
  let visible: boolean | null = true
  if (raw === 'notes') visible = notesVisible
  if (raw === 'workflow') visible = workflowVisible
  if (canPersist && (current == null || (current.visible === null && visible !== null))) {
    setLatch({ locationKey, storageKey, raw, visible })
  }
  const restoreVisible = current?.visible ?? visible
  const waitingVisibility = restore && restoreVisible === null
  const target = restore && !waitingVisibility
    ? (parseTab(raw, restoreVisible === true, restoreVisible === true) ?? DEFAULT_PROJECT_TAB)
    : null
  const redirectTo = target && target !== 'issues' ? projectTabPath(key, target) : null

  // 탭 길에 있으면 지금 탭을 저장한다. 되돌리는 렌더와 뒤로·앞으로 가기(POP) 도착에서는 저장하지 않는다(기억을 덮어쓰지 않게).
  // POP 으로 지나간 탭이 아니라 사용자가 고른 탭만 남긴다 — POP 뒤 같은 탭을 다시 누르면(REPLACE) remember 가 바뀌어 그때 저장한다.
  const remember = shouldRememberTab({ navigationType, locationKey })
  useEffect(() => {
    if (!canPersist || redirectTo || waitingVisibility || !tab || !remember) return
    // 직접 입력한 주소라도 보이지 않는 탭은 기억하지 않는다.
    if (tab === 'notes' && notesVisible !== true) return
    if (tab === 'workflow' && workflowVisible !== true) return
    writeStored(storageKey, tab)
  }, [canPersist, storageKey, redirectTo, waitingVisibility, tab, remember, notesVisible, workflowVisible])

  return { redirectTo, tab, waitingVisibility }
}

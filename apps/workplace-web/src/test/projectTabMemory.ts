// 프로젝트 마지막 탭 기억 심기(WP-1477·1478) — 렌더 도우미(renderScreen·renderPage)가 렌더 전에 한 곳에서 심는다.
// 앱은 기억한 탭이 없으면 조건 없는 /projects/:key 를 기본 탭(개요)으로 보낸다. 이슈 목록·보드를 보는 화면 테스트는 그 주소를
// 「전에 이슈 탭을 쓰던 사용자」로 연다 — 앱이 읽는 실제 저장 키(useRememberedProjectTab: project-tab:<key>:<userId>:<tenantId|->)에 심는다.
// 화면 모듈을 불러오지 않는 작은 모듈이다 — 모든 렌더 도우미가 불러도 화면 모듈 트리를 끌어오지 않게.
import { readStored, writeStored } from '@/lib/storageWithFallback'
import { userScopedKey } from '@/lib/userScopedKey'
import type { ProjectTabId } from '@/pages/projects/tabs/projectTabs'

/** 프로젝트 키 → 기억시킬 탭. */
export type RememberedProjectTabs = Readonly<Record<string, ProjectTabId>>

/**
 * 렌더 도우미의 기본 기억 — 화면 테스트가 주로 쓰는 프로젝트(WP)는 이슈 탭. 다른 키로 이슈 목록을 여는 테스트는 projectTabs 옵션으로 넘기고,
 * 기본 탭(개요)을 보는 테스트는 projectTabs: {} 로 끈다(E2E 의 rememberedProjectTabs 옵션과 같은 규칙).
 */
export const DEFAULT_REMEMBERED_PROJECT_TABS: RememberedProjectTabs = { WP: 'issues' }

/** 테스트 렌더 도우미의 기본 로그인 주인 — renderPage·renderRouteScreen(id 1, 워크스페이스 없음)과 renderScreen(testAuthValue: id 1, 워크스페이스 1). */
const DEFAULT_OWNERS = [
  { userId: 1, tenantId: null },
  { userId: 1, tenantId: 1 },
]

type Owner = { userId: number; tenantId: number | null }

/**
 * 프로젝트의 마지막 탭을 기억시킨다(덮어쓴다) — 렌더 전에 부른다. owners 를 주지 않으면 렌더 도우미들의 기본 로그인 주인 모두에게 심어,
 * 어느 렌더 도우미로 띄워도 같은 기억을 읽는다. 되돌리기를 보는 테스트가 다른 탭(cycles 등)을 심을 때 쓴다.
 */
export function rememberProjectTab(key: string, tab: ProjectTabId = 'issues', owners: readonly Owner[] = DEFAULT_OWNERS) {
  for (const owner of owners) writeStored(userScopedKey(`project-tab:${key}`, owner), tab)
}

/**
 * 렌더 도우미가 렌더 직전에 부른다 — 기억이 비어 있는 키에만 심는다. 테스트가 렌더 전에 rememberProjectTab 으로 다른 탭을 심었으면 그대로 둔다.
 */
export function seedProjectTabs(tabs: RememberedProjectTabs = DEFAULT_REMEMBERED_PROJECT_TABS) {
  for (const [key, tab] of Object.entries(tabs)) {
    for (const owner of DEFAULT_OWNERS) {
      const storageKey = userScopedKey(`project-tab:${key}`, owner)
      if (readStored(storageKey) == null) writeStored(storageKey, tab)
    }
  }
}

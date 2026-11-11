// 프로젝트 마지막 탭 기억 심기(WP-1478) — 앱은 기억한 탭이 없으면 조건 없는 /projects/:key 를 기본 탭(개요)으로 보낸다.
// 이슈 목록·보드를 조건 없는 주소로 여는 스펙은 「전에 이슈 탭을 쓰던 사용자」로 연다 — 앱이 읽는 실제 저장 키
// (useRememberedProjectTab: `project-tab:<key>:<userId>:<tenantId|->`)에 값을 심는다. 앱 코드·Storage 는 건드리지 않는다.
// 심는 곳은 auth.fixture 의 rememberedProjectTabs 옵션 fixture 한 곳이다(스펙은 test.use 로 값만 바꾼다).
import type { BrowserContext, Page } from '@playwright/test'

import type { ProjectTabId } from '../../src/pages/projects/tabs/projectTabs'

/** 프로젝트 키 → 기억시킬 탭. */
export type RememberedProjectTabs = Readonly<Record<string, ProjectTabId>>

/**
 * 기본 기억 — 스펙이 주로 쓰는 프로젝트(WP)는 이슈 탭. 다른 키로 이슈 목록을 여는 스펙은 test.use({ rememberedProjectTabs: {...} }) 로 더하고,
 * 기본 탭(개요)을 보는 스펙은 test.use({ rememberedProjectTabs: {} }) 로 끈다.
 */
export const DEFAULT_REMEMBERED_PROJECT_TABS: RememberedProjectTabs = { WP: 'issues' }

/** 기본 로그인 사용자(id 1, 워크스페이스 없음)의 저장 키 — useRememberedProjectTab 과 같은 규칙. */
function storageKeyOf(key: string): string {
  return `project-tab:${key}:1:-`
}

/**
 * 이어 쓰는 page(WP-1002) — 앱을 다시 띄울 때 넣을 localStorage 값으로 심는다(setStorage = setReusedStorage).
 */
export function seedProjectTabsForReusedPage(tabs: RememberedProjectTabs, setStorage: (key: string, value: string) => void): void {
  for (const [key, tab] of Object.entries(tabs)) setStorage(storageKeyOf(key), tab)
}

/**
 * 새 컨텍스트 — 시작 스크립트로 넣되 이미 값이 있으면(앱이 테스트 중 탭을 바꿔 기억했으면) 덮지 않는다 — 새로고침 뒤에도 고른 탭이 남게.
 */
export async function seedProjectTabs(target: BrowserContext | Page, tabs: RememberedProjectTabs): Promise<void> {
  const entries = Object.entries(tabs).map(([key, tab]) => [storageKeyOf(key), tab] as const)
  if (entries.length === 0) return
  await target.addInitScript((pairs) => {
    for (const [k, v] of pairs) if (window.localStorage.getItem(k) == null) window.localStorage.setItem(k, v)
  }, entries)
}

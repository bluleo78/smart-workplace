// 모바일 경로 판정 — 탭바를 보일지(탭 루트), 뒤로가기가 어디로 갈지(모듈 루트)를 경로만으로 결정한다.
// 상태 없이 렌더 시점에 판정하므로 회전·딥링크 진입에도 일관된다.

import { DEFAULT_TAB_SLOTS } from './tabConfig'
import { ALL_TAB_IDS, MOBILE_TABS, type MobileTabId, under } from './tabs'

// 탭바를 보이는 루트 경로(정확 일치) — 탭 레지스트리의 각 탭 루트 + 앱 목록.
// 탭바 순서 편집(/apps/tabs)은 ‹·[저장] 헤더의 푸시 화면이라 탭바를 숨긴다(U2-2).
// '/mail/:accountId' 는 계정별 받은편지함 = 루트(isTabRoot 의 별도 규칙).
const EXACT_ROOTS = new Set([...ALL_TAB_IDS.map((id) => MOBILE_TABS[id].path), '/apps'])

// 탭 레지스트리에 없는 모듈의 상세 → 뒤로가기 시 돌아갈 루트(탭 match 보다 먼저 본다).
// 설정은 자체 목록(/settings)으로, 프로필·앱 목록 하위는 앱 목록으로 돌아간다.
const EXTRA_ROOTS: [match: (p: string) => boolean, root: string][] = [
  [under('/settings'), '/settings'],
  [under('/profile', '/apps'), '/apps'],
]

/** 끝 슬래시 제거('/' 는 유지) — '/chat/' 와 '/chat' 을 같은 경로로 취급한다. 모바일 경로 판정의 단일 정규화. */
export const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)

// 탭 루트가 아닌 모듈 "목록" 화면 → 뒤로가기 대상. 모듈 루트 자신으로 돌아가면 제자리 루프가 되므로
// 진입점(앱 목록)으로 보낸다. 예: /settings 는 앱 목록 → 설정으로 들어오는 화면.
// /notifications 는 🔔 로 들어오는 "푸시 화면"이라(탭바에 고정하지 않았다면) 뒤로가기 = 홈.
const LIST_PARENTS: Record<string, string> = { '/settings': '/apps', '/notifications': '/' }

// 프로젝트 하위 화면(/projects/:key/…) — 뒤로가기(딥링크) 대상은 그 프로젝트. 모바일 병합 헤더가
// 페이지의 "프로젝트로 돌아가기" 아이콘을 ‹ 하나로 대체하므로 딥링크에서도 같은 곳으로 돌아가게 한다.
const PROJECT_SUB = /^(\/projects\/[^/]+)\/.+$/

// 노트 공간 목록(/wiki/spaces/:id) — 노트는 "공간 → 페이지" 2단 목록이라 공간을 고른 화면도 목록(탭 루트)이다(WP-178).
// 페이지(/wiki/spaces/:id/pages/:id)는 상세. 모듈 레이아웃도 이 판정으로 목록/상세를 가른다.
const WIKI_SPACE_LIST = /^\/wiki\/spaces\/[^/]+$/

/**
 * 탭바를 표시할 탭 루트 경로인가.
 * slots: 사용자 탭바 구성 — 알림(/notifications)은 탭바에 고정됐을 때만 탭 루트다(아니면 🔔 로 여는 푸시 화면:
 * 뒤로가기 헤더 + 탭바 숨김). 생략 시 기본 구성(알림 미포함) 기준.
 */
export function isTabRoot(pathname: string, slots: readonly MobileTabId[] = DEFAULT_TAB_SLOTS): boolean {
  const p = norm(pathname)
  if (p === MOBILE_TABS.notifications.path) return slots.includes('notifications')
  if (EXACT_ROOTS.has(p)) return true
  return /^\/mail\/[^/]+$/.test(p) || WIKI_SPACE_LIST.test(p)
}

/** 경로가 속한 모듈의 루트(뒤로가기 대상). 비탭루트 모듈 목록(/settings)은 진입점(/apps). 매칭 없으면 홈. */
export function moduleRootFor(pathname: string): string {
  const p = norm(pathname)
  if (LIST_PARENTS[p]) return LIST_PARENTS[p]
  const project = PROJECT_SUB.exec(p)
  if (project) return project[1]
  const extra = EXTRA_ROOTS.find(([match]) => match(p))
  if (extra) return extra[1]
  // 그 외엔 경로가 속한 탭(상세 포함 match)의 루트로. 어느 탭에도 속하지 않으면 홈.
  const tab = ALL_TAB_IDS.find((id) => MOBILE_TABS[id].match(p))
  return tab ? MOBILE_TABS[tab].path : '/'
}

/**
 * 뒤로가기 대상. react-router 의 history.state.idx 가 0 보다 크면 앱 안에서 쌓인 기록이 있으니 -1,
 * 아니면(푸시 딥링크 첫 진입 등) 앱 밖으로 나가지 않도록 모듈 루트 경로를 돌려준다.
 */
export function resolveBackTarget(pathname: string, historyIdx: number | undefined): number | string {
  return historyIdx && historyIdx > 0 ? -1 : moduleRootFor(pathname)
}

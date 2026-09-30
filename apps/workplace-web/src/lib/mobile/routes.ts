// 모바일 경로 판정 — 탭바를 보일지(탭 루트), 뒤로가기가 어디로 갈지(모듈 루트)를 경로만으로 결정한다.
// 상태 없이 렌더 시점에 판정하므로 회전·딥링크 진입에도 일관된다.

import { ALL_TAB_IDS, MOBILE_TABS, under } from './tabs'

// 탭바를 보이는 루트 경로(정확 일치) — 탭 레지스트리의 각 탭 루트 + 더보기 화면들.
// '/mail/:accountId' 는 계정별 받은편지함 = 루트(isTabRoot 의 별도 규칙).
const EXACT_ROOTS = new Set([...ALL_TAB_IDS.map((id) => MOBILE_TABS[id].path), '/more', '/more/tabs'])

// 탭 레지스트리에 없는 모듈의 상세 → 뒤로가기 시 돌아갈 루트(탭 match 보다 먼저 본다).
// 설정은 자체 목록(/settings)으로, 프로필·더보기 하위는 더보기로 돌아간다.
const EXTRA_ROOTS: [match: (p: string) => boolean, root: string][] = [
  [under('/settings'), '/settings'],
  [under('/profile', '/more'), '/more'],
]

/** 끝 슬래시 제거('/' 는 유지) — '/chat/' 와 '/chat' 을 같은 경로로 취급한다. 모바일 경로 판정의 단일 정규화. */
export const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)

// 탭 루트가 아닌 모듈 "목록" 화면 → 뒤로가기 대상. 모듈 루트 자신으로 돌아가면 제자리 루프가 되므로
// 진입점(더보기)으로 보낸다. 예: /settings 는 더보기 → 설정으로 들어오는 화면.
const LIST_PARENTS: Record<string, string> = { '/settings': '/more' }

/** 탭바를 표시할 탭 루트 경로인가. */
export function isTabRoot(pathname: string): boolean {
  const p = norm(pathname)
  if (EXACT_ROOTS.has(p)) return true
  return /^\/mail\/[^/]+$/.test(p)
}

/** 경로가 속한 모듈의 루트(뒤로가기 대상). 비탭루트 모듈 목록(/settings)은 진입점(/more). 매칭 없으면 홈. */
export function moduleRootFor(pathname: string): string {
  const p = norm(pathname)
  if (LIST_PARENTS[p]) return LIST_PARENTS[p]
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

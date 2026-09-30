// 모바일 경로 판정 — 탭바를 보일지(탭 루트), 뒤로가기가 어디로 갈지(모듈 루트)를 경로만으로 결정한다.
// 상태 없이 렌더 시점에 판정하므로 회전·딥링크 진입에도 일관된다.

// 탭바를 보이는 루트 경로(정확 일치). '/mail/:accountId' 는 계정별 받은편지함 = 루트.
const EXACT_ROOTS = new Set([
  '/', '/chat', '/mail', '/tasks', '/calendar', '/drive', '/wiki', '/contacts', '/notifications', '/more', '/more/tabs',
])

// 상세 경로 → 뒤로가기 시 돌아갈 모듈 루트. 위에서부터 첫 일치.
const MODULE_ROOTS: [prefix: string, root: string][] = [
  ['/chat', '/chat'],
  ['/projects', '/tasks'],
  ['/me', '/tasks'],
  ['/tasks', '/tasks'],
  ['/drive', '/drive'],
  ['/wiki', '/wiki'],
  ['/settings', '/settings'],
  ['/mail', '/mail'],
  ['/calendar', '/calendar'],
  ['/contacts', '/contacts'],
  ['/notifications', '/notifications'],
  ['/profile', '/more'],
  ['/more', '/more'],
]

// 끝 슬래시 제거('/' 는 유지).
const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)

/** 탭바를 표시할 탭 루트 경로인가. */
export function isTabRoot(pathname: string): boolean {
  const p = norm(pathname)
  if (EXACT_ROOTS.has(p)) return true
  return /^\/mail\/[^/]+$/.test(p)
}

/** 경로가 속한 모듈의 루트. 매칭 없으면 홈. */
export function moduleRootFor(pathname: string): string {
  const p = norm(pathname)
  const hit = MODULE_ROOTS.find(([prefix]) => p === prefix || p.startsWith(`${prefix}/`))
  return hit ? hit[1] : '/'
}

/**
 * 뒤로가기 대상. react-router 의 history.state.idx 가 0 보다 크면 앱 안에서 쌓인 기록이 있으니 -1,
 * 아니면(푸시 딥링크 첫 진입 등) 앱 밖으로 나가지 않도록 모듈 루트 경로를 돌려준다.
 */
export function resolveBackTarget(pathname: string, historyIdx: number | undefined): number | string {
  return historyIdx && historyIdx > 0 ? -1 : moduleRootFor(pathname)
}

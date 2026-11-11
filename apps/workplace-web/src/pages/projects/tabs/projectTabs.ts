// 프로젝트 화면 탭 정의(WP-1477) — 개요·이슈·노트·타임라인·사이클·버전.
// 탭 목록·길(경로)·저장값 해석·「들어올 때 마지막 탭으로 되돌릴지」 판단을 순수 함수로 모아 단위 테스트로 지킨다.
import { PROJECT_TAB_PATHS } from '@/lib/projectTabPaths'

/** 프로젝트 탭 식별자. */
export type ProjectTabId = 'overview' | 'issues' | 'notes' | 'timeline' | 'cycles' | 'versions'

/** 탭 정의 — 표시 순서대로. 노트는 노트 공간 기능(WP-1480·1481) 전이라 숨긴다. */
export const PROJECT_TABS: readonly { id: ProjectTabId; label: string; visible: boolean }[] = [
  { id: 'overview', label: '개요', visible: true },
  { id: 'issues', label: '이슈', visible: true },
  { id: 'notes', label: '노트', visible: false },
  { id: 'timeline', label: '타임라인', visible: true },
  { id: 'cycles', label: '사이클', visible: true },
  { id: 'versions', label: '버전', visible: true },
]

/**
 * 기억한 탭이 없을 때(첫 방문·저장값이 깨졌을 때) `/projects/:key` 가 여는 기본 탭.
 * 개요는 아직 「프로젝트 개요는 준비 중입니다」 자리 표시라, 첫 진입이 빈 화면이 되지 않게 이슈 탭으로 둔다.
 * 개요가 지표로 채워지면 여기 한 곳만 'overview' 로 바꾼다.
 */
export const DEFAULT_PROJECT_TAB: ProjectTabId = 'issues'

/**
 * 탭의 길. 이슈 탭은 `/projects/:key` 그대로(기존 링크·필터 쿼리 호환), 나머지는 `/projects/:key/<탭>`.
 * key 는 기존 링크와 같게 인코딩하지 않는다.
 */
export function projectTabPath(key: string, tab: ProjectTabId): string {
  return tab === 'issues' ? `/projects/${key}` : `/projects/${key}/${tab}`
}

/**
 * 주소를 조각(`/` 사이)마다 디코딩한다. location.pathname 은 인코딩된 채(예: 한글 key → `%ED%82%A4`)이고
 * useParams 의 key 는 디코딩된 값이라, 그대로 비교하면 탭을 못 찾는다. 잘못된 % 인코딩 조각은 던지지 않고 원문을 둔다.
 */
function decodePath(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    })
    .join('/')
}

/**
 * 지금 주소가 어느 탭인가. 탭이 아닌 길(이슈 상세·설정·버전 상세 등)이면 null. 끝의 `/` 는 무시한다.
 * pathname 은 인코딩된 주소, key 는 디코딩된 useParams 값을 받는다(조각마다 디코딩해 맞춰 본다).
 */
export function tabFromPath(pathname: string, key: string): ProjectTabId | null {
  const trimmed = decodePath(pathname).replace(/\/+$/, '')
  const base = `/projects/${key}`
  if (trimmed === base) return 'issues'
  if (!trimmed.startsWith(`${base}/`)) return null
  const rest = trimmed.slice(base.length + 1)
  // 하위 길 탭 목록은 모바일 뒤로가기 판정(lib/mobile/routes.ts)과 같은 한 곳(lib/projectTabPaths)에서 받는다.
  return PROJECT_TAB_PATHS.find((t) => t === rest) ?? null
}

/** 저장값을 탭으로 해석 — 보이는 탭만 통과(숨긴 노트·모르는 값·없음은 null). */
export function parseTab(raw: string | null): ProjectTabId | null {
  const found = PROJECT_TABS.find((t) => t.visible && t.id === raw)
  return found ? found.id : null
}

/**
 * `/projects/:key` 에 들어왔을 때 기억한 탭으로 되돌릴지.
 * 쿼리가 없고, 이슈 탭을 눌러 온 이동이 아니며, PUSH 이거나 첫 진입(key 'default')일 때만 참.
 * REPLACE(화면 안 필터 지움)와 POP(뒤로 가기)는 되돌리지 않는다 — 뒤로 가기가 튕기지 않게.
 */
export function shouldRestoreTab(input: {
  search: string
  navigationType: 'PUSH' | 'POP' | 'REPLACE'
  locationKey: string
  fromTab: boolean
}): boolean {
  if (input.search !== '' || input.fromTab) return false
  return input.navigationType === 'PUSH' || input.locationKey === 'default'
}

/**
 * 지금 탭을 기억할지. 사용자가 고른 이동(PUSH·REPLACE — 탭 클릭·링크·화면 안 필터 바꿈)과 첫 진입(key 'default' —
 * 주소 입력·새 창)만 기억한다. 뒤로·앞으로 가기(POP)로 도착한 탭은 고른 탭이 아니라 기억하지 않는다 — 안 그러면
 * 뒤로 가기로 이슈 탭을 지나기만 해도 기억한 타임라인 등이 'issues' 로 덮인다.
 */
export function shouldRememberTab(input: { navigationType: 'PUSH' | 'POP' | 'REPLACE'; locationKey: string }): boolean {
  return input.navigationType !== 'POP' || input.locationKey === 'default'
}

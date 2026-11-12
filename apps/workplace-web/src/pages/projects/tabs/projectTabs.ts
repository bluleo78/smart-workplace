// 프로젝트 화면 탭 정의(WP-1477) — 개요·이슈·노트·타임라인·사이클·버전.
// 탭 목록·길(경로)·저장값 해석·「들어올 때 마지막 탭으로 되돌릴지」 판단을 순수 함수로 모아 단위 테스트로 지킨다.
import { PROJECT_TAB_PATHS } from '@/lib/projectTabPaths'

/** 프로젝트 탭 식별자. */
export type ProjectTabId = 'overview' | 'issues' | 'notes' | 'timeline' | 'cycles' | 'versions'

/**
 * 탭 정의 — 표시 순서대로. 노트 탭은 프로젝트의 노트 공간을 불러온 프로젝트에서만 보인다(WP-1481) —
 * 그 판정은 정적 값이 아니라 호출부가 넘기는 notesVisible 로 한다(visibleProjectTabs·parseTab).
 */
export const PROJECT_TABS: readonly { id: ProjectTabId; label: string }[] = [
  { id: 'overview', label: '개요' },
  { id: 'issues', label: '이슈' },
  { id: 'notes', label: '노트' },
  { id: 'timeline', label: '타임라인' },
  { id: 'cycles', label: '사이클' },
  { id: 'versions', label: '버전' },
]

/** 지금 보이는 탭 — 노트 탭은 노트 공간이 있을 때(notesVisible)만 낀다. */
export function visibleProjectTabs(notesVisible: boolean) {
  return PROJECT_TABS.filter((t) => t.id !== 'notes' || notesVisible)
}

/**
 * 기억한 탭이 없을 때(첫 방문·저장값이 깨졌을 때) 조건 없는 `/projects/:key` 가 여는 기본 탭 — 개요(WP-1478, 처음 들어오는 사람은 개요).
 * 쿼리가 있는 기존 주소·공유 링크(`/projects/:key?view=board` 등)는 되돌리지 않아(shouldRestoreTab) 그대로 이슈 탭으로 열린다.
 */
export const DEFAULT_PROJECT_TAB: ProjectTabId = 'overview'

/**
 * 탭의 길. 이슈 탭은 `/projects/:key` 그대로(기존 링크·필터 쿼리 호환), 나머지는 `/projects/:key/<탭>`.
 * key 는 기존 링크와 같게 인코딩하지 않는다.
 */
export function projectTabPath(key: string, tab: ProjectTabId): string {
  return tab === 'issues' ? `/projects/${key}` : `/projects/${key}/${tab}`
}

/** 프로젝트 노트 탭의 페이지 주소 `/projects/:key/notes/<페이지 id>` — 개요 리포트 줄·설정 리포트 줄이 같이 쓴다. */
export function projectNotePath(key: string, pageId: number): string {
  return `${projectTabPath(key, 'notes')}/${pageId}`
}

/**
 * 프로젝트 화면으로 가는 이동이 router state 로 싣는 표시 — 모든 표시를 이 한 모양으로 싣고 readProjectNavState 로 읽는다
 * (표시마다 따로 캐스팅하면 이름이 어긋나도 컴파일러가 잡지 못한다). 표시는 그 이동 한 번에만 붙는다 — 화면 안 replace 에는 실리지 않는다.
 * - projectTab: 「이슈 탭을 고른 이동」 — 조건 없는 `/projects/:key` 로 가도 기억한 탭·기본 탭(개요)으로 되돌리지 않는다(shouldRestoreTab).
 * - fromOverview: 개요 탭(WP-1478)의 링크로 온 이동 — 주소의 조건은 따르되 이슈 탭의 조건 기억(WP-1035)은 바꾸지 않는다(useRememberedIssueQuery).
 */
export interface ProjectNavState {
  projectTab?: true
  fromOverview?: true
}

/**
 * 「이슈 탭을 고른 이동」 표시. 탭 줄의 이슈 탭 클릭(WP-1477)과, 이슈 목록으로 돌아가려는 앱 안 이동(이슈 삭제 뒤·없는 이슈에서
 * 「프로젝트로 돌아가기」, WP-1478)이 싣는다. 사이드바·프로젝트 목록 같은 진입 링크는 싣지 않는다(기억한 탭·개요를 따른다).
 */
export const ISSUES_TAB_STATE: ProjectNavState = { projectTab: true }

/** 개요 링크 표시 — 개요의 링크(OverviewIssueLink)만 싣는다. */
export const FROM_OVERVIEW_STATE: ProjectNavState = { fromOverview: true }

/** location.state 에서 프로젝트 이동 표시를 읽는다 — 다른 화면의 state·null 이면 둘 다 false. */
export function readProjectNavState(state: unknown): { projectTab: boolean; fromOverview: boolean } {
  const s = (state && typeof state === 'object' ? state : {}) as ProjectNavState
  return { projectTab: s.projectTab === true, fromOverview: s.fromOverview === true }
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
  // 노트 탭은 `notes`(목록에 있음)와 `notes/<페이지 id>` 두 모양 — 뒤쪽만 따로 알아본다.
  if (/^notes\/[^/]+$/.test(rest)) return 'notes'
  return PROJECT_TAB_PATHS.find((t) => t === rest) ?? null
}

/** 저장값을 탭으로 해석 — 보이는 탭만 통과(노트 공간이 없을 때의 노트·모르는 값·없음은 null). notesVisible 기본은 숨김. */
export function parseTab(raw: string | null, notesVisible = false): ProjectTabId | null {
  const found = visibleProjectTabs(notesVisible).find((t) => t.id === raw)
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

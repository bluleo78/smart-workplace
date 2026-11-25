import { ISSUE_DETAIL_PATH } from './issueDetailPath'
import type { PreloadableLoader } from './preloadableLazy'

/**
 * 청크를 내려받는 로더 — preloadableLazy 가 돌려준 것만 받는다(WP-2104). 일반 import 함수(React.lazy 화면)는
 * 미리 받아 둬도 첫 렌더에 Suspense 로 멈춰 미리 받기 효과가 줄어 타입에서 막는다. 같은 로더라 모듈도 한 번만 받아진다.
 */
export type Preload = PreloadableLoader<unknown>


/**
 * 주소(pathname)에 맞는 미리 받기 키를 고른다(WP-2021) — ROUTE_PRELOADS 에서 첫 일치 항목의 키들, 없으면 [].
 * 순수 함수라 표 순서(구체적인 것 먼저)만 지키면 된다.
 */
export function selectRoutePreloads(pathname: string): RoutePreloadKey[] {
  for (const [pattern, keys] of ROUTE_PRELOADS) {
    if (pattern.test(pathname)) return [...keys]
  }
  return []
}

/**
 * 고른 키의 청크를 지금 내려받기 시작한다(WP-2021) — 인증 응답을 기다리지 않고 병렬로 받기 위함.
 * 실패는 처리되지 않은 거부 경고만 막으려 삼킨다 — 다시 받지는 않는다. HTTP 오류로 실패한 모듈은 브라우저가 실패로 기억해
 * 뒤의 lazy() 도 같은 오류로 끝나고(WP-2021 실측), 그 오류 화면의 「다시 시도」가 청크 실패면 새로고침한다(PageErrorBoundary).
 * loaders 는 모든 키를 채운 Record 라 키가 빠질 수 없다.
 */
export function startRoutePreloads(pathname: string, loaders: Record<RoutePreloadKey, Preload>): void {
  for (const key of selectRoutePreloads(pathname)) {
    loaders[key]().catch(() => {})
  }
}

/** 이 문서에서 첫 주소 미리 받기를 이미 시작했는가 — App 이 다시 마운트돼도(E2E 이어 쓰기 등) 한 번만 돌게 한다. */
let initialPreloadStarted = false

/**
 * 첫 주소의 청크 미리 받기를 문서당 한 번만 시작한다(WP-2021 리뷰 후속) — 미리 받기는 첫 진입을 위한 것이라
 * App 이 같은 문서에서 다시 마운트될 때(주소가 바뀐 뒤) 또 돌면 그 주소의 청크를 쓸데없이 다시 고른다.
 */
export function startInitialRoutePreloads(pathname: string, loaders: Record<RoutePreloadKey, Preload>): void {
  if (initialPreloadStarted) return
  initialPreloadStarted = true
  startRoutePreloads(pathname, loaders)
}

/** 로그인 없이 보는 공개 화면 — refresh 가 실패해 이 주소들로 옮겨 간 사람에게는 앱 청크를 받아 줄 이유가 없다. */
const PUBLIC_PATH = /^\/(login|signup|s\/)/

/**
 * 미리 받기를 미룬 콜백이 실제로 돌 때 쓰는 판정(WP-2087) — 시작 전 조건(로그인 흔적)을 그 시점에 다시 확인한다.
 * 왜: 첫 refresh 가 끝나길 기다리는 사이 refresh 가 거절되면 흔적이 지워지고 로그인 화면으로 이동한다. 그 사람에게 청크를 받으면 낭비다.
 * 흔적이 없거나 현재 주소가 공개 화면이면 아무것도 하지 않고(문서당 한 번 표시도 소비하지 않는다), 아니면 현재 주소 기준으로 시작한다.
 */
export function startInitialRoutePreloadsIfSignedIn(
  loaders: Record<RoutePreloadKey, Preload>,
  hasSessionHint: () => boolean,
  pathname: string = window.location.pathname,
): void {
  if (!hasSessionHint() || PUBLIC_PATH.test(pathname)) return
  startInitialRoutePreloads(pathname, loaders)
}

/**
 * 첫 주소의 페이지 청크를 인증(users/me)과 병렬로 미리 받는 표(WP-2021) — 첫 일치 항목의 키만 쓴다. 키에 대응하는 로더는 App.tsx 가 쥔다.
 * 앱 셸 밖 화면(/mail/compose 새 창, /wiki/share/:token, /wiki/open/:pageId)과 탭이 아닌 프로젝트 하위 화면
 * (/projects/:key/versions/:id 등)은 해당 모듈·탭 청크가 필요 없으니 일부러 일치하지 않게 좁혀 둔다.
 */
export const ROUTE_PRELOADS = [
  // 이슈 상세(/projects/:key/issues/:number) — 탭 밖 단독 화면이라 탭 청크 없이 상세 페이지 청크만 받는다(WP-2074)
  [ISSUE_DETAIL_PATH, ['issueDetail']],
  // 프로젝트 홈과 이슈 목록 고정 주소(/projects/:key/issues, WP-2085) — 둘 다 이슈 탭 청크까지 받는다
  [/^\/projects\/[^/]+(?:\/issues)?\/?$/, ['projectTabs', 'projectIssues']],
  // 탭 라우트만: overview·timeline·cycles·versions(목록)·workflow·notes(/:pageId). versions/:id 상세는 탭 밖이다.
  [/^\/projects\/[^/]+\/(?:(?:timeline|cycles|versions|overview|workflow)|notes(?:\/[^/]+)?)\/?$/, ['projectTabs']],
  [/^\/projects\/?$/, ['projectList']],
  // /mail/compose 는 셸 밖 새 창이라 제외
  [/^\/mail(?!\/compose(?:\/|$))(?:\/|$)/, ['mailLayout', 'mailInbox']],
  // 인덱스(목록) 청크는 모듈 루트 정확히 일치일 때만 — 깊은 주소(/chat/channels/5 등)는 레이아웃만 받는다
  [/^\/chat\/?$/, ['chatLayout', 'chatList']],
  [/^\/chat(?:\/|$)/, ['chatLayout']],
  // 모듈 레이아웃 안쪽 라우트만: /wiki, recent, starred, spaces/... (share·open 은 셸 밖)
  [/^\/wiki\/?$/, ['wikiLayout', 'wikiIndex']],
  [/^\/wiki\/(?:recent|starred|spaces)(?:\/|$)/, ['wikiLayout']],
  [/^\/drive\/?$/, ['driveLayout', 'driveIndex']],
  [/^\/drive(?:\/|$)/, ['driveLayout']],
  [/^\/$/, ['home']],
  // 관리 화면(WP-2080): 설정 레이아웃(SettingsModuleLayout)과 목록 화면 청크 — 상세(/settings/users/5 등)는 다른 청크라 일부러 일치하지 않게 좁혀 둔다.
  // 이슈가 짚은 네 화면만 넣었다(AI 현황 등 나머지 관리 화면은 필요해지면 같은 방식으로 더한다). 옛 /admin/* 주소는 리다이렉트 뒤라 받지 않는다.
  [/^\/settings\/users\/?$/, ['settingsLayout', 'adminUsers']],
  [/^\/settings\/audit-logs\/?$/, ['settingsLayout', 'adminAuditLogs']],
  [/^\/settings\/roles\/?$/, ['settingsLayout', 'adminRoles']],
  [/^\/settings\/agents(?:\/(?:locations|accounts))?\/?$/, ['settingsLayout', 'adminAgents']],
] as const

/** 미리 받기 키 — 표에서 뽑아 App.tsx 의 로더 맵이 오타 없이 키를 채우게 한다. */
export type RoutePreloadKey = (typeof ROUTE_PRELOADS)[number][1][number]

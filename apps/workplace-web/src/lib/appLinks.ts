// 채팅 본문의 우리 앱 링크 읽기(WP-896) — 같은 호스트의 이슈·노트·드라이브 파일 주소를 종류·id 로 바꾼다. DOM 비의존 순수 함수.
// 카드는 서버가 보는 사람 권한으로 채우고(/api/v1/app-links), 여기서는 어느 링크가 앱 링크인지와 앱 안 이동 경로만 정한다.
import { CHAT_LINK_RULES, splitLinks } from '@/lib/textLinks'
import { PROJECT_KEY_RE } from '@/lib/validations/project'

/** 본문 앞에서 카드를 만드는 최대 링크 수 — 서버 LinkUrlExtractor.MAX_PREVIEWS 와 같다(OG 카드와 합쳐 3장 이하). */
export const MAX_LINK_CARDS = 3

export type AppLink =
  | { kind: 'ISSUE'; to: string; key: string; number: number }
  | { kind: 'PAGE'; to: string; pageId: number }
  | { kind: 'FILE'; to: string; fileId: number }

/** 앱 링크 종류의 화면 이름 — 채팅 카드와 노트 칩이 같은 말을 쓴다. */
export const APP_LINK_KIND_LABEL: Record<AppLink['kind'], string> = { ISSUE: '이슈', PAGE: '노트', FILE: '파일' }

// 마크다운 링크 [글](url) — 서버 LinkUrlExtractor.MD_LINK 와 같은 모양. 주소만 남겨 글 쪽 URL 과 한 토큰으로 붙지 않게 한다.
const MD_LINK = /\[[^\]\n]*\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g

// id 자릿수 상한(WP-1165) — 서버 LinkPreviewDispatcher 의 ISSUE_NUMBER·ID 와 같다. 넘는 주소는 앱 링크가 아니다(서버도 OG 미리보기를 만든다).
//   - 이슈 번호는 서버가 int 로 받으므로 9자리까지(2^31 아래)
//   - 노트·파일 id 는 Number() 로 바꿔도 값이 그대로인 15자리까지(2^53 아래)
const ISSUE_NUMBER = /^[1-9][0-9]{0,8}$/
const ID = /^[1-9][0-9]{0,14}$/

/** 본문에서 카드 대상 URL(href)을 나온 순서대로, 중복 없이 최대 3개 — 서버가 미리보기를 고르는 규칙과 같다. */
export function cardUrls(body: string): string[] {
  const text = body.replace(MD_LINK, (_m, url: string) => ` ${url} `)
  const out: string[] = []
  for (const seg of splitLinks(text, CHAT_LINK_RULES)) {
    if (seg.type !== 'link' || out.includes(seg.href)) continue
    out.push(seg.href)
    if (out.length === MAX_LINK_CARDS) break
  }
  return out
}

/** 우리 앱 호스트들(소문자) — 지금 접속한 호스트 + 서버가 알려 준 공개 웹 주소 호스트(WP-1165). */
export type AppHosts = readonly string[]

// 빈 호스트(file: 주소 등)는 어떤 앱 호스트와도 같지 않다.
function isAppHost(hostname: string, appHosts: AppHosts): boolean {
  const h = hostname.toLowerCase()
  return h !== '' && appHosts.includes(h)
}

/** 이슈 화면 주소 — 앱 링크 판정(parseAppLink)과 본문 이슈 키 링크(IssueKeyRef)가 같은 경로를 쓰도록 한 곳에 둔다. */
export function issuePath(projectKey: string, number: number): string {
  return `/projects/${projectKey}/issues/${number}`
}

/**
 * URL 하나를 앱 링크로 읽는다. 경로 문법은 서버 LinkPreviewDispatcher.isAppCardUrl 과 같아야 한다 — 두 쪽 테스트가 같은 사례 표
 * (workplace-api 의 test/resources/app-links/app-card-urls.json)를 읽어 어긋나면 실패한다. 호스트가 appHosts 와 같고(포트 무관 — 서버의 OG 제외와 같은 기준) 경로가 이슈·노트·파일 화면일 때만.
 *   - /projects/{KEY}/issues/{n}
 *   - /wiki/spaces/{spaceId}/pages/{id} · /wiki/open/{id}
 *   - /drive/spaces/{spaceId}?file={id}
 */
export function parseAppLink(href: string, appHosts: AppHosts): AppLink | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (!isAppHost(url.hostname, appHosts)) return null
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length === 4 && parts[0] === 'projects' && parts[2] === 'issues' && ISSUE_NUMBER.test(parts[3])) {
    const key = parts[1].toUpperCase()
    if (!PROJECT_KEY_RE.test(key)) return null
    // ISSUE_NUMBER 가 0 으로 시작하는 번호를 막으므로 Number 로 바꿔도 주소 글자는 같다.
    const number = Number(parts[3])
    return { kind: 'ISSUE', to: issuePath(key, number), key, number }
  }
  if (parts[0] === 'wiki') {
    const spacePage = parts.length === 5 && parts[1] === 'spaces' && ID.test(parts[2]) && parts[3] === 'pages' && ID.test(parts[4])
    const open = parts.length === 3 && parts[1] === 'open' && ID.test(parts[2])
    if (spacePage || open) {
      const pageId = Number(parts[parts.length - 1])
      return { kind: 'PAGE', to: url.pathname, pageId }
    }
    return null
  }
  const file = url.searchParams.get('file')
  if (parts.length === 3 && parts[0] === 'drive' && parts[1] === 'spaces' && ID.test(parts[2]) && file && ID.test(file)) {
    return { kind: 'FILE', to: `/drive/spaces/${parts[2]}?file=${file}`, fileId: Number(file) }
  }
  return null
}

// 최근 읽은 본문의 결과 — 메시지 행·작업 시트 판정이 렌더마다 같은 본문을 다시 읽지 않게. 넘치면 통째로 비운다.
const cache = new Map<string, AppLink[]>()
const CACHE_LIMIT = 500

/** 본문의 앱 링크(카드 대상 3개 안에서) — 같은 대상이 두 번 나와도 카드는 하나. 같은 (호스트, 본문)은 같은 배열을 돌려준다. */
export function appLinksOf(body: string, appHosts: AppHosts): AppLink[] {
  const key = `${appHosts.join(' ')}\n${body}`
  const hit = cache.get(key)
  if (hit) return hit
  const out = readAppLinks(body, appHosts)
  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(key, out)
  return out
}

/** 링크가 가리키는 대상 — 경로가 달라도(/wiki/open/{id} 와 /wiki/spaces/{s}/pages/{id}) 같은 대상이면 같은 값(WP-1165). */
export function appLinkTarget(link: AppLink): string {
  if (link.kind === 'ISSUE') return `ISSUE:${link.key}-${link.number}`
  if (link.kind === 'PAGE') return `PAGE:${link.pageId}`
  return `FILE:${link.fileId}`
}

function readAppLinks(body: string, appHosts: AppHosts): AppLink[] {
  const out: AppLink[] = []
  const seen = new Set<string>()
  for (const href of cardUrls(body)) {
    const link = parseAppLink(href, appHosts)
    // 같은 대상은 카드 하나 — 경로가 아니라 대상으로 거른다.
    if (!link) continue
    const target = appLinkTarget(link)
    if (seen.has(target)) continue
    seen.add(target)
    out.push(link)
  }
  return out
}

// 서버가 알려 준 공개 웹 주소 호스트(GET /app-links/config) — 받기 전이나 서버 설정이 비었으면 null(지금 호스트만 본다).
let publicAppHost: string | null = null
let hostsSnapshot: readonly string[] | null = null
let hostsSnapshotHere = ''
const hostListeners = new Set<() => void>()

/** 공개 웹 주소 호스트를 정한다 — 앱 시작 때 설정을 받은 뒤 한 번(useAppLinkConfig). 바뀌면 구독한 행이 다시 그린다. */
export function setPublicAppHost(host: string | null): void {
  const next = host ? host.toLowerCase() : null
  if (next === publicAppHost) return
  publicAppHost = next
  hostsSnapshot = null
  hostListeners.forEach((l) => l())
}

/** 앱 호스트가 바뀌는 것을 구독한다(useSyncExternalStore 용). */
export function subscribeAppHosts(listener: () => void): () => void {
  hostListeners.add(listener)
  return () => hostListeners.delete(listener)
}

/** 지금 우리 앱 주소로 보는 호스트들 — 지금 화면의 호스트와 공개 웹 주소 호스트(둘이 같으면 하나). 바뀌지 않으면 같은 배열. */
export function currentAppHosts(): readonly string[] {
  const here = typeof window === 'undefined' ? '' : window.location.hostname.toLowerCase()
  // 같은 값이면 같은 배열 — useSyncExternalStore 스냅샷·appLinksOf 캐시가 렌더마다 바뀌지 않게. 지금 호스트가 바뀌면(테스트) 다시 만든다.
  if (!hostsSnapshot || hostsSnapshotHere !== here) {
    hostsSnapshotHere = here
    // 창이 없으면(노드 테스트 등) 지금 호스트는 없다 — 빈 값은 넣지 않는다.
    hostsSnapshot = [...new Set([here, publicAppHost ?? ''])].filter(Boolean)
  }
  return hostsSnapshot
}

/** 화면에 그릴 앱 링크 — 지운 메시지·작성자가 미리보기를 지운 메시지는 없다. 메시지 행과 작업 시트가 같은 규칙을 쓴다. */
export function visibleAppLinks(
  m: { body: string; deleted?: boolean; linkPreviewsDismissed?: boolean },
  appHosts: AppHosts = currentAppHosts(),
): AppLink[] {
  return m.deleted || m.linkPreviewsDismissed ? [] : appLinksOf(m.body, appHosts)
}

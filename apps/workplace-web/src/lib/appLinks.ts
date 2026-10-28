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

// 마크다운 링크 [글](url) — 서버 LinkUrlExtractor.MD_LINK 와 같은 모양. 주소만 남겨 글 쪽 URL 과 한 토큰으로 붙지 않게 한다.
const MD_LINK = /\[[^\]\n]*\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g

const ID = /^[1-9][0-9]{0,17}$/

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

/**
 * URL 하나를 앱 링크로 읽는다. 호스트가 appHost 와 같고(포트 무관 — 서버의 OG 제외와 같은 기준) 경로가 이슈·노트·파일 화면일 때만.
 *   - /projects/{KEY}/issues/{n}
 *   - /wiki/spaces/{spaceId}/pages/{id} · /wiki/open/{id}
 *   - /drive/spaces/{spaceId}?file={id}
 */
export function parseAppLink(href: string, appHost: string): AppLink | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.hostname.toLowerCase() !== appHost.toLowerCase()) return null
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length === 4 && parts[0] === 'projects' && parts[2] === 'issues' && ID.test(parts[3])) {
    const key = parts[1].toUpperCase()
    if (!PROJECT_KEY_RE.test(key)) return null
    return { kind: 'ISSUE', to: `/projects/${key}/issues/${parts[3]}`, key, number: Number(parts[3]) }
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
export function appLinksOf(body: string, appHost: string): AppLink[] {
  const key = `${appHost}\n${body}`
  const hit = cache.get(key)
  if (hit) return hit
  const out = readAppLinks(body, appHost)
  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(key, out)
  return out
}

function readAppLinks(body: string, appHost: string): AppLink[] {
  const out: AppLink[] = []
  const seen = new Set<string>()
  for (const href of cardUrls(body)) {
    const link = parseAppLink(href, appHost)
    if (!link || seen.has(link.to)) continue
    seen.add(link.to)
    out.push(link)
  }
  return out
}

/** 지금 화면의 호스트 — 앱 링크 판정 기준. */
export function currentAppHost(): string {
  return typeof window === 'undefined' ? '' : window.location.hostname
}

/** 화면에 그릴 앱 링크 — 지운 메시지·작성자가 미리보기를 지운 메시지는 없다. 메시지 행과 작업 시트가 같은 규칙을 쓴다. */
export function visibleAppLinks(
  m: { body: string; deleted?: boolean; linkPreviewsDismissed?: boolean },
  appHost: string = currentAppHost(),
): AppLink[] {
  return m.deleted || m.linkPreviewsDismissed ? [] : appLinksOf(m.body, appHost)
}

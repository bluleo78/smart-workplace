// 노트 링크 넣기·고치기 입력 주소 정규화(WP-312) — DOM·에디터 비의존 순수 로직.
//
// 왜 따로 정규화하나: 링크 UI 는 setLink 로 마크를 붙이는데, setLink 는 스키마의 parseHTML(normalizeHref)을 거치지 않는다.
// 그대로 넣으면 공백·| ·비ASCII 가 든 주소가 저장 마크다운에서 링크 문법을 깨거나 다시 열 때마다 인코딩돼 본문이 바뀐다.
// 그래서 마크다운 파싱 경로와 같은 정규화(markdown-it normalizeLink)를 거친 뒤, 위험 주소(javascript: 등)를 isAllowedUri 로 거른다.
import { normalizeLinkHref } from '@smart-workplace/wiki-editor-schema'
import { isAllowedUri } from '@tiptap/extension-link'

// 스킴(예: https:, mailto:)으로 시작하는지.
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i
// "호스트:포트" 꼴(localhost:6173, docs.example.com:8080) — 스킴처럼 보여도 스킴이 아니다.
const HOST_PORT_RE = /^(localhost|[^\s:/]+\.[^\s:/]+):\d+(?=[/?#]|$)/i
// 메일 주소처럼 보이는지(user@host.tld) — https://user@host 가 아니라 mailto: 로 건다.
const EMAIL_RE = /^[^\s@/:?#]+@[^\s@/:?#]+\.[^\s@/:?#.]+$/
// 스킴 없이 친 주소가 도메인처럼 보이는지 — 첫 경로 조각에 점이 있거나 localhost.
const BARE_HOST_RE = /^(localhost|[^\s/?#]+\.[^\s/?#.]+)(?=[:/?#]|$)/i

/**
 * 사용자가 친 링크 주소를 저장할 href 로 바꾼다 — 넣을 수 없는 값이면 null.
 * - 앞뒤 공백 제거, 비면 null.
 * - 스킴이 없으면: `/` 하나로 시작하는 앱 안 경로는 그대로(`//host` 는 스킴 상대 주소라 거부), 메일 주소면 mailto:,
 *   호스트 앞에 @ 가 든 꼴(https://user@host)은 거부, 도메인처럼 보이면 https:// 를 붙이고, 그 밖(점 없는 낱말)은 null.
 * - http(s) 는 스킴 뒤 주소가 비었으면 null.
 * - 마크다운 경로와 같은 인코딩(이미 인코딩된 %XX 는 유지 → 멱등)을 한 뒤 isAllowedUri 로 위험 주소를 거른다.
 */
export function normalizeLinkInput(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null

  let url: string
  if (SCHEME_RE.test(text) && !HOST_PORT_RE.test(text)) {
    url = text
    if (/^https?:/i.test(url) && !/^https?:\/\/\S/i.test(url)) return null
  } else if (text.startsWith('/')) {
    if (text.startsWith('//')) return null
    url = text
  } else if (EMAIL_RE.test(text)) {
    url = `mailto:${text}`
  } else if (/^[^/?#]*@/.test(text)) {
    // 메일 주소도 아닌데 호스트 앞에 @ 가 있으면 https://user@host 꼴(보이는 것과 다른 곳으로 가는 주소)이라 거부한다.
    return null
  } else if (BARE_HOST_RE.test(text)) {
    url = `https://${text}`
  } else {
    return null
  }

  const href = normalizeLinkHref(url)
  if (!href) return null
  return isAllowedUri(href) ? href : null
}

/** 버블·시트에 보일 주소 — 저장용 퍼센트 인코딩(%EB%AC%B8…)을 사람이 읽는 글자로 푼다. 풀 수 없으면 그대로. */
export function displayLinkHref(href: string): string {
  try {
    return decodeURI(href)
  } catch {
    return href
  }
}

/** 열어도 되는 주소면 그대로, 비었거나 위험한 주소(javascript: 등 — 렌더에서도 막지만 여는 지점에서 다시 거름)면 null. */
export function openableHref(href: string | null | undefined): string | null {
  const h = href?.trim()
  return h && isAllowedUri(h) ? h : null
}

// 통합 검색 팔레트(WP-1353, 앞서 WP-1324 상단 이슈 검색)의 순수 판정 — 일치 강조 조각 나누기·단축키 판정·결과 이동 인덱스.
// 컴포넌트와 분리해(react-refresh) 브라우저 없이 지킨다.
import { isEditableTarget, OPEN_OVERLAY_SELECTOR } from '@/lib/escapeOverlay'

/** 입력이 멈춘 뒤 검색을 보내기까지(ms) — 글자마다 요청하지 않게. */
export const SEARCH_DEBOUNCE_MS = 250

/** 앱 한 곳에서 한 번에 받는 건수 — 한 앱 탭에서 「더 보기」로 이어 받는 단위. */
export const SEARCH_PAGE_SIZE = 20

/** 「전체」 탭에서 앱마다 먼저 보여 주는 건수 — 더 있으면 「더 보기」로 그 앱 탭으로 간다. */
export const GROUP_SIZE = 3

/** 결과 열기 단축키 안내 — mac 은 ⌘↵, 그 밖은 Ctrl+↵(새 탭은 수정 키를 더한 열기). */
export function shortcutHint(): { open: string; newTab: string } {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
  return mac ? { open: '↵', newTab: '⌘↵' } : { open: '↵', newTab: 'Ctrl+↵' }
}

/**
 * 보낼 만한 검색어인가 — 두 글자부터. 한 글자는 작업 번호(`7`·`#7`)일 때만 보낸다.
 * 서버 검색이 제목·본문 부분 일치라 한 글자는 거의 모든 이슈를 훑고 쓸모 있는 결과도 적다.
 */
export function isSearchableTerm(term: string): boolean {
  return term.length >= 2 || /^#?\d+$/.test(term)
}

/** 강조 조각 — match 면 검색어와 일치한 부분. */
interface HighlightPart {
  text: string
  match: boolean
}

/** 정규식 특수문자를 글자 그대로 찾도록 감싼다. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * text 를 검색어 q 와 일치하는 부분(대소문자 무시)과 나머지로 나눈다. 검색어가 비면 통째 하나.
 * 서버 검색이 제목·본문 부분 일치(LIKE)라 같은 규칙으로 제목에서 맞은 곳을 보여 준다.
 * 소문자로 바꾼 문자열의 위치로 원문을 자르지 않는다 — 'İ' 처럼 소문자가 되며 길이가 바뀌는 글자 뒤에서 어긋나므로
 * 원문에 대소문자 무시 정규식을 바로 건다.
 */
export function highlightParts(text: string, q: string): HighlightPart[] {
  const needle = q.trim()
  if (!needle) return [{ text, match: false }]
  const parts: HighlightPart[] = []
  let from = 0
  for (const m of text.matchAll(new RegExp(escapeRegExp(needle), 'gi'))) {
    const at = m.index
    if (at > from) parts.push({ text: text.slice(from, at), match: false })
    parts.push({ text: m[0], match: true })
    from = at + m[0].length
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false })
  return parts.length ? parts : [{ text, match: false }]
}

/**
 * 검색 열기 단축키인가 — 수정 키 없는 「/」(GitHub·YouTube 와 같은 관례). ⌘K/Ctrl+K 는 AI 어시스턴트가 이미 쓰므로 겹치지 않게 「/」를 쓴다.
 * 글을 쓰는 중이거나, 다른 화면이 이미 처리했거나, 대화상자·메뉴 같은 오버레이가 열려 있으면 열지 않는다
 * (오버레이가 포커스를 쥐고 있어 검색 칸에 글을 쓸 수 없다).
 */
export function isSearchShortcut(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'target' | 'isComposing' | 'defaultPrevented'>,
): boolean {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.defaultPrevented) return false
  if (isEditableTarget(e.target)) return false
  return document.querySelector(OPEN_OVERLAY_SELECTOR) == null
}

/** 위·아래 키로 고른 결과 인덱스 — 끝에서 처음으로(그 반대로) 돈다. 결과가 없으면 -1. */
export function moveActive(current: number, delta: 1 | -1, count: number): number {
  if (count <= 0) return -1
  if (current < 0) return delta === 1 ? 0 : count - 1
  return (current + delta + count) % count
}

/**
 * HTML 태그를 벗겨 글자만 남긴다 — 노트 snippet 의 `<b>일치</b>` 같은 표시를 화면에 그대로 그리지 않고,
 * 태그를 해석하지도 않기 위해(XSS 방지: 결과는 늘 텍스트 노드로만 그린다). 흔한 엔티티는 글자로 되돌린다.
 */
export function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

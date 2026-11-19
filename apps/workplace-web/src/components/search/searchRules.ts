// 통합 검색 팔레트(WP-1353, 앞서 WP-1324 상단 이슈 검색)의 순수 판정 — 일치 강조 조각 나누기·단축키 판정·결과 이동 인덱스.
// 컴포넌트와 분리해(react-refresh) 브라우저 없이 지킨다.
import { isEditableTarget, OPEN_OVERLAY_SELECTOR } from '@/lib/escapeOverlay'

/** 입력이 멈춘 뒤 검색을 보내기까지(ms) — 글자마다 요청하지 않게. */
export const SEARCH_DEBOUNCE_MS = 250

/** 앱 한 곳에서 한 번에 받는 건수 — 한 앱 탭에서 「더 보기」로 이어 받는 단위. */
export const SEARCH_PAGE_SIZE = 20

/** 「전체」 탭에서 앱마다 먼저 보여 주는 건수 — 더 있으면 「더 보기」로 그 앱 탭으로 간다. */
export const GROUP_SIZE = 3

/** 새 탭으로 열기 단축키 안내 — mac 은 ⌘↵, 그 밖은 Ctrl+↵(결과 열기 ↵ 에 수정 키를 더한다). */
export function newTabHint(): string {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
  return mac ? '⌘↵' : 'Ctrl+↵'
}

/**
 * 보낼 만한 검색어인가 — 두 글자부터. 한 글자는 작업 번호(`7`·`#7`)일 때만 보낸다.
 * 작업(issues) provider 가 쓰는 규칙이고 그 밖의 앱은 두 글자부터다(SearchProvider.isSearchable). 서버 검색이 제목·본문 부분 일치라 한 글자는 거의 모든 이슈를 훑고 쓸모 있는 결과도 적다.
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

/** 결과 안내 문구를 만드는 입력 — 화면이 가진 탭·건수·실패 여부를 그대로 넘긴다. */
export interface SearchAnnouncementInput {
  /** 결과 목록을 보여 주는 중인가(검색어가 보낼 만하고 결과 화면일 때). */
  showResults: boolean
  /** 이번 검색 응답이 확정됐나(로딩 중 이전 결과로 안내하지 않도록). */
  settled: boolean
  /** 현재 탭 이름(「전체」·「작업」·「드라이브」 …). */
  tabLabel: string
  /** 「전체」 탭인가 — 없음 문구가 앱 전체를 가리키도록. */
  isAll: boolean
  /** 받은 건수. */
  count: number
  /** 건수 뒤에 더 있는가 — 있으면 「이상」을 붙인다. */
  more: boolean
  /** 검색 요청이 실패했나. */
  failed: boolean
  /** 검색어 — 없음 문구에 쓴다. */
  term: string
}

/**
 * 스크린 리더에 알릴 결과 안내 문구. 화면이 안 보이거나 응답이 아직 확정되지 않았으면 빈 문자열을 준다.
 * 건수가 있으면 건수를 우선하고, 건수가 0일 때만 실패·없음 문구를 고른다 — 실패 때 이전 건수를 알리지 않으려고.
 */
export function searchResultAnnouncement(input: SearchAnnouncementInput): string {
  const { showResults, settled, tabLabel, isAll, count, more, failed, term } = input
  if (!showResults || !settled) return ''
  if (count > 0) return `${tabLabel} 결과 ${count}건${more ? ' 이상' : ''}`
  // 건수 0 이고 요청이 실패했으면 「없음」이 아니라 불러오지 못했다고 알린다(없는 것으로 오해하지 않게).
  if (failed) return '검색 결과를 불러오지 못했어요'
  return emptyResultText(isAll, tabLabel, term)
}

/**
 * 결과가 없을 때의 문구 — 화면(전체·종류 결과 컴포넌트)과 스크린 리더 안내가 같은 말을 쓰도록 한 곳에 둔다.
 * 전체 탭은 앱 전체, 종류 탭은 그 탭 안에서 맞는 것이 없다고 나눈다.
 */
export function emptyResultText(isAll: boolean, tabLabel: string, term: string): string {
  return isAll ? `모든 앱에 「${term}」와 맞는 것이 없어요` : `${tabLabel}에 「${term}」와 맞는 것이 없어요`
}

/** 검색 질의 상태 중 listbox 판정에 필요한 부분 — UseQueryResult 가 구조적으로 만족한다. */
export interface ListboxQueryState {
  isPending: boolean
  isError: boolean
  fetchStatus: string
}

/** 검색어가 짧아 아직 조회하지 않는 앱 — 대기 중이 아니라 건너뛴 것으로 본다. */
export function isSkippedQuery(g: Pick<ListboxQueryState, 'isPending' | 'fetchStatus'>): boolean {
  return g.isPending && g.fetchStatus === 'idle'
}

/**
 * 전체 탭이 role=listbox 를 그리는가 — 모든 묶음이 끝났는데 한 건도 없고 실패도 없으면 빈 문구만 그리고 listbox 는 없다.
 * 로딩 skeleton·묶음 실패(다시 시도)는 listbox 안에 그려진다. 결과 컴포넌트와 입력의 aria-controls/expanded 가 같은 판정을 쓰게 한다.
 */
export function allHasListbox(groups: (ListboxQueryState & { data?: { hits: unknown[] } })[]): boolean {
  const allDone = groups.every((g) => !g.isPending || isSkippedQuery(g))
  const total = groups.reduce((n, g) => n + (g.data?.hits.length ?? 0), 0)
  return !(allDone && total === 0 && groups.every((g) => !g.isError))
}

/** 종류 탭이 첫 응답을 기다리는 중인가 — 로딩 skeleton 을 그린다. 조회하지 않는 앱(idle)은 로딩이 아니라 빈 결과로 보인다. */
export function kindIsLoading(query: ListboxQueryState): boolean {
  return query.isPending && !query.isError && query.fetchStatus !== 'idle'
}

/** 종류 탭이 받은 줄 없이 실패했는가 — 다시 시도 안내를 그린다(이미 받은 줄이 있으면 목록을 유지). */
export function kindIsFailed(query: ListboxQueryState, hitCount: number): boolean {
  return query.isError && hitCount === 0
}

/**
 * 종류 탭이 role=listbox 를 그리는가 — 로딩 skeleton·실패 안내·빈 문구가 아니라 줄이 있을 때만 그린다.
 * 결과 컴포넌트의 분기도 같은 kindIsLoading·kindIsFailed 를 써서 판정이 갈라지지 않는다.
 */
export function kindHasListbox(query: ListboxQueryState, hitCount: number): boolean {
  return !kindIsLoading(query) && !kindIsFailed(query, hitCount) && hitCount > 0
}

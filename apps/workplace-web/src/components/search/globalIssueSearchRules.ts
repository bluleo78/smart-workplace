// 상단 전체 이슈 검색(WP-1324)의 순수 판정 — WP-1353 에서 공용 함수는 searchRules.ts 로 옮겼다.
// GlobalIssueSearch 가 Task 4(팔레트)에서 지워질 때까지 기존 import 를 깨지 않도록 다시 내보내기만 한다(그때 이 파일도 지운다).
import { SEARCH_DEBOUNCE_MS } from './searchRules'

export { highlightParts, isSearchableTerm, isSearchShortcut, moveActive } from './searchRules'

/** 결과 최대 건수 — 펼친 검색창 아래 목록이 화면을 넘지 않을 만큼. 더 찾으려면 검색어를 좁힌다. */
export const GLOBAL_SEARCH_LIMIT = 20

/** 입력이 멈춘 뒤 검색을 보내기까지(ms) — 글자마다 요청하지 않게. */
export const GLOBAL_SEARCH_DEBOUNCE_MS = SEARCH_DEBOUNCE_MS

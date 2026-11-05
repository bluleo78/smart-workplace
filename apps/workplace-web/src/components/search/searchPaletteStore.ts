// 통합 검색 팔레트(WP-1353)의 열림 상태 — 상단 🔍 트리거·「/」 단축키뿐 아니라 다른 화면(예: 드라이브 「드라이브 전체에서 찾기」, WP-1356)도
// 검색어와 탭을 정해 팔레트를 열 수 있게 작은 모듈 스토어로 둔다(lib/sendToChat 의 openSendToChat 과 같은 방식).
// 다른 앱 코드는 검색 내부에 기대지 않고 이 파일의 openSearchPalette 하나만 부른다(디자인 시스템 05 「검색 도메인」).
// 열림은 히스토리에 넣지 않는다 — 뒤로 가기가 팔레트를 닫는 데 쓰이지 않게.
import type { SearchAppId } from './searchApps'

/** 한 번 연 팔레트 — id 가 바뀌면 본문을 새로 마운트해 검색어·탭을 처음 값으로 시작한다. q·app 은 처음 값(없으면 빈 검색어·지금 앱 탭). */
export interface SearchPaletteSession {
  id: number
  q: string
  app: SearchAppId | null
}

let session: SearchPaletteSession | null = null
let seq = 0
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

/**
 * 팔레트를 연다. q 를 주면 그 검색어가 입력돼 바로 찾고, app 을 주면 그 앱 탭에서 시작한다(없으면 지금 화면의 앱 탭).
 * 이미 열려 있어도 새 세션으로 다시 연다(검색어·탭을 새 값으로).
 */
export function openSearchPalette(opts: { q?: string; app?: SearchAppId } = {}): void {
  session = { id: ++seq, q: opts.q ?? '', app: opts.app ?? null }
  emit()
}

/** 팔레트를 닫는다. 닫혀 있으면 아무것도 하지 않는다. */
export function closeSearchPalette(): void {
  if (session == null) return
  session = null
  emit()
}

/** 지금 열린 세션 — 닫혀 있으면 null(useSyncExternalStore 의 스냅숏). */
export function searchPaletteSession(): SearchPaletteSession | null {
  return session
}

/** 열림 변화 구독 — 해지 함수를 돌려준다. */
export function subscribeSearchPalette(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

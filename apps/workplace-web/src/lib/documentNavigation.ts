/**
 * 문서 탐색 기록 판정 유틸 (WP-2096).
 *
 * 왜: F5·브라우저 세션 복원으로 문서를 다시 불러오면 라우터는 현재 항목을 POP 으로 보고한다.
 * 이것은 사용자의 새 선택이 아니므로, 기억해 둔 조회 조건을 덮어쓰지 않도록 구분해야 한다.
 */

/** 문서 로드 항목에서 필요한 필드만 뽑은 형태 (PerformanceNavigationTiming 의 부분집합). */
export interface DocumentNavigationEntry {
  type: string
  name: string
}

/**
 * 문서를 불러온 뒤 뒤로/앞으로 가기(popstate)가 한 번이라도 있었는가.
 * 문서 로드 정보(entry)는 문서 수명 내내 같아, 새로고침 뒤 PUSH → 뒤로 가기로 같은 주소 항목에 돌아온 POP 도 주소만으로는 「다시 불러온 첫 항목」처럼 보인다.
 * 첫 항목은 popstate 없이 그려지고(브라우저는 문서 로드 때 popstate 를 내지 않는다) 그 뒤의 POP 은 모두 popstate 를 거치므로, 한 번이라도 있었으면 첫 항목이 아니다(WP-2096 리뷰).
 * 화면 훅이 마운트돼 있지 않던 동안(다른 화면에 다녀온 뒤 돌아오기)의 뒤로 가기도 잡도록 모듈 수준에서 듣고,
 * 지연 청크(이슈 화면)를 불러오기 전의 이동도 놓치지 않게 앱 진입점(main.tsx)이 이 모듈을 먼저 불러온다.
 */
let poppedSinceLoad = false
// 캡처 단계로 듣는다 — 대상(window)에서는 캡처 리스너가 먼저 돈다. 라우터(먼저 붙은 일반 리스너)가 POP 을 동기로 그려도 그 렌더가 이 표시를 보게.
globalThis.addEventListener?.(
  'popstate',
  () => {
    poppedSinceLoad = true
  },
  true,
)

/** BrowserRouter 가 history.state 에 심는 위치 번호(idx) — state 가 없으면(라우터가 처음 0 으로 심기 전) 0. */
function currentHistoryIdx(): number {
  const state = globalThis.history?.state as { idx?: unknown } | null | undefined
  return typeof state?.idx === 'number' ? state.idx : 0
}

/** 문서를 불러온 때의 위치 번호 — 앱 진입점(main.tsx)이 이 모듈을 먼저 불러와 라우터가 움직이기 전에 잡는다. */
let loadedHistoryIdx = currentHistoryIdx()

/**
 * 문서를 불러온 항목에서 PUSH 로 몇 걸음 왔는가 — REPLACE 는 번호를 그대로 두고 PUSH 는 하나 올린다.
 * 다시 불러온 항목을 화면이 붙기 전에 앱 셸이 정리한 경우(aiChat 지우기 REPLACE → 모바일 시트 표식 PUSH)를 가르되,
 * 그 뒤 여러 화면을 다녀온 이동까지 다시 불러온 항목으로 보지 않게 한다(WP-2096 리뷰).
 */
export function historyStepsSinceLoad(): number {
  return currentHistoryIdx() - loadedHistoryIdx
}

/** 테스트 전용 — 앞 테스트의 뒤로 가기가 남긴 popstate 표시를 지우고, 지금 위치를 문서를 불러온 위치로 다시 잡는다(같은 파일의 테스트는 모듈을 함께 쓴다). */
export function resetDocumentPopForTests(): void {
  poppedSinceLoad = false
  loadedHistoryIdx = currentHistoryIdx()
}

/** 현재 문서의 navigation 항목을 읽는다. performance·getEntriesByType 이 없는 환경(일부 워커·테스트 런타임)이면 null. */
function readDocumentEntry(): DocumentNavigationEntry | null {
  const entry = globalThis.performance?.getEntriesByType?.('navigation')[0] as unknown as DocumentNavigationEntry | undefined
  return entry ?? null
}

/**
 * 문서를 다시 불러왔으면(reload·back_forward) 그 문서 로드 주소, 아니면 null.
 * 문서를 불러온 뒤 뒤로/앞으로 가기(popstate)가 있었으면 지금 위치는 다시 불러온 첫 항목이 아니라 null 이다.
 *
 * back_forward 도 다시 불러온 것으로 본다 — 브라우저는 탭·세션 복원을 back_forward 로 알려 주고(이 판정의 주된 경우),
 * 새로 불러온 문서의 뒤로/앞으로(새로고침한 앞 문서로 돌아가기·다른 사이트에서 돌아오기)와 구별할 수 없다.
 * 둘 다 사용자가 지금 고른 조건이 아니라 그 항목에 남아 있던 옛 주소라 공유 기억을 덮지 않는다(WP-2096 리뷰).
 * 같은 문서 안의 뒤로 가기(popstate)는 사용자의 이동이라 기억한다 — 위 poppedSinceLoad.
 *
 * @param entry 문서 로드 항목 — 생략하면(undefined) performance 에서 읽는다(테스트는 주입). null 이면 판정 불가로 null
 */
export function reloadedDocumentUrl(entry: DocumentNavigationEntry | null = readDocumentEntry()): URL | null {
  if (poppedSinceLoad) return null
  if (!entry || (entry.type !== 'reload' && entry.type !== 'back_forward')) return null
  try {
    return new URL(entry.name)
  } catch {
    // URL 로 읽히지 않으면 판정 불가 → null (throw 하지 않는다)
    return null
  }
}

/**
 * 현재 라우터 위치가 "문서를 reload/back_forward 로 다시 불러온 그 히스토리 항목"인지 판정한다.
 * 문서를 불러온 뒤 뒤로/앞으로 가기가 있었으면 그 POP 은 첫 항목이 아니라 false 다(같은 주소로 돌아왔어도).
 *
 * @param navigationType 라우터의 탐색 종류 (POP 일 때만 후보)
 * @param pathname 현재 라우터 pathname
 * @param search 현재 라우터 search (선행 '?' 포함)
 * @param entry 문서 로드 항목 — 생략하면(undefined) performance 에서 읽는다(테스트는 주입). null 이면 판정 불가로 false
 */
export function isReloadedDocumentEntry(
  navigationType: 'POP' | 'PUSH' | 'REPLACE',
  pathname: string,
  search: string,
  entry?: DocumentNavigationEntry | null,
): boolean {
  // POP 이 아니면 문서 로드 항목을 읽지 않는다 — 이슈 화면의 렌더마다 불리므로.
  if (navigationType !== 'POP') return false
  const loaded = reloadedDocumentUrl(entry)
  if (!loaded) return false
  // 해시는 비교에서 제외한다 — pathname+search 만 같으면 같은 항목으로 본다.
  // 양쪽을 같은 URL 파서로 읽어 퍼센트 인코딩 차이(한글 등: 라우터는 디코딩, entry.name 은 인코딩)를 흡수한다.
  const here = new URL(pathname + search, 'http://x')
  return loaded.pathname + loaded.search === here.pathname + here.search
}

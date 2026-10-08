/**
 * 노트 본문 자리에 무엇을 그릴지 — 'empty' 노트 미선택 · 'loading' 처음 불러오는 중 · 'error' 못 불러옴 · 'editor' 에디터.
 *
 * 이 화면에서 조회 성공을 확인한 노트(loadedInThisView)는 재조회가 실패해도 에디터를 유지한다(WP-296). 삭제 SSE 가 재조회를
 * 부르면 404 가 와서, 예전엔 에디터를 오류 화면으로 바꿔 끼웠다 — 화면의 내용(아직 복사하지 못한 글)과 동기화 안내
 * ("삭제되었습니다"·"권한 없음")가 함께 사라졌다. 접근이 사라진 사실은 동기화 세션의 종단 상태가 칩·안내로 알리고 편집을 막는다.
 *
 * 캐시만 있는 노트(다른 노트에 갔다 돌아옴)는 재조회 중에도 바로 에디터로 그리되, 그 재조회가 실패하면 오류 화면(#788)이다 —
 * 그 사이 지워진 노트를 캐시로 붙잡으면 낡은 제목·빈 본문·접근 불가 띠에 갇혀 나갈 길이 없다.
 * 처음부터 못 불러온 노트(데이터 없음)도 오류 화면이다.
 */
export type WikiPageViewMode = 'empty' | 'loading' | 'error' | 'editor'

export function wikiPageViewMode(i: {
  pageId: number | null
  isLoading: boolean
  isError: boolean
  /** 지금 가진 데이터(캐시든 새 조회든)의 노트 id — pageId 와 같을 때만 그 노트의 데이터로 본다. */
  dataId: number | undefined
  /** 이 화면에서 pageId 의 조회 성공을 확인했다(isConfirmedLoad). */
  loadedInThisView: boolean
}): WikiPageViewMode {
  if (i.pageId == null) return 'empty'
  // 다른 노트의 데이터로 에디터를 그리지 않도록 id 까지 맞춘다(placeholderData 를 나중에 켜도 안전).
  const hasPage = i.dataId === i.pageId
  if (i.isError) return hasPage && i.loadedInThisView ? 'editor' : 'error'
  if (hasPage) return 'editor'
  return i.isLoading ? 'loading' : 'error'
}

/**
 * 이번 조회가 성공으로 끝났는가 — 캐시를 보여 주며 재조회 중(isFetching)이면 아직 아니다. 같은 노트의 데이터일 때만.
 * 방문 단위로 기억하는 일은 trackConfirmedLoad 가 한다.
 */
export function isConfirmedLoad(i: {
  pageId: number | null
  dataId: number | undefined
  isSuccess: boolean
  isFetching: boolean
}): boolean {
  return i.pageId != null && i.isSuccess && !i.isFetching && i.dataId === i.pageId
}

/** 지금 방문 중인 노트와 그 방문에서 조회 성공을 확인했는지. */
export interface ConfirmedLoadState {
  pageId: number | null
  confirmed: boolean
}

/**
 * 방문 단위 확인 추적(WP-296) — 노트가 바뀌면(노트 없음 포함) 확인을 버린다: 같은 화면 인스턴스가 스페이스 첫 화면을 거쳐
 * 그 사이 지워진 노트로 돌아왔을 때 예전 확인이 되살아나면 빈 에디터·종료 안내에 갇힌다.
 * 한 방문 안에서는 한 번 확인하면 이후 재조회가 실패해도 유지한다. 바뀐 게 없으면 같은 객체를 돌려준다(렌더 중 갱신 루프 방지).
 */
export function trackConfirmedLoad(
  prev: ConfirmedLoadState,
  i: { pageId: number | null; dataId: number | undefined; isSuccess: boolean; isFetching: boolean },
): ConfirmedLoadState {
  if (prev.pageId !== i.pageId) return { pageId: i.pageId, confirmed: isConfirmedLoad(i) }
  if (!prev.confirmed && isConfirmedLoad(i)) return { pageId: i.pageId, confirmed: true }
  return prev
}

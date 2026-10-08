import { describe, expect, it } from 'vitest'

import { isConfirmedLoad, trackConfirmedLoad, wikiPageViewMode } from './wikiPageViewMode'

// 노트 본문 자리 분기 — 특히 이 화면에서 불러온 노트가 재조회에서 실패(삭제 SSE 뒤 404 등)해도 에디터를 갈아치우지 않는다(WP-296).
describe('wikiPageViewMode', () => {
  const base = { pageId: 7, isLoading: false, isError: false, dataId: 7 as number | undefined, loadedInThisView: true }

  it('선택한 노트가 없으면 빈 상태', () =>
    expect(wikiPageViewMode({ ...base, pageId: null, dataId: undefined, loadedInThisView: false })).toBe('empty'))
  it('처음 불러오는 중이면 skeleton', () =>
    expect(wikiPageViewMode({ ...base, isLoading: true, dataId: undefined, loadedInThisView: false })).toBe('loading'))
  it('처음부터 못 불러오면 오류 화면', () =>
    expect(wikiPageViewMode({ ...base, isError: true, dataId: undefined, loadedInThisView: false })).toBe('error'))
  it('불러왔는데 데이터가 없으면 오류 화면', () =>
    expect(wikiPageViewMode({ ...base, dataId: undefined, loadedInThisView: false })).toBe('error'))
  it('불러온 노트는 에디터', () => expect(wikiPageViewMode(base)).toBe('editor'))
  // 노트를 바꾼 직후 예전 노트의 데이터가 남아 있어도 그것으로 에디터를 그리지 않는다.
  it('다른 노트의 데이터면 에디터가 아니다', () => {
    expect(wikiPageViewMode({ ...base, dataId: 8, isLoading: true })).toBe('loading')
    expect(wikiPageViewMode({ ...base, dataId: 8, isError: true })).toBe('error')
  })
  // 에디터를 오류 화면으로 바꾸면 화면의 내용·동기화 안내(삭제됨·권한 없음)가 함께 사라진다 — 에디터가 그 상태를 직접 알린다.
  it('이 화면에서 불러온 노트가 재조회에서 실패해도 에디터를 유지한다', () =>
    expect(wikiPageViewMode({ ...base, isError: true })).toBe('editor'))
  // 캐시는 다시 열 때 바로 그려 빠르게 보이되(재조회 진행 중), 확인 전이므로 실패하면 오류 화면이다.
  it('캐시로 다시 연 노트는 재조회 중에도 바로 에디터', () =>
    expect(wikiPageViewMode({ ...base, loadedInThisView: false })).toBe('editor'))
  // 다른 노트에 갔다 돌아오는 사이 지워진 노트 — 캐시만 있고 이 화면에서 확인한 적이 없으므로 #788 오류 화면으로 간다.
  it('캐시로 다시 연 노트가 재조회에서 실패하면 오류 화면', () =>
    expect(wikiPageViewMode({ ...base, isError: true, loadedInThisView: false })).toBe('error'))
})

// 이 화면에서 "불러온 것으로 확인"하는 시점 — 캐시가 아니라 이번 조회가 성공으로 끝났을 때만.
describe('isConfirmedLoad', () => {
  const ok = { pageId: 7, dataId: 7, isSuccess: true, isFetching: false }
  it('조회가 성공으로 끝나고 같은 노트면 확인', () => expect(isConfirmedLoad(ok)).toBe(true))
  it('캐시를 보여 주며 재조회 중이면 아직 아님', () => expect(isConfirmedLoad({ ...ok, isFetching: true })).toBe(false))
  it('실패했으면 아님', () => expect(isConfirmedLoad({ ...ok, isSuccess: false })).toBe(false))
  it('다른 노트의 데이터면 아님', () => expect(isConfirmedLoad({ ...ok, dataId: 8 })).toBe(false))
  it('노트 미선택이면 아님', () => expect(isConfirmedLoad({ ...ok, pageId: null })).toBe(false))
})

// 방문 단위 확인 — 같은 화면 인스턴스가 다른 노트(또는 노트 없음)를 거쳐 돌아오면 확인을 처음부터 다시 받아야 한다(WP-296).
describe('trackConfirmedLoad', () => {
  const ok = { pageId: 19, dataId: 19, isSuccess: true, isFetching: false }
  const fetching = { ...ok, isFetching: true }
  const initial = { pageId: null, confirmed: false }

  it('조회가 끝나면 이 방문을 확인한다', () =>
    expect(trackConfirmedLoad({ pageId: 19, confirmed: false }, ok)).toEqual({ pageId: 19, confirmed: true }))
  it('바뀐 게 없으면 같은 객체(렌더 중 갱신 루프 방지)', () => {
    const s = { pageId: 19, confirmed: true }
    expect(trackConfirmedLoad(s, ok)).toBe(s)
  })
  it('노트가 바뀌면 확인을 버린다', () =>
    expect(trackConfirmedLoad({ pageId: 19, confirmed: true }, { ...fetching, pageId: 20, dataId: undefined })).toEqual({
      pageId: 20,
      confirmed: false,
    }))
  // 19 확인 → 스페이스 첫 화면(노트 없음) → 다시 19(캐시로 재조회 중) — 예전 확인을 되살리지 않는다.
  it('노트 없음을 거쳐 같은 노트로 돌아와도 다시 확인 전이다', () => {
    let s = trackConfirmedLoad(initial, ok)
    s = trackConfirmedLoad(s, { pageId: null, dataId: undefined, isSuccess: false, isFetching: false })
    s = trackConfirmedLoad(s, fetching)
    expect(s).toEqual({ pageId: 19, confirmed: false })
  })
  it('확인 뒤 재조회가 실패해도 확인은 유지한다', () => {
    const s = { pageId: 19, confirmed: true }
    expect(trackConfirmedLoad(s, { ...ok, isSuccess: false })).toBe(s)
  })
})

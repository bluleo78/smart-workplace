import { QueryClient } from '@tanstack/react-query'
import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'

import { wikiKeys } from '../../hooks/queries/wikiKeys'
import { accessRequestState, classifyShareLinkError, dropShareCaches, isGoneError, isShareTokenQuery } from './wikiShareLink'

/** 응답이 있는 axios 오류 — 링크 열기 실패를 흉내 낸다. */
function httpError(status: number, data: unknown): AxiosError {
  const headers = new AxiosHeaders()
  return new AxiosError('fail', 'ERR', { headers }, null, { status, statusText: '', headers, config: { headers }, data })
}

// 링크 열기 실패의 화면 갈래(WP-579) — 다른 워크스페이스 전환·접근 요청·열리지 않음.
describe('classifyShareLinkError', () => {
  it('다른 워크스페이스 409 는 본문 최상위 tenantId 로 전환한다', () =>
    expect(classifyShareLinkError(httpError(409, { code: 'WIKI_SHARE_OTHER_TENANT', tenantId: 2 }), 1)).toEqual({
      kind: 'switch',
      tenantId: 2,
    }))
  // 같은 워크스페이스로 다시 전환하면 같은 응답이 와 같은 주소를 오가는 고리가 된다.
  it('지금 워크스페이스로 전환하라는 409 는 열리지 않음', () =>
    expect(classifyShareLinkError(httpError(409, { code: 'WIKI_SHARE_OTHER_TENANT', tenantId: 1 }), 1)).toEqual({ kind: 'gone' }))
  // 표준 오류 묶음(errors) 아래에 있으면 다른 409 다 — 전환하지 않는다. 404 가 아니므로 「없음」이 아니라 다시 시도할 오류.
  it('code 가 최상위에 없는 409 는 전환하지 않는다', () =>
    expect(classifyShareLinkError(httpError(409, { errors: { code: 'WIKI_SHARE_OTHER_TENANT', tenantId: 2 } }), 1)).toEqual({
      kind: 'error',
    }))
  // 다른 워크스페이스의 외부 링크를 그곳 멤버가 아닌 사람이 열면 — 전환이 아니라 외부 보기로 간다.
  it('외부 보기 409 는 public', () =>
    expect(classifyShareLinkError(httpError(409, { code: 'WIKI_SHARE_PUBLIC' }), 1)).toEqual({ kind: 'public' }))
  it('403 은 접근 요청 상태를 함께 준다', () => {
    expect(classifyShareLinkError(httpError(403, { requested: false }), 1)).toEqual({
      kind: 'forbidden',
      requested: false,
      denied: false,
    })
    expect(classifyShareLinkError(httpError(403, { requested: true }), 1)).toMatchObject({ requested: true })
    // 같은 공유에 24시간 안에 거절됐으면 denied — 받는 화면이 처음부터 「거절됨」을 보인다.
    expect(classifyShareLinkError(httpError(403, { requested: false, denied: true }), 1)).toMatchObject({
      denied: true,
    })
  })
  it('404 는 열리지 않음', () => {
    expect(classifyShareLinkError(httpError(404, {}), 1)).toEqual({ kind: 'gone' })
  })
  // 5xx·네트워크 오류는 링크가 살아 있어도 난다 — 「더 이상 열리지 않습니다」가 아니라 다시 시도.
  it('5xx·네트워크 오류는 다시 시도할 오류', () => {
    expect(classifyShareLinkError(httpError(500, {}), 1)).toEqual({ kind: 'error' })
    expect(classifyShareLinkError(httpError(503, {}), 1)).toEqual({ kind: 'error' })
    expect(classifyShareLinkError(new Error('network'), 1)).toEqual({ kind: 'error' })
  })
  it('isGoneError 는 404 만', () => {
    expect(isGoneError(httpError(404, {}))).toBe(true)
    expect(isGoneError(httpError(500, {}))).toBe(false)
    expect(isGoneError(new Error('network'))).toBe(false)
  })
})

// 해제로 닫힌 공유 화면이 지울 캐시 — 그 토큰으로 받은 멘션·이미지만.
describe('isShareTokenQuery', () => {
  it('그 토큰의 멘션·이미지 캐시만 고른다', () => {
    expect(isShareTokenQuery(['wiki', 'mentions', 31, 'wsh_a'], 'wsh_a')).toBe(true)
    expect(isShareTokenQuery(['wiki', 'mentions', 31, null], 'wsh_a')).toBe(false)
    expect(isShareTokenQuery(['api-blob', '/api/v1/x', { 'X-Wiki-Share-Token': 'wsh_a' }], 'wsh_a')).toBe(true)
    expect(isShareTokenQuery(['api-blob', '/api/v1/x', { 'X-Wiki-Share-Token': 'wsh_b' }], 'wsh_a')).toBe(false)
    expect(isShareTokenQuery(['api-blob', '/api/v1/x', null], 'wsh_a')).toBe(false)
    expect(isShareTokenQuery(['wiki', 'page', 31], 'wsh_a')).toBe(false)
    expect(isShareTokenQuery(['wiki', 'page', 31, 'wsh_a'], 'wsh_a')).toBe(true)
    expect(isShareTokenQuery(['wiki', 'page', 31, 'wsh_b'], 'wsh_a')).toBe(false)
  })
})

// 해제로 닫힐 때 — 그 토큰의 링크 열기 결과(페이지 제목 트리)·멘션·이미지·링크로 본 페이지를 지우고, 다른 토큰·멤버 캐시는 둔다.
describe('dropShareCaches', () => {
  it('그 토큰으로 받은 캐시만 지운다', () => {
    const qc = new QueryClient()
    const set = (key: readonly unknown[]) => qc.setQueryData(key, { any: true })
    set(wikiKeys.shareLink('wsh_a'))
    set(wikiKeys.shareLink('wsh_b'))
    set([...wikiKeys.mentions(31), 'wsh_a'])
    set([...wikiKeys.mentions(31), null])
    set(['api-blob', '/api/v1/x', { 'X-Wiki-Share-Token': 'wsh_a' }])
    // 페이지 상세 — 이 토큰으로 받은 것만 지우고, 같은 페이지의 멤버 캐시·다른 링크 캐시는 둔다.
    set(wikiKeys.sharedPage(31, 'wsh_a'))
    set(wikiKeys.sharedPage(31, 'wsh_b'))
    set(wikiKeys.page(31))
    dropShareCaches(qc, 'wsh_a')
    const left = qc.getQueryCache().getAll().map((q) => JSON.stringify(q.queryKey))
    expect(left.sort()).toEqual(
      [wikiKeys.shareLink('wsh_b'), [...wikiKeys.mentions(31), null], wikiKeys.sharedPage(31, 'wsh_b'), wikiKeys.page(31)]
        .map((k) => JSON.stringify(k))
        .sort(),
    )
  })
})

// 접근 요청 화면의 상태(WP-579) — 403 이 실어 온 값과 방금 보낸 요청의 결과를 합친다. 거절이 대기보다 앞선다.
describe('accessRequestState', () => {
  it('아무것도 없으면 요청 전', () => expect(accessRequestState({ requested: false, denied: false }, undefined)).toBe('idle'))
  it('403 이 대기 중이라 하면 요청함', () => expect(accessRequestState({ requested: true, denied: false }, undefined)).toBe('requested'))
  it('403 이 최근 거절이라 하면 거절됨', () => expect(accessRequestState({ requested: false, denied: true }, undefined)).toBe('denied'))
  it('보낸 요청이 PENDING 이면 요청함', () => expect(accessRequestState({ requested: false, denied: false }, 'PENDING')).toBe('requested'))
  // 24시간 안의 재요청 — 서버는 새 요청·알림 없이 DENIED 를 돌려준다.
  it('보낸 요청이 DENIED 이면 거절됨', () => expect(accessRequestState({ requested: false, denied: false }, 'DENIED')).toBe('denied'))
  it('요청할 필요가 없다는 답(NOT_NEEDED)은 요청 전 그대로', () =>
    expect(accessRequestState({ requested: false, denied: false }, 'NOT_NEEDED')).toBe('idle'))
})

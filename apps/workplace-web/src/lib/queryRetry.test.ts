// shouldRetryQuery(WP-412) — 전역 쿼리 재시도 정책 단위 테스트(query-retry E2E 에서 이관).
import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'

import { shouldRetryQuery } from './queryRetry'

function httpError(status: number): AxiosError {
  const headers = new AxiosHeaders()
  return new AxiosError('fail', 'ERR', { headers }, null, { status, statusText: '', headers, config: { headers }, data: {} })
}

describe('shouldRetryQuery', () => {
  it('4xx 는 첫 실패부터 재시도하지 않는다', () => {
    for (const s of [400, 403, 404, 422]) expect(shouldRetryQuery(0, httpError(s))).toBe(false)
  })

  it('5xx 는 1회만 재시도한다', () => {
    expect(shouldRetryQuery(0, httpError(500))).toBe(true)
    expect(shouldRetryQuery(1, httpError(500))).toBe(false)
  })

  it('응답 없는 네트워크 오류·일반 오류도 1회만 재시도한다', () => {
    expect(shouldRetryQuery(0, new Error('network'))).toBe(true)
    expect(shouldRetryQuery(1, new Error('network'))).toBe(false)
  })
})

// 일정 저장 충돌 판정(WP-1920) — 409 + errors.code=EVENT_CONFLICT 일 때만 true.
import { AxiosError, type AxiosResponse } from 'axios'
import { describe, expect, test } from 'vitest'

import { isEventConflict } from './eventConflict'

// 지정한 상태·본문의 Axios 오류를 만든다.
function axiosError(status: number, data: unknown): AxiosError {
  return new AxiosError('fail', undefined, undefined, undefined, { status, data } as AxiosResponse)
}

describe('isEventConflict', () => {
  test('409 이고 errors.code 가 EVENT_CONFLICT 면 true', () => {
    expect(isEventConflict(axiosError(409, { message: 'x', errors: { code: 'EVENT_CONFLICT' } }))).toBe(true)
  })
  test('409 여도 코드가 없거나 다르면 false', () => {
    expect(isEventConflict(axiosError(409, { message: 'x' }))).toBe(false)
    expect(isEventConflict(axiosError(409, { message: 'x', errors: { code: 'OTHER' } }))).toBe(false)
  })
  test('코드가 같아도 409 가 아니면 false', () => {
    expect(isEventConflict(axiosError(400, { errors: { code: 'EVENT_CONFLICT' } }))).toBe(false)
  })
  test('Axios 오류가 아니면 false', () => {
    expect(isEventConflict(new Error('x'))).toBe(false)
    expect(isEventConflict(null)).toBe(false)
    expect(isEventConflict(undefined)).toBe(false)
  })
})

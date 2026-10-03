// 연락처 상세 URL 키(?contact) 코덱 테스트 — 기존 ?type(목록 필터)과 겹치지 않는 별도 키(WP-206).
import { describe, expect, it } from 'vitest'

import { decodeContactParam, encodeContactParam } from './contactParam'

describe('contactParam', () => {
  it('멤버·외부를 소문자 접두로 인코딩한다', () => {
    expect(encodeContactParam({ type: 'MEMBER', id: 12 })).toBe('member:12')
    expect(encodeContactParam({ type: 'EXTERNAL', id: 5 })).toBe('external:5')
  })
  it('왕복 디코딩', () => {
    expect(decodeContactParam('member:12')).toEqual({ type: 'MEMBER', id: 12 })
    expect(decodeContactParam('external:5')).toEqual({ type: 'EXTERNAL', id: 5 })
  })
  it('형식이 틀리면 null(상세 미표시, 목록 유지)', () => {
    expect(decodeContactParam(null)).toBeNull()
    expect(decodeContactParam('')).toBeNull()
    expect(decodeContactParam('MEMBER:1')).toBeNull()
    expect(decodeContactParam('member:abc')).toBeNull()
    expect(decodeContactParam('group:1')).toBeNull()
  })
})

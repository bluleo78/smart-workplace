import { describe, expect, it } from 'vitest'

import { initialOf } from './utils'

// 아바타 이니셜 — 법인 표기·기호로 시작하는 이름이 '(' 같은 기호를 이니셜로 쓰던 문제(WP-198).
describe('initialOf', () => {
  it('일반 이름은 첫 글자', () => {
    expect(initialOf('양동희')).toBe('양')
    expect(initialOf('  Default Workspace')).toBe('D')
  })

  it('앞의 법인 표기((주)·㈜·(유))는 건너뛴다', () => {
    expect(initialOf('(주)아이에이클라우드')).toBe('아')
    expect(initialOf('㈜ 스마트')).toBe('스')
    expect(initialOf('(유) 베타')).toBe('베')
  })

  it('앞의 기호는 건너뛰고 첫 문자·숫자를 쓴다', () => {
    expect(initialOf('[TF] 혁신팀')).toBe('T')
    expect(initialOf('#2 Lab')).toBe('2')
  })

  it('문자·숫자가 없으면 원래 첫 글자, 비었으면 가운뎃점', () => {
    expect(initialOf('***')).toBe('*')
    expect(initialOf('   ')).toBe('·')
    expect(initialOf(null)).toBe('·')
  })
})

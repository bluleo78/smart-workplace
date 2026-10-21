import { describe, expect, it } from 'vitest'

import { andParticle, euroRo, initialOf, objectParticle, subjectParticle } from './utils'

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

describe('subjectParticle', () => {
  it('한글 음절로 끝나면 받침에 따라 이/가, 아니면 「이(가)」 (WP-647)', () => {
    expect(subjectParticle('결제 테스트 프로젝트')).toBe('가')
    expect(subjectParticle('모바일 앱')).toBe('이')
    expect(subjectParticle('Workplace')).toBe('이(가)')
    expect(subjectParticle('v2')).toBe('이(가)')
  })
})

// 이름·검색어 뒤 목적격·접속 조사 — 받침에 맞게, 한글이 아니면 둘 다(WP-679).
describe('objectParticle', () => {
  it('한글 음절로 끝나면 받침에 따라 을/를, 아니면 「을(를)」', () => {
    expect(objectParticle('테스트봇')).toBe('을')
    expect(objectParticle('도우미')).toBe('를')
    expect(objectParticle('Claude')).toBe('을(를)')
  })
})

describe('andParticle', () => {
  it('한글 음절로 끝나면 받침에 따라 과/와, 아니면 「와(과)」', () => {
    expect(andParticle('회의실')).toBe('과')
    expect(andParticle('고양이')).toBe('와')
    expect(andParticle('meeting')).toBe('와(과)')
  })
})

describe('euroRo', () => {
  it('받침 있으면 「으로」, 받침 없음·ㄹ받침은 「로」', () => {
    expect(euroRo('목록')).toBe('으로')
    expect(euroRo('체크리스트')).toBe('로')
    expect(euroRo('보드')).toBe('로')
    expect(euroRo('파일')).toBe('로')
  })
})

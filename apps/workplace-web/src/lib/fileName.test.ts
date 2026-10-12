import { describe, expect, it } from 'vitest'

import { fileStemLength } from './fileName'

describe('fileStemLength', () => {
  it('마지막 점 앞까지 — 확장자를 뺀 길이', () => {
    expect(fileStemLength('보고서.pdf')).toBe(3)
    expect(fileStemLength('archive.tar.gz')).toBe('archive.tar'.length)
  })

  it('점이 없으면 전체 길이', () => {
    expect(fileStemLength('README')).toBe(6)
  })

  it('맨 앞 점뿐인 숨김 파일은 전체 길이', () => {
    expect(fileStemLength('.env')).toBe(4)
  })

  it('끝이 점이면 점 앞까지', () => {
    expect(fileStemLength('memo.')).toBe(4)
  })
})

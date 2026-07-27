// 노트 마크다운 내보내기 파일명 — 제목이 그대로 파일명이 되면 경로 구분자·제어문자로
// 저장이 실패하거나(OS별로 다름) 의도치 않은 경로로 쓰일 수 있다. 순수 함수로 격리해 고정한다.
import { describe, expect, it } from 'vitest'

import { wikiMarkdownFilename } from './wikiMarkdownFilename'

describe('wikiMarkdownFilename', () => {
  it('평범한 제목은 그대로 .md 를 붙인다', () => {
    expect(wikiMarkdownFilename('분기 지표')).toBe('분기 지표.md')
  })

  it('경로 구분자와 예약 문자를 _ 로 치환한다', () => {
    expect(wikiMarkdownFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j.md')
  })

  it('제어문자를 제거한다', () => {
    expect(wikiMarkdownFilename('제목\u0007끝')).toBe('제목끝.md')
  })

  it('앞뒤 공백과 점을 제거한다', () => {
    expect(wikiMarkdownFilename('  ..제목..  ')).toBe('제목.md')
  })

  it('빈 제목은 untitled 로 폴백한다', () => {
    expect(wikiMarkdownFilename('')).toBe('untitled.md')
    expect(wikiMarkdownFilename('   ')).toBe('untitled.md')
  })

  it('새니타이즈 후 비면 untitled 로 폴백한다', () => {
    expect(wikiMarkdownFilename('...')).toBe('untitled.md')
  })

  it('한글 자모 분리(NFD) 제목을 NFC 로 정규화한다', () => {
    // macOS 파일 시스템에서 온 NFD 문자열이 그대로 파일명이 되면 다른 OS 에서 깨져 보인다.
    const nfd = '한글'.normalize('NFD')
    expect(nfd).not.toBe('한글')
    expect(wikiMarkdownFilename(nfd)).toBe('한글.md')
  })

  it('아주 긴 제목은 잘라낸다', () => {
    const out = wikiMarkdownFilename('가'.repeat(300))
    expect(out).toBe('가'.repeat(100) + '.md')
  })

  it('자른 경계에 점이 남으면 다시 제거한다', () => {
    // 99자 + '.b' 를 100자로 자르면 끝이 '.' 가 된다 — 그대로면 '….md' 앞에 점이 붙는다.
    const out = wikiMarkdownFilename('a'.repeat(99) + '.b')
    expect(out.endsWith('..md')).toBe(false)
    expect(out).toBe('a'.repeat(99) + '.md')
  })
})

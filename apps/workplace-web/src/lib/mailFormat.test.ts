import { describe, expect, it } from 'vitest'

import { FORMAT_COLORS } from '@/components/wiki/wikiTextFormat'

import {
  MAIL_CELL_STYLE,
  MAIL_COLORS,
  MAIL_HEADER_CELL_STYLE,
  MAIL_TABLE_STYLE,
  matchLineHeight,
  matchMailFont,
  matchMailFontSize,
  parseIndentStep,
  toMailColorHex,
} from './mailFormat'

describe('mailFormat', () => {
  it('글꼴은 따옴표·대소문자가 달라도 같은 항목으로 읽는다', () => {
    expect(matchMailFont('"Malgun Gothic", 맑은 고딕, sans-serif')?.key).toBe('malgun')
    expect(matchMailFont('맑은 고딕')?.key).toBe('malgun')
    expect(matchMailFont('times new roman')?.key).toBe('times')
  })
  it('붙여 넣은 목록 밖 색·글꼴은 버린다', () => {
    expect(matchMailFont('Calibri, sans-serif')).toBeNull()
    expect(toMailColorHex('rgb(232, 232, 232)', 'color')).toBeNull()
    expect(toMailColorHex('#fee2e2', 'color')).toBeNull() // 배경 팔레트 값은 글자색이 아니다
  })
  it('색은 rgb·짧은 16진도 팔레트 16진으로 맞춘다', () => {
    expect(toMailColorHex('rgb(220, 38, 38)', 'color')).toBe('#dc2626')
    expect(toMailColorHex('#FEF08A', 'background-color')).toBe('#fef08a')
  })
  it('크기·줄 간격·들여쓰기는 정해 둔 값만', () => {
    expect(matchMailFontSize('18px')).toBe('large')
    expect(matchMailFontSize('16px')).toBeNull()
    expect(matchLineHeight('1')).toBe('1.0')
    expect(matchLineHeight('1.3')).toBeNull()
    // 단위가 붙은 값은 배수가 아니다 — 2px 를 2배 줄 간격으로 바꾸지 않는다
    expect(matchLineHeight('2px')).toBeNull()
    expect(matchLineHeight('150%')).toBeNull()
    expect(parseIndentStep('80px')).toBe(2)
    expect(parseIndentStep('999px')).toBe(7)
    expect(parseIndentStep(null)).toBe(0)
  })
  it('글자색·배경색 목록은 노트 팔레트 7색의 16진값이다', () => {
    expect(MAIL_COLORS.map((c) => c.text)).toEqual(FORMAT_COLORS.map((c) => c.text))
    expect(MAIL_COLORS.every((c) => /^#[0-9a-f]{6}$/.test(c.text) && /^#[0-9a-f]{6}$/.test(c.mark))).toBe(true)
  })
  it('표 style 문자열은 선언을 "; " 로 잇고 끝 ; 가 없다', () => {
    expect(MAIL_TABLE_STYLE).toBe('border-collapse: collapse; border: 1px solid #d1d5db')
    expect(MAIL_CELL_STYLE).toBe('border: 1px solid #d1d5db; padding: 6px 10px; vertical-align: top; min-width: 48px')
    expect(MAIL_HEADER_CELL_STYLE).toBe(`${MAIL_CELL_STYLE}; background-color: #f3f4f6; font-weight: bold; text-align: left`)
  })
})

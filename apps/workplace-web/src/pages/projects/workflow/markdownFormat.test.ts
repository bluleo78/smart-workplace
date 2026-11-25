// 마크다운 서식 넣기(WP-2092) 검증 — 선택 영역 감싸기·줄 단위 토글·표 삽입과 선택 범위 결과.
import { describe, expect, it } from 'vitest'

import { applyMarkdownFormat } from './markdownFormat'

describe('applyMarkdownFormat — 감싸기', () => {
  it('bold: 선택을 ** 로 감싸고 선택을 안쪽 글자에 유지', () => {
    expect(applyMarkdownFormat('a 굵게 b', 2, 4, 'bold')).toEqual({ value: 'a **굵게** b', selStart: 4, selEnd: 6 })
  })
  it('bold: 선택 없으면 빈 표시를 넣고 커서를 가운데 둠', () => {
    expect(applyMarkdownFormat('ab', 1, 1, 'bold')).toEqual({ value: 'a****b', selStart: 3, selEnd: 3 })
  })
  it('italic', () => {
    expect(applyMarkdownFormat('x', 0, 1, 'italic')).toEqual({ value: '*x*', selStart: 1, selEnd: 2 })
  })
  it('code 한 줄: 백틱 하나', () => {
    expect(applyMarkdownFormat('x', 0, 1, 'code')).toEqual({ value: '`x`', selStart: 1, selEnd: 2 })
  })
  it('code 여러 줄: 코드 블록으로 감싸고 선택은 본문에 유지', () => {
    expect(applyMarkdownFormat('a\nb', 0, 3, 'code')).toEqual({ value: '```\na\nb\n```', selStart: 4, selEnd: 7 })
  })
  it('code 선택 없음: 빈 백틱 사이에 커서', () => {
    expect(applyMarkdownFormat('', 0, 0, 'code')).toEqual({ value: '``', selStart: 1, selEnd: 1 })
  })
})

describe('applyMarkdownFormat — 줄 단위', () => {
  it('h3 추가·제거 토글', () => {
    expect(applyMarkdownFormat('제목', 0, 0, 'h3')).toEqual({ value: '### 제목', selStart: 0, selEnd: 6 })
    expect(applyMarkdownFormat('### 제목', 5, 5, 'h3')).toEqual({ value: '제목', selStart: 0, selEnd: 2 })
  })
  it('h3: 커서가 줄 가운데여도 그 줄 전체에 적용', () => {
    expect(applyMarkdownFormat('앞\n본문입니다\n뒤', 5, 5, 'h3').value).toBe('앞\n### 본문입니다\n뒤')
  })
  it('bullet 여러 줄 적용 후 다시 적용하면 원래대로', () => {
    const on = applyMarkdownFormat('a\nb\nc', 0, 3, 'bullet')
    expect(on).toEqual({ value: '- a\n- b\nc', selStart: 0, selEnd: 7 })
    const off = applyMarkdownFormat(on.value, on.selStart, on.selEnd, 'bullet')
    expect(off).toEqual({ value: 'a\nb\nc', selStart: 0, selEnd: 3 })
  })
  it('bullet: 일부 줄만 기호가 있으면 없는 줄에만 붙임(있는 줄은 그대로)', () => {
    expect(applyMarkdownFormat('- a\nb', 0, 5, 'bullet').value).toBe('- a\n- b')
  })
  it('ordered: 일부 줄만 번호가 있으면 없는 줄에만 1. 부터 붙임(번호 다시 매기기 안 함)', () => {
    expect(applyMarkdownFormat('1. a\nb', 0, 6, 'ordered').value).toBe('1. a\n1. b')
  })
  it('h3: 다른 수준 제목은 ### 로 바꾸고 ### 이면 뺌', () => {
    expect(applyMarkdownFormat('## 절차', 0, 0, 'h3').value).toBe('### 절차')
    expect(applyMarkdownFormat('# 절차', 0, 0, 'h3').value).toBe('### 절차')
    expect(applyMarkdownFormat('### 절차', 0, 0, 'h3').value).toBe('절차')
  })
  it('h3: 일부 줄만 ### 이면 나머지만 붙임', () => {
    expect(applyMarkdownFormat('### a\nb', 0, 7, 'h3').value).toBe('### a\n### b')
  })
  it('ordered: 번호를 1부터 매기고 토글 시 숫자 번호를 뺌', () => {
    const on = applyMarkdownFormat('a\nb', 0, 3, 'ordered')
    expect(on).toEqual({ value: '1. a\n2. b', selStart: 0, selEnd: 9 })
    expect(applyMarkdownFormat('1. a\n12. b', 0, 10, 'ordered').value).toBe('a\nb')
  })
  it('빈 줄은 건너뛰고 번호도 세지 않음', () => {
    expect(applyMarkdownFormat('a\n\nb', 0, 4, 'ordered').value).toBe('1. a\n\n2. b')
  })
  it('선택이 다음 줄 맨 앞에서 끝나면 그 줄은 포함하지 않음', () => {
    expect(applyMarkdownFormat('a\nb', 0, 2, 'bullet').value).toBe('- a\nb')
  })
  it('첫 줄이 빈 줄이고 커서가 0 이어도 텍스트가 중복되지 않음', () => {
    expect(applyMarkdownFormat('\nabc', 0, 0, 'bullet')).toEqual({ value: '- \nabc', selStart: 0, selEnd: 2 })
  })
  it('빈 입력에 bullet', () => {
    expect(applyMarkdownFormat('', 0, 0, 'bullet')).toEqual({ value: '- ', selStart: 0, selEnd: 2 })
  })
})

describe('applyMarkdownFormat — 표', () => {
  const skeleton = '| 항목 | 내용 |\n| --- | --- |\n|  |  |\n'
  it('내용 있는 줄 뒤에 빈 줄을 두고 표를 넣고 커서는 첫 빈 칸', () => {
    const r = applyMarkdownFormat('끝', 1, 1, 'table')
    expect(r.value).toBe('끝\n\n' + skeleton)
    const cell = '끝\n\n| 항목 | 내용 |\n| --- | --- |\n| '.length
    expect(r).toMatchObject({ selStart: cell, selEnd: cell })
  })
  it('빈 입력이면 접두 없이 표만', () => {
    const r = applyMarkdownFormat('', 0, 0, 'table')
    expect(r.value).toBe(skeleton)
    expect(r.selStart).toBe('| 항목 | 내용 |\n| --- | --- |\n| '.length)
  })
  it('첫 줄이 빈 줄이고 커서가 0 이면 접두 없이 맨 앞에 넣음', () => {
    expect(applyMarkdownFormat('\nabc', 0, 0, 'table').value).toBe(skeleton + '\nabc')
  })
  it('빈 줄 커서인데 앞 줄에 글이 있으면 빈 줄을 하나 더 둠', () => {
    expect(applyMarkdownFormat('설명\n', 3, 3, 'table').value).toBe('설명\n\n' + skeleton)
  })
  it('빈 줄 커서이고 앞 줄도 빈 줄이면 그대로', () => {
    expect(applyMarkdownFormat('설명\n\n', 4, 4, 'table').value).toBe('설명\n\n' + skeleton)
  })
  it('줄 가운데 커서여도 현재 줄 끝 뒤에 넣고 뒷줄은 보존', () => {
    expect(applyMarkdownFormat('앞뒤\n다음', 1, 1, 'table').value).toBe('앞뒤\n\n' + skeleton + '\n다음')
  })
})

describe('applyMarkdownFormat — 코드 블록 펜스 줄 맨 앞', () => {
  it('여러 줄 선택이 줄 중간에서 시작·끝나면 펜스 앞뒤에 줄바꿈을 넣음', () => {
    const v = '가나\n다라\n마바'
    // '나' 부터 '다' 까지 선택
    const r = applyMarkdownFormat(v, 1, 4, 'code')
    expect(r.value).toBe('가\n```\n나\n다\n```\n라\n마바')
    expect(r.value.slice(r.selStart, r.selEnd)).toBe('나\n다')
  })
  it('줄 경계에서 시작·끝나면 줄바꿈을 더하지 않음', () => {
    expect(applyMarkdownFormat('a\nb', 0, 3, 'code').value).toBe('```\na\nb\n```')
  })
})

describe('applyMarkdownFormat — 범위 보정', () => {
  it('selEnd 가 길이를 넘으면 끝으로 자름', () => {
    expect(applyMarkdownFormat('ab', 0, 99, 'bold')).toEqual({ value: '**ab**', selStart: 2, selEnd: 4 })
  })
  it('음수·역전 선택도 예외 없이 보정', () => {
    expect(() => applyMarkdownFormat('ab', -5, 1, 'italic')).not.toThrow()
    expect(applyMarkdownFormat('ab', 2, 0, 'italic').value).toBe('*ab*')
  })
})

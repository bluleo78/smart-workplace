import { describe, expect, it } from 'vitest'

import {
  hasPendingToken, imageMarkdown, insertAt, placeholderToken, removeToken, replaceToken,
} from './markdownImageInsert'

describe('markdownImageInsert', () => {
  it('빈 본문에는 토큰만 넣고 캐럿을 토큰 뒤에 둔다', () => {
    const t = placeholderToken(1)
    expect(insertAt('', 0, 0, t)).toEqual({ text: `${t}\n`, caret: t.length + 1, lead: false })
  })

  it('줄 중간에 넣으면 앞뒤를 줄바꿈으로 분리한다', () => {
    const t = placeholderToken(2)
    const r = insertAt('재현 단계 끝', 5, 5, t)
    expect(r.text).toBe(`재현 단계\n${t}\n 끝`)
  })

  it('선택 영역은 토큰으로 대체된다', () => {
    const t = placeholderToken(3)
    expect(insertAt('a XXX b', 2, 5, t).text).toBe(`a \n${t}\n b`)
  })

  it('업로드 중 사용자가 앞쪽을 편집해도 토큰을 찾아 교체한다', () => {
    const t = placeholderToken(4)
    const edited = `앞에 추가함\n${t}\n뒤`
    expect(replaceToken(edited, t, '![a.png](/x)')).toBe('앞에 추가함\n![a.png](/x)\n뒤')
  })

  it('동시 업로드 토큰은 서로 독립적으로 교체된다', () => {
    const a = placeholderToken(10)
    const b = placeholderToken(1)
    const text = `${a}\n${b}\n`
    expect(replaceToken(replaceToken(text, b, 'B'), a, 'A')).toBe('A\nB\n')
  })

  it('실패 시 removeToken 은 삽입 전 텍스트로 되돌린다(줄 중간·끝·빈 본문·줄 시작)', () => {
    const t = placeholderToken(5)
    for (const [orig, pos] of [['재현 화면입니다', 3], ['abc', 3], ['', 0], ['x\ny', 2]] as const) {
      const r = insertAt(orig, pos, pos, t)
      expect(removeToken(r.text, t, r.lead)).toBe(orig)
    }
  })

  it('removeToken 은 토큰이 없으면 원문 그대로 둔다', () => {
    expect(removeToken('사용자가 지움', placeholderToken(5), true)).toBe('사용자가 지움')
  })

  it('토큰이 지워졌으면 원문을 그대로 둔다', () => {
    expect(replaceToken('사용자가 지움', placeholderToken(6), 'X')).toBe('사용자가 지움')
  })

  it('alt 의 대괄호·줄바꿈을 제거해 마크다운이 깨지지 않게 한다', () => {
    expect(imageMarkdown('스크린샷 [1]\n.png', '/u')).toBe('![스크린샷 1 .png](/u)')
  })

  it('남은 업로드 토큰을 감지한다', () => {
    expect(hasPendingToken(`a ${placeholderToken(7)}`)).toBe(true)
    expect(hasPendingToken('![a](/x)')).toBe(false)
  })
})

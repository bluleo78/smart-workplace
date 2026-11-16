// mdast 공용 파서(WP-1633) — 도움말 파서가 화면 그리기(MarkdownMessage·HelpMarkdown)와 같은 한국어 강조 규칙으로 읽는지 본다.
// 다르면 AI 답 꼬리말의 출처 이름(mdastText)에 화면에선 굵게로 보이는 글의 ** 가 기호째 남는다.
import { describe, expect, it } from 'vitest'

import { markdownParser, mdastText } from './mdast'

describe('markdownParser 한국어 강조', () => {
  it.each([
    ['**설정(A)**을 누름', '설정(A)을 누름'],
    ['~~취소(A)~~를 확인', '취소(A)를 확인'],
  ])('%j 의 평문에 기호가 남지 않는다', (md, text) => {
    expect(mdastText(markdownParser.parse(md))).toBe(text)
  })
})

// WP-299 회귀 — 표 셀에 멘션 칩·이미지처럼 텍스트가 없는 노드만 있으면 저장 시 셀이 빈칸이 되던 문제.
// tiptap-markdown 표 직렬화기가 셀의 textContent.trim() 이 비면 셀을 통째로 건너뛰었다(멘션·이미지는 textContent '').
import { describe, expect, it } from 'vitest'

import { docToMarkdown, markdownToDoc } from './markdown'

/** 마크다운 → 문서 → 마크다운 한 바퀴. */
const roundtrip = (md: string) => docToMarkdown(markdownToDoc(md))

describe('표 셀의 텍스트 없는 노드 직렬화 (WP-299)', () => {
  it('멘션만 든 셀이 저장 후에도 멘션 토큰을 유지한다', () => {
    const md = '| 담당 | 비고 |\n| --- | --- |\n| <@3> | <#page:12> |\n'
    expect(roundtrip(md)).toBe(md)
  })

  it('이미지만 든 셀이 저장 후에도 이미지를 유지한다', () => {
    const md = '| 사진 | 설명 |\n| --- | --- |\n| ![](/api/v1/wiki/attachments/1) | 현장 |\n'
    expect(roundtrip(md)).toBe(md)
  })

  it('헤더 셀에 멘션만 있어도 유지된다', () => {
    const md = '| <#issue:7> | b |\n| --- | --- |\n| 1 | 2 |\n'
    expect(roundtrip(md)).toBe(md)
  })

  it('두 번 왕복해도 결과가 같다(병합 안정성)', () => {
    const once = roundtrip('| a | b |\n| --- | --- |\n| <@3> ![](/api/v1/wiki/attachments/1) | x |')
    expect(roundtrip(once)).toBe(once)
  })

  it('공백뿐인 셀은 기존처럼 빈칸으로 쓴다', () => {
    expect(roundtrip('| a | b |\n| --- | --- |\n|   | x |')).toBe('| a | b |\n| --- | --- |\n|  | x |\n')
  })

  it('셀 안 이미지의 alt·title 에 든 | 는 이스케이프되어 셀이 쪼개지지 않는다', () => {
    // 이미지 직렬화기는 Text 직렬화기(WikiMarkdownText)를 거치지 않아 | 가 셀 구분자로 샜다 — 이미지 셀이 살아나며 드러난 경계.
    const md = '| a |\n| --- |\n| ![x\\|y](/api/v1/wiki/attachments/1 "p\\|q") |\n'
    expect(roundtrip(md)).toBe(md)
    expect(roundtrip(roundtrip(md))).toBe(md)
  })

  it('표 밖 이미지 alt 의 | 는 이스케이프하지 않는다', () => {
    expect(roundtrip('![x|y](/api/v1/wiki/attachments/1)')).toBe('![x|y](/api/v1/wiki/attachments/1)')
  })
})

describe('GFM 으로 못 쓰는 표의 HTML 폴백(#742)은 그대로다', () => {
  // 수정 전 main 출력 그대로 — 직렬화기를 덮어쓰면서 폴백 경로가 바뀌지 않았는지 바이트 단위로 고정한다.
  it('병합 셀 표', () => {
    const md =
      '<table><tbody><tr><th colspan="2"><p>병합</p></th></tr><tr><td><p>a</p></td><td><p>b</p></td></tr></tbody></table>'
    expect(roundtrip(md)).toBe(
      '<div class="tableWrapper">\n<table style="min-width: 50px;"><colgroup><col style="min-width: 25px;"><col style="min-width: 25px;"></colgroup><tbody><tr><th colspan="2" rowspan="1"><p>병합</p></th></tr><tr><td colspan="1" rowspan="1"><p>a</p></td><td colspan="1" rowspan="1"><p>b</p></td></tr></tbody></table>\n</div>',
    )
  })

  it('여러 문단이 든 셀', () => {
    const md =
      '<table><tbody><tr><th><p>h1</p></th><th><p>h2</p></th></tr><tr><td><p>p1</p><p>p2</p></td><td><p>x</p></td></tr></tbody></table>'
    expect(roundtrip(md)).toBe(
      '<div class="tableWrapper">\n<table style="min-width: 50px;"><colgroup><col style="min-width: 25px;"><col style="min-width: 25px;"></colgroup><tbody><tr><th colspan="1" rowspan="1"><p>h1</p></th><th colspan="1" rowspan="1"><p>h2</p></th></tr><tr><td colspan="1" rowspan="1"><p>p1</p><p>p2</p></td><td colspan="1" rowspan="1"><p>x</p></td></tr></tbody></table>\n</div>',
    )
  })
})

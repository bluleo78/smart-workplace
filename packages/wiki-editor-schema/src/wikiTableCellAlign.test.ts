// WP-584 — 표 열 정렬이 GFM 정렬 마커로 저장되고 다시 읽혀 셀 align 속성으로 돌아오는지.
import { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'

import { wikiSchemaExtensions } from './extensions'

import { docToMarkdown, markdownToDoc } from './markdown'
import { parseCellAlign } from './tableCellAlign'

/** 마크다운 → 문서 → 마크다운 한 바퀴. */
const roundtrip = (md: string) => docToMarkdown(markdownToDoc(md))

/** 문서의 표에서 행마다 셀 align 값을 뽑는다. */
function rowAligns(doc: PMNode): (string | null)[][] {
  const rows: (string | null)[][] = []
  doc.descendants((n) => {
    if (n.type.name === 'tableRow') rows.push(n.content.content.map((c) => c.attrs.align))
    return true
  })
  return rows
}
const cellAligns = (md: string) => rowAligns(markdownToDoc(md))

describe('표 열 정렬 (WP-584)', () => {
  it('가운데·오른쪽 마커는 왕복해도 그대로다', () => {
    const md = '| 서비스 | 상태 | 응답 |\n| --- | :---: | ---: |\n| API | 정상 | 128 |\n'
    expect(roundtrip(md)).toBe(md)
    expect(roundtrip(roundtrip(md))).toBe(md)
  })

  it('마커를 읽으면 그 열의 헤더·본문 셀 모두 같은 align 을 갖는다', () => {
    expect(cellAligns('| a | b | c |\n| --- | :-: | --: |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |')).toEqual([
      [null, 'center', 'right'],
      [null, 'center', 'right'],
      [null, 'center', 'right'],
    ])
  })

  it('왼쪽 마커(:---)는 기본(정렬 없음)으로 읽혀 --- 로 저장된다 — 화면은 같다', () => {
    expect(cellAligns('| a |\n| :--- |\n| 1 |')).toEqual([[null], [null]])
    expect(roundtrip('| a |\n| :--- |\n| 1 |\n')).toBe('| a |\n| --- |\n| 1 |\n')
  })

  it('정렬 없는 기존 표는 바뀌지 않는다', () => {
    const md = '| a | b |\n| --- | --- |\n| 1 | 2 |\n'
    expect(roundtrip(md)).toBe(md)
  })

  it('마크다운으로 못 쓰는 표(병합 셀)는 HTML 로 저장되고 셀 정렬 style 이 남는다', () => {
    const html =
      '<table><tbody><tr><th colspan="2" style="text-align: center">합계</th></tr>' +
      '<tr><td style="text-align: right">1</td><td>2</td></tr></tbody></table>'
    const once = roundtrip(html)
    expect(once).toContain('text-align: center')
    expect(once).toContain('text-align: right')
    expect(roundtrip(once)).toBe(once)
  })
})

describe('열 정렬 맞춤 플러그인 (WP-584)', () => {
  /** 마크다운으로 연 편집기 — 표 명령(행 추가 등)을 실제로 돌려 본다. */
  function editorOf(md: string): Editor {
    const ed = new Editor({ extensions: wikiSchemaExtensions() })
    ed.commands.setContent(md)
    return ed
  }
  const aligns = (ed: Editor) => rowAligns(ed.state.doc)
  /** 마지막 본문 셀로 커서를 옮긴다. */
  function focusLastCell(ed: Editor) {
    let last = 0
    ed.state.doc.descendants((n, pos) => {
      if (n.type.name === 'tableCell') last = pos
      return true
    })
    ed.commands.setTextSelection(last + 2)
  }

  it('정렬한 열에 행을 더하면 새 셀도 그 열의 정렬을 따른다 — 화면과 저장본이 같다', () => {
    const ed = editorOf('| a | b |\n| --- | :---: |\n| 1 | 2 |')
    focusLastCell(ed)
    ed.commands.addRowAfter()
    expect(aligns(ed)).toEqual([
      [null, 'center'],
      [null, 'center'],
      [null, 'center'],
    ])
    ed.destroy()
  })

  it('본문 셀만 다르게 바뀌면 헤더 값으로 되돌린다', () => {
    const ed = editorOf('| a |\n| --- |\n| 1 |')
    focusLastCell(ed)
    ed.commands.setCellAttribute('align', 'right')
    expect(aligns(ed)).toEqual([[null], [null]])
    ed.destroy()
  })

  it('HTML 로 저장되는 표(병합 셀)는 셀마다 정렬을 그대로 둔다', () => {
    const ed = editorOf(
      '<table><tbody><tr><th colspan="2">합계</th></tr>' +
        '<tr><td style="text-align: right">1</td><td>2</td></tr></tbody></table>',
    )
    expect(aligns(ed)).toEqual([[null], ['right', null]])
    ed.destroy()
  })
})

describe('parseCellAlign', () => {
  it('center·right 만 남기고 나머지는 기본(null)', () => {
    expect(parseCellAlign('center')).toBe('center')
    expect(parseCellAlign(' RIGHT ')).toBe('right')
    expect(parseCellAlign('left')).toBeNull()
    expect(parseCellAlign('justify')).toBeNull()
    expect(parseCellAlign('')).toBeNull()
    expect(parseCellAlign(null)).toBeNull()
  })
})

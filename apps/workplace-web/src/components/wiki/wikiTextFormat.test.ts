// @vitest-environment jsdom
// WP-1305 — 선택 서식 도구 명령. 밑줄·글자색·배경색이 class 없는 서식 span 하나에 모이고(겹겹이 늘지 않음), 끄면 그 선언만 빠지며,
// 정렬·크기 바꾸기가 서로를 지우지 않는지 편집기 상태와 저장 마크다운으로 본다(그리기는 브라우저 몫).
import { docToMarkdown, getMarkdownSchema, isFormatSpanMark, wikiSchemaExtensions } from '@smart-workplace/wiki-editor-schema'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'

import {
  currentBlockSize,
  FORMAT_COLORS,
  markColorValue,
  readDecl,
  selectionFormat,
  setBlockSize,
  setFormatColor,
  setTextAlign,
  textColorValue,
  toggleUnderline,
  WikiTextFormatKeys,
  withDecl,
} from './wikiTextFormat'

const RED = textColorValue(FORMAT_COLORS.find((c) => c.key === 'red')!)
const BLUE = textColorValue(FORMAT_COLORS.find((c) => c.key === 'blue')!)
const YELLOW_BG = markColorValue(FORMAT_COLORS.find((c) => c.key === 'yellow')!)

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

const open = (md: string) => {
  editor = new Editor({ element: document.createElement('div'), extensions: [...wikiSchemaExtensions(), WikiTextFormatKeys], content: md })
  return editor
}

/** 문서에서 글자 text 의 범위를 고른다(첫 등장 — 마크가 달라 글자 노드가 나뉘어도 글자 블록 단위로 찾는다). */
function select(ed: Editor, text: string) {
  let from = -1
  ed.state.doc.descendants((n, pos) => {
    if (from >= 0) return false
    if (!n.isTextblock) return true
    const i = n.textContent.indexOf(text)
    if (i >= 0) from = pos + 1 + i
    return false
  })
  if (from < 0) throw new Error(`no text ${text}`)
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, from, from + text.length)))
}

const md = (ed: Editor) => docToMarkdown(ed.state.doc)

describe('style 선언 다루기', () => {
  it('withDecl 은 같은 속성을 바꾸거나 지우고 다른 선언은 그대로 둔다', () => {
    expect(withDecl(null, 'color', 'red')).toBe('color: red')
    expect(withDecl('text-decoration: underline', 'color', 'red')).toBe('text-decoration: underline; color: red')
    expect(withDecl('text-decoration: underline; color: red', 'color', BLUE)).toBe(`text-decoration: underline; color: ${BLUE}`)
    expect(withDecl('color: red', 'color', null)).toBeNull()
    // var(…, #fff) 의 쉼표·괄호와 url(data:…;…) 의 ; 로 선언이 쪼개지지 않는다.
    expect(readDecl(`${'color: ' + RED}; background-image: url(data:image/png;base64,AA)`, 'background-image')).toBe('url(data:image/png;base64,AA)')
  })

  it('isFormatSpanMark(공용 스키마)는 밑줄·글자색·배경색만 든 class 없는 span 일 때만 참', () => {
    const span = getMarkdownSchema().marks.wikiHtmlSpan
    expect(isFormatSpanMark(span.create({ style: `text-decoration: underline; color: ${RED}` }))).toBe(true)
    expect(isFormatSpanMark(span.create({ style: 'color: red; position: fixed' }))).toBe(false)
    expect(isFormatSpanMark(span.create({ className: 'badge', style: 'color: red' }))).toBe(false)
    expect(isFormatSpanMark(span.create({ style: null }))).toBe(false)
  })
})

describe('밑줄·글자색·배경색 명령', () => {
  it('밑줄 켜고 끄기 — ⌘U 와 같은 명령, 눌림 상태가 따라간다', () => {
    const ed = open('가나다')
    select(ed, '나')
    expect(selectionFormat(ed.state).underline).toBe(false)
    ed.commands.command(toggleUnderline)
    expect(md(ed)).toBe('가<span style="text-decoration: underline">나</span>다')
    expect(selectionFormat(ed.state).underline).toBe(true)
    ed.commands.command(toggleUnderline)
    expect(md(ed)).toBe('가나다')
  })

  it('밑줄 글자에 색·배경을 더하면 span 하나로 합쳐지고, 밑줄만 끄면 색은 남는다', () => {
    const ed = open('가나다')
    select(ed, '나')
    ed.commands.command(toggleUnderline)
    ed.commands.command(setFormatColor('color', RED))
    ed.commands.command(setFormatColor('background-color', YELLOW_BG))
    expect(md(ed)).toBe(`가<span style="text-decoration: underline; color: ${RED}; background-color: ${YELLOW_BG}">나</span>다`)
    expect(selectionFormat(ed.state).color).toBe(RED)
    ed.commands.command(toggleUnderline)
    expect(md(ed)).toBe(`가<span style="color: ${RED}; background-color: ${YELLOW_BG}">나</span>다`)
    // 다른 색으로 바꾸면 값만 바뀐다(선언이 두 번 생기지 않는다). 「기본」은 선언을 지운다.
    ed.commands.command(setFormatColor('color', BLUE))
    expect(md(ed)).toBe(`가<span style="color: ${BLUE}; background-color: ${YELLOW_BG}">나</span>다`)
    ed.commands.command(setFormatColor('color', null))
    ed.commands.command(setFormatColor('background-color', null))
    expect(md(ed)).toBe('가나다')
  })

  it('일부만 밑줄인 선택에 밑줄을 켜면 모두 켜지고(섞임 → 켬), 한 span 으로 이어진다', () => {
    const ed = open('<span style="text-decoration: underline">가</span>나')
    select(ed, '가나')
    expect(selectionFormat(ed.state).underline).toBe(false)
    ed.commands.command(toggleUnderline)
    expect(md(ed)).toBe('<span style="text-decoration: underline">가나</span>')
  })

  it('색이 섞인 선택의 현재 색은 null(메뉴에 체크 없음)', () => {
    const ed = open(`<span style="color: ${RED}">가</span>나`)
    select(ed, '가나')
    expect(selectionFormat(ed.state).color).toBeNull()
    select(ed, '가')
    expect(selectionFormat(ed.state).color).toBe(RED)
  })

  it('class 를 지닌 모양 span(배지)은 남기고, 그 안의 같은 속성 선언은 서식 span 으로 옮긴다', () => {
    const ed = open('<span class="badge" style="color: green; padding: 2px">좋음</span>')
    select(ed, '좋음')
    expect(selectionFormat(ed.state).color).toBe('green')
    ed.commands.command(setFormatColor('color', RED))
    const marks = ed.state.doc.firstChild!.firstChild!.marks.map((m) => m.attrs)
    expect(marks).toContainEqual({ className: 'badge', style: 'padding: 2px' })
    expect(marks).toContainEqual({ className: null, style: `color: ${RED}` })
    expect(selectionFormat(ed.state).color).toBe(RED)
  })

  it('굵게·취소선과 함께 써도 마크다운 서식이 유지된다', () => {
    const ed = open('**굵게** ~~취소~~')
    select(ed, '굵게')
    ed.commands.command(toggleUnderline)
    select(ed, '취소')
    ed.commands.command(setFormatColor('color', RED))
    expect(md(ed)).toBe(
      `<span style="text-decoration: underline">**굵게**</span> <span style="color: ${RED}">~~취소~~</span>`,
    )
  })

  it('⌘U(Mod-u) 단축키가 밑줄을 켠다', () => {
    const ed = open('가나')
    select(ed, '가')
    // keyboardShortcut 은 키 이벤트를 만들어 편집기의 handleKeyDown(단축키 플러그인)에 넘긴다.
    ed.commands.keyboardShortcut('Mod-u')
    expect(selectionFormat(ed.state).underline).toBe(true)
  })

  it('빈 선택(커서)에서는 다음에 칠 글자의 마크(저장된 마크)를 바꾼다', () => {
    const ed = open('가')
    ed.commands.setTextSelection(2)
    ed.commands.command(setFormatColor('color', RED))
    ed.commands.insertContent('나')
    expect(md(ed)).toBe(`가<span style="color: ${RED}">나</span>`)
  })
})

describe('정렬·크기 명령', () => {
  it('선택이 걸친 문단·제목을 정렬하고, 기본(null)은 감싸개를 없앤다', () => {
    const ed = open('# 제목\n\n본문')
    ed.commands.selectAll()
    expect(selectionFormat(ed.state).canAlign).toBe(true)
    ed.commands.command(setTextAlign('center'))
    expect(md(ed)).toBe(['<div align="center">', '', '# 제목', '', '본문', '', '</div>'].join('\n'))
    expect(selectionFormat(ed.state).align).toBe('center')
    ed.commands.command(setTextAlign(null))
    expect(md(ed)).toBe('# 제목\n\n본문')
  })

  it('목록 항목 안은 정렬하지 않는다(감싸개가 촘촘한 목록을 느슨하게 만든다)', () => {
    const ed = open(['- 하나', '- 둘'].join('\n'))
    select(ed, '하나')
    expect(selectionFormat(ed.state).canAlign).toBe(false)
    expect(ed.commands.command(setTextAlign('center'))).toBe(false)
  })

  it('배경색도 같은 한 번 훑기로 읽는다', () => {
    const ed = open(`<span style="background-color: ${YELLOW_BG}">가</span>`)
    select(ed, '가')
    expect(selectionFormat(ed.state).background).toBe(YELLOW_BG)
  })

  it('표 셀 안은 정렬하지 않는다(셀 정렬이 따로 있다)', () => {
    const ed = open(['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n'))
    select(ed, '1')
    expect(selectionFormat(ed.state).canAlign).toBe(false)
    expect(ed.commands.command(setTextAlign('center'))).toBe(false)
  })

  it('크기 바꾸기(본문 ↔ 제목1~3)는 정렬을 지우지 않는다', () => {
    const ed = open(['<div align="right">', '', '글', '', '</div>'].join('\n'))
    select(ed, '글')
    expect(currentBlockSize(ed.state)).toBe('paragraph')
    ed.commands.command(setBlockSize(2))
    expect(ed.state.doc.firstChild!.attrs).toEqual({ level: 2, textAlign: 'right' })
    expect(currentBlockSize(ed.state)).toBe(2)
    ed.commands.command(setBlockSize('paragraph'))
    expect(md(ed)).toBe(['<div align="right">', '', '글', '', '</div>'].join('\n'))
  })
})

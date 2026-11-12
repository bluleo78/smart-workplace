// @vitest-environment jsdom
// WP-1524 — 메일 작성기 서식 확장. 글꼴·크기·색·배경이 class 없는 span 하나의 인라인 style 로, 정렬·줄 간격·들여쓰기가
// 문단 style 로 나가는지, 붙여 넣은 목록 밖 서식은 버리는지, 저장 HTML 을 다시 열어도 같은지를 편집기 HTML 로 본다.
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it } from 'vitest'

import { MailLink } from './mailEditorLink'
import { MAIL_FORMAT_EXTENSIONS, readMailFormatState } from './mailFormatExtensions'
import { mailComposerHtml } from './mailSignatureNode'

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

/** 작성기와 같은 바탕(StarterKit·MailLink)에 메일 서식 확장을 더한 편집기. */
const open = (content: string) => {
  editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit, MailLink, ...MAIL_FORMAT_EXTENSIONS], content })
  return editor
}

/** 문서에서 글자 text 의 범위를 고른다(첫 등장 — 글자 블록 단위로 찾는다). */
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

const SPAN_STYLE = "font-family: 'Malgun Gothic', '맑은 고딕', sans-serif; font-size: 18px; color: #dc2626; background-color: #fef08a"

describe('메일 서식 확장', () => {
  it('글꼴·크기·글자색·배경색이 span 하나의 인라인 style 로 나간다', () => {
    const ed = open('<p>안녕 하세요</p>')
    select(ed, '안녕')
    ed.commands.setMailFont('malgun')
    ed.commands.setMailFontSize('large')
    ed.commands.setMailColor('#dc2626')
    ed.commands.setMailBackground('#fef08a')
    expect(ed.getHTML()).toContain(`<span style="${SPAN_STYLE}">안녕</span>`)
    // 보내는 본문(작성기의 비활성 문서 직렬화)도 16진값 그대로 — cssText 정규화로 rgb() 가 되지 않는다.
    expect(mailComposerHtml(ed)).toContain(`<span style="${SPAN_STYLE}">안녕</span>`)
  })

  it('정렬·줄 간격·들여쓰기는 문단 style 로 나간다', () => {
    const ed = open('<p>안녕</p>')
    select(ed, '안녕')
    ed.commands.setTextAlign('center')
    ed.commands.setMailLineHeight('1.5')
    ed.commands.indentMail()
    ed.commands.indentMail()
    expect(ed.getHTML()).toMatch(/<p style="[^"]*text-align: center[^"]*">/)
    expect(ed.getHTML()).toContain('line-height: 1.5')
    expect(ed.getHTML()).toContain('margin-left: 80px')
    expect(ed.getHTML()).not.toContain('class=')
  })

  it('커서에서 마지막 글자 서식을 지우면 이어 쓰는 글자에 빈 <span> 이 남지 않는다', () => {
    const ed = open('<p>안녕</p>')
    ed.commands.setTextSelection(ed.state.doc.content.size - 1)
    ed.commands.setMailFontSize('large')
    ed.commands.setMailFontSize('normal')
    ed.commands.insertContent('x')
    expect(ed.getHTML()).toBe('<p>안녕x</p>')
  })

  it('왼쪽 정렬은 선언을 내지 않는다', () => {
    const ed = open('<p style="text-align: center">안녕</p>')
    select(ed, '안녕')
    ed.commands.setTextAlign('left')
    expect(ed.getHTML()).toBe('<p>안녕</p>')
  })

  it('목록 항목 안에서 들여쓰기는 하위 목록으로 내린다', () => {
    const ed = open('<ul><li><p>a</p></li><li><p>b</p></li></ul>')
    select(ed, 'b')
    expect(ed.commands.indentMail()).toBe(true)
    expect(ed.getHTML()).toBe('<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>')
    expect(ed.getHTML()).not.toContain('margin-left')
    // 내어쓰기는 다시 같은 단의 목록으로 올린다.
    expect(ed.commands.outdentMail()).toBe(true)
    expect(ed.getHTML()).toBe('<ul><li><p>a</p></li><li><p>b</p></li></ul>')
  })

  it('들여쓰기는 7단에서 멈추고 0단에서 내어쓰기는 canOutdent=false', () => {
    const ed = open('<p>안녕</p>')
    select(ed, '안녕')
    expect(readMailFormatState(ed).canOutdent).toBe(false)
    expect(ed.commands.outdentMail()).toBe(false)
    for (let i = 0; i < 7; i++) expect(ed.commands.indentMail()).toBe(true)
    expect(ed.getHTML()).toContain('margin-left: 280px')
    // 8번째는 더 들어가지 않는다.
    expect(ed.commands.indentMail()).toBe(false)
    expect(ed.getHTML()).toContain('margin-left: 280px')
    expect(readMailFormatState(ed).canOutdent).toBe(true)
    for (let i = 0; i < 7; i++) ed.commands.outdentMail()
    expect(ed.getHTML()).toBe('<p>안녕</p>')
    expect(readMailFormatState(ed).canOutdent).toBe(false)
  })

  it('「기본」 글꼴·「보통」 크기·null 색은 그 선언만 지우고 빈 span 을 남기지 않는다', () => {
    const ed = open(`<p><span style="${SPAN_STYLE}">안녕</span></p>`)
    select(ed, '안녕')
    ed.commands.setMailFont('default')
    expect(ed.getHTML()).toBe('<p><span style="font-size: 18px; color: #dc2626; background-color: #fef08a">안녕</span></p>')
    ed.commands.setMailFontSize('normal')
    expect(ed.getHTML()).toBe('<p><span style="color: #dc2626; background-color: #fef08a">안녕</span></p>')
    ed.commands.setMailColor(null)
    expect(ed.getHTML()).toBe('<p><span style="background-color: #fef08a">안녕</span></p>')
    ed.commands.setMailBackground(null)
    expect(ed.getHTML()).toBe('<p>안녕</p>')
  })

  it('getHTML → setContent → getHTML 이 같다(임시저장 다시 열기)', () => {
    const ed = open('<p>안녕 하세요</p><ul><li><p>항목</p></li></ul>')
    select(ed, '안녕')
    ed.commands.setMailFont('malgun')
    ed.commands.setMailFontSize('large')
    ed.commands.setMailColor('#dc2626')
    ed.commands.setMailBackground('#fef08a')
    ed.commands.setTextAlign('right')
    ed.commands.setMailLineHeight('1.15')
    ed.commands.indentMail()
    const first = ed.getHTML()
    expect(first).toContain(`<span style="${SPAN_STYLE}">안녕</span>`)
    ed.commands.setContent(first)
    expect(ed.getHTML()).toBe(first)
  })

  it('붙여 넣은 목록 밖 색·글꼴은 버린다', () => {
    const ed = open('<p></p>')
    ed.commands.setContent('<p><span style="color: rgb(232, 232, 232); font-family: Calibri">x</span></p>')
    expect(ed.getHTML()).toBe('<p>x</p>')
    // 목록 안 값만 남기고 나머지 선언은 버린다(rgb 는 16진으로).
    ed.commands.setContent('<p><span style="color: rgb(220, 38, 38); font-family: Calibri; font-size: 13px">y</span></p>')
    expect(ed.getHTML()).toBe('<p><span style="color: #dc2626">y</span></p>')
    // 문단의 목록 밖 줄 간격·여백도 버린다.
    ed.commands.setContent('<p style="line-height: 1.3; margin-left: 13px">z</p>')
    expect(ed.getHTML()).toBe('<p>z</p>')
  })

  it('서식 지우기는 글자 서식과 문단 정렬·줄 간격·들여쓰기를 지우고 링크·목록은 남긴다', () => {
    const ed = open(
      `<p style="text-align: center; line-height: 2.0; margin-left: 40px"><a href="https://example.com"><strong><em><u><s><span style="${SPAN_STYLE}">링크</span></s></u></em></strong></a></p>` +
        '<ul><li><p><strong>항목</strong></p></li></ul>',
    )
    ed.commands.selectAll()
    ed.commands.clearMailFormat()
    const html = ed.getHTML()
    expect(html).toContain('<a ')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('<ul><li><p>항목</p></li></ul>')
    expect(html).not.toMatch(/<(strong|em|u|s|span)[\s>]/)
    expect(html).not.toContain('style=')
  })

  it('readMailFormatState 가 커서 자리의 값을 돌려준다', () => {
    const ed = open('<p>안녕 하세요</p>')
    expect(readMailFormatState(ed)).toEqual({
      font: 'default',
      size: 'normal',
      color: null,
      background: null,
      align: 'left',
      lineHeight: null,
      canOutdent: false,
    })
    select(ed, '안녕')
    ed.commands.setMailFont('malgun')
    ed.commands.setMailFontSize('large')
    ed.commands.setMailColor('#dc2626')
    ed.commands.setTextAlign('center')
    ed.commands.setMailLineHeight('2.0')
    expect(readMailFormatState(ed)).toMatchObject({
      font: 'malgun',
      size: 'large',
      color: '#dc2626',
      background: null,
      align: 'center',
      lineHeight: '2.0',
    })
  })
})

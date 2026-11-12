// @vitest-environment jsdom
// WP-1524 — 메일 안전 표. 머리글 행 + 인라인 테두리·여백만 지닌 HTML 인지, 크기 상한, 재열기 동일성, 노트 표 명령 호환.
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runTableCommand } from '@/components/wiki/wikiTableCommands'
import { MAIL_CELL_STYLE, MAIL_HEADER_CELL_STYLE, MAIL_TABLE_STYLE } from '@/lib/mailFormat'

import { mailComposerHtml } from './mailSignatureNode'
import { insertMailTable, MAIL_TABLE_EXTENSIONS } from './mailTable'

let ed: Editor
beforeEach(() => {
  ed = new Editor({ element: document.createElement('div'), extensions: [StarterKit, ...MAIL_TABLE_EXTENSIONS], content: '<p>x</p>' })
})
afterEach(() => ed.destroy())

describe('mailTable', () => {
  it('보내는 HTML 은 표 칸(td·th) 문단에만 margin: 0 을 단다 — 표 밖 문단은 그대로, class 는 새지 않는다', () => {
    insertMailTable(ed, 2, 2)
    ed.commands.insertContentAt(0, '<p>본문</p>')
    const doc = new DOMParser().parseFromString(mailComposerHtml(ed), 'text/html')
    const cellParas = doc.querySelectorAll('td > p, th > p')
    expect(cellParas.length).toBeGreaterThanOrEqual(4)
    cellParas.forEach((p) => expect(p.getAttribute('style')).toBe('margin: 0'))
    expect(doc.querySelectorAll('th > p').length).toBe(2)
    expect(doc.querySelectorAll('td > p').length).toBe(2)
    const outside = [...doc.querySelectorAll('p')].filter((p) => !p.closest('table'))
    expect(outside.length).toBeGreaterThan(0)
    outside.forEach((p) => expect(p.hasAttribute('style')).toBe(false))
    expect(mailComposerHtml(ed)).not.toContain('class=')
    // 작성창 문서·getHTML 은 그대로(재열기 동일성)
    expect(ed.getHTML()).not.toContain('margin: 0')
  })

  it('3×2 표는 머리글 행 + 인라인 테두리·여백만 지닌 HTML 이다', () => {
    insertMailTable(ed, 3, 2)
    const html = ed.getHTML()
    expect(html).toContain(`<table cellspacing="0" cellpadding="0" style="${MAIL_TABLE_STYLE}">`)
    expect(html.match(/<th /g)).toHaveLength(2)
    expect(html.match(/<tr>/g)).toHaveLength(3)
    expect(html).toContain(`style="${MAIL_CELL_STYLE}"`)
    expect(html).toContain(`style="${MAIL_HEADER_CELL_STYLE}"`)
    expect(html).not.toMatch(/class=|<colgroup|<table[^>]*min-width/)
  })

  it('행·열 수는 1~8 로 자른다', () => {
    insertMailTable(ed, 20, 0)
    const html = ed.getHTML()
    expect(html.match(/<tr>/g)).toHaveLength(8)
    expect(html.match(/<th /g)).toHaveLength(1)
  })

  it('표를 다시 열어도 같은 HTML 이다', () => {
    insertMailTable(ed, 2, 3)
    const html = ed.getHTML()
    ed.commands.setContent(html)
    expect(ed.getHTML()).toBe(html)
  })

  it('노트 표 명령(행 추가·열 삭제)이 그대로 돈다', () => {
    insertMailTable(ed, 3, 2)
    runTableCommand(ed, 'addRowAfter')
    expect(ed.getHTML().match(/<tr>/g)).toHaveLength(4)
    runTableCommand(ed, 'deleteColumn')
    expect(ed.getHTML().match(/<th /g)).toHaveLength(1)
  })
})

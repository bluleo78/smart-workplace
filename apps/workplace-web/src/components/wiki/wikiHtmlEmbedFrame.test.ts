// @vitest-environment jsdom
// WP-1242 — HTML 블록 iframe 높이 맞추기(문서 만들기·메시지 가리기·높이 범위)와 슬래시 메뉴 삽입 명령, 붙여넣기에서 블록이 남는지.
import { getMarkdownSchema, markdownToDoc, wikiSchemaExtensions } from '@smart-workplace/wiki-editor-schema'
import { Editor } from '@tiptap/core'
import { Slice } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clampEmbedHeight,
  embedHeightFromMessage,
  HTML_EMBED_HEIGHT_MESSAGE,
  HTML_EMBED_HEIGHT_SCRIPT,
  HTML_EMBED_MAX_HEIGHT,
  HTML_EMBED_MIN_HEIGHT,
  htmlEmbedDocument,
  watchEmbedHeight,
} from './wikiHtmlEmbedFrame'
import { consumeHtmlEmbedInserted, insertHtmlEmbed } from './wikiHtmlEmbedNode'
import { embedsToCodeBlocks, stripShapeFromSlice } from './wikiPasteShape'
import { filterSlashItems } from './wikiSlashSuggestion'

describe('htmlEmbedDocument', () => {
  it('소스는 그대로 두고 끝에 높이 보고 스크립트를 붙인다', () => {
    const src = '<!doctype html><html><body><canvas></canvas></body></html>'
    const doc = htmlEmbedDocument(src)
    expect(doc.startsWith(src)).toBe(true)
    expect(doc.endsWith(HTML_EMBED_HEIGHT_SCRIPT)).toBe(true)
    expect(HTML_EMBED_HEIGHT_SCRIPT).toContain(`type:'${HTML_EMBED_HEIGHT_MESSAGE}'`)
    expect(HTML_EMBED_HEIGHT_SCRIPT).toContain('parent.postMessage')
    expect(HTML_EMBED_HEIGHT_SCRIPT).toContain('ResizeObserver')
  })
})

describe('clampEmbedHeight', () => {
  it('하한·상한으로 자르고 소수는 올린다', () => {
    expect(clampEmbedHeight(0)).toBe(HTML_EMBED_MIN_HEIGHT)
    expect(clampEmbedHeight(-50)).toBe(HTML_EMBED_MIN_HEIGHT)
    expect(clampEmbedHeight(300.2)).toBe(301)
    expect(clampEmbedHeight(99999)).toBe(HTML_EMBED_MAX_HEIGHT)
  })
  it('숫자가 아니거나 유한하지 않으면 무시한다', () => {
    expect(clampEmbedHeight('300')).toBeNull()
    expect(clampEmbedHeight(Number.NaN)).toBeNull()
    expect(clampEmbedHeight(Number.POSITIVE_INFINITY)).toBeNull()
    expect(clampEmbedHeight(undefined)).toBeNull()
  })
})

describe('embedHeightFromMessage', () => {
  const frame = {} as Window
  const other = {} as Window
  const msg = (source: unknown, data: unknown) => ({ source, data }) as Pick<MessageEvent, 'source' | 'data'>

  it('그 iframe 이 보낸 높이 메시지만 받아 범위로 자른다', () => {
    expect(embedHeightFromMessage(msg(frame, { type: HTML_EMBED_HEIGHT_MESSAGE, height: 250 }), frame)).toBe(250)
    expect(embedHeightFromMessage(msg(frame, { type: HTML_EMBED_HEIGHT_MESSAGE, height: 5000 }), frame)).toBe(HTML_EMBED_MAX_HEIGHT)
  })
  it('다른 창이 보냈거나 iframe 이 아직 없으면 무시한다', () => {
    expect(embedHeightFromMessage(msg(other, { type: HTML_EMBED_HEIGHT_MESSAGE, height: 250 }), frame)).toBeNull()
    expect(embedHeightFromMessage(msg(null, { type: HTML_EMBED_HEIGHT_MESSAGE, height: 250 }), frame)).toBeNull()
    expect(embedHeightFromMessage(msg(frame, { type: HTML_EMBED_HEIGHT_MESSAGE, height: 250 }), null)).toBeNull()
  })
  it('종류가 다르거나 모양이 틀린 메시지는 무시한다', () => {
    expect(embedHeightFromMessage(msg(frame, { type: 'other', height: 250 }), frame)).toBeNull()
    expect(embedHeightFromMessage(msg(frame, 'wp-html-embed-height'), frame)).toBeNull()
    expect(embedHeightFromMessage(msg(frame, null), frame)).toBeNull()
    expect(embedHeightFromMessage(msg(frame, { type: HTML_EMBED_HEIGHT_MESSAGE, height: '250' }), frame)).toBeNull()
  })
})

describe('watchEmbedHeight', () => {
  it('창 message 듣기 하나로 보낸 창의 블록에만 높이를 넘기고, 마지막 해제 때 듣기를 뗀다', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const a = {} as Window
    const b = {} as Window
    const gotA: number[] = []
    const gotB: number[] = []
    const stopA = watchEmbedHeight(a, (h) => gotA.push(h))
    const stopB = watchEmbedHeight(b, (h) => gotB.push(h))
    expect(add.mock.calls.filter(([type]) => type === 'message')).toHaveLength(1)
    const post = (source: Window, height: unknown) =>
      window.dispatchEvent(new MessageEvent('message', { data: { type: HTML_EMBED_HEIGHT_MESSAGE, height } , source: source as never }))
    post(a, 300)
    post(b, 99999)
    post(window, 500)
    expect(gotA).toEqual([300])
    expect(gotB).toEqual([HTML_EMBED_MAX_HEIGHT])
    stopA()
    post(a, 310)
    expect(gotA).toEqual([300])
    expect(remove.mock.calls.filter(([type]) => type === 'message')).toHaveLength(0)
    stopB()
    expect(remove.mock.calls.filter(([type]) => type === 'message')).toHaveLength(1)
    add.mockRestore()
    remove.mockRestore()
  })
})

describe('슬래시 메뉴 HTML 블록', () => {
  let editor: Editor | null = null
  // 편집기를 없앤 뒤 ProseMirror 가 걸어 둔 선택 동기화 타이머(약 20ms)가 끝나기를 기다린다 —
  // 기다리지 않으면 테스트 환경이 내려간 뒤 타이머가 터져 「document is not defined」 처리 안 된 오류가 난다.
  afterEach(async () => {
    editor?.destroy()
    editor = null
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
  const open = (md: string) => {
    editor = new Editor({ extensions: wikiSchemaExtensions(), content: md })
    return editor
  }

  it('「HTML」로 찾으면 삽입 항목에 있다', () => {
    const items = filterSlashItems('html', { inTable: false, aiEnabled: false })
    // 「HTML 파일 넣기」(WP-1241)도 함께 찾힌다 — HTML 블록이 먼저다.
    expect(items[0]).toEqual({ key: 'htmlEmbed', label: 'HTML 블록', kind: 'insert' })
    expect(items.map((i) => i.key)).toEqual(['htmlEmbed', 'htmlImport'])
  })

  it('표 안에서는 HTML 블록 항목을 뺀다(표처럼)', () => {
    expect(filterSlashItems('', { inTable: true, aiEnabled: true }).map((i) => i.key)).not.toContain('htmlEmbed')
    expect(filterSlashItems('html', { inTable: true, aiEnabled: false })).toEqual([])
    expect(filterSlashItems('', { inTable: false, aiEnabled: true }).map((i) => i.key)).toContain('htmlEmbed')
  })

  it('넣은 위치를 이 편집기에만 한 번 남긴다 — 그 위치 블록 화면이 꺼내 쓰고 두 번째는 없다', () => {
    const ed = open('본문 글자')
    const insertAt = () => {
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 3)))
      ed.commands.command(insertHtmlEmbed)
    }
    insertAt()
    const pos = ed.state.doc.child(0).nodeSize
    const other = new Editor({ extensions: wikiSchemaExtensions() })
    expect(consumeHtmlEmbedInserted(other, pos)).toBe(false)
    other.destroy()
    expect(consumeHtmlEmbedInserted(ed, pos)).toBe(true)
    expect(consumeHtmlEmbedInserted(ed, pos)).toBe(false)
    // 위치가 다르면 false 이고 표시도 버린다(뒤에 맞는 위치로 물어도 없다).
    insertAt()
    expect(consumeHtmlEmbedInserted(ed, pos + 1)).toBe(false)
    expect(consumeHtmlEmbedInserted(ed, pos)).toBe(false)
  })

  it('빈 문단에서는 그 문단을 빈 HTML 블록으로 바꾸고 커서를 안에 둔다', () => {
    const ed = open('앞\n\n')
    // 문서 끝 빈 문단에 커서.
    ed.commands.insertContentAt(ed.state.doc.content.size, { type: 'paragraph' })
    ed.commands.setTextSelection(ed.state.doc.content.size - 1)
    expect(ed.commands.command(insertHtmlEmbed)).toBe(true)
    const types: string[] = []
    ed.state.doc.forEach((n) => types.push(n.type.name))
    expect(types).toEqual(['paragraph', 'wikiHtmlEmbed'])
    expect(ed.state.selection.$from.parent.type.name).toBe('wikiHtmlEmbed')
  })

  it('글자가 있는 문단에서는 글자를 소스로 옮기지 않고 문단 뒤에 넣는다', () => {
    const ed = open('본문 글자')
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 3)))
    ed.commands.command(insertHtmlEmbed)
    expect(ed.state.doc.child(0).textContent).toBe('본문 글자')
    expect(ed.state.doc.child(1).type.name).toBe('wikiHtmlEmbed')
    expect(ed.state.doc.child(1).textContent).toBe('')
    expect(ed.state.selection.$from.parent.type.name).toBe('wikiHtmlEmbed')
  })
})

describe('붙여넣기 모양 거르기와 HTML 블록', () => {
  it('모양 영역을 풀어도 HTML 블록은 모양으로 보지 않는다(실행 블록 → 코드 블록 바꾸기는 embedsToCodeBlocks 가 따로 한다)', () => {
    const schema = getMarkdownSchema()
    const doc = markdownToDoc('<div class="card">\n\n```html-embed\n<b>x</b>\n```\n\n</div>')
    expect(doc.firstChild!.type.name).toBe('wikiHtmlBox')
    const stripped = stripShapeFromSlice(new Slice(doc.content, 0, 0))
    expect(stripped.content.firstChild!.type).toBe(schema.nodes.wikiHtmlEmbed)
    const out = embedsToCodeBlocks(stripped, schema)
    expect(out.content.childCount).toBe(1)
    expect(out.content.firstChild!.type).toBe(schema.nodes.codeBlock)
    expect(out.content.firstChild!.attrs.language).toBe('html')
    expect(out.content.firstChild!.textContent).toBe('<b>x</b>')
  })
})

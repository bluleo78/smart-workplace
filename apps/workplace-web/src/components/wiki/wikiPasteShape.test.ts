// @vitest-environment jsdom
// WP-1240 — 노트 밖에서 온 붙여넣기(HTML·글자)는 HTML 모양 노드 도입 전과 같은 결과(모양 없음)여야 하고, 노트 편집기에서 복사한 것
// (노트 복사 표지가 붙은 HTML)만 모양을 옮긴다. 순수 함수와, 확장을 단 에디터에 실제로 붙여넣은 결과(ProseMirror 클립보드 경로)를 함께 본다.
import { docToMarkdown, getMarkdownSchema, wikiSchemaExtensions } from '@smart-workplace/wiki-editor-schema'
import { Editor } from '@tiptap/core'
import { type Node as PMNode, Slice } from '@tiptap/pm/model'
import { afterEach, describe, expect, it } from 'vitest'

import { WikiHtmlScope } from './wikiHtmlScope'
import { isNoteCopyHtml, NOTE_COPY_ATTR, stripShapeFromSlice, WikiPasteShape } from './wikiPasteShape'

// Google Docs 가 클립보드에 싣는 모양 — 바깥 <b id=docs-internal-guid> 와 서식 span·style 든 div.
const GOOGLE_DOCS = [
  '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1234">',
  '<p dir="ltr" style="line-height:1.38;margin-top:0pt"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;">보고서 </span>',
  '<span style="font-size:11pt;font-family:Arial,sans-serif;font-weight:700;">굵게</span></p>',
  '<div class="card" style="padding:8px"><p><span class="badge">배지</span></p></div>',
  '<style data-wp-style>.card{color:red}</style>',
  '<table><tbody><tr><th style="text-align:center">a</th></tr><tr><td style="text-align:center">1</td></tr></tbody></table>',
  '</b>',
].join('')

const SHAPED_HTML =
  '<div class="card" style="padding:8px"><p>매출 <span class="badge" style="color:#16a34a">좋음</span></p></div><p>끝</p>'

/** 문서에 쓰인 노드·마크 이름 모음. */
function typesIn(doc: PMNode): Set<string> {
  const names = new Set<string>()
  doc.descendants((n) => {
    names.add(n.type.name)
    n.marks.forEach((m) => names.add(m.type.name))
  })
  return names
}

/** 모양 노드·마크가 하나라도 있는지. */
function hasShape(doc: PMNode): boolean {
  const t = typesIn(doc)
  return t.has('wikiHtmlBox') || t.has('wikiHtmlSpan') || t.has('wikiStyle')
}

describe('isNoteCopyHtml', () => {
  it('is true only when an element carries the note-copy marker', () => {
    expect(isNoteCopyHtml(`<p ${NOTE_COPY_ATTR}="">x</p>`)).toBe(true)
    // 다른 ProseMirror 앱의 복사(data-pm-slice 만)·글자로 적힌 표지는 아니다.
    expect(isNoteCopyHtml('<p data-pm-slice="1 1 []">x</p>')).toBe(false)
    expect(isNoteCopyHtml(`<p>${NOTE_COPY_ATTR}</p>`)).toBe(false)
  })
})

describe('stripShapeFromSlice', () => {
  const schema = getMarkdownSchema()
  const p = (text: string, marks?: object[]) => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] })
  const span = { type: 'wikiHtmlSpan', attrs: { className: 'b', style: null } }

  it('drops page styles, unwraps boxes, removes span marks and merges the text back', () => {
    const content = schema.nodeFromJSON({
      type: 'doc',
      content: [
        { type: 'wikiStyle', attrs: { css: '.a{color:red}' } },
        { type: 'wikiHtmlBox', attrs: { tag: 'div', className: 'card', style: null }, content: [p('안'), p('굵게', [{ type: 'bold' }])] },
        { type: 'paragraph', content: [{ type: 'text', text: '가' }, { type: 'text', text: '나', marks: [span] }] },
      ],
    }).content
    const out = stripShapeFromSlice(new Slice(content, 0, 0))
    expect(out.content.toJSON()).toEqual([
      p('안'),
      p('굵게', [{ type: 'bold' }]),
      { type: 'paragraph', content: [{ type: 'text', text: '가나' }] },
    ])
  })

  it('lowers the open depth by the boxes unwrapped on the open path', () => {
    const content = schema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'wikiHtmlBox', attrs: { tag: 'div', className: 'card', style: null }, content: [p('a'), p('b')] }],
    }).content
    const out = stripShapeFromSlice(new Slice(content, 2, 2))
    expect(out.openStart).toBe(1)
    expect(out.openEnd).toBe(1)
    expect(out.content.childCount).toBe(2)
  })

  it('returns the same slice when there is no shape', () => {
    const slice = new Slice(schema.nodeFromJSON({ type: 'doc', content: [p('x')] }).content, 1, 1)
    expect(stripShapeFromSlice(slice)).toBe(slice)
  })
})

describe('pasting into an editor with WikiPasteShape', () => {
  const editors: Editor[] = []
  afterEach(() => {
    editors.splice(0).forEach((e) => e.destroy())
  })

  /** jsdom 에는 ClipboardEvent 가 없어 pasteHTML 의 기본 이벤트를 만들 수 없다 — 붙여넣기 이벤트 모양만 넘긴다. */
  const pasteEvent = () => new Event('paste') as unknown as ClipboardEvent

  function mount(): Editor {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: [...wikiSchemaExtensions(), WikiHtmlScope, WikiPasteShape],
    })
    editors.push(editor)
    return editor
  }

  /** 노트 편집기에서 복사한 클립보드 HTML — ProseMirror 클립보드 직렬화(편집기의 clipboardSerializer 포함)를 그대로 쓴다. */
  function copiedHtml(html: string): string {
    const source = mount()
    source.commands.setContent(html)
    return source.view.serializeForClipboard(source.state.doc.slice(0, source.state.doc.content.size)).dom.innerHTML
  }

  it('external Google-Docs-like HTML creates no box/span/style nodes and no containment, keeping bold and cell alignment', () => {
    const ed = mount()
    ed.view.pasteHTML(GOOGLE_DOCS, pasteEvent())
    expect(hasShape(ed.state.doc)).toBe(false)
    expect(ed.view.dom.classList.contains('wiki-html-scope')).toBe(false)
    const md = docToMarkdown(ed.state.doc)
    expect(md).toContain('보고서 **굵게**')
    expect(md).toContain('배지')
    // 표 셀 정렬은 지금처럼 살아 있다.
    expect(md).toContain('| :---: |')
  })

  it('an internal copy between notes carries the marker and keeps the shapes', () => {
    const html = copiedHtml(SHAPED_HTML)
    expect(isNoteCopyHtml(html)).toBe(true)
    const target = mount()
    target.view.pasteHTML(html, pasteEvent())
    const types = typesIn(target.state.doc)
    expect(types.has('wikiHtmlBox')).toBe(true)
    expect(types.has('wikiHtmlSpan')).toBe(true)
    // jsdom 이 클립보드 직렬화 때 style 을 'padding: 8px;' 로 다시 쓰므로 공백은 보지 않는다.
    expect(docToMarkdown(target.state.doc)).toMatch(/<div class="card" style="padding: ?8px">/)
  })

  // data-pm-slice 는 ProseMirror 기반 앱이면 어디서나 붙는다 — 노트 복사 표지가 없으면 바깥 붙여넣기다.
  it('HTML from another ProseMirror app (data-pm-slice without the note marker) loses the shapes', () => {
    const html = copiedHtml(SHAPED_HTML).replaceAll(` ${NOTE_COPY_ATTR}=""`, '')
    expect(html).toContain('data-pm-slice')
    const target = mount()
    target.view.pasteHTML(html, pasteEvent())
    expect(hasShape(target.state.doc)).toBe(false)
    expect(target.state.doc.textContent).toContain('매출 좋음')
  })

  // tiptap-markdown(transformPastedText)은 글자를 html:true 마크다운으로 읽는다 — 친 HTML 이 모양 노드가 되면 안 된다.
  it('a plain-text paste of markdown with HTML shape creates no shape nodes', () => {
    const ed = mount()
    const text = ['<style data-wp-style>', 'body{display:none}', '</style>', '', '<div class="card">', '', '**굵게** <span class="b">s</span>', '', '</div>'].join(
      '\n',
    )
    // 서식 붙여넣기(⇧ 없이)로 글자만 든 클립보드 — view.pasteText 는 「서식 없이 붙여넣기」(plain)라 마크다운 파서를 건너뛴다.
    const event = Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
      clipboardData: { getData: (type: string) => (type === 'text/plain' ? text : '') },
    })
    ed.view.dom.dispatchEvent(event)
    // 마크다운으로 읽혔다(굵게가 마크로) — 그런데도 모양 노드는 없다.
    expect(typesIn(ed.state.doc).has('bold')).toBe(true)
    expect(hasShape(ed.state.doc)).toBe(false)
    expect(docToMarkdown(ed.state.doc)).toContain('**굵게** s')
  })
})

// @vitest-environment jsdom
// WP-1240 — 노트 밖에서 온 붙여넣기(HTML·글자)는 HTML 모양 노드 도입 전과 같은 결과(모양 없음)여야 하고, 노트 편집기에서 복사한 것
// (노트 복사 표지가 붙은 HTML)만 모양을 옮긴다. 순수 함수와, 확장을 단 에디터에 실제로 붙여넣은 결과(ProseMirror 클립보드 경로)를 함께 본다.
import { docToMarkdown, getMarkdownSchema, markdownToDoc, wikiSchemaExtensions } from '@smart-workplace/wiki-editor-schema'
import { Editor } from '@tiptap/core'
import { type Node as PMNode, Slice } from '@tiptap/pm/model'
import { afterEach, describe, expect, it } from 'vitest'

import { WikiHtmlScope } from './wikiHtmlScope'
import { embedsToCodeBlocks, isNoteCopyHtml, NOTE_COPY_ATTR, stripShapeFromSlice, WikiPasteShape } from './wikiPasteShape'

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
  // 문단은 정렬 속성(textAlign, WP-1305)을 지닌다 — toJSON 이 기본값 null 도 싣는다.
  const p = (text: string, marks?: object[]) => ({ type: 'paragraph', attrs: { textAlign: null }, content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] })
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
      { type: 'paragraph', attrs: { textAlign: null }, content: [{ type: 'text', text: '가나' }] },
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

  // WP-1306 — Google Docs 의 글꼴·크기·검정 글자색·여백 div 는 모양 유지 정리기가 모두 걸러 「글만」과 같은 결과가 된다.
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

  // WP-1305 — 선택 서식 도구로 단 밑줄·글자색·배경색(서식 span)·문단/제목 정렬은 노트끼리 복사에서 그대로 옮겨진다.
  const FORMATTED_MD = [
    '<div align="center">',
    '',
    '## 가운데 제목',
    '',
    '</div>',
    '',
    '앞 <span style="text-decoration: underline; color: var(--wiki-text-red, #dc2626); background-color: var(--wiki-mark-yellow, #fef08a)">서식</span> **굵게** ~~취소~~',
  ].join('\n')

  it('an internal copy between notes keeps underline/color/background spans and paragraph alignment', () => {
    const source = mount()
    source.commands.setContent(FORMATTED_MD)
    const html = source.view.serializeForClipboard(source.state.doc.slice(0, source.state.doc.content.size)).dom.innerHTML
    expect(isNoteCopyHtml(html)).toBe(true)
    const target = mount()
    target.view.pasteHTML(html, pasteEvent())
    expect(target.state.doc.firstChild!.attrs).toMatchObject({ level: 2, textAlign: 'center' })
    const md = docToMarkdown(target.state.doc)
    expect(md).toContain('<div align="center">')
    // jsdom 이 클립보드 직렬화 때 style 을 다시 써 공백·끝 ; 이 달라질 수 있어 선언 단위로 본다.
    expect(md).toMatch(/<span style="[^"]*text-decoration: underline[^"]*">서식<\/span>/)
    expect(md).toMatch(/color: var\(--wiki-text-red, #dc2626\)/)
    expect(md).toMatch(/background-color: var\(--wiki-mark-yellow, #fef08a\)/)
    expect(md).toContain('**굵게** ~~취소~~')
    // 서식 span 만 있는 노트는 범위 가두기(contain)를 켜지 않는다 — 첫 줄 위 접속자 이름표가 잘리지 않게.
    expect(target.view.dom.classList.contains('wiki-html-scope')).toBe(false)
  })

  // WP-1306 — 노트 밖 HTML 은 「모양 유지」가 기본이다: 유채색 글자·밑줄은 서식 span, 문단·제목 정렬도 남는다(글만은 칩으로 고른다).
  it('an external paste (no note marker) keeps colored/underlined text as a format span and the paragraph alignment', () => {
    const ed = mount()
    ed.view.pasteHTML(
      '<p>앞</p><p style="text-align:center">바깥 <span style="text-decoration:underline;color:red;font-family:Arial">밑줄</span></p><h2 style="text-align:right">제목</h2>',
      pasteEvent(),
    )
    // 첫 문단은 붙여 넣은 자리의 (빈) 문단과 합쳐져 그 문단 속성을 따른다 — 정렬은 둘째·셋째 블록에서 본다.
    const aligns: unknown[] = []
    ed.state.doc.forEach((n) => aligns.push(n.attrs.textAlign))
    expect(aligns).toEqual([null, 'center', 'right'])
    const md = docToMarkdown(ed.state.doc)
    expect(md).toContain('<span style="text-decoration: underline; color: red">밑줄</span>')
    expect(md).not.toContain('font-family')
    // class 없는 서식 span 뿐이라 범위 가두기(contain)는 켜지지 않는다.
    expect(ed.view.dom.classList.contains('wiki-html-scope')).toBe(false)
  })

  // data-pm-slice 는 ProseMirror 기반 앱이면 어디서나 붙는다 — 노트 복사 표지가 없으면 바깥 붙여넣기다(class 는 떼고 걸러 들인다).
  it('HTML from another ProseMirror app (data-pm-slice without the note marker) is filtered like any foreign HTML', () => {
    const html = copiedHtml(SHAPED_HTML).replaceAll(` ${NOTE_COPY_ATTR}=""`, '')
    expect(html).toContain('data-pm-slice')
    const target = mount()
    target.view.pasteHTML(html, pasteEvent())
    // 여백뿐인 div.card 는 보이는 상자가 아니라 풀리고, 유채색 배지 글자만 서식 span 으로 남는다(class 는 뗀다).
    const md = docToMarkdown(target.state.doc)
    expect(typesIn(target.state.doc).has('wikiHtmlBox')).toBe(false)
    // jsdom 이 클립보드 직렬화 때 색을 rgb() 로 다시 쓴다.
    expect(md).toContain('매출 <span style="color: rgb(22, 163, 74)">좋음</span>')
    expect(md).not.toContain('class=')
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

  // WP-1242 — 노트 밖 붙여넣기는 스크립트가 도는 HTML 블록을 만들지 않는다(같은 글자의 ```html 코드 블록), 노트끼리 복사는 블록 그대로.
  const EMBED_MD = '```html-embed\n<script>alert(1)</script>\n```'

  it('an external HTML paste turns an html-embed into an html code block with the same text', () => {
    const html = copiedHtml(EMBED_MD).replaceAll(` ${NOTE_COPY_ATTR}=""`, '')
    const target = mount()
    target.view.pasteHTML(html, pasteEvent())
    expect(typesIn(target.state.doc).has('wikiHtmlEmbed')).toBe(false)
    expect(docToMarkdown(target.state.doc)).toContain('```html\n<script>alert(1)</script>\n```')
  })

  it('a plain-text paste of an html-embed fence becomes an html code block', () => {
    const ed = mount()
    const event = Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
      clipboardData: { getData: (type: string) => (type === 'text/plain' ? EMBED_MD : '') },
    })
    ed.view.dom.dispatchEvent(event)
    expect(typesIn(ed.state.doc).has('wikiHtmlEmbed')).toBe(false)
    expect(docToMarkdown(ed.state.doc)).toContain('```html\n<script>alert(1)</script>\n```')
  })

  it('a copy between notes keeps the html-embed', () => {
    const html = copiedHtml(EMBED_MD)
    expect(isNoteCopyHtml(html)).toBe(true)
    const target = mount()
    target.view.pasteHTML(html, pasteEvent())
    expect(typesIn(target.state.doc).has('wikiHtmlEmbed')).toBe(true)
    expect(docToMarkdown(target.state.doc)).toContain(EMBED_MD)
  })
})

describe('embedsToCodeBlocks', () => {
  const schema = getMarkdownSchema()
  it('converts nested embeds (inside a list) and keeps the open depth; returns the same slice without embeds', () => {
    const doc = markdownToDoc('- a\n\n  ```html-embed\n  <b>x</b>\n  ```')
    const out = embedsToCodeBlocks(new Slice(doc.content, 0, 0), schema)
    const item = out.content.firstChild!.firstChild!
    expect(item.child(1).type.name).toBe('codeBlock')
    expect(item.child(1).attrs.language).toBe('html')
    expect(item.child(1).textContent).toBe('<b>x</b>')
    const plain = new Slice(markdownToDoc('x').content, 1, 1)
    expect(embedsToCodeBlocks(plain, schema)).toBe(plain)
  })
})

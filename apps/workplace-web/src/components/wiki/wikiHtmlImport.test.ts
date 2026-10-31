// @vitest-environment jsdom
//
// HTML 파일 → 노트 변환(WP-1241) — 대표 아티팩트(정적 카드 보고서·표 문서·차트 문서·Tailwind CDN 문서)가 원본 모양에 가깝게, 글자는 바로 편집되는
// 노트 블록으로 들어오고, 그 마크다운이 저장 → 다시 열기(md → doc → md)에서 바뀌지 않는지 고정한다. 붙여넣기 판정(문서 전체 vs 조각)도 본다.
import fs from 'node:fs'
import path from 'node:path'

import { docToMarkdown, markdownToDoc, wikiSchemaExtensions } from '@smart-workplace/wiki-editor-schema'
import { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { afterEach, describe, expect, it } from 'vitest'

import {
  convertHtmlToWiki,
  cssClassNames,
  htmlFileBaseName,
  looksLikeHtmlDocument,
  pruneUnusedClasses,
  stripAnalyticsScripts,
} from './wikiHtmlImport'
import {
  canImportHtmlAt,
  HTML_IMPORT_MAX_BYTES,
  htmlDocumentFromClipboard,
  htmlImportNotice,
  importHtmlIntoEditor,
  insertHtmlImport,
  rejectOversizedHtmlFile,
  WikiHtmlImportPaste,
} from './wikiHtmlImportInsert'
import { WikiPasteShape } from './wikiPasteShape'

/** 테스트 자료(대표 아티팩트) 읽기. */
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, '__fixtures__/htmlImport', name), 'utf8')

/** 저장 형식 왕복 — 한 번 열어 저장한 결과가 처음 마크다운과 같아야 한다(들여온 직후 저장해도 글자가 바뀌지 않는다). */
function expectStableRoundtrip(md: string): PMNode {
  const doc = markdownToDoc(md)
  expect(docToMarkdown(doc)).toBe(md)
  return doc
}

/** 문서 안 노드 이름 목록(깊이 우선). */
function nodeNames(doc: PMNode): string[] {
  const out: string[] = []
  doc.descendants((n) => {
    out.push(n.type.name)
  })
  return out
}

/** 문서 통째로 HTML 블록 하나가 됐는지 — 결과 본문이 HTML 블록 하나뿐이다(런타임 스타일·문서 전체를 다루는 스크립트). */
function isWholeEmbed(r: { markdown: string }): boolean {
  const doc = markdownToDoc(r.markdown)
  return doc.childCount === 1 && doc.firstChild!.type.name === 'wikiHtmlEmbed'
}

/** 이름이 같은 첫 노드. */
function findNode(doc: PMNode, name: string): PMNode | null {
  let found: PMNode | null = null
  doc.descendants((n) => {
    if (found) return false
    if (n.type.name === name) found = n
    return !found
  })
  return found
}

describe('정적 카드 보고서', () => {
  const result = convertHtmlToWiki(fixture('card-report.html'))

  it('제목은 <title>, 넣지 못한 data: 이미지 수를 알린다', () => {
    expect(result.title).toBe('3분기 매출 보고서')
    expect(isWholeEmbed(result)).toBe(false)
    expect(result.droppedImages).toBe(1)
    expect(htmlImportNotice(result)).toContain('이미지 1개')
  })

  it('페이지 스타일 + 모양 영역 + 인라인 모양으로 바뀐다(@import·글꼴 link·meta·noscript·주석·on* 는 빠진다)', () => {
    const md = result.markdown
    expect(md.startsWith('<style data-wp-style>\nbody { font-family: Inter, sans-serif;')).toBe(true)
    expect(md).toContain('.badge { padding: 2px 8px;')
    expect(md).not.toMatch(/@import|fonts\.googleapis|<meta|<link|noscript|스크립트를 켜|머리말|onload|track\(/)
    expect(md).toContain('<div class="grid">\n\n<div class="card">\n\n### 국내\n\n매출 ₩1.2B <span class="badge up">+18%</span>\n\n</div>')
    // 스타일이 쓰지 않는 class(wrapper)는 모양 영역을 만들지 않는다.
    expect(md).not.toContain('wrapper')
    // 카드 안 맨 글자는 앞 공백 없는 문단으로.
    expect(md).toContain('<div class="card" style="border-left: 4px solid #6366f1">\n\n### 신규\n\n고객 120곳\n\n</div>')
    expect(md).toContain('2026년 3분기 **지역별** 매출 요약입니다. 자세한 내용은 [원문](https://example.com/report)을 보세요.')
    expect(md).toContain('- 국내는 신제품 효과\n- 해외는 환율 영향')
    expect(md).toContain('![로고](https://example.com/logo.png)')
  })

  it('글자는 일반 노드라 바로 편집되고, 저장 형식이 왕복에서 바뀌지 않는다', () => {
    const doc = expectStableRoundtrip(result.markdown)
    expect(doc.firstChild!.type.name).toBe('wikiStyle')
    const box = findNode(doc, 'wikiHtmlBox')!
    expect(box.attrs).toMatchObject({ tag: 'div', className: 'grid' })
    const card = box.firstChild!
    expect(card.attrs.className).toBe('card')
    expect(card.child(0).type.name).toBe('heading')
    expect(card.child(1).type.name).toBe('paragraph')
    const badge = card.child(1).lastChild!
    expect(badge.text).toBe('+18%')
    expect(badge.marks.map((m) => [m.type.name, m.attrs.className])).toEqual([['wikiHtmlSpan', 'badge up']])
    expect(nodeNames(doc)).not.toContain('wikiHtmlEmbed')
  })
})

describe('표 중심 문서', () => {
  const result = convertHtmlToWiki(fixture('table-doc.html'))

  it('표는 노트 표, 목록·제목은 일반 블록', () => {
    expect(result.title).toBe('팀별 일정표')
    expect(result.markdown).toContain(
      ['| 팀 | 담당 | 마감 |', '| --- | --- | --- |', '| 플랫폼 | 김하나 | 11/10 |', '| 모바일 | 이두리 | 11/17 |', '| 디자인 | [박세나](https://example.com/d) | 11/24 |'].join('\n'),
    )
    expect(result.markdown).toContain('## 메모\n\n1. 마감은 금요일 기준\n2. 변경 시 채널에 공유')
    const doc = expectStableRoundtrip(result.markdown)
    const table = findNode(doc, 'table')!
    expect(table.childCount).toBe(4)
    expect(table.firstChild!.firstChild!.type.name).toBe('tableHeader')
  })
})

describe('차트 문서', () => {
  const result = convertHtmlToWiki(fixture('chart-doc.html'))
  const doc = expectStableRoundtrip(result.markdown)
  const embed = findNode(doc, 'wikiHtmlEmbed')!

  it('차트 부분만 HTML 블록이 되고 주변 제목·문단·카드 제목은 편집할 수 있는 블록이다', () => {
    expect(isWholeEmbed(result)).toBe(false)
    expect(doc.child(1).type.name).toBe('heading')
    expect(doc.child(1).textContent).toBe('방문자 추이')
    expect(doc.child(2).textContent).toBe('지난 4주 방문자 수입니다.')
    const card = doc.child(3)
    expect(card.type.name).toBe('wikiHtmlBox')
    expect(card.attrs.className).toBe('card')
    expect(card.child(0).type.name).toBe('heading')
    expect(card.child(0).textContent).toBe('주간 방문자')
    expect(card.child(1).type.name).toBe('wikiHtmlEmbed')
    expect(result.markdown).toContain('4주차에 *가장 많이* 늘었습니다.')
  })

  it('HTML 블록 소스는 원본 스타일 + 차트 영역 + 스크립트를 원본 순서로(라이브러리가 먼저), 분석 스크립트는 뺀다', () => {
    const src = embed.textContent
    expect(src.startsWith('<!doctype html>')).toBe(true)
    expect(src).toContain('.chart-wrap { position: relative; height: 280px; }')
    const lib = src.indexOf('chart.umd.min.js')
    const area = src.indexOf('<div class="chart-wrap"><canvas id="visits"></canvas></div>')
    const inline = src.indexOf("new Chart(document.getElementById('visits')")
    expect(lib).toBeGreaterThan(0)
    expect(area).toBeGreaterThan(lib)
    expect(inline).toBeGreaterThan(area)
    expect(src).not.toContain('googletagmanager')
    // 블록 밖 본문에는 스크립트가 남지 않는다.
    expect(result.markdown.replace(/```html-embed[\s\S]*?```/, '')).not.toMatch(/<script|<canvas/)
  })
})

describe('Tailwind CDN 문서', () => {
  it('런타임 스타일 문서는 원본 그대로 HTML 블록 하나가 된다', () => {
    const html = fixture('tailwind-doc.html')
    const result = convertHtmlToWiki(html)
    expect(isWholeEmbed(result)).toBe(true)
    expect(result.title).toBe('Tailwind 대시보드')
    const doc = expectStableRoundtrip(result.markdown)
    expect(doc.childCount).toBe(1)
    expect(doc.firstChild!.type.name).toBe('wikiHtmlEmbed')
    expect(doc.firstChild!.textContent).toBe(html.trim())
  })
})

describe('스크립트 판정', () => {
  const page = (head: string, body: string) => `<!doctype html><html><head><title>t</title>${head}</head><body>${body}</body></html>`

  it('아무 요소도 손대지 않는 스크립트(분석 도구 등)는 버리고 HTML 블록을 만들지 않는다', () => {
    const r = convertHtmlToWiki(page('<script>window.dataLayer=[];console.log(1)</script>', '<p>본문</p><script src="https://example.com/a.js"></script>'))
    expect(r.markdown).toBe('본문')
  })

  it('스크립트가 body 를 다루거나 공통 조상이 body 면 문서 통째로', () => {
    expect(isWholeEmbed(convertHtmlToWiki(page('', '<p>x</p><script>document.body.appendChild(document.createElement("div"))</script>')))).toBe(true)
    const twoSections = page('', '<section><canvas id="a"></canvas></section><p>가운데</p><section><canvas id="b"></canvas></section><script>draw()</script>')
    expect(isWholeEmbed(convertHtmlToWiki(twoSections))).toBe(true)
  })

  it('getElementById·querySelector 로 찾는 요소들의 공통 조상을 떼고, 그 안 데이터 JSON 스크립트는 그대로 둔다', () => {
    const r = convertHtmlToWiki(
      page(
        '',
        '<h2>제목</h2><div><div id="out"></div><ul class="list"><li>a</li></ul><script type="application/json" id="data">{"n":1}</script></div><p>뒤</p>' +
          "<script>const d=JSON.parse(document.getElementById('data').textContent);document.getElementById('out').textContent=d.n;document.querySelector('.list').remove()</script>",
      ),
    )
    const doc = expectStableRoundtrip(r.markdown)
    expect(doc.child(0).textContent).toBe('제목')
    expect(doc.child(1).type.name).toBe('wikiHtmlEmbed')
    expect(doc.child(1).textContent).toContain('<script type="application/json" id="data">{"n":1}</script>')
    expect(doc.child(1).textContent).toContain("document.getElementById('out')")
    expect(doc.child(2).textContent).toBe('뒤')
  })

  it('표 셀 안 캔버스는 표 전체를 HTML 블록으로 뗀다(표 셀은 블록을 담지 못한다)', () => {
    const r = convertHtmlToWiki(page('', '<p>앞</p><table><tr><td><canvas id="c"></canvas></td></tr></table><script>new Chart(document.getElementById("c"))</script>'))
    const doc = expectStableRoundtrip(r.markdown)
    expect(nodeNames(doc)).not.toContain('table')
    expect(doc.child(1).type.name).toBe('wikiHtmlEmbed')
    expect(doc.child(1).textContent).toContain('<table>')
  })

  it('스크립트 없는 큰 SVG(도식)는 HTML 블록으로, 작은 아이콘은 버린다', () => {
    const big = '<svg viewBox="0 0 10 10"><rect/><rect/><circle/><line/></svg>'
    const icon = '<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>'
    const r = convertHtmlToWiki(page('', `<p>${icon} 아이콘</p>${big}`))
    const doc = expectStableRoundtrip(r.markdown)
    expect(doc.child(0).textContent).toBe('아이콘')
    expect(doc.child(1).type.name).toBe('wikiHtmlEmbed')
    expect(doc.child(1).textContent).toContain('<rect></rect>')
  })
})

describe('제목·새 노트', () => {
  it('<title> 이 없으면 첫 h1, 새 노트로 만들면 제목과 같은 첫 h1 을 본문에서 뺀다', () => {
    const html = '<html><body><h1> 회의  메모 </h1><p>내용</p></body></html>'
    expect(convertHtmlToWiki(html).title).toBe('회의 메모')
    expect(convertHtmlToWiki(html).markdown).toBe('# 회의 메모\n\n내용')
    expect(convertHtmlToWiki(html, { stripTitleHeading: true }).markdown).toBe('내용')
    expect(convertHtmlToWiki('<p>x</p>').title).toBeNull()
  })

  it('파일 이름에서 .html·.htm 을 뗀다', () => {
    expect(htmlFileBaseName('보고서.HTML')).toBe('보고서')
    expect(htmlFileBaseName('a.b.htm')).toBe('a.b')
  })
})

describe('붙여넣기 판정', () => {
  /** 클립보드 흉내 — 형식별 글자. */
  const clip = (data: Record<string, string>) => ({ getData: (t: string) => data[t] ?? '' })

  it('문서 전체 소스(text/plain 이 <!doctype html·<html 로 시작)는 들여오기다', () => {
    expect(looksLikeHtmlDocument('  \n<!DOCTYPE html><html></html>')).toBe(true)
    expect(looksLikeHtmlDocument('<html lang="ko">')).toBe(true)
    expect(htmlDocumentFromClipboard(clip({ 'text/plain': '<!doctype html>\n<p>x</p>', 'text/html': '<pre>…</pre>' }))).toBe('<!doctype html>\n<p>x</p>')
  })

  it('조각·일반 글자·일반 웹 복사는 보통 붙여넣기다', () => {
    expect(looksLikeHtmlDocument('<div class="card">x</div>')).toBe(false)
    expect(looksLikeHtmlDocument('html 문서를 보세요')).toBe(false)
    expect(looksLikeHtmlDocument('<htmlx>')).toBe(false)
    // 웹 페이지 복사 — text/plain 은 보이는 글자.
    expect(htmlDocumentFromClipboard(clip({ 'text/plain': '카드 제목', 'text/html': '<html><body><div class="card">카드 제목</div></body></html>' }))).toBeNull()
    // Windows 브라우저는 일반 복사도 <html><body><!--StartFragment--> 로 감싼다.
    expect(htmlDocumentFromClipboard(clip({ 'text/html': '<html><body>\n<!--StartFragment--><b>x</b><!--EndFragment-->\n</body></html>' }))).toBeNull()
    // 노트끼리 복사.
    expect(htmlDocumentFromClipboard(clip({ 'text/html': '<html><body><p data-wp-note-copy="">x</p></body></html>' }))).toBeNull()
  })

  it('text/plain 이 없고 text/html 자체가 문서 전체면 들여오기다', () => {
    const html = '<!doctype html><html><head><style>.a{color:red}</style></head><body><p class="a">x</p></body></html>'
    expect(htmlDocumentFromClipboard(clip({ 'text/html': html }))).toBe(html)
  })

  it('코드 블록·HTML 블록 소스 칸·표 셀 안에서는 들여오지 않는다(글자로 붙인다)', () => {
    const at = (md: string, pos: number) => {
      const doc = markdownToDoc(md)
      return { selection: { $from: doc.resolve(pos) } } as unknown as Parameters<typeof canImportHtmlAt>[0]
    }
    expect(canImportHtmlAt(at('문단', 1))).toBe(true)
    expect(canImportHtmlAt(at('```js\nx\n```', 1))).toBe(false)
    expect(canImportHtmlAt(at('```html-embed\nx\n```', 1))).toBe(false)
    expect(canImportHtmlAt(at('| a |\n| --- |\n| b |', 4))).toBe(false)
  })
})

describe('편집기에 넣기 — 붙여넣기 모양 거르기를 지나지 않는다', () => {
  const editors: Editor[] = []
  afterEach(() => {
    editors.splice(0).forEach((e) => e.destroy())
  })

  /** 노트 편집기와 같은 붙여넣기 확장(모양 거르기·HTML 문서 붙여넣기)을 단 편집기. */
  function mount(content = ''): Editor {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: [...wikiSchemaExtensions(), WikiPasteShape, WikiHtmlImportPaste],
      content,
    })
    editors.push(editor)
    return editor
  }

  /** 클립보드를 실은 붙여넣기 이벤트(jsdom 에는 ClipboardEvent 가 없다). */
  const pasteEvent = (data: Record<string, string>) =>
    Object.assign(new Event('paste', { cancelable: true }), {
      clipboardData: { getData: (t: string) => data[t] ?? '' },
    }) as unknown as ClipboardEvent

  const card = fixture('card-report.html')

  it('HTML 문서 소스를 붙여넣으면 변환해 모양째 들어간다(페이지 스타일·모양 영역·인라인 모양 유지)', () => {
    const ed = mount()
    ed.view.pasteText(card, pasteEvent({ 'text/plain': card }))
    // 기존 노트에 넣는 길이라 범위 class 로 감싼다 — 무작위 꼬리를 고정 이름으로 바꿔 범위 없이 변환한 결과의 감싼 꼴과 비교한다.
    const md = docToMarkdown(ed.state.doc).replace(/wp-import-[a-z0-9]{6}/g, 'wp-import-x')
    expect(md).toBe(convertHtmlToWiki(card, { scopeClass: 'wp-import-x' }).markdown)
    expect(md).toContain('<div class="wp-import-x">\n\n# 3분기 매출 보고서')
    expect(md).toContain('<span class="badge up">+18%</span>')
  })

  it('차트 문서 붙여넣기는 HTML 블록이 실행 블록 그대로다(```html 코드 블록으로 바뀌지 않는다)', () => {
    const chart = fixture('chart-doc.html')
    const ed = mount()
    ed.view.pasteText(chart, pasteEvent({ 'text/plain': chart }))
    expect(nodeNames(ed.state.doc)).toContain('wikiHtmlEmbed')
    expect(nodeNames(ed.state.doc)).not.toContain('codeBlock')
  })

  it('조각 HTML 글자 붙여넣기는 지금처럼 모양을 거른다(WP-1240)', () => {
    const ed = mount()
    const frag = '<div class="card">\n\n카드\n\n</div>'
    ed.view.pasteText(frag, pasteEvent({ 'text/plain': frag }))
    expect(nodeNames(ed.state.doc)).not.toContain('wikiHtmlBox')
    expect(ed.state.doc.textContent).toContain('카드')
  })

  it('코드 블록 안에 붙인 문서 소스는 글자 그대로 들어간다', () => {
    const ed = mount('```html\n\n```')
    ed.commands.setTextSelection(1)
    const src = '<!doctype html><p>x</p>'
    ed.view.pasteText(src, pasteEvent({ 'text/plain': src }))
    expect(ed.state.doc.firstChild!.type.name).toBe('codeBlock')
    expect(ed.state.doc.firstChild!.textContent).toBe(src)
  })

  it('커서 자리 넣기(슬래시 「HTML 파일 넣기」)는 앞 문단 뒤에 블록으로 들어간다', () => {
    const ed = mount('앞 문단')
    ed.commands.setTextSelection(ed.state.doc.content.size - 1)
    expect(insertHtmlImport(ed, '<style data-wp-style>\n.a{color:red}\n</style>\n\n<div class="a">\n\n가\n\n</div>')).toBe(true)
    expect(docToMarkdown(ed.state.doc)).toBe('앞 문단\n\n<style data-wp-style>\n.a{color:red}\n</style>\n\n<div class="a">\n\n가\n\n</div>')
    expect(insertHtmlImport(ed, '  ')).toBe(false)
  })

  it('붙잡아 둔 위치(at)가 있으면 지금 커서가 아니라 그 자리에 넣는다(파일 대화상자 동안 선택이 바뀌어도)', () => {
    const ed = mount('첫 문단\n\n둘째 문단')
    const at = ed.state.doc.content.size - 1 // 둘째 문단 끝
    ed.commands.setTextSelection(1) // 커서는 맨 앞으로 옮겨졌다
    expect(insertHtmlImport(ed, '# 들여온 글', at)).toBe(true)
    expect(docToMarkdown(ed.state.doc)).toBe('첫 문단\n\n둘째 문단\n\n# 들여온 글')
  })

  it('기존 노트에 넣은 들여오기 CSS 는 범위 class 아래로만 걸린다 — 기존 글(범위 밖)의 p·body 선택자에 닿지 않는다', () => {
    const ed = mount('기존 글')
    ed.commands.setTextSelection(ed.state.doc.content.size - 1)
    const html = '<!doctype html><html><head><style>body{color:red} p{margin:0} .card{padding:4px}</style></head><body><p>새 글</p><div class="card"><p>카드</p></div></body></html>'
    expect(importHtmlIntoEditor(ed, html)).toBe(true)
    const doc = ed.state.doc
    // 기존 글은 맨 앞 문단 그대로, 들여온 글은 범위 영역 안.
    expect(doc.child(0).type.name).toBe('paragraph')
    expect(doc.child(0).textContent).toBe('기존 글')
    const style = doc.child(1)
    const wrapper = doc.child(2)
    expect(style.type.name).toBe('wikiStyle')
    expect(wrapper.type.name).toBe('wikiHtmlBox')
    const scope = String(wrapper.attrs.className)
    expect(scope).toMatch(/^wp-import-[a-z0-9]{6}$/)
    expect(wrapper.textContent).toBe('새 글카드')
    // 모든 선택자가 범위로 시작한다(body 는 범위 자신) — 범위 밖 기존 글에는 맞을 수 없다.
    const css = String(style.attrs.css)
    expect(css).toBe(`.${scope} {color:red} .${scope} p {margin:0} .${scope} .card {padding:4px}`)
    for (const rule of css.split('}').map((r) => r.trim()).filter(Boolean)) {
      const selectors = rule.split('{')[0].split(',').map((x) => x.trim())
      for (const sel of selectors) expect(sel.startsWith(`.${scope}`)).toBe(true)
    }
    expect(css).not.toMatch(/(^|[\s}])body\b/)
  })
})

describe('붙여넣기 판정 — 노트끼리 복사·편집기 안 끌기', () => {
  /** 클립보드 흉내 — 형식별 글자. */
  const clip = (data: Record<string, string>) => ({ getData: (t: string) => data[t] ?? '' })

  it('노트 복사 표지가 있으면 text/plain 이 문서 소스여도(HTML 블록·코드 블록 복사) 보통 붙여넣기다', () => {
    const source = '<!doctype html>\n<canvas id="c"></canvas>'
    expect(
      htmlDocumentFromClipboard(clip({ 'text/plain': source, 'text/html': `<pre data-wp-note-copy=""><code>${source.replace(/</g, '&lt;')}</code></pre>` })),
    ).toBeNull()
  })

  it('편집기 안에서 끄는 중(view.dragging)이면 들여오지 않는다', () => {
    const editor = new Editor({ element: document.createElement('div'), extensions: [...wikiSchemaExtensions(), WikiHtmlImportPaste] })
    try {
      const src = '<!doctype html><p>x</p>'
      const event = Object.assign(new Event('paste', { cancelable: true }), {
        clipboardData: { getData: (t: string) => (t === 'text/plain' ? src : '') },
      }) as unknown as ClipboardEvent
      ;(editor.view as unknown as { dragging: unknown }).dragging = { slice: null, move: false }
      const handled = editor.view.someProp('handlePaste', (f) => f(editor.view, event, editor.state.doc.slice(0, 0)))
      expect(handled).toBeFalsy()
      ;(editor.view as unknown as { dragging: unknown }).dragging = null
      expect(editor.view.someProp('handlePaste', (f) => f(editor.view, event, editor.state.doc.slice(0, 0)))).toBe(true)
    } finally {
      editor.destroy()
    }
  })
})

describe('리뷰 보강 — 이스케이프 class·차트 이름·큰 인라인 라이브러리·분석 스크립트·인라인 태그·크기 상한', () => {
  /** 본문만 있는 문서의 body. */
  const bodyOf = (html: string) => new DOMParser().parseFromString(html, 'text/html').body

  it('이스케이프된 class 규칙(md\\:grid-cols-2·w-1\\/2·hover\\:bg-gray-100)이 있으면 그 class 를 남긴다', () => {
    // CSS 를 한 번 훑어 날것·이스케이프를 푼 꼴을 모은다 — 16진 이스케이프(\3a )도 푼다.
    expect(cssClassNames(String.raw`.md\:a{}.w-1\/2,.b .c:hover{} .md\3a x{}`)).toEqual(new Set(['md\\:a', 'md:a', 'w-1\\/2', 'w-1/2', 'b', 'c', 'md\\3a x', 'md:x']))
    const body = bodyOf('<div class="md:grid-cols-2 w-1/2 hover:bg-gray-100 unused card"></div>')
    pruneUnusedClasses(body, '.md\\:grid-cols-2{grid-template-columns:1fr 1fr}.w-1\\/2{width:50%}.hover\\:bg-gray-100:hover{background:#eee}.card{x:1}')
    expect(body.firstElementChild!.getAttribute('class')).toBe('md:grid-cols-2 w-1/2 hover:bg-gray-100 card')
  })

  it('차트 SVG 는 chart·graph·plot 이 class 토큰·하이픈 조각일 때만 — paragraph·typography·graphic 안 SVG 는 대상이 아니다', () => {
    const svg = '<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>'
    const page = (cls: string) =>
      `<html><body><h2>앞</h2><div class="${cls}">${svg}</div><p>뒤</p><script>console.log(1)</script></body></html>`
    for (const cls of ['paragraph', 'typography', 'graphic']) {
      expect(nodeNames(markdownToDoc(convertHtmlToWiki(page(cls)).markdown))).not.toContain('wikiHtmlEmbed')
    }
    for (const cls of ['chart', 'chart-wrap', 'bar-chart', 'graph', 'plot-area']) {
      expect(nodeNames(markdownToDoc(convertHtmlToWiki(page(cls)).markdown))).toContain('wikiHtmlEmbed')
    }
  })

  it('큰 인라인 라이브러리 안의 document.body 는 문서 통째 판정에 쓰지 않는다 — 차트 초기화 스크립트의 대상만 뗀다', () => {
    const lib = `/* lib */ var L=function(){return document.body};${'x=1;'.repeat(6000)}`
    const html = `<html><head><script>${lib}</script></head><body><h1>보고서</h1><p>설명</p><div class="chart-wrap"><canvas id="c"></canvas></div><p>끝</p><script>new L(document.getElementById('c'))</script></body></html>`
    const r = convertHtmlToWiki(html)
    expect(isWholeEmbed(r)).toBe(false)
    const doc = markdownToDoc(r.markdown)
    expect(doc.child(0).textContent).toBe('보고서')
    expect(nodeNames(doc)).toContain('wikiHtmlEmbed')
    expect(findNode(doc, 'wikiHtmlEmbed')!.textContent).toContain('/* lib */')
  })

  it('공통 조상이 글을 많이 품으면 알린다(블록 하나는 그대로)', () => {
    const long = '<p>' + '긴 설명 문장입니다. '.repeat(100) + '</p>'
    const html = `<html><body><h1>t</h1><section><canvas id="a"></canvas>${long}<canvas id="b"></canvas></section><p>밖</p><script>draw()</script></body></html>`
    const r = convertHtmlToWiki(html)
    expect(r.embedCapturedText).toBe(true)
    expect(htmlImportNotice(r)).toContain('차트 영역이 커서 일부 글이 HTML 블록 안에 들어갔습니다')
    expect(convertHtmlToWiki(fixture('chart-doc.html')).embedCapturedText).toBe(false)
  })

  it('문서 통째 HTML 블록에서도 분석·추적 스크립트(주소·인라인 gtag/dataLayer)를 지우고 나머지는 글자 그대로 둔다', () => {
    const html = [
      '<!DOCTYPE html><html><head>',
      '<script src="https://cdn.tailwindcss.com"></script>',
      '<script async src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>',
      "<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('config','G-1')</script>",
      '</head><body class="p-4"><p>본문</p><script>document.querySelector("p").title="x"</script></body></html>',
    ].join('\n')
    const r = convertHtmlToWiki(html)
    expect(isWholeEmbed(r)).toBe(true)
    const src = markdownToDoc(r.markdown).firstChild!.textContent
    expect(src).not.toMatch(/googletagmanager|dataLayer|gtag/)
    expect(src).toContain('<script src="https://cdn.tailwindcss.com"></script>')
    expect(src).toContain('<script>document.querySelector("p").title="x"</script>')
    expect(stripAnalyticsScripts('<p>a</p>')).toBe('<p>a</p>')
  })

  it('del·ins·kbd 등 인라인 태그는 문단을 나누지 않는다 — 「가격 ~~10,000원~~ 8,000원」은 한 문단', () => {
    const r = convertHtmlToWiki('<html><body><div style="padding:4px">가격 <del>10,000원</del> 8,000원 <kbd>Ctrl</kbd> <ruby>漢<rt>한</rt></ruby></div></body></html>')
    const box = markdownToDoc(r.markdown).firstChild!
    expect(box.type.name).toBe('wikiHtmlBox')
    expect(box.childCount).toBe(1)
    expect(r.markdown).toContain('가격 ~~10,000원~~ 8,000원')
  })

  it('5MB 넘는 파일은 읽기 전에 거른다', () => {
    expect(rejectOversizedHtmlFile({ size: HTML_IMPORT_MAX_BYTES })).toBe(false)
    expect(rejectOversizedHtmlFile({ size: HTML_IMPORT_MAX_BYTES + 1 })).toBe(true)
  })
})

describe('Tailwind 정적 내보내기 class (WP-1241 — 스키마 class 허용 글자 확장)', () => {
  // 컴파일된 Tailwind CSS — class 의 : / [ ] ( ) % # 는 선택자에서 역슬래시로 이스케이프된다.
  const CSS = String.raw`.grid{display:grid}.md\:grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.w-1\/2{width:50%}.bg-\[\#0f172a\]{background-color:#0f172a}.w-\[calc\(100\%-2rem\)\]{width:calc(100% - 2rem)}`
  const HTML = `<!doctype html><html><head><title>t</title><style>${CSS}</style></head><body><div class="grid md:grid-cols-2"><div class="w-1/2 bg-[#0f172a]"><p>왼쪽</p></div><div class="w-[calc(100%-2rem)] unused"><p>오른쪽</p></div></div></body></html>`

  it('새 노트 — class 와 이스케이프된 규칙이 그대로 남고 저장 형식이 왕복에서 바뀌지 않는다', () => {
    const r = convertHtmlToWiki(HTML)
    expect(r.markdown).toContain(`<style data-wp-style>\n${CSS}\n</style>`)
    expect(r.markdown).toContain('<div class="grid md:grid-cols-2">')
    expect(r.markdown).toContain('<div class="w-1/2 bg-[#0f172a]">')
    expect(r.markdown).toContain('<div class="w-[calc(100%-2rem)]">')
    const doc = expectStableRoundtrip(r.markdown)
    expect(doc.firstChild!.attrs.css).toBe(CSS)
    expect(findNode(doc, 'wikiHtmlBox')!.attrs.className).toBe('grid md:grid-cols-2')
  })

  it('기존 노트에 넣기 — 범위 접두가 붙은 규칙이 이스케이프 선택자를 그대로 지닌다', () => {
    const r = convertHtmlToWiki(HTML, { scopeClass: 'wp-import-abc123' })
    const doc = expectStableRoundtrip(r.markdown)
    const css = String(doc.firstChild!.attrs.css)
    expect(css).toContain(String.raw`.wp-import-abc123 .md\:grid-cols-2 {grid-template-columns:repeat(2,minmax(0,1fr))}`)
    expect(css).toContain(String.raw`.wp-import-abc123 .w-1\/2 {width:50%}`)
    expect(css).toContain(String.raw`.wp-import-abc123 .w-\[calc\(100\%-2rem\)\] {width:calc(100% - 2rem)}`)
    expect(r.markdown).toContain('<div class="grid md:grid-cols-2">')
  })
})

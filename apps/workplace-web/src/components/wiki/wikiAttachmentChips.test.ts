// @vitest-environment jsdom
import { docToMarkdown, wikiSchemaExtensions } from '@smart-workplace/wiki-editor-schema'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { afterEach, describe, expect, it } from 'vitest'

import { rememberWikiAttachment } from '@/lib/wikiAttachments'

import { collectAttachmentLinkRanges, WikiAttachmentChips } from './wikiAttachmentChips'
import { WikiRevisionDiffHighlight, wikiRevisionDiffKey } from './wikiRevisionPreviewDoc'

// 노트 본문 첨부 칩(WP-1545) — 어느 링크가 칩이 되는지, 원래 글자를 숨기고 칩을 그리는지, 편집 중 커서가 닿으면 원래 글자를
// 드러내는지, 칩이 문서(마크다운)에 들어가지 않는지 브라우저 없이 본다.

const URL_A = '/api/v1/wiki/pages/5/attachments/9/content'
const PUBLIC_URL = '/api/v1/public/wiki/shares/wsh_t/pages/5/attachments/10'

const editors: Editor[] = []
function makeEditor(content: string, editable = false) {
  const editor = new Editor({ extensions: [...wikiSchemaExtensions(), WikiAttachmentChips], content, editable })
  editors.push(editor)
  return editor
}

/** 플러그인 view 가 첫 마운트에 마이크로태스크로 다시 고르는 것을 기다린다. */
const settle = () => new Promise<void>((r) => queueMicrotask(() => queueMicrotask(r)))
const chips = (editor: Editor) => [...editor.view.dom.querySelectorAll<HTMLElement>('[data-testid="wiki-attachment-chip"]')]

afterEach(() => {
  editors.splice(0).forEach((e) => {
    if (!e.isDestroyed) e.destroy()
  })
})

describe('collectAttachmentLinkRanges', () => {
  it('첨부 주소 링크만 자리가 되고, 이름은 링크 글자다', () => {
    const editor = makeEditor(`<p>보고서 <a href="${URL_A}">주간 보고.pdf</a> 와 <a href="https://example.com">바깥</a></p>`)
    const ranges = collectAttachmentLinkRanges(editor.state.doc)
    expect(ranges.map((r) => [r.name, r.link.fileId])).toEqual([['주간 보고.pdf', 9]])
  })
  it('공개 공유 주소도 칩 자리다', () => {
    const editor = makeEditor(`<p><a href="${PUBLIC_URL}">app.log</a></p>`)
    expect(collectAttachmentLinkRanges(editor.state.doc).map((r) => r.link.publicToken)).toEqual(['wsh_t'])
  })
  it('코드 블록 안의 주소는 건너뛴다', () => {
    const editor = makeEditor(`<pre><code>${URL_A}</code></pre>`)
    expect(collectAttachmentLinkRanges(editor.state.doc)).toEqual([])
  })
})

describe('칩 데코레이션', () => {
  it('첨부 링크는 칩(이름)으로 보이고 원래 글자는 숨긴다 — 일반 링크는 그대로 링크다', async () => {
    const editor = makeEditor(`<p><a href="${URL_A}">주간 보고.pdf</a> <a href="https://example.com/x">바깥 링크</a></p>`)
    await settle()
    const [chip] = chips(editor)
    expect(chips(editor)).toHaveLength(1)
    expect(chip.textContent).toBe('주간 보고.pdf')
    expect(chip.getAttribute('role')).toBe('button')
    expect(chip.dataset.url).toBe(URL_A)
    // 칩은 새 탭으로 열리는 링크가 아니다(로그인 경로라 401).
    expect(chip.tagName).toBe('SPAN')
    expect(editor.view.dom.querySelectorAll('[data-wiki-attachment-src]')).toHaveLength(1)
    const outside = editor.view.dom.querySelector<HTMLAnchorElement>('a[href="https://example.com/x"]')
    expect(outside?.textContent).toBe('바깥 링크')
    expect(outside?.closest('[data-wiki-attachment-src]')).toBeNull()
  })

  it('이 화면에서 올린 파일은 크기와 형식 아이콘을 함께 보인다', async () => {
    rememberWikiAttachment({ url: '/api/v1/wiki/pages/5/attachments/77/content', originalName: 'a.zip', mimeType: 'application/zip', sizeBytes: 2048 })
    const editor = makeEditor('<p><a href="/api/v1/wiki/pages/5/attachments/77/content">a.zip</a></p>')
    await settle()
    const [chip] = chips(editor)
    expect(chip.textContent).toBe('a.zip2.0 KB')
    expect(chip.dataset.mimeType).toBe('application/zip')
    expect(chip.querySelector('svg')).not.toBeNull()
  })

  it('편집 중 커서가 링크에 닿으면 원래 글자를 드러내고, 벗어나면 다시 칩이다', async () => {
    const editor = makeEditor(`<p>앞 <a href="${URL_A}">a.pdf</a> 뒤</p>`, true)
    await settle()
    expect(chips(editor)).toHaveLength(1)
    const [r] = collectAttachmentLinkRanges(editor.state.doc)
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, r.from + 1)))
    expect(chips(editor)).toHaveLength(0)
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)))
    expect(chips(editor)).toHaveLength(1)
  })

  it('판 미리보기에서 지운 글자 표시가 링크에 걸리면 칩이 그 표시를 단다', async () => {
    const editor = new Editor({
      extensions: [...wikiSchemaExtensions(), WikiAttachmentChips, WikiRevisionDiffHighlight],
      content: `<p>앞 <a href="${URL_A}">a.pdf</a> 뒤</p>`,
      editable: false,
    })
    editors.push(editor)
    await settle()
    expect(chips(editor)[0].classList.contains('wiki-diff-removed')).toBe(false)
    const [r] = collectAttachmentLinkRanges(editor.state.doc)
    const diff = DecorationSet.create(editor.state.doc, [
      Decoration.inline(r.from, r.to, { class: 'wiki-diff-removed' }, { kind: 'removed-text' }),
    ])
    editor.view.dispatch(editor.state.tr.setMeta(wikiRevisionDiffKey, diff))
    expect(chips(editor)[0].classList.contains('wiki-diff-removed')).toBe(true)
    // 이웃 글자(링크 밖)에만 걸린 표시는 칩에 옮기지 않는다.
    const beside = DecorationSet.create(editor.state.doc, [
      Decoration.inline(1, r.from, { class: 'wiki-diff-removed' }, { kind: 'removed-text' }),
    ])
    editor.view.dispatch(editor.state.tr.setMeta(wikiRevisionDiffKey, beside))
    expect(chips(editor)[0].classList.contains('wiki-diff-removed')).toBe(false)
  })

  it('칩은 문서에 들어가지 않는다 — 마크다운은 링크 그대로다', async () => {
    const editor = makeEditor(`<p><a href="${URL_A}">a.pdf</a></p>`)
    await settle()
    expect(docToMarkdown(editor.state.doc).trim()).toBe(`[a.pdf](${URL_A})`)
  })
})

// WP-1304 — 상자 꾸미기 창과 페이지 스타일 고치기 창. 실제 편집기(동시 편집 확장 포함)를 띄워 상자 막대 「꾸미기」로 창을 열고,
// 미리 만든 모양·견본·세그먼트를 누르면 상자 노드 style 이 바뀌어 동료 문서에도 가는지, 한 번 바꾸기가 실행 취소 한 번인지,
// 「CSS 로 직접 고치기」·페이지 스타일 칩 창이 정리기를 거쳐 위험 값을 빼는지 본다. style 글자 계산 자체는 wikiBoxStyle.test.ts.
import { COLLAB_FRAGMENT, wikiSchemaExtensions } from '@smart-workplace/wiki-editor-schema'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import { NodeSelection } from '@tiptap/pm/state'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { type ReactNode, useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { link } from './collabTestHarness'
import { BOX_BASIC_STYLE, BOX_EMPTY_STYLE, selectedBox, WikiBox, writeSelectedBoxStyle } from './wikiBox'
import { BOX_BACKGROUNDS, BOX_COLORS, BOX_PRESETS } from './wikiBoxStyle'
import { WikiBoxToolbar } from './WikiBoxToolbar'
import { WikiPageStyleDialog } from './WikiPageStyleDialog'
import { wikiRenderExtensions } from './wikiRenderExtensions'

// 떠 있는 막대(tiptap BubbleMenu)는 tippy 를 jsdom 에서 띄우지 못한다 — 같은 shouldShow 로 보일지만 정하는 막대로 바꾼다.
// 막대 배치·실제 누르기는 E2E(wiki-box.spec.ts)가 본다.
vi.mock('@/components/editor/EditorFloatingToolbar', () => ({
  EditorFloatingToolbar: ({
    editor,
    shouldShow,
    testId,
    children,
  }: {
    editor: Editor | null
    shouldShow: (p: { editor: Editor; state: Editor['state'] }) => boolean
    testId: string
    children: ReactNode
  }) => {
    const show = useEditorState({ editor, selector: ({ editor: ed }) => (ed ? shouldShow({ editor: ed, state: ed.state }) : false) })
    return show ? <div data-testid={testId}>{children}</div> : null
  },
  EditorToolbarDivider: () => <span />,
}))

const peers: Editor[] = []
afterEach(() => {
  peers.splice(0).forEach((e) => e.destroy())
})

const preset = (key: string) => BOX_PRESETS.find((p) => p.key === key)!.style
const BOX_MD = ['앞 글', '', `<div style="${BOX_BASIC_STYLE}">`, '', '상자 글', '', '</div>', '', '뒤 글'].join('\n')

/** 노트 편집기와 같은 렌더 확장 + 상자 확장 + 동시 편집(Y.Doc). 상자 막대·페이지 스타일 창을 함께 띄운다. */
function Note({ doc, onEditor }: { doc: Y.Doc; onEditor: (e: Editor) => void }) {
  const editor = useEditor(
    { extensions: [...wikiRenderExtensions(), WikiBox, Collaboration.configure({ document: doc, field: COLLAB_FRAGMENT })] },
    [],
  )
  useEffect(() => {
    if (editor) onEditor(editor)
  }, [editor, onEditor])
  return (
    <div>
      <WikiBoxToolbar editor={editor} disabled={false} />
      <WikiPageStyleDialog editor={editor} disabled={false} />
      <EditorContent editor={editor} className="wiki-editor" />
    </div>
  )
}

/** 편집기를 띄우고 본문을 채운다. 동료 편집기(peer)가 같은 문서를 이어 받는다. */
async function mount(markdown: string) {
  const doc = new Y.Doc()
  const peerDoc = new Y.Doc()
  link(doc, peerDoc)
  let ed: Editor | null = null
  render(<Note doc={doc} onEditor={(e) => (ed = e)} />)
  await waitFor(() => expect(ed).not.toBeNull())
  act(() => {
    ed!.commands.setContent(markdown)
  })
  const peer = new Editor({ extensions: [...wikiSchemaExtensions(), Collaboration.configure({ document: peerDoc, field: COLLAB_FRAGMENT })] })
  peers.push(peer)
  return { ed: ed!, peer }
}

/** 첫 노드(이름)의 앞 위치. */
const posOf = (ed: Editor, name: string) => {
  let at = -1
  ed.state.doc.descendants((n, pos) => {
    if (at < 0 && n.type.name === name) at = pos
    return at < 0
  })
  return at
}
const boxStyle = (ed: Editor) => ed.state.doc.nodeAt(posOf(ed, 'wikiHtmlBox'))?.attrs.style as string

/** 상자를 통째 선택하고(테두리 누르기와 같다) 상자 막대 「꾸미기」로 창을 연다. */
async function openPanel(ed: Editor) {
  act(() => {
    ed.view.focus()
    ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, posOf(ed, 'wikiHtmlBox'))))
  })
  const toggle = await screen.findByTestId('wiki-box-style')
  expect(toggle).toBeEnabled()
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(toggle)
  const panel = await screen.findByTestId('wiki-box-style-panel')
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  return panel
}

const click = (testId: string) => act(() => fireEvent.click(screen.getByTestId(testId)))

describe('상자 꾸미기 창', () => {
  it('막대 「꾸미기」로 열리고, 미리 만든 모양을 고르면 상자 style 이 그 묶음이 되어 동료 문서·저장본에도 간다', async () => {
    const { ed, peer } = await mount(BOX_MD)
    const panel = await openPanel(ed)
    expect(within(panel).getByText('상자 꾸미기')).toBeInTheDocument()
    // 새 상자는 「기본」 — 지금 값이 눌린 상태로 보인다.
    expect(screen.getByTestId('wiki-box-style-preset-basic')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('wiki-box-style-border-thin')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('wiki-box-style-padding-normal')).toHaveAttribute('aria-pressed', 'true')

    click('wiki-box-style-preset-info')
    expect(boxStyle(ed)).toBe(preset('info'))
    expect(screen.getByTestId('wiki-box-style-preset-info')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('wiki-box-style-preset-basic')).toHaveAttribute('aria-pressed', 'false')
    // 상자는 계속 통째 선택이라 막대·창이 그대로다.
    expect(selectedBox(ed.state)).not.toBeNull()
    // 동료 문서와 저장본(마크다운)에 같은 style.
    expect(boxStyle(peer)).toBe(preset('info'))
    const md = (ed.storage as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()
    expect(md).toContain(`<div style="${preset('info')}">`)
  })

  it('배경·글자색 견본과 테두리·모서리·여백·그림자 세그먼트가 각각 style 을 바꾸고 눌린 값이 따라간다', async () => {
    const { ed } = await mount(BOX_MD)
    await openPanel(ed)
    click('wiki-box-style-bg-yellow')
    expect(boxStyle(ed)).toContain(`background: ${BOX_BACKGROUNDS.find((s) => s.key === 'yellow')!.value}`)
    expect(screen.getByTestId('wiki-box-style-bg-yellow')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('wiki-box-style-bg-none')).toHaveAttribute('aria-pressed', 'false')
    click('wiki-box-style-color-brown')
    expect(boxStyle(ed)).toContain(`color: ${BOX_COLORS.find((s) => s.key === 'brown')!.value}`)
    click('wiki-box-style-border-thick')
    expect(boxStyle(ed)).toContain('border: 2px solid var(--border, #e5e7eb)')
    click('wiki-box-style-radius-square')
    expect(boxStyle(ed)).not.toContain('border-radius')
    click('wiki-box-style-padding-wide')
    expect(boxStyle(ed)).toContain('padding: 20px 24px')
    click('wiki-box-style-shadow-has')
    expect(boxStyle(ed)).toContain('box-shadow')
    for (const id of ['border-thick', 'radius-square', 'padding-wide', 'shadow-has', 'color-brown']) {
      expect(screen.getByTestId(`wiki-box-style-${id}`)).toHaveAttribute('aria-pressed', 'true')
    }
    // 여러 항목을 바꿔 묶음과 달라지면 어떤 모양도 눌려 있지 않다.
    expect(screen.getByTestId('wiki-box-style-preset-basic')).toHaveAttribute('aria-pressed', 'false')
    // 「없음」은 배경 선언을 지운다.
    click('wiki-box-style-bg-none')
    expect(boxStyle(ed)).not.toContain('background')
  })

  it('한 번 바꾸기는 실행 취소 한 번에 하나씩 돌아간다(연달아 눌러도 묶이지 않는다)', async () => {
    const { ed } = await mount(BOX_MD)
    await openPanel(ed)
    click('wiki-box-style-preset-warning')
    click('wiki-box-style-shadow-has')
    const both = boxStyle(ed)
    expect(both).toContain('box-shadow')
    act(() => {
      ed.commands.undo()
    })
    expect(boxStyle(ed)).toBe(preset('warning'))
    act(() => {
      ed.commands.undo()
    })
    expect(boxStyle(ed)).toBe(BOX_BASIC_STYLE)
  })

  it('Esc 는 창만 닫고 상자 통째 선택으로 돌아간다(편집기에 포커스가 있어도)', async () => {
    const { ed } = await mount(BOX_MD)
    await openPanel(ed)
    act(() => {
      fireEvent.keyDown(ed.view.dom, { key: 'Escape' })
    })
    await waitFor(() => expect(screen.queryByTestId('wiki-box-style-panel')).toBeNull())
    expect(selectedBox(ed.state)?.pos).toBe(posOf(ed, 'wikiHtmlBox'))
    expect(screen.getByTestId('wiki-box-style')).toHaveAttribute('aria-expanded', 'false')
  })

  it('창 안 단추에 포커스가 있을 때(키보드 Tab) Esc 도 창을 닫는다', async () => {
    const { ed } = await mount(BOX_MD)
    await openPanel(ed)
    const button = screen.getByTestId('wiki-box-style-shadow-has')
    act(() => {
      button.focus()
      fireEvent.keyDown(button, { key: 'Escape' })
    })
    await waitFor(() => expect(screen.queryByTestId('wiki-box-style-panel')).toBeNull())
    expect(selectedBox(ed.state)).not.toBeNull()
  })

  it('상자 선택이 풀리면 창이 닫힌다', async () => {
    const { ed } = await mount(BOX_MD)
    await openPanel(ed)
    act(() => {
      ed.commands.setTextSelection(2)
    })
    await waitFor(() => expect(screen.queryByTestId('wiki-box-style-panel')).toBeNull())
  })

  it('창을 연 채 다른 상자를 고르면 창이 닫힌다 — 앞 상자의 CSS 칸이 새 상자에 덮어써지지 않게', async () => {
    const two = [BOX_MD, '', `<div style="${BOX_BASIC_STYLE}">`, '', '둘째 상자', '', '</div>'].join('\n')
    const { ed } = await mount(two)
    await openPanel(ed)
    click('wiki-box-style-css-open')
    let second = -1
    ed.state.doc.descendants((n, pos) => {
      if (n.type.name === 'wikiHtmlBox' && pos !== posOf(ed, 'wikiHtmlBox')) second = pos
      return true
    })
    expect(second).toBeGreaterThan(0)
    act(() => {
      ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, second)))
    })
    await waitFor(() => expect(screen.queryByTestId('wiki-box-style-panel')).toBeNull())
  })

  it('동료 편집으로 상자 위치가 옮겨져도 창은 열린 채 남는다', async () => {
    const { ed, peer } = await mount(BOX_MD)
    await openPanel(ed)
    act(() => {
      peer.commands.insertContentAt(0, '<p>동료 줄</p>')
    })
    expect(screen.getByTestId('wiki-box-style-panel')).toBeInTheDocument()
    click('wiki-box-style-preset-info')
    expect(boxStyle(ed)).toBe(preset('info'))
  })

  it('CSS 로 직접 고치기 — 지금 style 이 줄마다 채워지고, 위험한 값(url(javascript:)·expression()은 빼고 적용한 뒤 뺀 수를 알린다', async () => {
    const { ed, peer } = await mount(BOX_MD)
    await openPanel(ed)
    click('wiki-box-style-css-open')
    const input = screen.getByTestId('wiki-box-style-css-input') as HTMLTextAreaElement
    expect(input.value).toBe('border: 1px solid var(--border, #e5e7eb);\nborder-radius: 8px;\npadding: 12px 16px;')
    fireEvent.change(input, {
      target: { value: 'color: red;\nbackground: url(javascript:alert(1));\nwidth: expression(alert(1));\npadding: 4px;' },
    })
    click('wiki-box-style-css-apply')
    expect(boxStyle(ed)).toBe('color: red; padding: 4px')
    expect(boxStyle(peer)).toBe('color: red; padding: 4px')
    expect(screen.getByTestId('wiki-box-style-css-note')).toHaveTextContent('쓸 수 없는 값 2개를 뺐습니다')
    // 칸에는 남은 선언만 보인다 — 무엇이 빠졌는지 보이게.
    expect((screen.getByTestId('wiki-box-style-css-input') as HTMLTextAreaElement).value).toBe('color: red;\npadding: 4px;')
    // 뺄 것이 없으면 적용하고 항목 화면으로 돌아간다.
    fireEvent.change(screen.getByTestId('wiki-box-style-css-input'), { target: { value: 'color: blue' } })
    click('wiki-box-style-css-apply')
    expect(boxStyle(ed)).toBe('color: blue')
    expect(screen.queryByTestId('wiki-box-style-css')).toBeNull()
    expect(screen.getByTestId('wiki-box-style-preset-basic')).toBeInTheDocument()
  })

  it('CSS 로 직접 고치기 — Esc·취소는 바꾸지 않고 항목 화면으로, 다 지워도 상자는 남는다', async () => {
    const { ed } = await mount(BOX_MD)
    await openPanel(ed)
    click('wiki-box-style-css-open')
    const input = screen.getByTestId('wiki-box-style-css-input')
    fireEvent.change(input, { target: { value: 'color: red' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(boxStyle(ed)).toBe(BOX_BASIC_STYLE)
    expect(screen.getByTestId('wiki-box-style-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('wiki-box-style-css')).toBeNull()

    click('wiki-box-style-css-open')
    fireEvent.change(screen.getByTestId('wiki-box-style-css-input'), { target: { value: '' } })
    click('wiki-box-style-css-apply')
    // 빈 style 은 자리 지킴 선언 — 다시 읽어도 상자다.
    expect(boxStyle(ed)).toBe('display: block')
    const md = (ed.storage as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()
    const again = new Editor({ extensions: wikiSchemaExtensions(), content: md })
    peers.push(again)
    expect(posOf(again, 'wikiHtmlBox')).toBeGreaterThanOrEqual(0)
  })
})

describe('writeSelectedBoxStyle — 상자 style 저장 한곳', () => {
  it('넘긴 글자를 정리기에 거쳐 저장하고, 비면 자리 지킴 선언을 둔다 — 저장한 글자를 돌려준다', async () => {
    const { ed } = await mount(BOX_MD)
    act(() => {
      ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, posOf(ed, 'wikiHtmlBox'))))
    })
    let stored: string | null = null
    act(() => {
      stored = writeSelectedBoxStyle(ed, () => 'background: url(javascript:alert(1)); color: red')
    })
    expect(stored).toBe('color: red')
    expect(boxStyle(ed)).toBe('color: red')
    act(() => {
      stored = writeSelectedBoxStyle(ed, () => 'width: expression(alert(1))')
    })
    expect(stored).toBe(BOX_EMPTY_STYLE)
    expect(boxStyle(ed)).toBe(BOX_EMPTY_STYLE)
    // 상자가 선택돼 있지 않으면 저장하지 않는다.
    act(() => {
      ed.commands.setTextSelection(2)
      stored = writeSelectedBoxStyle(ed, () => 'color: blue')
    })
    expect(stored).toBeNull()
    expect(boxStyle(ed)).toBe(BOX_EMPTY_STYLE)
  })
})

describe('페이지 스타일 고치기 창', () => {
  const STYLE_MD = ['<style data-wp-style>', '.card { color: red; }', '</style>', '', '본문'].join('\n')
  const css = (ed: Editor) => ed.state.doc.nodeAt(posOf(ed, 'wikiStyle'))?.attrs.css as string

  it('칩 「페이지 스타일」을 누르면 CSS 가 채워진 창이 열리고, 적용은 정리기를 거쳐 위험 값을 빼고 알린다', async () => {
    const { ed, peer } = await mount(STYLE_MD)
    const chip = ed.view.dom.querySelector('[data-testid="wiki-style-chip"]') as HTMLElement
    act(() => {
      ;(chip.querySelector('button[title="페이지 스타일 고치기"]') as HTMLButtonElement).click()
    })
    const dialog = await screen.findByTestId('wiki-page-style-dialog')
    const input = within(dialog).getByTestId('wiki-page-style-css-input') as HTMLTextAreaElement
    expect(input.value).toBe('.card { color: red; }')
    fireEvent.change(input, { target: { value: '@import url(https://x.test/a.css);\n.card { color: blue; background: url(javascript:alert(1)); }' } })
    click('wiki-page-style-css-apply')
    expect(css(ed)).not.toContain('javascript')
    expect(css(ed)).not.toContain('@import')
    expect(css(ed)).toContain('color: blue')
    expect(css(peer)).toBe(css(ed))
    expect(within(dialog).getByTestId('wiki-page-style-css-note')).toHaveTextContent('쓸 수 없는 값을 뺐습니다')
    // 안전한 CSS 는 적용하고 창을 닫는다.
    fireEvent.change(within(dialog).getByTestId('wiki-page-style-css-input'), { target: { value: '.card { color: green; }' } })
    click('wiki-page-style-css-apply')
    expect(css(ed)).toBe('.card { color: green; }')
    await waitFor(() => expect(screen.queryByTestId('wiki-page-style-dialog')).toBeNull())
  })

  it('창을 연 사이 동료 편집으로 페이지 스타일 위치가 옮겨져도 적용된다', async () => {
    const { ed, peer } = await mount(STYLE_MD)
    const chip = ed.view.dom.querySelector('[data-testid="wiki-style-chip"]') as HTMLElement
    act(() => {
      ;(chip.querySelector('button[title="페이지 스타일 고치기"]') as HTMLButtonElement).click()
    })
    const input = await screen.findByTestId('wiki-page-style-css-input')
    act(() => {
      peer.commands.insertContentAt(0, '<p>동료 줄</p>')
    })
    expect(posOf(ed, 'wikiStyle')).toBeGreaterThan(0)
    fireEvent.change(input, { target: { value: '.card { color: green; }' } })
    click('wiki-page-style-css-apply')
    expect(css(ed)).toBe('.card { color: green; }')
  })

  it('페이지 CSS 적용은 실행 취소 한 단계로 따로 돌아간다 — 바로 앞 글자 입력과 묶이지 않는다', async () => {
    const { ed } = await mount(STYLE_MD)
    const chip = ed.view.dom.querySelector('[data-testid="wiki-style-chip"]') as HTMLElement
    act(() => {
      ;(chip.querySelector('button[title="페이지 스타일 고치기"]') as HTMLButtonElement).click()
    })
    const input = await screen.findByTestId('wiki-page-style-css-input')
    // 본문에 글자를 치고 곧바로(실행 취소 묶음 시간 0.5초 안) 페이지 CSS 를 적용한다.
    act(() => {
      ed.commands.insertContentAt(ed.state.doc.content.size - 1, '추가')
    })
    expect(ed.state.doc.textContent).toContain('본문추가')
    fireEvent.change(input, { target: { value: '.card { color: green; }' } })
    click('wiki-page-style-css-apply')
    expect(css(ed)).toBe('.card { color: green; }')
    act(() => {
      ed.commands.undo()
    })
    // 페이지 CSS 만 돌아가고 친 글자는 남는다.
    expect(css(ed)).toBe('.card { color: red; }')
    expect(ed.state.doc.textContent).toContain('본문추가')
    act(() => {
      ed.commands.undo()
    })
    expect(ed.state.doc.textContent).not.toContain('추가')
  })

  it('취소는 바꾸지 않고 닫고, ✕ 는 그대로 페이지 스타일을 지운다', async () => {
    const { ed } = await mount(STYLE_MD)
    const chip = () => ed.view.dom.querySelector('[data-testid="wiki-style-chip"]') as HTMLElement
    act(() => {
      ;(chip().querySelector('button[title="페이지 스타일 고치기"]') as HTMLButtonElement).click()
    })
    fireEvent.change(await screen.findByTestId('wiki-page-style-css-input'), { target: { value: '.x{}' } })
    click('wiki-page-style-css-cancel')
    await waitFor(() => expect(screen.queryByTestId('wiki-page-style-dialog')).toBeNull())
    expect(css(ed)).toBe('.card { color: red; }')
    act(() => {
      ;(chip().querySelector('button[aria-label="페이지 스타일 지우기"]') as HTMLButtonElement).click()
    })
    expect(posOf(ed, 'wikiStyle')).toBe(-1)
  })
})

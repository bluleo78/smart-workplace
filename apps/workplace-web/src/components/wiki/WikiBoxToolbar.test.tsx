// WP-1482 — 상자 막대의 「AI 지시로 바꾸기 / 일반 상자로」 전환 단추. 일반 상자를 통째 선택하면 「AI 지시로 바꾸기」가 뜨고,
// 누르면 상자 className 이 지시가 되며 단추 글자가 「일반 상자로」로 바뀌고, 다시 누르면 되돌아간다.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { BOX_BASIC_STYLE, WikiBox } from './wikiBox'
import { WikiBoxToolbar } from './WikiBoxToolbar'
import { wikiRenderExtensions } from './wikiRenderExtensions'

// 떠 있는 막대는 jsdom 에서 못 띄우므로 같은 shouldShow 로 보일지만 정하는 막대로 바꾼다(WikiBoxStylePanel.test.tsx 와 같다).
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

const BOX_MD = ['앞 글', '', `<div style="${BOX_BASIC_STYLE}">`, '', '상자 글', '', '</div>'].join('\n')

function Note({ onEditor }: { onEditor: (e: Editor) => void }) {
  const editor = useEditor({ extensions: [...wikiRenderExtensions(), WikiBox], content: BOX_MD }, [])
  if (editor) onEditor(editor)
  return (
    <div>
      <WikiBoxToolbar editor={editor} disabled={false} />
      <EditorContent editor={editor} />
    </div>
  )
}

const boxAt = (ed: Editor) => {
  let hit: { pos: number; className: string | null } | null = null
  ed.state.doc.descendants((n, pos) => {
    if (!hit && n.type.name === 'wikiHtmlBox') hit = { pos, className: n.attrs.className as string | null }
    return !hit
  })
  return hit!
}

describe('상자 막대 — AI 지시 전환', () => {
  it('일반 상자는 「AI 지시로 바꾸기」, 누르면 지시 상자가 되고 글자가 「일반 상자로」로 바뀐다', async () => {
    let ed: Editor | null = null
    render(<Note onEditor={(e) => (ed = e)} />)
    act(() => {
      ed!.view.dispatch(ed!.state.tr.setSelection(NodeSelection.create(ed!.state.doc, boxAt(ed!).pos)))
    })
    const btn = await screen.findByTestId('wiki-box-ai-instruction')
    expect(btn).toHaveTextContent('AI 지시로 바꾸기')
    fireEvent.click(btn)
    expect(boxAt(ed!).className).toContain('wp-ai-instruction')
    expect(screen.getByTestId('wiki-box-ai-instruction')).toHaveTextContent('일반 상자로')
    fireEvent.click(screen.getByTestId('wiki-box-ai-instruction'))
    expect(boxAt(ed!).className ?? '').not.toContain('wp-ai-instruction')
    expect(screen.getByTestId('wiki-box-ai-instruction')).toHaveTextContent('AI 지시로 바꾸기')
  })
})

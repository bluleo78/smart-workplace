// 메일 표 막대(WP-1524) — 표 안 커서에서만 일곱 명령이 보이고, 노트와 같은 가드·동작인지 실제 Tiptap 에디터로 본다.
// 데스크톱 떠 있는 막대(BubbleMenu)는 jsdom 에서 tippy 표시를 잴 수 없어 명령·가드는 touch 경로로 보고, 위치는 E2E(@layout)가 본다.
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect } from 'react'
import { describe, expect, it } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import { MAIL_MOBILE_ABOVE_FORMAT_BAR_CLASS } from './mailMobileBars'
import { insertMailTable, MAIL_TABLE_EXTENSIONS } from './mailTable'
import { MailTableToolbar } from './MailTableToolbar'

/** 작성창과 같은 표 확장으로 띄운 에디터 + 표 막대(touch). */
function Harness({ onReady }: { onReady: (e: Editor) => void }) {
  const editor = useEditor({ extensions: [StarterKit, ...MAIL_TABLE_EXTENSIONS], content: '<p>앞</p>' })
  useEffect(() => {
    if (editor) onReady(editor)
  }, [editor, onReady])
  if (!editor) return null
  // 작성창처럼 감싸개 div 안에 둔다 — BubbleMenu 는 자기 DOM 을 떼어 내므로 컨테이너 바로 아래면 정리 때 React 가 그 노드를 지우다 던진다.
  return (
    <div>
      <MailTableToolbar editor={editor} touch />
      <EditorContent editor={editor} />
    </div>
  )
}

/** 막대와 에디터를 띄운다. */
async function setup() {
  let editor: Editor | null = null
  const user = userEvent.setup()
  renderWithProviders(
    <Harness
      onReady={(e) => {
        editor = e
      }}
    />,
  )
  await waitFor(() => expect(editor).not.toBeNull())
  return { user, editor: editor as unknown as Editor }
}

/** 문서에서 n 번째(0부터) 셀 안 첫 글자 자리 — 머리글(th)·본문(td) 순서대로 센다. */
function cellPos(editor: Editor, n: number): number {
  const positions: number[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') positions.push(pos + 2)
  })
  return positions[n]
}

/** 표 밖 「앞」 문단 안 자리 — 표를 넣은 위치(앞·뒤)와 무관하게 찾는다. */
function outsidePos(editor: Editor): number {
  let found = -1
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name === 'paragraph' && node.textContent === '앞') found = offset + 1
  })
  return found
}

/** 막대 안 단추의 aria-label 을 DOM 순서대로. */
function labels() {
  return within(screen.getByTestId('mail-table-toolbar'))
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label'))
}

const ALL_LABELS = ['위에 행 삽입', '아래에 행 삽입', '왼쪽에 열 삽입', '오른쪽에 열 삽입', '행 삭제', '열 삭제', '표 삭제']

describe('MailTableToolbar', () => {
  it('표 밖이면 막대가 없고, 표 안에 커서를 두면 일곱 명령이 보인다', async () => {
    const { editor } = await setup()
    expect(screen.queryByTestId('mail-table-toolbar')).toBeNull()
    // 2×2 표(첫 행 머리글)를 넣고 본문 셀(세 번째 셀)에 커서를 둔다.
    act(() => {
      insertMailTable(editor, 2, 2)
      editor.commands.setTextSelection(cellPos(editor, 2))
    })
    expect(labels()).toEqual(ALL_LABELS)
    // 고정 줄은 서식 줄 바로 위 자리(safe-area 여백까지 더한 offset)를 쓴다 — 노치 아이폰에서 서식 줄을 덮지 않게.
    const rowClass = screen.getByTestId('mail-table-toolbar').className
    for (const c of MAIL_MOBILE_ABOVE_FORMAT_BAR_CLASS.split(' ')) expect(rowClass.split(' ')).toContain(c)
    expect(rowClass).toContain('env(safe-area-inset-bottom)')
    for (const label of ALL_LABELS) expect(screen.getByRole('button', { name: label })).toBeEnabled()
    // 삭제 3종만 파괴적 색이다.
    expect(screen.getByRole('button', { name: '표 삭제' }).className).toContain('text-destructive')
    expect(screen.getByRole('button', { name: '위에 행 삽입' }).className).not.toContain('text-destructive')
    // 표 밖(「앞」 문단)으로 나가면 사라진다.
    const outside = outsidePos(editor)
    expect(outside).toBeGreaterThan(0)
    act(() => {
      editor.commands.setTextSelection(outside)
    })
    expect(screen.queryByTestId('mail-table-toolbar')).toBeNull()
  })

  it('머리글 행에서는 행 삭제가 꺼진다(노트와 같은 가드)', async () => {
    const { editor } = await setup()
    act(() => {
      insertMailTable(editor, 2, 2)
      editor.commands.setTextSelection(cellPos(editor, 0))
    })
    expect(screen.getByRole('button', { name: '행 삭제' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '열 삭제' })).toBeEnabled()
  })

  it('오른쪽에 열 삽입을 누르면 머리글·본문 행 모두 칸이 하나 는다', async () => {
    const { user, editor } = await setup()
    act(() => {
      insertMailTable(editor, 2, 2)
      editor.commands.setTextSelection(cellPos(editor, 2))
    })
    await user.click(screen.getByRole('button', { name: '오른쪽에 열 삽입' }))
    const html = editor.getHTML()
    expect(html.match(/<th /g)).toHaveLength(3)
    expect(html.match(/<td /g)).toHaveLength(3)
  })

  it('표 삭제를 누르면 표가 사라지고 막대도 사라진다', async () => {
    const { user, editor } = await setup()
    act(() => {
      insertMailTable(editor, 2, 2)
      editor.commands.setTextSelection(cellPos(editor, 2))
    })
    await user.click(screen.getByRole('button', { name: '표 삭제' }))
    expect(editor.getHTML()).not.toContain('<table')
    expect(screen.queryByTestId('mail-table-toolbar')).toBeNull()
  })
})

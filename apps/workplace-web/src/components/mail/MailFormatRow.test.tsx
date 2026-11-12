// 메일 작성 서식 둘째 줄(WP-1524) — 묶음 순서·색·글꼴·정렬·내어쓰기 가드·표 넣기를 실제 Tiptap 에디터로 본다.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect } from 'react'
import { describe, expect, it } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import { MAIL_FORMAT_EXTENSIONS } from './mailFormatExtensions'
import { MailFormatRow } from './MailFormatRow'
import { MAIL_TABLE_EXTENSIONS } from './mailTable'

/** 작성창과 같은 확장으로 띄운 에디터 + 서식 줄. 첫 글자를 골라 둔 채로 시작한다. */
function Harness({ layout, onReady }: { layout: 'dock' | 'fill'; onReady: (e: Editor) => void }) {
  const editor = useEditor({
    extensions: [StarterKit, ...MAIL_FORMAT_EXTENSIONS, ...MAIL_TABLE_EXTENSIONS],
    content: '<p>Hello</p>',
  })
  useEffect(() => {
    if (!editor) return
    editor.commands.setTextSelection({ from: 1, to: 2 })
    onReady(editor)
  }, [editor, onReady])
  if (!editor) return null
  return (
    <>
      <MailFormatRow editor={editor} layout={layout} />
      <EditorContent editor={editor} />
    </>
  )
}

/** 서식 줄을 띄우고 에디터를 돌려준다. */
async function setup(layout: 'dock' | 'fill' = 'dock') {
  let editor: Editor | null = null
  const user = userEvent.setup()
  renderWithProviders(
    <Harness
      layout={layout}
      onReady={(e) => {
        editor = e
      }}
    />,
  )
  await waitFor(() => expect(editor).not.toBeNull())
  return { user, editor: editor as unknown as Editor }
}

/** 서식 줄 안 단추의 aria-label 을 DOM 순서대로. */
function labels() {
  const row = screen.getByTestId('mail-composer-format-row')
  return within(row)
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label'))
}

/** 서식 줄 안 이름이 label 인 단추. */
function btn(label: string) {
  return within(screen.getByTestId('mail-composer-format-row')).getByRole('button', { name: label })
}

describe('MailFormatRow', () => {
  it('세 묶음이 순서대로 보인다(배경색은 글자색 뒤)', async () => {
    await setup()
    expect(labels()).toEqual([
      '글꼴',
      '글자 크기',
      '밑줄',
      '글자색',
      '배경색',
      '정렬',
      '내어쓰기',
      '들여쓰기',
      '줄 간격',
      '표 넣기',
      '서식 지우기',
    ])
    // 묶음 사이 세로 구분선 둘.
    const row = screen.getByTestId('mail-composer-format-row')
    expect(row.querySelectorAll('[data-slot="separator"][data-orientation="vertical"]')).toHaveLength(2)
    expect(btn('글꼴')).toHaveTextContent('기본')
    expect(btn('글자 크기')).toHaveTextContent('보통')
  })

  it('글자색 메뉴에서 빨강을 고르면 본문 HTML 에 #dc2626 이 실린다', async () => {
    const { user, editor } = await setup()
    await user.click(btn('글자색'))
    const items = screen.getAllByRole('menuitem')
    expect(items).toHaveLength(8)
    expect(items[0]).toHaveAccessibleName('글자색 기본')
    await user.click(screen.getByRole('menuitem', { name: '글자색 빨강' }))
    expect(editor.getHTML()).toContain('color: #dc2626')
  })

  it('배경색 메뉴에서 노랑을 고르면 mark 16진값이 실린다', async () => {
    const { user, editor } = await setup()
    await user.click(btn('배경색'))
    await user.click(screen.getByRole('menuitem', { name: '배경색 노랑' }))
    expect(editor.getHTML()).toContain('background-color: #fef08a')
  })

  it('밑줄을 누르면 <u> 로 감싸고 단추가 눌림 상태가 된다', async () => {
    const { user, editor } = await setup()
    expect(btn('밑줄')).toHaveAttribute('aria-pressed', 'false')
    await user.click(btn('밑줄'))
    expect(editor.getHTML()).toContain('<u>H</u>')
    await waitFor(() => expect(btn('밑줄')).toHaveAttribute('aria-pressed', 'true'))
  })

  it('글꼴을 고르면 단추 글자가 그 이름으로 바뀐다', async () => {
    const { user, editor } = await setup()
    await user.click(btn('글꼴'))
    const item = screen.getByRole('menuitemradio', { name: '맑은 고딕' })
    // 메뉴 항목은 그 글꼴로 그린다.
    expect(item.style.fontFamily).toContain('Malgun Gothic')
    await user.click(item)
    expect(editor.getHTML()).toContain('font-family:')
    await waitFor(() => expect(btn('글꼴')).toHaveTextContent('맑은 고딕'))
  })

  it('글자 크기를 고르면 px 로 실리고 단추 글자가 바뀐다', async () => {
    const { user, editor } = await setup()
    await user.click(btn('글자 크기'))
    await user.click(screen.getByRole('menuitemradio', { name: '크게' }))
    expect(editor.getHTML()).toContain('font-size: 18px')
    await waitFor(() => expect(btn('글자 크기')).toHaveTextContent('크게'))
  })

  it('정렬 메뉴에서 가운데 → text-align: center, 지금 값에 체크', async () => {
    const { user, editor } = await setup()
    await user.click(btn('정렬'))
    expect(screen.getByRole('menuitemradio', { name: '왼쪽' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('menuitemradio', { name: '가운데' }))
    expect(editor.getHTML()).toContain('text-align: center')
    await user.click(btn('정렬'))
    expect(screen.getByRole('menuitemradio', { name: '가운데' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: '왼쪽' })).toHaveAttribute('aria-checked', 'false')
  })

  it('줄 간격 메뉴는 4개이고 고르면 line-height 가 실린다', async () => {
    const { user, editor } = await setup()
    await user.click(btn('줄 간격'))
    expect(screen.getAllByRole('menuitemradio').map((i) => i.textContent)).toEqual(['1.0', '1.15', '1.5', '2.0'])
    await user.click(screen.getByRole('menuitemradio', { name: '1.5' }))
    expect(editor.getHTML()).toContain('line-height: 1.5')
  })

  it('0단 문단에서는 내어쓰기가 꺼져 있다', async () => {
    const { user, editor } = await setup()
    expect(btn('내어쓰기')).toBeDisabled()
    await user.click(btn('들여쓰기'))
    expect(editor.getHTML()).toContain('margin-left: 40px')
    await waitFor(() => expect(btn('내어쓰기')).toBeEnabled())
  })

  it('서식 지우기는 글자색을 걷어 낸다', async () => {
    const { user, editor } = await setup()
    await user.click(btn('글자색'))
    await user.click(screen.getByRole('menuitem', { name: '글자색 빨강' }))
    expect(editor.getHTML()).toContain('color: #dc2626')
    await user.click(btn('서식 지우기'))
    expect(editor.getHTML()).toBe('<p>Hello</p>')
  })

  it('표 넣기 → 격자 3×2 → 표가 들어가고 팝오버가 닫힌다(dock 은 6×6)', async () => {
    const { user, editor } = await setup('dock')
    await user.click(btn('표 넣기'))
    const grid = await screen.findByTestId('mail-table-grid')
    expect(within(grid).getAllByRole('button')).toHaveLength(36)
    await user.click(within(grid).getByRole('button', { name: '3행 2열 표' }))
    const doc = new DOMParser().parseFromString(editor.getHTML(), 'text/html')
    expect(doc.querySelectorAll('table')).toHaveLength(1)
    expect(doc.querySelectorAll('table tr')).toHaveLength(3)
    expect(doc.querySelectorAll('table tr:first-child > *')).toHaveLength(2)
    await waitFor(() => expect(screen.queryByTestId('mail-table-grid')).not.toBeInTheDocument())
  })

  it('fill 에서는 표 격자가 8×8 이다', async () => {
    const { user } = await setup('fill')
    await user.click(btn('표 넣기'))
    const grid = await screen.findByTestId('mail-table-grid')
    expect(within(grid).getAllByRole('button')).toHaveLength(64)
  })
})

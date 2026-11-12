// 모바일 서식판(WP-1524) — 칸 순서·크기 칩·색 견본·표 격자를 실제 Tiptap 에디터로 본다.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect } from 'react'
import { describe, expect, it } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import { MAIL_FORMAT_EXTENSIONS } from './mailFormatExtensions'
import { MailFormatSheet } from './MailFormatSheet'
import { MAIL_TABLE_EXTENSIONS } from './mailTable'

/** 작성창과 같은 확장으로 띄운 에디터 + 서식판. 첫 글자를 골라 둔 채로 시작한다. */
function Harness({ onReady }: { onReady: (e: Editor) => void }) {
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
      <MailFormatSheet editor={editor} />
      <EditorContent editor={editor} />
    </>
  )
}

/** 서식판을 띄우고 에디터를 돌려준다. */
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

/** 서식판 안 섹션(aria-label) 하나. */
function section(name: string) {
  return within(screen.getByTestId('mail-format-sheet')).getByRole('group', { name })
}

describe('MailFormatSheet', () => {
  it('첫 칸은 크기·글자색·정렬·목록, 그 아래 글꼴·배경색·줄 간격·표 순서다', async () => {
    await setup()
    const sheet = screen.getByTestId('mail-format-sheet')
    expect(within(sheet).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual([
      '크기',
      '글자색',
      '정렬',
      '목록',
      '글꼴',
      '배경색',
      '줄 간격',
      '표',
    ])
  })

  it('서식 줄 바로 위 고정 자리이고, 모든 칩은 44px 터치 대상이다', async () => {
    await setup()
    const sheet = screen.getByTestId('mail-format-sheet')
    expect(sheet.className).toContain('fixed')
    expect(sheet.className).toContain('max-h-[calc(var(--vvh,100dvh)*0.45)]')
    expect(sheet.className).toContain('overflow-y-auto')
    for (const b of within(sheet).getAllByRole('button')) {
      expect(b.className).toMatch(/min-h-11|size-11/)
    }
  })

  it('크게 칩 → font-size: 18px, 지금 값 칩이 눌림(aria-pressed)', async () => {
    const { user, editor } = await setup()
    const size = section('크기')
    expect(within(size).getByRole('button', { name: '보통' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(size).getByRole('button', { name: '크게' }))
    expect(editor.getHTML()).toContain('font-size: 18px')
    await waitFor(() => expect(within(size).getByRole('button', { name: '크게' })).toHaveAttribute('aria-pressed', 'true'))
    expect(within(size).getByRole('button', { name: '보통' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('글자색·배경색은 기본 + 7색이고 고른 16진값을 인라인으로 싣는다', async () => {
    const { user, editor } = await setup()
    expect(within(section('글자색')).getAllByRole('button')).toHaveLength(8)
    expect(within(section('배경색')).getAllByRole('button')).toHaveLength(8)
    await user.click(within(section('글자색')).getByRole('button', { name: '글자색 빨강' }))
    expect(editor.getHTML()).toMatch(/color: #[0-9a-f]{6}/)
    await waitFor(() =>
      expect(within(section('글자색')).getByRole('button', { name: '글자색 빨강' })).toHaveAttribute('aria-pressed', 'true'),
    )
  })

  it('정렬·목록·글꼴·줄 간격 칩이 명령을 건다', async () => {
    const { user, editor } = await setup()
    await user.click(within(section('정렬')).getByRole('button', { name: '가운데' }))
    expect(editor.getHTML()).toContain('text-align: center')
    await user.click(within(section('줄 간격')).getByRole('button', { name: '1.5' }))
    expect(editor.getHTML()).toContain('line-height: 1.5')
    await user.click(within(section('글꼴')).getByRole('button', { name: 'Arial' }))
    expect(editor.getHTML()).toContain('font-family: Arial')
    await user.click(within(section('목록')).getByRole('button', { name: '글머리 목록' }))
    expect(editor.getHTML()).toContain('<ul>')
  })

  it('표 3×3 칸을 탭하면 표가 들어간다', async () => {
    const { user, editor } = await setup()
    const grid = section('표')
    // 모바일 격자는 6×6.
    expect(within(grid).getAllByRole('button')).toHaveLength(36)
    await user.click(within(grid).getByRole('button', { name: '3행 3열 표' }))
    const doc = new DOMParser().parseFromString(editor.getHTML(), 'text/html')
    const rows = doc.querySelectorAll('table tr')
    expect(rows).toHaveLength(3)
    rows.forEach((r) => expect(r.children).toHaveLength(3))
  })
})

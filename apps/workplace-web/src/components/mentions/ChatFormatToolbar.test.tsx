// 채팅 서식 도구의 링크 팝오버(role=dialog) 접근 가능한 이름(WP-2067) — 새 링크는 「링크 넣기」, 링크 안이면 「링크 고치기」.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Editor } from '@tiptap/core'
import Link from '@tiptap/extension-link'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect } from 'react'
import { describe, expect, it } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import { ChatFormatToolbar } from './ChatFormatToolbar'

/** 실제 Tiptap 에디터 + 서식 줄. content 의 글자 첫 칸을 골라 둔다. */
function Harness({ content }: { content: string }) {
  const editor = useEditor({ extensions: [StarterKit, Link], content })
  useEffect(() => {
    editor?.commands.setTextSelection({ from: 2, to: 3 })
  }, [editor])
  if (!editor) return null
  return (
    <>
      <ChatFormatToolbar editor={editor as Editor} testId="t" />
      <EditorContent editor={editor} />
    </>
  )
}

describe('ChatFormatToolbar 링크 팝오버 이름', () => {
  it('링크 밖에서는 「링크 넣기」', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness content="<p>Hello</p>" />)
    await user.click(await screen.findByTestId('t-link'))
    expect(await screen.findByRole('dialog', { name: '링크 넣기' })).toBeInTheDocument()
  })

  it('링크 안에서는 「링크 고치기」', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness content='<p><a href="https://example.com">Hello</a></p>' />)
    const btn = await screen.findByTestId('t-link')
    await waitFor(() => expect(btn).toHaveAttribute('aria-pressed', 'true'))
    await user.click(btn)
    expect(await screen.findByRole('dialog', { name: '링크 고치기' })).toBeInTheDocument()
  })
})

// RichInput 멘션 후보 팝업의 콤보박스 접근성(WP-2061) — 후보가 열리면 편집칸이 listbox·활성 option 을 aria 로 가리키고,
// 닫히면(후보 없음·선택·Esc) 속성이 빠지는지 본다. aria-expanded 는 role=textbox 에 무효라 달지 않는다.
import { act, fireEvent, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { describe, expect, it, vi } from 'vitest'

import { editorOf } from '@/test/kits/richEditor'
import { renderWithProviders } from '@/test/renderWithProviders'

import { RichInput } from './RichInput'

const MEMBERS = [
  { userId: 7, username: 'kim', name: '김개발', kind: 'HUMAN' as const },
  { userId: 8, username: 'kang', name: '강기획', kind: 'HUMAN' as const },
]

/** 코멘트 모드(본문 모드 아님) RichInput 을 띄운다. */
function renderComment(testId = 'mention-aria-input') {
  renderWithProviders(
    <RichInput
      members={MEMBERS}
      ariaLabel="코멘트 작성"
      inputTestId={testId}
      submitTestId={`${testId}-submit`}
      onSubmit={vi.fn()}
    />,
  )
  return screen.getByTestId(testId)
}

/** 편집칸 끝에 text 를 넣고 멘션 자동완성(비동기 시작)이 자리 잡을 때까지 기다린다. */
async function typeAtEnd(editor: Editor, text: string) {
  await act(async () => {
    editor.commands.focus('end')
    editor.commands.insertContent(text)
  })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30))
  })
}

describe('RichInput 멘션 팝업 aria', () => {
  it('편집칸은 늘 aria-autocomplete=list 이고 팝업이 없으면 aria-controls·aria-activedescendant 가 없다', () => {
    const el = renderComment()
    expect(el.getAttribute('aria-autocomplete')).toBe('list')
    expect(el.hasAttribute('aria-controls')).toBe(false)
    expect(el.hasAttribute('aria-activedescendant')).toBe(false)
    expect(el.hasAttribute('aria-expanded')).toBe(false)
  })

  it('@ 로 후보가 열리면 aria-controls 가 listbox id, aria-activedescendant 가 첫 option id 다', async () => {
    const el = renderComment()
    await typeAtEnd(editorOf(el), '@')
    const listbox = screen.getByRole('listbox')
    const options = screen.getAllByRole('option')
    expect(listbox.id).not.toBe('')
    expect(el.getAttribute('aria-controls')).toBe(listbox.id)
    expect(options[0].id).not.toBe('')
    expect(el.getAttribute('aria-activedescendant')).toBe(options[0].id)
    expect(options[0].getAttribute('aria-selected')).toBe('true')
    expect(el.hasAttribute('aria-expanded')).toBe(false)
  })

  it('ArrowDown 을 누르면 aria-activedescendant 가 둘째 option id 로 바뀐다', async () => {
    const el = renderComment()
    await typeAtEnd(editorOf(el), '@')
    await act(async () => {
      fireEvent.keyDown(el, { key: 'ArrowDown' })
    })
    const options = screen.getAllByRole('option')
    expect(el.getAttribute('aria-activedescendant')).toBe(options[1].id)
    // 다시 그려도 코멘트 편집칸이 textbox 역할을 잃지 않는다(aria-activedescendant 가 붙을 역할).
    expect(el.getAttribute('role')).toBe('textbox')
    expect(el.hasAttribute('aria-expanded')).toBe(false)
  })

  it('맞는 후보가 없으면(@zzz) aria-controls·aria-activedescendant 가 빠진다', async () => {
    const el = renderComment()
    await typeAtEnd(editorOf(el), '@zzz')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(el.hasAttribute('aria-controls')).toBe(false)
    expect(el.hasAttribute('aria-activedescendant')).toBe(false)
    expect(el.hasAttribute('aria-expanded')).toBe(false)
  })

  it('Enter 로 고르면 속성이 빠진다', async () => {
    const el = renderComment()
    await typeAtEnd(editorOf(el), '@')
    expect(el.hasAttribute('aria-controls')).toBe(true)
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' })
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(el.hasAttribute('aria-controls')).toBe(false)
    expect(el.hasAttribute('aria-activedescendant')).toBe(false)
    expect(el.hasAttribute('aria-expanded')).toBe(false)
  })

  it('Esc 로 팝업을 숨기면 속성이 빠진다', async () => {
    const el = renderComment()
    await typeAtEnd(editorOf(el), '@')
    expect(el.hasAttribute('aria-controls')).toBe(true)
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Escape' })
    })
    expect(el.hasAttribute('aria-controls')).toBe(false)
    expect(el.hasAttribute('aria-activedescendant')).toBe(false)
    expect(el.hasAttribute('aria-expanded')).toBe(false)
  })

  it('Esc 로 숨긴 뒤 방향키·입력을 해도 속성이 되살아나지 않는다', async () => {
    const el = renderComment()
    const editor = editorOf(el)
    await typeAtEnd(editor, '@')
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Escape' })
    })
    await act(async () => {
      fireEvent.keyDown(el, { key: 'ArrowDown' })
    })
    // 후보가 바뀌어 선택이 0 으로 되돌아가도(항목 변화) 숨긴 목록을 가리키지 않는다.
    await typeAtEnd(editor, '김')
    expect(el.hasAttribute('aria-controls')).toBe(false)
    expect(el.hasAttribute('aria-activedescendant')).toBe(false)
  })

  it('Esc 로 숨긴 자동완성이 끝난 뒤 새 @ 에서는 다시 가리킨다', async () => {
    const el = renderComment()
    const editor = editorOf(el)
    await typeAtEnd(editor, '@')
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Escape' })
    })
    // 띄어쓰기로 지금 자동완성을 끝내고 새 @ 를 연다.
    await typeAtEnd(editor, ' ')
    await typeAtEnd(editor, '@')
    expect(el.getAttribute('aria-controls')).toBe(screen.getByRole('listbox').id)
  })

  it('RichInput 둘의 listbox id 가 다르다', async () => {
    const a = renderComment('aria-input-a')
    const b = renderComment('aria-input-b')
    await typeAtEnd(editorOf(a), '@')
    const idA = a.getAttribute('aria-controls')
    expect(idA).toBeTruthy()
    await act(async () => {
      fireEvent.keyDown(a, { key: 'Escape' })
    })
    await typeAtEnd(editorOf(b), '@')
    const idB = b.getAttribute('aria-controls')
    expect(idB).toBeTruthy()
    expect(idB).not.toBe(idA)
    expect(b.hasAttribute('aria-expanded')).toBe(false)
  })

  it('본문 모드에서 Esc 로 팝업을 숨기면 속성이 빠진다', async () => {
    renderWithProviders(
      <RichInput
        members={MEMBERS}
        ariaLabel="이슈 본문"
        inputTestId="mention-aria-body"
        submitTestId="mention-aria-body-submit"
        bodyMode={{ projectKey: 'WP' }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const el = screen.getByTestId('mention-aria-body')
    await typeAtEnd(editorOf(el), '@김')
    expect(el.hasAttribute('aria-controls')).toBe(true)
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Escape' })
    })
    expect(el.hasAttribute('aria-controls')).toBe(false)
    expect(el.hasAttribute('aria-activedescendant')).toBe(false)
  })
})

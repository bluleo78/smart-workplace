// RichInput 멘션 후보 Esc 로 숨긴 뒤의 키 경로(WP-2062) — Esc 로 숨긴 팝업(dismissed)에는 방향키·Enter·Shift+Enter 가 목록에 넘어가지 않아야
// 보이지 않는 후보가 멘션으로 삽입되지 않고, Enter 는 전송으로 가는지 본다. Esc 없이 는 후보를 고르는 기존 동작과
// 본문 모드 Esc 후 Enter 가 줄바꿈인 기존 동작도 함께 고정한다(회귀).
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

/** 코멘트 모드(본문 모드 아님) RichInput 을 띄운다 — 전송 스파이를 받아 확인에 쓴다. */
function renderComment(onSubmit: () => void, testId = 'mention-esc-input') {
  renderWithProviders(
    <RichInput
      members={MEMBERS}
      ariaLabel="코멘트 작성"
      inputTestId={testId}
      submitTestId={`${testId}-submit`}
      onSubmit={onSubmit}
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

describe('RichInput 멘션 Esc 로 숨긴 뒤 키', () => {
  it('Esc 로 숨긴 뒤 방향키로 고른 뒤 Enter 해도 멘션을 넣지 않고 전송한다', async () => {
    const onSubmit = vi.fn()
    const el = renderComment(onSubmit)
    await typeAtEnd(editorOf(el), '@')
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Escape' })
    })
    await act(async () => {
      fireEvent.keyDown(el, { key: 'ArrowDown' })
    })
    // Esc 후 방향키는 숨긴 목록에 넘어가지 않는다 — 목록 안 선택(aria-selected)이 그대로야 보이지 않는 후보가 갱신되지 않는다(WP-2062).
    expect(screen.getByTestId('chat-mention-option-7')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('chat-mention-option-8')).toHaveAttribute('aria-selected', 'false')
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' })
    })
    expect(onSubmit).toHaveBeenCalledTimes(1) // 순번을 옮겨도 삽입이 아니라 전송
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(el.hasAttribute('aria-controls')).toBe(false)
  })

  it('Esc 로 숨긴 뒤 Enter 는 멘션을 넣지 않고 전송한다', async () => {
    const onSubmit = vi.fn()
    const el = renderComment(onSubmit)
    await typeAtEnd(editorOf(el), '@')
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Escape' })
    })
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' })
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('listbox')).toBeNull() // 숨긴 후보가 삽입되지 않는다
    expect(el.hasAttribute('aria-controls')).toBe(false)
  })

  it('Esc 로 숨긴 뒤 Shift+Enter 는 줄바꿈이고 멘션을 넣지 않는다', async () => {
    const onSubmit = vi.fn()
    const el = renderComment(onSubmit)
    await typeAtEnd(editorOf(el), '@')
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Escape' })
    })
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter', shiftKey: true })
    })
    // Shift+Enter 는 전송도 멘션 선택도 아니라 줄바꿈이다 — Esc 로 숨긴 목록이 이 키를 삼키면 멘션 노드가 들어가 줄바꿈이 없다(WP-2062).
    expect(onSubmit).not.toHaveBeenCalled()
    const paragraph = editorOf(el).getJSON().content?.[0]
    expect(paragraph?.content?.map((node) => node.type)).toEqual(['text', 'hardBreak'])
  })

  it('Esc 없이 Enter 는 후보를 고른다(기존 동작)', async () => {
    const onSubmit = vi.fn()
    const el = renderComment(onSubmit)
    await typeAtEnd(editorOf(el), '@')
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' })
    })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(el.hasAttribute('aria-controls')).toBe(false)
  })

  it('본문 모드에서 Esc 후 Enter 는 줄바꿈이고 전송하지 않는다', async () => {
    const onSubmit = vi.fn()
    renderWithProviders(
      <RichInput
        members={MEMBERS}
        ariaLabel="이슈 본문"
        inputTestId="mention-esc-body"
        submitTestId="mention-esc-body-submit"
        bodyMode={{ projectKey: 'WP' }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    )
    const el = screen.getByTestId('mention-esc-body')
    await typeAtEnd(editorOf(el), '@김')
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Escape' })
    })
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' })
    })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(el.hasAttribute('aria-controls')).toBe(false)
    // Esc 후 Enter 는 줄바꿈 — 한 문단이 둘로 갈라졌다.
    expect(editorOf(el).getJSON().content).toHaveLength(2)
  })
})
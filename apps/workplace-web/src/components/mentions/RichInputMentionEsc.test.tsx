// RichInput 멘션 후보 Esc 로 숨긴 뒤의 키 경로(WP-2062) — Esc 로 숨긴 팝업(dismissed)에는 방향키·Enter·Shift+Enter 가 목록에 넘어가지 않아야
// 보이지 않는 후보가 멘션으로 삽입되지 않고, Enter 는 전송으로 가는지 본다. Esc 없이 는 후보를 고르는 기존 동작과
// 본문 모드 Esc 후 Enter 가 줄바꿈인 기존 동작도 함께 고정한다(회귀).
// 메시지 수정(onCancel) 중 Esc(WP-2082) — 후보가 보이면 첫 Esc 는 팝업만 닫고 두 번째 Esc 가 수정을 취소한다. 후보 0건은 Esc 한 번에 취소,
// 한글 조합 중 Esc 는 취소하지 않는다(조합 가드는 ProseMirror 가 조합 중 키를 대부분 걸러 주는 위에 둔 방어 장치).
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

/** 메시지 수정 칸(onCancel 있음)을 그린다 — Esc 로 수정 취소가 도는 경로(WP-2082). */
function renderEdit(onCancel: () => void, testId: string) {
  renderWithProviders(
    <RichInput
      members={MEMBERS}
      ariaLabel="메시지 수정"
      inputTestId={testId}
      submitTestId={`${testId}-submit`}
      onSubmit={vi.fn()}
      onCancel={onCancel}
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

  it('수정 중(onCancel) 후보 팝업이 열려 있으면 Esc 는 팝업만 닫고, 다시 Esc 하면 취소한다(WP-2082)', async () => {
    const onCancel = vi.fn()
    const el = renderEdit(onCancel, 'mention-esc-cancel')
    await typeAtEnd(editorOf(el), '@')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Escape' })
    })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onCancel).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Escape' })
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('수정 중(onCancel) 맞는 멤버가 없어 후보가 안 보이면 Esc 한 번에 취소한다(WP-2082)', async () => {
    const onCancel = vi.fn()
    const el = renderEdit(onCancel, 'mention-esc-cancel-empty')
    await typeAtEnd(editorOf(el), '@zzzz')
    expect(screen.queryByRole('listbox')).toBeNull()
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Escape' })
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('수정 중(onCancel) 한글 조합 중 Esc 는 수정을 취소하지 않는다(WP-2082)', async () => {
    const onCancel = vi.fn()
    const el = renderEdit(onCancel, 'mention-esc-cancel-ime')
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Escape', isComposing: true })
    })
    expect(onCancel).not.toHaveBeenCalled()
    // Safari 는 조합 중 키를 isComposing 대신 keyCode 229 로 알린다 — 그것도 취소하지 않는다.
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Escape', keyCode: 229 })
    })
    expect(onCancel).not.toHaveBeenCalled()
    // 조합이 끝난 뒤 Esc 는 지금처럼 취소한다.
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Escape' })
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

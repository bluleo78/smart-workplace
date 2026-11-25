// RichInput 멘션 후보 Esc 로 숨긴 뒤의 키 경로(WP-2062) — Esc 로 숨긴 팝업(dismissed)에는 방향키·Enter·Shift+Enter 가 목록에 넘어가지 않아야
// 보이지 않는 후보가 멘션으로 삽입되지 않고, Enter 는 전송으로 가는지 본다. Esc 없이 는 후보를 고르는 기존 동작과
// 본문 모드 Esc 후 Enter 가 줄바꿈인 기존 동작도 함께 고정한다(회귀).
// 메시지 수정(onCancel) 중 Esc(WP-2082) — 후보가 보이면 첫 Esc 는 팝업만 닫고 두 번째 Esc 가 수정을 취소한다. 후보 0건은 Esc 한 번에 취소,
// 한글 조합 중 Esc 는 취소하지 않는다(조합 가드는 ProseMirror 가 조합 중 키를 대부분 걸러 주는 위에 둔 방어 장치).
// 맞는 멤버 없는 @ 뒤 Enter(WP-2107) — 보이는 후보가 없으면 Enter 는 전송, 조합 확정 Enter 처럼 검색어가 막 후보가 생기는 값이 된 직후
// (비동기 onUpdate 전)엔 보내지 않고 멘션에 양보한다. MentionList 빈 목록은 Enter·방향키를 삼키지 않는다.
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { editorOf } from '@/test/kits/richEditor'
import { renderWithProviders } from '@/test/renderWithProviders'

import { MentionList, type MentionListHandle } from './MentionList'
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

  it('수정 중(onCancel) 팝업이 뜨기 전(onStart 전)에 온 Esc 도 수정을 취소하지 않는다(WP-2124 반려)', async () => {
    const onCancel = vi.fn()
    const el = renderEdit(onCancel, 'mention-esc-cancel-before-start')
    const editor = editorOf(el)
    // @김 입력과 Esc 를 await 없이 잇달아 보내 — suggestion 의 onStart(팝업 띄우기)가 돌기 전에 Esc 가 닿는다.
    // (mentionPopupOpenForEsc 만 보면 hide 가 없어 양보하지 않고 onCancel 이 불려 실패한다.)
    await act(async () => {
      editor.commands.focus('end')
      editor.commands.insertContent('@김')
      fireEvent.keyDown(el, { key: 'Escape' })
    })
    expect(onCancel).not.toHaveBeenCalled()
    // 그 Esc 는 팝업을 닫은 것이다 — onStart 뒤에도 후보 목록이 뜨지 않는다(Esc 가 아무 일도 안 하고 팝업이 뜨지 않게).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(screen.queryByRole('listbox')).toBeNull()
    // 다음 Esc 는 수정을 취소한다(팝업을 닫은 뒤 두 번째 Esc — 열린 팝업의 Esc 와 같은 순서).
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

// 맞는 멤버가 없는 @입력 뒤 Enter (WP-2107) — 보이는 후보가 없으면 Enter 는 멘션 플러그인에 양보하지 않고 전송으로 간다.
describe('맞는 멤버가 없는 @ 뒤 Enter (WP-2107)', () => {
  it('맞는 멤버가 없는 @zzzz 뒤 Enter 는 보낸다', async () => {
    const onSubmit = vi.fn()
    const el = renderComment(onSubmit, 'mention-enter-empty')
    await typeAtEnd(editorOf(el), '@zzzz')
    expect(screen.queryByRole('listbox')).toBeNull()
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' })
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toContain('@zzzz')
  })

  it('후보가 보이다 사라진 뒤 Enter 는 보낸다', async () => {
    const onSubmit = vi.fn()
    const el = renderComment(onSubmit, 'mention-enter-vanish')
    const editor = editorOf(el)
    await typeAtEnd(editor, '@kim')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await typeAtEnd(editor, 'zz')
    expect(screen.queryByRole('listbox')).toBeNull()
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' })
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('검색어가 막 후보가 생기는 값이 된 직후(onUpdate 전)에 온 Enter 는 보내지 않고 멘션에 양보한다', async () => {
    const onSubmit = vi.fn()
    const el = renderComment(onSubmit, 'mention-enter-ime')
    const editor = editorOf(el)
    // 조합 중 글자 'ㄱ' — 맞는 멤버가 없어 후보가 안 보인다(live=false).
    await typeAtEnd(editor, '@ㄱ')
    expect(screen.queryByRole('listbox')).toBeNull()
    // 조합 확정 Enter 흉내: ImeCommitFlush 가 같은 keydown 안에서 확정 글자('김')를 반영한 직후 Enter 가 온다.
    // 글자 바꾸기와 Enter 를 await 없이 잇달아 보내 — suggestion 의 onUpdate(items 를 await 해 마이크로태스크 뒤)가 돌기 전에 Enter 가 닿는다.
    // (가드를 live 로 되돌리면 이 Enter 가 '@김' 을 보내 실패하고, 플러그인 onKeyDown 의 삼키기를 빼면 줄 나누기가 돼 실패한다.)
    await act(async () => {
      const to = editor.state.selection.from
      editor.chain().insertContentAt({ from: to - 1, to }, '김').run()
      fireEvent.keyDown(el, { key: 'Enter' })
    })
    expect(onSubmit).not.toHaveBeenCalled() // 반쯤 쓴 글을 보내지 않는다
    expect(editor.getJSON().content).toHaveLength(1) // 줄 나누기도 아니다
    // 목록이 따라오면 후보가 보이고, 다음 Enter 는 그 후보를 고른다(고정 대기 대신 목록이 뜰 때까지 기다린다).
    expect(await screen.findByRole('listbox')).toBeInTheDocument()
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' })
    })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(JSON.stringify(editor.getJSON())).toContain('mention')
  })

  it('멤버 목록이 늦게 와 목록이 빈 채로 남으면 Enter 는 삼키지 않고 보낸다(리뷰 후속)', async () => {
    const onSubmit = vi.fn()
    const props = { ariaLabel: '코멘트 작성', inputTestId: 'mention-enter-late', submitTestId: 'mention-enter-late-submit', onSubmit }
    const { rerender } = renderWithProviders(<RichInput members={[]} {...props} />)
    const el = screen.getByTestId('mention-enter-late')
    // 멤버가 아직 없을 때 '@kim' — 목록은 빈 채로 이 검색어를 따라왔다.
    await typeAtEnd(editorOf(el), '@kim')
    expect(screen.queryByRole('listbox')).toBeNull()
    // 멤버가 늦게 와 지금 거르면 맞지만 목록은 그대로 비어 있다 — 이때 Enter 는 보이는 대로(후보 없음) 보낸다.
    rerender(<RichInput members={MEMBERS} {...props} />)
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' })
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('후보가 보일 때 Enter 는 고르고 보내지 않는다', async () => {
    const onSubmit = vi.fn()
    const el = renderComment(onSubmit, 'mention-enter-pick')
    await typeAtEnd(editorOf(el), '@kim')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' })
    })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(JSON.stringify(editorOf(el).getJSON())).toContain('mention')
  })
})

// 검색어가 바뀐 직후(목록 갱신 전) Enter (WP-2124) — 목록은 비동기로 갱신돼 앞 검색어의 항목이 남아 있다. 그 항목을 넣으면 안 된다.
describe('낡은 후보 목록의 Enter (WP-2124)', () => {
  it('검색어가 바뀐 직후(목록 갱신 전) Enter 는 앞 목록의 항목을 넣지 않고, 목록이 따라오면 새 후보를 고른다', async () => {
    const onSubmit = vi.fn()
    const el = renderComment(onSubmit, 'mention-enter-stale')
    const editor = editorOf(el)
    // '@k' — 후보 김개발·강기획, 0번(김개발) 선택.
    await typeAtEnd(editor, '@k')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    // 검색어 'ka'(강기획만)가 된 직후 목록이 따라오기 전에 Enter — await 없이 한 act 안에서 보낸다.
    await act(async () => {
      editor.commands.insertContent('a')
      fireEvent.keyDown(el, { key: 'Enter' })
    })
    expect(onSubmit).not.toHaveBeenCalled()
    const afterStale = JSON.stringify(editor.getJSON())
    expect(afterStale).not.toContain('김개발') // 낡은 목록의 0번 항목이 들어가지 않는다
    expect(afterStale).not.toContain('mention')
    // 목록이 따라온 뒤 Enter 는 새 후보(강기획)를 고른다.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' })
    })
    const picked = JSON.stringify(editor.getJSON())
    expect(picked).toContain('강기획')
    expect(picked).not.toContain('김개발')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  // WP-2124 리뷰 후속 — 낡은 목록 가드는 수정 키 없는 Enter 만 삼킨다. Shift+Enter 는 목록(낡은 항목)에 넘기지 않고 줄바꿈으로 간다.
  it('검색어가 바뀐 직후 Shift+Enter 는 삼켜지지 않고 줄바꿈하며, 낡은 항목을 넣지 않는다', async () => {
    const onSubmit = vi.fn()
    const el = renderComment(onSubmit, 'mention-shift-enter-stale')
    const editor = editorOf(el)
    await typeAtEnd(editor, '@k')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await act(async () => {
      editor.commands.insertContent('a')
      fireEvent.keyDown(el, { key: 'Enter', shiftKey: true })
    })
    const after = JSON.stringify(editor.getJSON())
    expect(after).not.toContain('김개발')
    expect(after).not.toContain('mention')
    expect(after).toContain('hardBreak') // 삼키지 않고 편집기의 Shift+Enter(줄바꿈)로 갔다
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('MentionList 빈 목록 키 (WP-2107)', () => {
  it('빈 목록은 Enter·ArrowDown 을 삼키지 않는다', () => {
    const ref = createRef<MentionListHandle>()
    const command = vi.fn()
    render(<MentionList ref={ref} items={[]} command={command} listId="l" onActiveChange={() => {}} />)
    expect(ref.current?.onKeyDown({ event: new KeyboardEvent('keydown', { key: 'Enter' }) })).toBe(false)
    expect(ref.current?.onKeyDown({ event: new KeyboardEvent('keydown', { key: 'ArrowDown' }) })).toBe(false)
    expect(command).not.toHaveBeenCalled()
  })
})

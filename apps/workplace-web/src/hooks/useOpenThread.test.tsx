// 스레드 칸 닫힘 초점 복귀(WP-1804) — 키보드로 연 요소를 open() 때 기억했다가 칸이 실제로 닫힐 때만 돌려준다.
// BrowserRouter(jsdom 세션 히스토리)로 ?thread 를 오가고, 칸 대신 닫기 단추만 그려 닫히면 초점이 body 로 빠지게 한다.
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { nextFrames } from '@/test/nextFrames'
import type { MessageResponse } from '@/types/messaging'

import { useOpenThread } from './useOpenThread'

const messages = [{ id: 1 }, { id: 2 }] as MessageResponse[]


/** 채널 화면 흉내 — 메시지마다 「스레드」 단추와 「답글」 링크, 열려 있으면 칸 대신 닫기 단추. */
function Thread() {
  const { threadParam, threadShown, openThreadParent } = useOpenThread(messages)
  return (
    <>
      {messages.map((m) => (
        <div key={m.id}>
          <button type="button" data-testid={`message-reply-${m.id}`} onClick={() => threadParam.open(String(m.id))}>
            스레드
          </button>
          <button type="button" data-testid={`message-thread-link-${m.id}`} onClick={() => threadParam.open(String(m.id))}>
            답글
          </button>
        </div>
      ))}
      {threadShown && (
        <button type="button" data-testid="thread-close" data-parent={openThreadParent?.id} onClick={threadParam.close}>
          닫기
        </button>
      )}
    </>
  )
}

function renderThread(path = '/chat/channels/1') {
  window.history.replaceState(null, '', path)
  return render(
    <BrowserRouter>
      <button type="button" data-testid="other">
        다른 곳
      </button>
      <Thread />
    </BrowserRouter>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useOpenThread — 닫힘 초점 복귀(WP-1804)', () => {
  test('키보드로 「스레드」 단추로 연 칸을 닫으면 초점이 그 단추로 돌아온다', async () => {
    const user = userEvent.setup()
    renderThread()
    screen.getByTestId('message-reply-1').focus()
    await user.keyboard('{Enter}')
    screen.getByTestId('thread-close').focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByTestId('thread-close')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('message-reply-1')).toHaveFocus())
  })

  test('키보드로 「답글 N개」 링크로 연 칸을 닫으면 초점이 그 링크로 돌아온다', async () => {
    const user = userEvent.setup()
    renderThread()
    screen.getByTestId('message-thread-link-1').focus()
    await user.keyboard('{Enter}')
    screen.getByTestId('thread-close').focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByTestId('message-thread-link-1')).toHaveFocus())
  })

  test('마우스로 열어 초점 링이 없던 요소(:focus-visible 아님)는 기억하지 않아 돌려주지 않는다', async () => {
    const user = userEvent.setup()
    renderThread()
    // jsdom 은 :focus-visible 을 가리지 못하므로, 마우스 클릭처럼 초점 링이 없는 상태를 흉내 낸다.
    const realMatches = Element.prototype.matches
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, sel: string) {
      return sel === ':focus-visible' ? false : realMatches.call(this, sel)
    })
    await user.click(screen.getByTestId('message-reply-1'))
    await user.click(screen.getByTestId('thread-close'))
    await waitFor(() => expect(screen.queryByTestId('thread-close')).not.toBeInTheDocument())
    await nextFrames()
    expect(screen.getByTestId('message-reply-1')).not.toHaveFocus()
  })

  test('다른 스레드로 바꾸면(칸은 그대로) 초점을 옮기지 않는다', async () => {
    const user = userEvent.setup()
    renderThread()
    screen.getByTestId('message-reply-1').focus()
    await user.keyboard('{Enter}')
    screen.getByTestId('message-reply-2').focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByTestId('thread-close')).toHaveAttribute('data-parent', '2'))
    await nextFrames()
    expect(screen.getByTestId('message-reply-2')).toHaveFocus()
  })

  test('닫을 때 초점이 다른 곳에 있으면 건드리지 않는다', async () => {
    const user = userEvent.setup()
    renderThread()
    screen.getByTestId('message-reply-1').focus()
    await user.keyboard('{Enter}')
    screen.getByTestId('other').focus()
    // 닫기는 초점을 옮기지 않고(=다른 곳에 둔 채) 부른다 — 예: 시스템 뒤로가기.
    act(() => {
      screen.getByTestId('thread-close').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await waitFor(() => expect(screen.queryByTestId('thread-close')).not.toBeInTheDocument())
    await nextFrames()
    expect(screen.getByTestId('other')).toHaveFocus()
  })

  test('딥링크로 열린 칸(open 을 부르지 않음)은 닫아도 초점을 옮기지 않는다', async () => {
    const user = userEvent.setup()
    renderThread('/chat/channels/1?thread=1')
    await user.click(screen.getByTestId('thread-close'))
    await waitFor(() => expect(screen.queryByTestId('thread-close')).not.toBeInTheDocument())
    await nextFrames()
    expect(screen.getByTestId('message-reply-1')).not.toHaveFocus()
  })

  test('닫고 다시 열어 닫아도(두 번째) 연 요소로 돌아온다', async () => {
    const user = userEvent.setup()
    renderThread()
    for (const id of ['1', '2']) {
      screen.getByTestId(`message-reply-${id}`).focus()
      await user.keyboard('{Enter}')
      screen.getByTestId('thread-close').focus()
      await user.keyboard('{Enter}')
      await waitFor(() => expect(screen.getByTestId(`message-reply-${id}`)).toHaveFocus())
    }
  })
})

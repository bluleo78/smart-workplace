// 스레드 칸 닫힘 초점 복귀(WP-1804) — 키보드로 연 요소를 open() 때 기억했다가 칸이 실제로 닫힐 때만 돌려준다.
// BrowserRouter(jsdom 세션 히스토리)로 ?thread 를 오가고, 칸 대신 닫기 단추만 그려 닫히면 초점이 body 로 빠지게 한다.
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { nextFrames } from '@/test/nextFrames'
import type { MessageResponse } from '@/types/messaging'

import { useOpenThread } from './useOpenThread'

const messages = [{ id: 1 }, { id: 2 }] as MessageResponse[]


/**
 * 채널 화면 흉내 — 메시지마다 「스레드」 단추와 「답글」 링크, 열려 있으면 칸 대신 닫기 단추.
 * 「없는 루트」 단추는 첫 페이지에 없는 루트(9)를 열어 칸이 뜨지 않는 경우, 「딥링크」 단추는 open 없이 ?thread=1 로 가는 경우다.
 */
function Thread({ loaded = messages }: { loaded?: MessageResponse[] }) {
  const { threadParam, threadShown, openThreadParent } = useOpenThread(loaded)
  const navigate = useNavigate()
  return (
    <>
      <button type="button" data-testid="open-missing" onClick={() => threadParam.open('9')}>
        없는 루트
      </button>
      {[1, 2].map((id) => (
        <button key={id} type="button" data-testid={`deeplink-${id}`} onClick={() => navigate(`/chat/channels/1?thread=${id}`)}>
          딥링크 {id}
        </button>
      ))}
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

function tree(loaded?: MessageResponse[]) {
  return (
    <BrowserRouter>
      <button type="button" data-testid="other">
        다른 곳
      </button>
      <Thread loaded={loaded} />
    </BrowserRouter>
  )
}

function renderThread(path = '/chat/channels/1') {
  window.history.replaceState(null, '', path)
  return render(tree())
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

  test('복귀는 preventScroll 없이 한다 — 화면 밖으로 밀린 단추도 스크롤해 초점 링이 보이게(리뷰 후속)', async () => {
    const user = userEvent.setup()
    renderThread()
    const opener = screen.getByTestId('message-reply-1')
    opener.focus()
    await user.keyboard('{Enter}')
    const focusSpy = vi.spyOn(opener, 'focus')
    screen.getByTestId('thread-close').focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(opener).toHaveFocus())
    expect(focusSpy).toHaveBeenCalled()
    for (const args of focusSpy.mock.calls) expect(args[0]?.preventScroll).not.toBe(true)
  })

  // 첫 페이지에 없는 루트(9)를 키보드로 열어 칸이 뜨지 않은 뒤, ?thread 가 비거나(뒤로가기) 곧장 다른 값으로 바뀌는 두 경우.
  test.each([
    ['?thread 가 비면', true],
    ['다른 스레드 값으로 바뀌어도', false],
  ])('칸이 뜨지 않은 채 %s 기억을 지워, 나중에 딥링크로 연 칸을 닫아도 낡은 단추로 가지 않는다(리뷰 후속)', async (_, goBack) => {
    const user = userEvent.setup()
    renderThread()
    screen.getByTestId('open-missing').focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(window.location.search).toBe('?thread=9'))
    expect(screen.queryByTestId('thread-close')).not.toBeInTheDocument()
    if (goBack) {
      act(() => window.history.back())
      await waitFor(() => expect(window.location.search).toBe(''))
    }
    // open 없이(딥링크처럼) ?thread=1 로 칸을 열고 키보드로 닫는다.
    await user.click(screen.getByTestId('deeplink-1'))
    await waitFor(() => expect(screen.getByTestId('thread-close')).toBeInTheDocument())
    screen.getByTestId('thread-close').focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByTestId('thread-close')).not.toBeInTheDocument())
    await nextFrames()
    expect(screen.getByTestId('open-missing')).not.toHaveFocus()
  })

  test('칸이 떠 있는 채 뒤로가기로 스레드만 바뀌어도 기억을 지우지 않아, 닫으면 연 단추로 돌아온다', async () => {
    const user = userEvent.setup()
    renderThread()
    screen.getByTestId('message-reply-1').focus()
    await user.keyboard('{Enter}')
    // 칸이 떠 있는 채 open 없이 ?thread=2 로 갔다가(push) 뒤로가기로 1 로 돌아온다.
    await user.click(screen.getByTestId('deeplink-2'))
    await waitFor(() => expect(screen.getByTestId('thread-close')).toHaveAttribute('data-parent', '2'))
    act(() => window.history.back())
    await waitFor(() => expect(screen.getByTestId('thread-close')).toHaveAttribute('data-parent', '1'))
    screen.getByTestId('thread-close').focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByTestId('message-reply-1')).toHaveFocus())
  })

  test('열린 칸에서 안 불린 루트로 바꿔 칸이 잠시 사라져도, 루트가 불려 뜬 칸을 닫으면 연 단추로 돌아온다', async () => {
    const user = userEvent.setup()
    const view = renderThread()
    screen.getByTestId('message-reply-1').focus()
    await user.keyboard('{Enter}')
    screen.getByTestId('open-missing').focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(window.location.search).toBe('?thread=9'))
    expect(screen.queryByTestId('thread-close')).not.toBeInTheDocument()
    // 다음 페이지가 불려 루트 9 가 생기면 칸이 뜬다.
    view.rerender(tree([...messages, { id: 9 } as MessageResponse]))
    await waitFor(() => expect(screen.getByTestId('thread-close')).toHaveAttribute('data-parent', '9'))
    screen.getByTestId('thread-close').focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByTestId('open-missing')).toHaveFocus())
  })
})

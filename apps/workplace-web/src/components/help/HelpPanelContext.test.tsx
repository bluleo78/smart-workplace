// 도움말 패널 상태(WP-1505) — `?` 로 여닫기, 사용자·워크스페이스별 열림 기억, 모바일은 닫힌 채 시작, 주소가 바뀌면 이동 기록 비움, 폭 범위.
import { act, screen } from '@testing-library/react'
import { useNavigate } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import { testAuthValue } from '@/test/renderWithProviders'

import { HelpPanelProvider, useHelpPanel } from './HelpPanelContext'
import { HELP_MAX_WIDTH, HELP_MIN_WIDTH } from './helpPanelStorage'

// 셸 분기를 테스트에서 바꾸려고 모바일 판정을 가변 값으로 대신한다(jsdom 의 matchMedia 로는 폭 전환을 일으킬 수 없다).
// set 은 구독한 useIsMobile 을 다시 그리게 해 마운트된 채 창 폭이 바뀌는 것을 흉내 낸다.
const mobile = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  return {
    value: false,
    listeners,
    set(next: boolean) {
      this.value = next
      listeners.forEach((l) => l())
    },
  }
})
vi.mock('@/hooks/useIsMobile', async () => {
  const { useSyncExternalStore } = await import('react')
  const subscribe = (cb: () => void) => {
    mobile.listeners.add(cb)
    return () => mobile.listeners.delete(cb)
  }
  return { useIsMobile: () => useSyncExternalStore(subscribe, () => mobile.value), getIsMobile: () => mobile.value }
})

/** 상태를 글로 보이고 동작을 단추로 부르는 탐침. */
function Probe() {
  const help = useHelpPanel()
  const navigate = useNavigate()
  return (
    <div>
      <output data-testid="open">{help.open ? 'open' : 'closed'}</output>
      <output data-testid="width">{help.width}</output>
      <output data-testid="selected">{help.nav.selected?.sectionId ?? '-'}</output>
      <output data-testid="history">{help.nav.history.length}</output>
      <input aria-label="글" />
      <button onClick={() => help.select({ chapter: 'c', sectionId: 'a' }, null)}>a 고르기</button>
      <button onClick={() => help.select({ chapter: 'c', sectionId: 'b' }, { chapter: 'c', sectionId: 'a' })}>b 고르기</button>
      <button onClick={() => help.resize(9999, true)}>넓게</button>
      <button onClick={() => help.resize(1)}>좁게</button>
      <button onClick={() => void navigate('/other')}>이동</button>
    </div>
  )
}

const ui = (
  <HelpPanelProvider>
    <Probe />
  </HelpPanelProvider>
)

describe('HelpPanelProvider', () => {
  it('? 로 열고 다시 ? 로 닫는다', async () => {
    mobile.value = false
    const { user } = renderScreen(ui)
    expect(screen.getByTestId('open')).toHaveTextContent('closed')
    await user.keyboard('?')
    expect(screen.getByTestId('open')).toHaveTextContent('open')
    await user.keyboard('?')
    expect(screen.getByTestId('open')).toHaveTextContent('closed')
  })

  it('입력 칸에서 ? 는 글자로 들어가고 패널은 그대로', async () => {
    mobile.value = false
    const { user } = renderScreen(ui)
    await user.click(screen.getByLabelText('글'))
    await user.keyboard('?')
    expect(screen.getByLabelText('글')).toHaveValue('?')
    expect(screen.getByTestId('open')).toHaveTextContent('closed')
  })

  it('연 상태를 기억해 다시 마운트하면 열린 채 시작한다(같은 사용자·워크스페이스)', async () => {
    mobile.value = false
    const first = renderScreen(ui)
    await first.user.keyboard('?')
    first.unmount()
    renderScreen(ui)
    expect(screen.getByTestId('open')).toHaveTextContent('open')
  })

  it('다른 사용자는 기억을 물려받지 않는다', async () => {
    mobile.value = false
    const first = renderScreen(ui)
    await first.user.keyboard('?')
    first.unmount()
    renderScreen(ui, { auth: { user: { ...testAuthValue.user!, id: 2 } } })
    expect(screen.getByTestId('open')).toHaveTextContent('closed')
  })

  it('모바일은 기억과 무관하게 닫힌 채 시작하고, 모바일에서 연 것은 기억하지 않는다', async () => {
    mobile.value = false
    const first = renderScreen(ui)
    await first.user.keyboard('?')
    first.unmount()
    mobile.value = true
    const second = renderScreen(ui)
    expect(screen.getByTestId('open')).toHaveTextContent('closed')
    // 모바일에서 열고 닫은 것은 데스크톱 기억(열림)을 바꾸지 않는다.
    await second.user.keyboard('?')
    await second.user.keyboard('?')
    second.unmount()
    mobile.value = false
    renderScreen(ui)
    expect(screen.getByTestId('open')).toHaveTextContent('open')
  })

  it('데스크톱에서 연 채 모바일 폭이 되면 닫히고, 다시 데스크톱 폭이 되면 기억한 열림으로 돌아온다', async () => {
    mobile.value = false
    const { user } = renderScreen(ui)
    await user.keyboard('?')
    expect(screen.getByTestId('open')).toHaveTextContent('open')
    act(() => mobile.set(true))
    expect(screen.getByTestId('open')).toHaveTextContent('closed')
    act(() => mobile.set(false))
    expect(screen.getByTestId('open')).toHaveTextContent('open')
  })

  it('주소가 바뀌면 고른 절과 뒤로 기록을 비운다', async () => {
    mobile.value = false
    const { user } = renderScreen(ui)
    await user.click(screen.getByRole('button', { name: 'a 고르기' }))
    await user.click(screen.getByRole('button', { name: 'b 고르기' }))
    expect(screen.getByTestId('selected')).toHaveTextContent('b')
    expect(screen.getByTestId('history')).toHaveTextContent('1')
    await user.click(screen.getByRole('button', { name: '이동' }))
    expect(screen.getByTestId('selected')).toHaveTextContent('-')
    expect(screen.getByTestId('history')).toHaveTextContent('0')
  })

  it('폭은 범위 안으로 맞추고 저장한 폭으로 다시 시작한다', async () => {
    mobile.value = false
    const first = renderScreen(ui)
    await first.user.click(screen.getByRole('button', { name: '좁게' }))
    expect(screen.getByTestId('width')).toHaveTextContent(String(HELP_MIN_WIDTH))
    await first.user.click(screen.getByRole('button', { name: '넓게' }))
    expect(screen.getByTestId('width')).toHaveTextContent(String(HELP_MAX_WIDTH))
    first.unmount()
    renderScreen(ui)
    expect(screen.getByTestId('width')).toHaveTextContent(String(HELP_MAX_WIDTH))
  })
})

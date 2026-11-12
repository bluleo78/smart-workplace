// AI 답 표식 동작(WP-1511) — 출처는 도움말을 그 절로 열고, 화면 문구는 단추에 포커스하고, 창 단추는 등록된 허용 창만 연다.
// 휴대폰은 AI 전체 화면 시트를 걷어(히스토리 항목이 사라진 뒤) 동작하고, 데스크톱 옆 패널은 AI 를 그대로 둔다.
// 실제 스크롤·강조 색은 브라우저가 필요해 라이브 캡처로 본다(이 계획에 E2E 없음).
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AIAssistantProvider, useAssistant } from '@/components/ai/AIAssistantContext'
import { AiDialogTargetsProvider, useAiDialogTarget } from '@/components/ai/dialogTargets/AiDialogTargets'
import { AiScreenContextProvider } from '@/components/ai/screen-context/AiScreenContextProvider'
import { useHelpIndex } from '@/components/help/helpBundle'
import { HelpPanelProvider, useHelpPanel } from '@/components/help/HelpPanelContext'
import { helpBundleHandlers } from '@/test/kits/help/helpBundleKit'
import { renderScreen } from '@/test/renderScreen'

import type { HelpAnswerActions } from './helpAnswerContext'
import { useHelpAnswerActions } from './useHelpAnswerActions'

// 휴대폰 여부를 테스트마다 바꾼다(jsdom matchMedia 로는 폭을 바꿀 수 없다).
const env = vi.hoisted(() => ({ mobile: false }))
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => env.mobile, getIsMobile: () => env.mobile }))

let actions: HelpAnswerActions
const scrolled: Element[] = []
const modeWhenOpened: string[] = []
// 창을 여는 순간의 AI 모드를 적어 둔다 — 휴대폰은 AI 를 닫은 뒤여야 한다.
const openDialogFn = vi.fn(() => {
  modeWhenOpened.push(document.querySelector('[data-testid="ai-mode"]')?.textContent ?? '')
})

beforeEach(() => {
  env.mobile = false
  scrolled.length = 0
  openDialogFn.mockClear()
  modeWhenOpened.length = 0
  // jsdom 에는 scrollIntoView 가 없다 — 스크롤한 요소만 기록한다.
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this)
  }
})

/** 표식 동작을 꺼내 오고 AI·도움말 상태를 글로 보여 주는 가짜 AI 패널. */
function Probe() {
  const a = useHelpAnswerActions()
  const ai = useAssistant()
  const help = useHelpPanel()
  // 실제 화면에서는 출처 링크가 목차를 받아 캐시에 둔다 — 같은 일을 한다.
  useHelpIndex()
  useEffect(() => {
    actions = a
  }, [a])
  return (
    <div data-ai-panel>
      <output data-testid="ai-mode">{ai.mode}</output>
      <output data-testid="ai-history">{ai.historyOpen ? 'on' : 'off'}</output>
      <output data-testid="help-open">{help.open ? 'open' : 'closed'}</output>
      <output data-testid="help-section">{help.nav.selected?.sectionId ?? ''}</output>
      <button onClick={() => ai.open('side')}>AI 열기</button>
      <button onClick={() => ai.open('fullscreen')}>AI 전체 화면</button>
      {/* AI 패널 안 같은 이름 단추 — 화면 단추로 잘못 맞추지 않아야 한다. */}
      <button>토큰 다시 넣기</button>
    </div>
  )
}

/** 화면이 등록한 창과 화면 단추 — open 호출과 이미 열림 여부를 테스트가 정한다. */
function FakeScreen({ dialogOpen = false, register = true }: { dialogOpen?: boolean; register?: boolean }) {
  const anchor = useRef<HTMLButtonElement>(null)
  useAiDialogTarget('agents.accounts.add', register ? { open: openDialogFn, isOpen: () => dialogOpen, anchor } : null)
  return (
    <div data-ai-page-root>
      <button ref={anchor}>계정 추가</button>
      <button>토큰 다시 넣기</button>
    </div>
  )
}

function ui(screenProps?: { dialogOpen?: boolean; register?: boolean }) {
  return (
    <AIAssistantProvider hotkeysEnabled>
      <HelpPanelProvider>
        <AiScreenContextProvider>
          <AiDialogTargetsProvider>
            <Probe />
            <FakeScreen {...screenProps} />
          </AiDialogTargetsProvider>
        </AiScreenContextProvider>
      </HelpPanelProvider>
    </AIAssistantProvider>
  )
}

describe('AI 답 표식 동작', () => {
  it('출처를 누르면 도움말 패널이 그 절로 열린다(AI 는 닫지 않음, 데스크톱)', async () => {
    renderScreen(ui(), { path: '/', handlers: helpBundleHandlers() })
    fireEvent.click(screen.getByRole('button', { name: 'AI 열기' }))
    await waitFor(() => expect(screen.getByTestId('ai-mode')).toHaveTextContent('side'))
    await waitFor(() => {
      act(() => actions.openHelpSection('home.widgets'))
      expect(screen.getByTestId('help-section')).toHaveTextContent('home.widgets')
    })
    expect(screen.getByTestId('help-open')).toHaveTextContent('open')
    expect(screen.getByTestId('ai-mode')).toHaveTextContent('side')
  })

  it('목차에 없는 절 id 는 열지 않는다', async () => {
    renderScreen(ui(), { path: '/', handlers: helpBundleHandlers() })
    await waitFor(() => expect(actions).toBeDefined())
    // 목차가 들어올 시간을 준 뒤(정상 id 가 열리는 것을 확인) 없는 id 를 시험한다.
    await waitFor(() => {
      act(() => actions.openHelpSection('home.widgets'))
      expect(screen.getByTestId('help-section')).toHaveTextContent('home.widgets')
    })
    act(() => actions.openHelpSection('no.such.section'))
    expect(screen.getByTestId('help-section')).toHaveTextContent('home.widgets')
  })

  it('휴대폰: 출처를 누르면 AI 시트를 닫고 도움말이 그 절로 열린다', async () => {
    env.mobile = true
    renderScreen(ui(), { path: '/', handlers: helpBundleHandlers() })
    // 목차가 들어올 때까지 기다린다 — 닫혀 있을 때는 closeThen 이 바로 부르므로 정상 id 로 확인한다.
    await waitFor(() => {
      act(() => actions.openHelpSection('home.widgets'))
      expect(screen.getByTestId('help-section')).toHaveTextContent('home.widgets')
    })
    // 상태를 비운 새 화면에서 AI 시트를 연 뒤 누른다.
    fireEvent.click(screen.getByRole('button', { name: 'AI 열기' }))
    await waitFor(() => expect(screen.getByTestId('ai-mode')).toHaveTextContent('fullscreen'))
    act(() => actions.openHelpSection('home.widgets'))
    await waitFor(() => expect(screen.getByTestId('ai-mode')).toHaveTextContent('closed'))
    await waitFor(() => expect(screen.getByTestId('help-open')).toHaveTextContent('open'))
    expect(screen.getByTestId('help-section')).toHaveTextContent('home.widgets')
  })

  it('창 단추: 등록된 창이면 열고, 없으면 missing', async () => {
    const { unmount } = renderScreen(ui(), { path: '/', handlers: helpBundleHandlers() })
    await waitFor(() => expect(actions).toBeDefined())
    let result: ReturnType<HelpAnswerActions['openDialog']> = 'missing'
    act(() => {
      result = actions.openDialog('agents.accounts.add')
    })
    expect(result).toBe('opened')
    expect(openDialogFn).toHaveBeenCalledTimes(1)
    unmount()

    renderScreen(ui({ register: false }), { path: '/', handlers: helpBundleHandlers() })
    await waitFor(() => expect(actions).toBeDefined())
    act(() => {
      result = actions.openDialog('agents.accounts.add')
    })
    expect(result).toBe('missing')
    expect(openDialogFn).toHaveBeenCalledTimes(1)
  })

  it('창이 이미 열려 있으면 다시 열지 않고 기준 단추로 스크롤만 한다(scrolled)', async () => {
    renderScreen(ui({ dialogOpen: true }), { path: '/', handlers: helpBundleHandlers() })
    await waitFor(() => expect(actions).toBeDefined())
    let result: ReturnType<HelpAnswerActions['openDialog']> = 'missing'
    act(() => {
      result = actions.openDialog('agents.accounts.add')
    })
    expect(result).toBe('scrolled')
    expect(openDialogFn).not.toHaveBeenCalled()
    expect(scrolled).toContain(screen.getByRole('button', { name: '계정 추가' }))
  })

  it('휴대폰: 창 단추는 AI 를 닫은 뒤 창을 연다', async () => {
    env.mobile = true
    renderScreen(ui(), { path: '/', handlers: helpBundleHandlers() })
    fireEvent.click(screen.getByRole('button', { name: 'AI 열기' }))
    await waitFor(() => expect(screen.getByTestId('ai-mode')).toHaveTextContent('fullscreen'))
    act(() => {
      expect(actions.openDialog('agents.accounts.add')).toBe('opened')
    })
    // 히스토리 항목이 걷힌 뒤에야 창을 연다 — 열리는 순간 AI 는 이미 닫혀 있고 브라우저 위치가 라우터 위치를 따라와 있다.
    await waitFor(() => expect(openDialogFn).toHaveBeenCalledTimes(1))
    expect(modeWhenOpened).toEqual(['closed'])
    expect(screen.getByTestId('ai-mode')).toHaveTextContent('closed')
  })

  it('화면 문구를 누르면 그 단추에 포커스가 가고 강조된다(AI 패널 안 같은 이름 단추는 제외)', async () => {
    renderScreen(ui(), { path: '/', handlers: helpBundleHandlers() })
    await waitFor(() => expect(actions).toBeDefined())
    act(() => actions.focusScreenControl('토큰 다시 넣기'))
    const pageButton = within_page('토큰 다시 넣기')
    expect(pageButton).toHaveFocus()
    expect(pageButton).toHaveAttribute('data-help-highlight')
    expect(scrolled).toContain(pageButton)
    await waitFor(() => expect(pageButton).not.toHaveAttribute('data-help-highlight'))
  })

  it('데스크톱 전체 화면에서도 화면 문구는 화면 단추로 가고 AI 단추는 맞추지 않는다', async () => {
    renderScreen(ui(), { path: '/', handlers: helpBundleHandlers() })
    await waitFor(() => expect(actions).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: 'AI 전체 화면' }))
    await waitFor(() => expect(screen.getByTestId('ai-mode')).toHaveTextContent('fullscreen'))
    act(() => actions.focusScreenControl('토큰 다시 넣기'))
    const pageButton = within_page('토큰 다시 넣기')
    await waitFor(() => expect(pageButton).toHaveFocus())
    expect(screen.getByTestId('ai-mode')).toHaveTextContent('side')
    // 전체 화면이 넣은 히스토리 항목도 함께 걷는다(표식만 남으면 뒤로가기에 AI 가 되살아난다).
    await waitFor(() => expect(screen.getByTestId('ai-history')).toHaveTextContent('off'))
  })

  it('창이 이미 열려 있어 scrolled 여도 데스크톱 전체 화면 AI 는 걷어 낸 뒤 스크롤한다', async () => {
    renderScreen(ui({ dialogOpen: true }), { path: '/', handlers: helpBundleHandlers() })
    await waitFor(() => expect(actions).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: 'AI 전체 화면' }))
    await waitFor(() => expect(screen.getByTestId('ai-mode')).toHaveTextContent('fullscreen'))
    let result: ReturnType<HelpAnswerActions['openDialog']> = 'missing'
    act(() => {
      result = actions.openDialog('agents.accounts.add')
    })
    expect(result).toBe('scrolled')
    await waitFor(() => expect(scrolled).toContain(screen.getByRole('button', { name: '계정 추가' })))
    expect(screen.getByTestId('ai-mode')).toHaveTextContent('side')
  })

  it('휴대폰에서 창이 이미 열려 있어 scrolled 여도 AI 시트를 닫은 뒤 스크롤한다', async () => {
    env.mobile = true
    renderScreen(ui({ dialogOpen: true }), { path: '/', handlers: helpBundleHandlers() })
    fireEvent.click(screen.getByRole('button', { name: 'AI 열기' }))
    await waitFor(() => expect(screen.getByTestId('ai-mode')).toHaveTextContent('fullscreen'))
    act(() => {
      expect(actions.openDialog('agents.accounts.add')).toBe('scrolled')
    })
    await waitFor(() => expect(scrolled).toContain(screen.getByRole('button', { name: '계정 추가' })))
    expect(screen.getByTestId('ai-mode')).toHaveTextContent('closed')
  })
})

/** 화면(페이지 영역) 안의 단추 — AI 패널 안 같은 이름 단추와 구분한다. */
function within_page(name: string): HTMLElement {
  const root = document.querySelector('[data-ai-page-root]') as HTMLElement
  return Array.from(root.querySelectorAll('button')).find((b) => b.textContent === name) as HTMLElement
}

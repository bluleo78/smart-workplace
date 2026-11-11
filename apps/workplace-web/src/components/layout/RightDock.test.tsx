// 오른쪽 도킹(RightDock, WP-1505) 화면 테스트 — 배치에 따라 무엇을 그리고 무엇을 지우는지.
// jsdom 은 앱 셸이 없어 판정 폭이 window.innerWidth(기본 1024)다: 도움말 360 + AI 380 이면 본문 284 로 위아래,
// innerWidth 를 1920 으로 바꾸고 resize 를 보내면 나란히다. 실제 상자 위치는 E2E(e2e/pages/layout/help-panel.spec.ts)가 잰다.
// AI 패널 본체(AISidePanel)는 그대로 두고 그 안의 대화 영역·머리만 가벼운 대역으로 바꾼다 — 예전 마크업(손잡이·왼쪽 선)과
// 다시 마운트 여부(입력 초안)를 실제 aside 로 보려고.
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AIAssistantProvider, useAssistant } from '@/components/ai/AIAssistantContext'
import { HelpPanelProvider, useHelpPanel } from '@/components/help/HelpPanelContext'
import { helpBundleHandlers } from '@/test/kits/help/helpBundleKit'
import { renderScreen } from '@/test/renderScreen'

import { RightDock } from './RightDock'

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false, getIsMobile: () => false }))
// 대화 영역 대역 — 비제어 입력이라 aside 가 다시 마운트되면 글이 사라진다.
vi.mock('@/components/ai/AIChatPanel', () => ({ AIChatPanel: () => <textarea aria-label="AI 입력" /> }))
vi.mock('@/components/ai/AIPanelHeader', () => ({ AIPanelHeader: () => null }))
vi.mock('@/hooks/useAssistantChat', () => ({ useAssistantChat: () => ({}) }))

const DEFAULT_INNER_WIDTH = window.innerWidth

/** 판정 폭을 바꾼다 — RightDock 은 앱 셸이 없으면 window.innerWidth 를 쓰고 resize 로 다시 잰다. */
function setWindowWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  act(() => {
    window.dispatchEvent(new Event('resize'))
  })
}

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: DEFAULT_INNER_WIDTH })
  document.documentElement.style.removeProperty('--help-side-width')
  document.documentElement.style.removeProperty('--ai-side-width')
})

/** 도움말·AI 를 여닫는 단추. */
function Probe() {
  const help = useHelpPanel()
  const ai = useAssistant()
  return (
    <div>
      <button onClick={() => help.setOpen(!help.open)}>도움말 토글</button>
      <button onClick={() => (ai.mode === 'side' ? ai.close() : ai.open('side'))}>AI 토글</button>
    </div>
  )
}

function renderDock({ aiAvailable = true }: { aiAvailable?: boolean } = {}) {
  return renderScreen(
    <AIAssistantProvider hotkeysEnabled={false}>
      <HelpPanelProvider>
        <Probe />
        <RightDock aiAvailable={aiAvailable} />
      </HelpPanelProvider>
    </AIAssistantProvider>,
    { path: '/', handlers: helpBundleHandlers() },
  )
}

const helpWidthVar = () => document.documentElement.style.getPropertyValue('--help-side-width')

describe('RightDock', () => {
  it('도움말 하나만 열면 고정 폭 aside 와 --help-side-width 를 두고, 닫으면 언마운트하며 변수를 지운다', async () => {
    const { user } = renderDock()
    expect(screen.queryByTestId('help-panel')).toBeNull()
    expect(helpWidthVar()).toBe('')

    await user.click(screen.getByRole('button', { name: '도움말 토글' }))
    const aside = await screen.findByTestId('help-panel')
    expect(aside).toHaveStyle({ width: '360px' })
    expect(aside).toHaveClass('border-l')
    expect(screen.getByTestId('help-resize-handle')).toBeInTheDocument()
    expect(helpWidthVar()).toBe('360px')

    await user.click(screen.getByRole('button', { name: '도움말 토글' }))
    await waitFor(() => expect(screen.queryByTestId('help-panel')).toBeNull())
    expect(screen.queryByText('홈 첫머리 본문', { exact: false })).toBeNull()
    expect(helpWidthVar()).toBe('')
  })

  it('나란히면 --help-side-width 를 두고, 위아래로 합치면 지우며, 다시 나란히면 되살린다', async () => {
    setWindowWidth(1920)
    const { user } = renderDock()
    await user.click(screen.getByRole('button', { name: '도움말 토글' }))
    await user.click(screen.getByRole('button', { name: 'AI 토글' }))
    await screen.findByTestId('ai-side-panel')
    expect(screen.queryByTestId('right-dock-stacked')).toBeNull()
    expect(helpWidthVar()).toBe('360px')

    setWindowWidth(1280)
    expect(screen.getByTestId('right-dock-stacked')).toBeInTheDocument()
    expect(helpWidthVar()).toBe('')

    setWindowWidth(1920)
    expect(screen.queryByTestId('right-dock-stacked')).toBeNull()
    expect(helpWidthVar()).toBe('360px')
  })

  it('앱 셸이 있으면 셸·레일 폭으로 판정하고, 레일이 다시 마운트되면 새 레일 폭을 잰다', async () => {
    // 앱 셸(data-ai-page-root) 1500px + 레일. jsdom 은 레이아웃이 없어 폭을 요소에 직접 정한다.
    const shell = document.createElement('div')
    shell.setAttribute('data-ai-page-root', '')
    Object.defineProperty(shell, 'clientWidth', { configurable: true, value: 1500 })
    const makeRail = (width: number) => {
      const rail = document.createElement('aside')
      rail.setAttribute('data-testid', 'app-rail')
      Object.defineProperty(rail, 'offsetWidth', { configurable: true, value: width })
      return rail
    }
    shell.appendChild(makeRail(56))
    document.body.appendChild(shell)
    try {
      const { user } = renderDock()
      await user.click(screen.getByRole('button', { name: '도움말 토글' }))
      await user.click(screen.getByRole('button', { name: 'AI 토글' }))
      await screen.findByTestId('ai-side-panel')
      // 1500 − 56 − 360 − 380 = 704 ≥ 640 → 나란히(창 폭 1024 가 아니라 셸 폭으로 잰다).
      expect(screen.queryByTestId('right-dock-stacked')).toBeNull()
      // 레일이 다시 마운트되며 넓어지면(1500 − 200 − 740 = 560 < 640) 위아래로 합친다 — 떨어진 옛 레일 노드를 보면 그대로 나란히다.
      act(() => {
        shell.replaceChildren(makeRail(200))
      })
      await waitFor(() => expect(screen.getByTestId('right-dock-stacked')).toBeInTheDocument())
    } finally {
      shell.remove()
    }
  })

  it('도움말이 열린 채 RightDock 이 빠지면(셸 전환) --help-side-width 를 지운다', async () => {
    const { user, unmount } = renderDock()
    await user.click(screen.getByRole('button', { name: '도움말 토글' }))
    await screen.findByTestId('help-panel')
    expect(helpWidthVar()).toBe('360px')
    unmount()
    expect(helpWidthVar()).toBe('')
  })

  it('나란히 ↔ 위아래 전환에 AI aside 가 다시 마운트되지 않아 입력 초안이 남는다', async () => {
    setWindowWidth(1920)
    const { user } = renderDock()
    await user.click(screen.getByRole('button', { name: '도움말 토글' }))
    await user.click(screen.getByRole('button', { name: 'AI 토글' }))
    const input = await screen.findByRole('textbox', { name: 'AI 입력' })
    const aside = screen.getByTestId('ai-side-panel')
    await user.type(input, '초안')

    setWindowWidth(1280)
    expect(screen.getByTestId('right-dock-stacked')).toContainElement(aside)
    expect(screen.getByTestId('ai-side-panel')).toBe(aside)
    expect(screen.getByRole('textbox', { name: 'AI 입력' })).toBe(input)
    expect(input).toHaveValue('초안')
    // 위아래에서는 칸이 폭·손잡이·왼쪽 선을 갖는다 — AI aside 는 인라인 폭과 자체 손잡이가 없다.
    expect(aside.style.width).toBe('')
    expect(screen.queryByTestId('ai-resize-handle')).toBeNull()
    expect(screen.getByTestId('dock-resize-handle')).toBeInTheDocument()

    setWindowWidth(1920)
    expect(screen.getByTestId('ai-side-panel')).toBe(aside)
    expect(input).toHaveValue('초안')
  })

  it('AI 혼자면 예전 마크업 그대로 — 자체 손잡이·왼쪽 선·인라인 폭, 도움말·합친 칸 없음', async () => {
    const { user } = renderDock()
    await user.click(screen.getByRole('button', { name: 'AI 토글' }))
    const aside = await screen.findByTestId('ai-side-panel')
    expect(aside).toHaveClass('border-l')
    expect(aside).toHaveStyle({ width: '380px' })
    expect(screen.getByTestId('ai-resize-handle')).toBeInTheDocument()
    expect(screen.queryByTestId('help-panel')).toBeNull()
    expect(screen.queryByTestId('right-dock-stacked')).toBeNull()
    expect(helpWidthVar()).toBe('')
  })

  it('비서가 없으면 AI 를 열어도 그리지 않고 도움말만 붙는다', async () => {
    const { user } = renderDock({ aiAvailable: false })
    await user.click(screen.getByRole('button', { name: 'AI 토글' }))
    await user.click(screen.getByRole('button', { name: '도움말 토글' }))
    await screen.findByTestId('help-panel')
    expect(screen.queryByTestId('ai-side-panel')).toBeNull()
    expect(screen.queryByTestId('right-dock-stacked')).toBeNull()
    expect(helpWidthVar()).toBe('360px')
  })

  it('위아래 손잡이는 ↑↓ 로 5%씩, Home·End 로 끝까지 바꾸고 20~80 밖으로 나가지 않으며 도움말 칸을 가리킨다', async () => {
    const { user } = renderDock()
    await user.click(screen.getByRole('button', { name: '도움말 토글' }))
    await user.click(screen.getByRole('button', { name: 'AI 토글' }))
    const handle = await screen.findByRole('separator', { name: '도움말·AI 높이 조절' })
    const help = screen.getByTestId('help-panel')
    expect(handle).toHaveAttribute('aria-controls', help.id)
    expect(handle).toHaveAttribute('aria-valuenow', '50')
    expect(help).toHaveStyle({ flex: '0 0 50%' })

    handle.focus()
    await user.keyboard('{ArrowUp}')
    expect(handle).toHaveAttribute('aria-valuenow', '45')
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(handle).toHaveAttribute('aria-valuenow', '55')
    await user.keyboard('{End}{ArrowDown}')
    expect(handle).toHaveAttribute('aria-valuenow', '80')
    await user.keyboard('{Home}{ArrowUp}')
    expect(handle).toHaveAttribute('aria-valuenow', '20')
    expect(help).toHaveStyle({ flex: '0 0 20%' })
    expect(window.localStorage.getItem('help-dock-split')).toBe('0.2')
  })

  it('위아래 손잡이를 끄는 동안은 도움말 칸 높이만 바꾸고, 놓을 때 한 번 상태로 반영해 기억한다', async () => {
    const { user } = renderDock()
    await user.click(screen.getByRole('button', { name: '도움말 토글' }))
    await user.click(screen.getByRole('button', { name: 'AI 토글' }))
    const handle = await screen.findByTestId('dock-split-handle')
    const column = screen.getByTestId('right-dock-stacked')
    const help = screen.getByTestId('help-panel')
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 0, y: 100, width: 380, height: 800 }))

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 500 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 340 })
    // 끄는 중 — 칸 높이는 바뀌지만 상태(aria-valuenow)·저장은 그대로다.
    expect(help.style.flexBasis).toBe('30%')
    expect(handle).toHaveAttribute('aria-valuenow', '50')
    expect(window.localStorage.getItem('help-dock-split')).toBeNull()

    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 340 })
    expect(handle).toHaveAttribute('aria-valuenow', '30')
    expect(window.localStorage.getItem('help-dock-split')).toBe('0.3')
  })
})

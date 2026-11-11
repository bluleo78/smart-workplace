// 휴대폰 도움말 시트(WP-1505) — 전체 화면 시트로 열리고 ✕·뒤로 가기로 닫히며, 도움말과 AI 시트는 한 번에 하나만 열린다.
// 한 번에 하나는 양쪽 방향을 다 본다: 도움말이 열린 채 AI 가 열리면 도움말을 닫고, AI 가 열린 채 도움말을 열면 AI 를 닫는다.
// 둘 다 히스토리 항목(뒤로 가기 = 닫기)을 가지므로, 닫은 쪽 항목이 걷힌 뒤 남은 쪽이 열려 있어야 한다(뒤로 가기가 엇갈리지 않게).
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AIAssistantProvider, useAssistant } from '@/components/ai/AIAssistantContext'
import { MobileHelpButton } from '@/components/mobile/MobileHelpButton'
import { settleHistory } from '@/test/history'
import { helpBundleHandlers } from '@/test/kits/help/helpBundleKit'
import { renderScreen } from '@/test/renderScreen'

import { HelpPanelProvider, useHelpPanel } from './HelpPanelContext'
import { MobileHelpSheet } from './MobileHelpSheet'

// 휴대폰 셸로 고정한다(jsdom matchMedia 로는 폭을 바꿀 수 없다). AI 옆 패널은 휴대폰에서 전체 화면으로 올라간다.
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => true, getIsMobile: () => true }))

/** 도움말·AI 를 여는 단추와 상태 글. 시트가 모달이라 바깥 단추는 fireEvent 로 누른다(포인터가 막힌다). */
function Probe() {
  const help = useHelpPanel()
  const ai = useAssistant()
  return (
    <div>
      <output data-testid="ai-mode">{ai.mode}</output>
      <output data-testid="help-open">{help.open ? 'open' : 'closed'}</output>
      <button onClick={() => help.setOpen(true)}>도움말 열기</button>
      <button onClick={() => ai.open('side')}>AI 열기</button>
      {/* 히스토리 항목 없이 AI 가 열리는 경로(딥링크·셸 전환 등)의 흉내 — dismiss 는 모드만 바꾸고 항목을 넣지 않는다. */}
      <button onClick={() => ai.dismiss('side')}>AI 기록 없이 열기</button>
    </div>
  )
}

const ui = (
  <AIAssistantProvider hotkeysEnabled>
    <HelpPanelProvider>
      <Probe />
      <MobileHelpSheet />
    </HelpPanelProvider>
  </AIAssistantProvider>
)

/** 도움말 시트를 열고 본문이 뜰 때까지. */
async function openSheet() {
  fireEvent.click(screen.getByRole('button', { name: '도움말 열기', hidden: true }))
  await screen.findByTestId('help-sheet')
  await screen.findByText('홈 첫머리 본문', { exact: false })
}

describe('MobileHelpSheet', () => {
  it('열면 전체 화면 시트에 도움말을 보이고, ✕ 로 닫힌다', async () => {
    const { user } = renderScreen(ui, { path: '/', handlers: helpBundleHandlers() })
    await openSheet()
    await user.click(screen.getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByTestId('help-sheet')).toBeNull())
    expect(screen.getByTestId('help-open')).toHaveTextContent('closed')
  })

  it('뒤로 가기로 닫히고 기록 위치가 연 자리로 돌아온다', async () => {
    renderScreen(ui, { path: '/', handlers: helpBundleHandlers() })
    // 라우터가 history.state 에 두는 기록 순번(idx) — 시트가 넣은 항목을 걷으면 연 자리 순번으로 돌아와야 한다(기록이 남지 않음).
    const startIdx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    await openSheet()
    expect((window.history.state as { idx?: number } | null)?.idx).toBe(startIdx + 1)
    act(() => window.history.back())
    await waitFor(() => expect(screen.queryByTestId('help-sheet')).toBeNull())
    expect(screen.getByTestId('help-open')).toHaveTextContent('closed')
    await settleHistory()
    expect((window.history.state as { idx?: number } | null)?.idx ?? 0).toBe(startIdx)
  })

  it('도움말이 열린 채 AI 가 열리면 도움말을 닫고 AI 만 남는다 — 뒤로 가기는 AI 를 닫는다', async () => {
    renderScreen(ui, { path: '/', handlers: helpBundleHandlers() })
    await openSheet()
    fireEvent.click(screen.getByRole('button', { name: 'AI 열기', hidden: true }))
    await waitFor(() => expect(screen.queryByTestId('help-sheet')).toBeNull())
    await waitFor(() => expect(screen.getByTestId('ai-mode')).toHaveTextContent('fullscreen'))
    await settleHistory()
    expect(screen.getByTestId('ai-mode')).toHaveTextContent('fullscreen')
    expect(screen.getByTestId('help-open')).toHaveTextContent('closed')
    // AI 항목이 제자리에 있다 — 뒤로 가면 AI 가 닫히고 도움말은 되살아나지 않는다.
    act(() => window.history.back())
    await waitFor(() => expect(screen.getByTestId('ai-mode')).toHaveTextContent('closed'))
    expect(screen.queryByTestId('help-sheet')).toBeNull()
  })

  it('도움말이 열린 채 AI 가 히스토리 항목 없이 열려도 도움말을 닫아 두 시트가 겹치지 않는다 — 뒤로 가기는 AI 를 닫는다', async () => {
    renderScreen(ui, { path: '/', handlers: helpBundleHandlers() })
    await openSheet()
    fireEvent.click(screen.getByRole('button', { name: 'AI 기록 없이 열기', hidden: true }))
    await waitFor(() => expect(screen.queryByTestId('help-sheet')).toBeNull())
    expect(screen.getByTestId('help-open')).toHaveTextContent('closed')
    await waitFor(() => expect(screen.getByTestId('ai-mode')).toHaveTextContent('fullscreen'))
    await settleHistory()
    expect(screen.getByTestId('ai-mode')).toHaveTextContent('fullscreen')
    // 도움말 항목은 걷혔고 AI 가 제 항목으로 다시 열렸다 — 뒤로 가면 AI 가 닫히고 도움말은 되살아나지 않는다.
    act(() => window.history.back())
    await waitFor(() => expect(screen.getByTestId('ai-mode')).toHaveTextContent('closed'))
    expect(screen.queryByTestId('help-sheet')).toBeNull()
  })

  it('「✦ AI에게 묻기」는 도움말을 닫고 AI 를 연다 — 뒤로 가기 한 번에 AI 만 닫히고, 다시 열면 도움말만 열린다', async () => {
    const { user } = renderScreen(ui, { path: '/', handlers: helpBundleHandlers() })
    await openSheet()
    await user.click(screen.getByRole('button', { name: '✦ AI에게 묻기' }))
    await waitFor(() => expect(screen.getByTestId('ai-mode')).toHaveTextContent('fullscreen'))
    expect(screen.queryByTestId('help-sheet')).toBeNull()
    await settleHistory()
    expect(screen.getByTestId('ai-mode')).toHaveTextContent('fullscreen')
    // AI 항목이 도움말 항목을 이어받지 않았다 — 뒤로 가기 한 번이면 AI 가 닫히고 도움말도 다시 뜨지 않는다.
    act(() => window.history.back())
    await waitFor(() => expect(screen.getByTestId('ai-mode')).toHaveTextContent('closed'))
    await settleHistory()
    expect(screen.queryByTestId('help-sheet')).toBeNull()
    expect(screen.getByTestId('help-open')).toHaveTextContent('closed')
    // 다시 도움말을 열면 도움말만 열린다(AI 는 닫힌 채).
    await openSheet()
    expect(screen.getByTestId('ai-mode')).toHaveTextContent('closed')
  })

  it('AI 가 열린 채 도움말을 열면 AI 를 닫고 도움말이 열린다 — 뒤로 가기는 도움말을 닫고 AI 는 되살아나지 않는다', async () => {
    renderScreen(ui, { path: '/', handlers: helpBundleHandlers() })
    fireEvent.click(screen.getByRole('button', { name: 'AI 열기' }))
    expect(screen.getByTestId('ai-mode')).toHaveTextContent('fullscreen')
    await settleHistory()
    fireEvent.click(screen.getByRole('button', { name: '도움말 열기' }))
    await screen.findByTestId('help-sheet')
    expect(screen.getByTestId('ai-mode')).toHaveTextContent('closed')
    await settleHistory()
    act(() => window.history.back())
    await waitFor(() => expect(screen.queryByTestId('help-sheet')).toBeNull())
    await settleHistory()
    expect(screen.getByTestId('ai-mode')).toHaveTextContent('closed')
  })

  it('헤더 「?」(MobileHelpButton)는 AI 가 열려 있어도 도움말을 열고, 뒤로 가기는 도움말만 닫는다', async () => {
    renderScreen(
      <AIAssistantProvider hotkeysEnabled>
        <HelpPanelProvider>
          <Probe />
          <MobileHelpButton />
          <MobileHelpSheet />
        </HelpPanelProvider>
      </AIAssistantProvider>,
      { path: '/', handlers: helpBundleHandlers() },
    )
    fireEvent.click(screen.getByRole('button', { name: 'AI 열기' }))
    await settleHistory()
    fireEvent.click(screen.getByRole('button', { name: '도움말' }))
    await screen.findByTestId('help-sheet')
    // 단추는 열기만 하고 AI 닫기는 시트(②)가 맡는다 — 시트가 보일 때 AI 는 이미 닫혀 있다.
    expect(screen.getByTestId('ai-mode')).toHaveTextContent('closed')
    await settleHistory()
    act(() => window.history.back())
    await waitFor(() => expect(screen.queryByTestId('help-sheet')).toBeNull())
    await settleHistory()
    expect(screen.getByTestId('ai-mode')).toHaveTextContent('closed')
  })
})

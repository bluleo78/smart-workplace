// 도움말 단추(WP-1505) — 데스크톱 상단 「?」는 누를 때마다 패널을 여닫고(aria-pressed 로 상태를 알린다),
// 모바일 헤더 「?」는 도움말을 열기만 한다 — 휴대폰의 「한 번에 하나」(AI 닫기)는 도움말 시트가 맡는다(MobileHelpSheet.test 의 헤더 「?」 경우).
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AIAssistantProvider, useAssistant } from '@/components/ai/AIAssistantContext'
import { MobileHelpButton } from '@/components/mobile/MobileHelpButton'
import { renderScreen } from '@/test/renderScreen'

import { HelpPanelProvider, useHelpPanel } from './HelpPanelContext'
import { HelpTrigger } from './HelpTrigger'

// 모바일 단추 테스트는 휴대폰 셸에서 돈다 — jsdom matchMedia 로는 폭을 바꿀 수 없어 판정을 가변 값으로 대신한다.
const mobile = vi.hoisted(() => ({ value: false }))
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mobile.value, getIsMobile: () => mobile.value }))

/** AI 모드·도움말 열림을 글로 보이고 AI 를 여는 단추를 둔 탐침. */
function Probe() {
  const ai = useAssistant()
  const help = useHelpPanel()
  return (
    <div>
      <output data-testid="ai-mode">{ai.mode}</output>
      <output data-testid="help-open">{help.open ? 'open' : 'closed'}</output>
      <button onClick={() => ai.open('side')}>AI 열기</button>
    </div>
  )
}

function wrap(trigger: React.ReactNode) {
  return (
    <AIAssistantProvider hotkeysEnabled>
      <HelpPanelProvider>
        {trigger}
        <Probe />
      </HelpPanelProvider>
    </AIAssistantProvider>
  )
}

describe('HelpTrigger', () => {
  it('누를 때마다 도움말을 여닫고 aria-pressed 로 열림을 알린다', async () => {
    mobile.value = false
    const { user } = renderScreen(wrap(<HelpTrigger />))
    const button = screen.getByRole('button', { name: '도움말 (?)' })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    await user.click(button)
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('help-open')).toHaveTextContent('open')
    await user.click(button)
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('help-open')).toHaveTextContent('closed')
  })
})

describe('MobileHelpButton', () => {
  it('누르면 도움말을 연다', async () => {
    mobile.value = true
    const { user } = renderScreen(wrap(<MobileHelpButton />))
    await user.click(screen.getByRole('button', { name: '도움말' }))
    expect(screen.getByTestId('help-open')).toHaveTextContent('open')
  })
})

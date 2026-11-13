// 도움말 열기 기록(WP-1512) — 사용자 동작(「?」 단추·단축키·휴대폰 단추·밖에서 절 고르기)만 기록하고,
// 기억된 열림으로 시작하는 것·닫기는 기록하지 않는다. 기록 요청이 실패해도 패널은 그대로 열린다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import { MobileHelpButton } from '@/components/mobile/MobileHelpButton'
import { helpMetricHandlers } from '@/test/kits/help/helpBundleKit'
import { renderScreen } from '@/test/renderScreen'

import { HelpPanelProvider, useHelpPanel, useHelpPanelActions } from './HelpPanelContext'
import { helpOpenKey, writeHelpOpen } from './helpPanelStorage'
import { HelpTrigger } from './HelpTrigger'

// 휴대폰 여부는 가변 값으로 대신한다(HelpTrigger.test.tsx 와 같다).
const mobile = vi.hoisted(() => ({ value: false }))
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mobile.value, getIsMobile: () => mobile.value }))
// 패널 본체 미리 받기는 부른 것만 확인한다(WP-1530).
vi.mock('./helpPanelLoader', () => ({ preloadHelpPanel: vi.fn(() => Promise.resolve()) }))

const ROUTE = '/projects/WP/issues/12'

/** 열림을 글로 보이는 탐침. */
function Probe() {
  const help = useHelpPanel()
  return <output data-testid="help-open">{help.open ? 'open' : 'closed'}</output>
}

/** 패널 밖에서 절을 고르는 단추(화면의 「연결 방법」·AI 답 출처와 같은 길). */
function OutsideSelect() {
  const actions = useHelpPanelActions()
  return <button onClick={() => actions?.select({ chapter: 'home', sectionId: 'home.widgets' }, null)}>밖에서 고르기</button>
}

function ui() {
  return (
    <AIAssistantProvider hotkeysEnabled>
      <HelpPanelProvider>
        <HelpTrigger />
        <MobileHelpButton />
        <OutsideSelect />
        <Probe />
      </HelpPanelProvider>
    </AIAssistantProvider>
  )
}

const settle = () => new Promise((r) => setTimeout(r, 300))

describe('도움말 열기 기록', () => {
  it('? 단추로 열면 한 번 기록하고 닫을 때는 기록하지 않는다', async () => {
    mobile.value = false
    const opens: unknown[] = []
    const { user } = renderScreen(ui(), { path: ROUTE, handlers: helpMetricHandlers(opens) })
    const button = screen.getByRole('button', { name: '도움말 (?)' })
    await user.click(button)
    await user.click(button)
    await waitFor(() => expect(opens).toEqual([{ route: '/projects/:key/issues/:id', helpId: null }]))
    await settle()
    expect(opens).toHaveLength(1)
  })

  it('? 단축키로 열면 기록한다', async () => {
    mobile.value = false
    const opens: unknown[] = []
    const { user } = renderScreen(ui(), { path: ROUTE, handlers: helpMetricHandlers(opens) })
    await user.keyboard('?')
    await waitFor(() => expect(opens).toHaveLength(1))
  })

  it('기억된 열림으로 시작하면 기록하지 않는다', async () => {
    mobile.value = false
    writeHelpOpen(helpOpenKey({ userId: 1, tenantId: 1 }), true)
    const opens: unknown[] = []
    renderScreen(ui(), { path: ROUTE, handlers: helpMetricHandlers(opens), auth: { activeTenant: { tenantId: 1 } as never } })
    await settle()
    expect(screen.getByTestId('help-open')).toHaveTextContent('open')
    expect(opens).toEqual([])
  })

  it('휴대폰 도움말 단추로 열면 기록한다', async () => {
    mobile.value = true
    const opens: unknown[] = []
    const { user } = renderScreen(ui(), { path: ROUTE, handlers: helpMetricHandlers(opens) })
    await user.click(screen.getByRole('button', { name: '도움말' }))
    await waitFor(() => expect(opens).toHaveLength(1))
  })

  it('밖에서 절을 고르면 그 절 id 로 기록한다', async () => {
    mobile.value = false
    const opens: unknown[] = []
    const { user } = renderScreen(ui(), { path: ROUTE, handlers: helpMetricHandlers(opens) })
    await user.click(screen.getByRole('button', { name: '밖에서 고르기' }))
    await waitFor(() => expect(opens).toEqual([{ route: '/projects/:key/issues/:id', helpId: 'home.widgets' }]))
  })

  it('기록 요청이 실패해도 패널은 열린다', async () => {
    mobile.value = false
    let failedCalls = 0
    const { user } = renderScreen(ui(), {
      path: ROUTE,
      handlers: [
        http.post('/api/v1/help/metrics/open', () => {
          failedCalls += 1
          return new HttpResponse(null, { status: 500 })
        }),
      ],
    })
    await user.click(screen.getByRole('button', { name: '도움말 (?)' }))
    expect(screen.getByTestId('help-open')).toHaveTextContent('open')
    await waitFor(() => expect(failedCalls).toBe(1))
    expect(screen.queryByText(/오류|실패/)).toBeNull()
  })
})

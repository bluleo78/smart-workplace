// 도움말 패널의 AI 화면 참고 등록(WP-1511) — 보던 절·검색어·포커스 칸이 store.help 에 실리고, 비밀값은 새지 않으며,
// 패널을 닫으면 풀리는지 본다. 묶음·검색 응답은 MSW 로 준다(helpBundleKit), 받침은 HelpPanelHost.
import { screen, waitFor } from '@testing-library/react'
import { useContext, useEffect } from 'react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import { AiScreenContextProvider } from '@/components/ai/screen-context/AiScreenContextProvider'
import { AiScreenContextStoreContext } from '@/components/ai/screen-context/useAiScreenContext'
import { helpBundleHandlers, helpSearchHandler } from '@/test/kits/help/helpBundleKit'
import { HelpPanelHost } from '@/test/kits/help/HelpPanelHost'
import { renderScreen, type ScreenUser } from '@/test/renderScreen'

import { HelpPanelProvider, useHelpPanel } from './HelpPanelContext'

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false, getIsMobile: () => false }))

const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1000 })
})
afterAll(() => {
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth)
})

/** 테스트가 store 를 읽도록 밖으로 꺼내 둔다. */
let store: { get(): { help?: { section?: { id: string; path: string[]; body: string }; focus?: { name: string; secret?: true; value?: string }; query?: string } } | null } | null = null
function StoreProbe() {
  const ctx = useContext(AiScreenContextStoreContext)
  useEffect(() => {
    store = ctx as typeof store
  }, [ctx])
  return null
}

/** 저장소 연결 절을 직접 고르는 탐침. */
function PickRepo() {
  const help = useHelpPanel()
  return <button onClick={() => help.select({ chapter: 'agents', sectionId: 'agent.run.repo' }, null)}>저장소 절</button>
}

const ui = (
  <AIAssistantProvider hotkeysEnabled={false}>
    <AiScreenContextProvider>
      <HelpPanelProvider>
        <StoreProbe />
        <PickRepo />
        <HelpPanelHost openButton />
        {/* 화면 쪽 칸 — 도움말 패널 밖. 비밀값 칸(토큰)과 일반 칸 */}
        <div data-help="agent.run.repo">
          <label htmlFor="t">토큰</label>
          <input id="t" />
        </div>
      </HelpPanelProvider>
    </AiScreenContextProvider>
  </AIAssistantProvider>
)

const admin = { isAdmin: true }

async function openPanel(user: ScreenUser) {
  await user.click(screen.getByRole('button', { name: '열기' }))
  await screen.findByRole('combobox', { name: '도움말 검색' })
}

describe('HelpPanel AI 화면 참고', () => {
  it('절이 보이면 화면 참고에 help.section(id·경로·본문)이 실린다', async () => {
    const { user } = renderScreen(ui, { path: '/settings/agents/7', handlers: helpBundleHandlers(), auth: admin })
    await openPanel(user)
    await user.click(screen.getByRole('button', { name: '저장소 절' }))
    await waitFor(() => expect(store?.get()?.help?.section?.id).toBe('agent.run.repo'))
    const section = store!.get()!.help!.section!
    expect(section.path.at(-1)).toBe('저장소 연결')
    expect(section.body).toContain('저장소 연결 본문')
  })

  it('검색칸 질의가 help.query 로 실린다', async () => {
    const { user } = renderScreen(ui, { path: '/settings/agents/7', handlers: [helpSearchHandler(), ...helpBundleHandlers()], auth: admin })
    await openPanel(user)
    await user.type(screen.getByRole('combobox', { name: '도움말 검색' }), '토큰 만료')
    await waitFor(() => expect(store?.get()?.help?.query).toBe('토큰 만료'))
    // 검색 결과를 보는 동안은 읽는 절이 없다 — section 은 없고 query 만 실린다.
    await waitFor(() => expect(store?.get()?.help?.section).toBeUndefined())
    expect(store?.get()?.help?.query).toBe('토큰 만료')
  })

  it('토큰 칸 포커스 뒤 화면 참고에 칸 이름만 있고 입력값 문자열이 없다', async () => {
    const { user } = renderScreen(ui, { path: '/settings/agents/7', handlers: helpBundleHandlers(), auth: admin })
    await openPanel(user)
    await user.click(screen.getByLabelText('토큰'))
    await user.keyboard('ghp_secret')
    await waitFor(() => expect(store?.get()?.help?.focus).toEqual({ name: '토큰', secret: true }))
    // 디바운스(200ms)보다 길게 기다린 뒤에도 값이 없다
    await new Promise((r) => setTimeout(r, 350))
    expect(JSON.stringify(store!.get())).not.toContain('ghp_secret')
    expect(store!.get()!.help!.focus!.secret).toBe(true)
  })

  it('패널이 닫히면 help 층이 풀린다', async () => {
    const { user } = renderScreen(ui, { path: '/settings/agents/7', handlers: helpBundleHandlers(), auth: admin })
    await openPanel(user)
    await waitFor(() => expect(store?.get()?.help).toBeTruthy())
    await user.click(screen.getByTestId('help-close'))
    await waitFor(() => expect(store?.get()?.help).toBeUndefined())
  })
})

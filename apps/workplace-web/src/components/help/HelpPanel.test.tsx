// 도움말 패널 내용(WP-1505) — 주소에 맞는 장 첫머리, ⌄ 목록·브레드크럼·뒤로로 절 사이를 오가는지,
// 관리자 장이 일반 구성원의 목차·관련에서 빠지는지, 묶음을 못 받을 때(목차 404·장 404)의 상태, 자리표시 채움,
// 「✦ AI에게 묻기」(AI 가 있을 때만)와 ✕ 닫기를 본다. 묶음은 MSW 로 준다(helpBundleKit).
import { screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { AIAssistantProvider, useAssistant } from '@/components/ai/AIAssistantContext'
import { helpBundleHandlers, helpIndexFixture } from '@/test/kits/help/helpBundleKit'
import { renderScreen } from '@/test/renderScreen'
import { testAuthValue } from '@/test/renderWithProviders'

import { HelpPanel } from './HelpPanel'
import { HelpPanelProvider, useHelpPanel } from './HelpPanelContext'
import { HelpTrigger } from './HelpTrigger'
import { useProvideHelpValues } from './helpValues'

// 데스크톱 셸로 고정한다(jsdom matchMedia 로는 폭을 바꿀 수 없다).
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false, getIsMobile: () => false }))

// jsdom 은 폭이 0 이라 공용 브레드크럼이 늘 접힌다(뒤 ⌄ 표식 폭만큼 모자람) — 넉넉한 폭을 주어 경로 단계를 그대로 본다.
// 접기 자체는 Breadcrumb 테스트·E2E 몫이다.
const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1000 })
})
afterAll(() => {
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth)
})

/** 패널을 열림 상태에 따라 그리는 받침 — 「열기」 단추로 열고, AI 모드를 글로 보인다. */
function Host() {
  const help = useHelpPanel()
  const ai = useAssistant()
  return (
    <div>
      <button onClick={() => help.setOpen(true)}>열기</button>
      <output data-testid="ai-mode">{ai.mode}</output>
      {help.open && <HelpPanel />}
    </div>
  )
}

/** 화면이 자리표시 값을 등록하는 흉내. */
function ValueProbe() {
  useProvideHelpValues({ placeholders: { 'agent.username': 'dev5' } })
  return null
}

const ui = (extra?: React.ReactNode) => (
  <AIAssistantProvider hotkeysEnabled={false}>
    <HelpPanelProvider>
      <Host />
      {extra}
    </HelpPanelProvider>
  </AIAssistantProvider>
)

const admin = { isAdmin: true }

/** 패널을 열고 본문이 뜰 때까지 기다린다. */
async function openPanel(user: ReturnType<typeof renderScreen>['user'], text: string) {
  await user.click(screen.getByRole('button', { name: '열기' }))
  return screen.findByText(text, { exact: false })
}

describe('HelpPanel', () => {
  it('주소의 장 첫머리를 보인다 — 브레드크럼은 앱 이름 › 장 첫머리', async () => {
    const { user } = renderScreen(ui(), { path: '/settings/agents/7', handlers: helpBundleHandlers(), auth: admin })
    await openPanel(user, '에이전트 첫머리 본문')
    const crumbs = screen.getByTestId('help-breadcrumb')
    expect(within(crumbs).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['설정', 'AI 에이전트 관리'])
    // 첫 화면에는 돌아갈 곳이 없다.
    expect(screen.queryByTestId('help-back')).toBeNull()
    // 검색 칸은 자리만(동작은 WP-1509).
    expect(screen.getByRole('textbox', { name: '도움말 검색' })).toBeDisabled()
  })

  it('⌄ 목록에서 고르면 그 절이 보이고 뒤로 단추가 생긴다', async () => {
    const { user } = renderScreen(ui(), { path: '/settings/agents/7', handlers: helpBundleHandlers(), auth: admin })
    await openPanel(user, '에이전트 첫머리 본문')
    await user.click(screen.getByRole('button', { name: '이 화면 도움말 목록' }))
    const menu = await screen.findByTestId('help-section-menu')
    expect(within(menu).getByText('이 화면')).toBeInTheDocument()
    // 지금 절이 aria-current, 층만큼 들여쓴다.
    expect(within(menu).getByRole('button', { name: 'AI 에이전트 관리' })).toHaveAttribute('aria-current', 'true')
    await user.click(within(menu).getByRole('button', { name: '저장소 연결' }))
    expect(await screen.findByText('저장소 연결 본문.')).toBeInTheDocument()
    expect(screen.queryByTestId('help-section-menu')).toBeNull()
    await user.click(screen.getByTestId('help-back'))
    expect(await screen.findByText('에이전트 첫머리 본문.')).toBeInTheDocument()
    expect(screen.queryByTestId('help-back')).toBeNull()
  })

  it('브레드크럼 조상을 누르면 그 단계 절', async () => {
    const { user } = renderScreen(ui(), { path: '/settings/agents/7', handlers: helpBundleHandlers(), auth: admin })
    await openPanel(user, '에이전트 첫머리 본문')
    await user.click(screen.getByRole('button', { name: '이 화면 도움말 목록' }))
    await user.click(within(await screen.findByTestId('help-section-menu')).getByRole('button', { name: '저장소 연결' }))
    await screen.findByText('저장소 연결 본문.')
    const crumbs = screen.getByTestId('help-breadcrumb')
    expect(within(crumbs).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['설정', 'AI 에이전트 관리', '실행', '저장소 연결'])
    // 앱 이름 칸은 누를 수 없다.
    expect(within(crumbs).queryByRole('button', { name: '설정' })).toBeNull()
    await user.click(within(crumbs).getByRole('button', { name: '실행' }))
    expect(await screen.findByText('실행 본문.', { exact: false })).toBeInTheDocument()
  })

  it('관리자 장은 일반 구성원의 관련 목록·본문 링크·목차에 없다', async () => {
    const { user } = renderScreen(ui(), { path: '/', handlers: helpBundleHandlers() })
    await openPanel(user, '홈 첫머리 본문')
    // 본문의 관리자 장 링크는 글로만, 같은 장 링크는 이동 단추.
    expect(screen.queryByRole('button', { name: '에이전트' })).toBeNull()
    expect(screen.getByRole('button', { name: '위젯' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '이 화면 도움말 목록' }))
    const menu = await screen.findByTestId('help-section-menu')
    expect(within(menu).getByText('관련')).toBeInTheDocument()
    expect(within(menu).queryByText('AI 에이전트 관리')).toBeNull()
    // 본문 링크로 같은 장 절로 이동하면 뒤로 단추가 생긴다.
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: '위젯' }))
    expect(await screen.findByText('위젯 본문.')).toBeInTheDocument()
    expect(screen.getByTestId('help-back')).toBeInTheDocument()
  })

  it('주소에 맞는 장이 없으면 목차 — 보이는 장만, 누르면 그 장 첫머리', async () => {
    const { user } = renderScreen(ui(), { path: '/nowhere', handlers: helpBundleHandlers() })
    await openPanel(user, '목차')
    const toc = screen.getByTestId('help-toc')
    expect(within(toc).getByRole('button', { name: '홈' })).toBeInTheDocument()
    expect(within(toc).queryByRole('button', { name: 'AI 에이전트 관리' })).toBeNull()
    await user.click(within(toc).getByRole('button', { name: '홈' }))
    expect(await screen.findByText('홈 첫머리 본문', { exact: false })).toBeInTheDocument()
  })

  it('목차가 404 면 불러오지 못함 + 다시 시도, 다시 시도는 다시 요청한다', async () => {
    let calls = 0
    const handlers = [
      http.get('/help/manual-index.json', () => {
        calls += 1
        return calls === 1 ? new HttpResponse('<html></html>', { status: 404 }) : HttpResponse.json(helpIndexFixture)
      }),
      ...helpBundleHandlers(),
    ]
    const { user } = renderScreen(ui(), { path: '/', handlers })
    await openPanel(user, '도움말을 불러오지 못함')
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByText('홈 첫머리 본문', { exact: false })).toBeInTheDocument()
    expect(calls).toBe(2)
  })

  it('장 파일이 404 면 목차로 내려간다', async () => {
    const handlers = [http.get('/help/manual/home.json', () => new HttpResponse(null, { status: 404 })), ...helpBundleHandlers()]
    const { user } = renderScreen(ui(), { path: '/', handlers })
    await openPanel(user, '목차')
    expect(screen.getByTestId('help-toc')).toBeInTheDocument()
  })

  it('장 파일이 500 이면 불러오지 못함 + 다시 시도', async () => {
    const handlers = [http.get('/help/manual/home.json', () => new HttpResponse(null, { status: 500 })), ...helpBundleHandlers()]
    const { user } = renderScreen(ui(), { path: '/', handlers })
    await openPanel(user, '도움말을 불러오지 못함')
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
  })

  it('자리표시를 화면 값으로 채워 보인다', async () => {
    const { user } = renderScreen(ui(<ValueProbe />), { path: '/settings/agents/7', handlers: helpBundleHandlers(), auth: admin })
    await openPanel(user, '에이전트 첫머리 본문')
    await user.click(screen.getByRole('button', { name: '이 화면 도움말 목록' }))
    await user.click(within(await screen.findByTestId('help-section-menu')).getByRole('button', { name: '실행' }))
    expect(await screen.findByText('실행 본문. 아이디는 dev5 이다.')).toBeInTheDocument()
  })

  it('AI 가 없으면 AI에게 묻기 단추가 없다', async () => {
    const { user } = renderScreen(ui(), {
      path: '/',
      handlers: helpBundleHandlers(),
      auth: { user: { ...testAuthValue.user!, aiAvailable: false } },
    })
    await openPanel(user, '홈 첫머리 본문')
    expect(screen.queryByTestId('help-ask-ai')).toBeNull()
  })

  it('AI 가 있으면 AI에게 묻기를 누를 때 옆 AI 패널이 열린다', async () => {
    const { user } = renderScreen(ui(), { path: '/', handlers: helpBundleHandlers() })
    await openPanel(user, '홈 첫머리 본문')
    await user.click(screen.getByRole('button', { name: '✦ AI에게 묻기' }))
    expect(screen.getByTestId('ai-mode')).toHaveTextContent('side')
    // 데스크톱은 도움말을 닫지 않는다(나란히 볼 수 있다).
    expect(screen.getByTestId('help-panel-body')).toBeInTheDocument()
  })

  it('✕ 를 누르면 닫힌다', async () => {
    const { user } = renderScreen(ui(), { path: '/', handlers: helpBundleHandlers() })
    await openPanel(user, '홈 첫머리 본문')
    await user.click(screen.getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByTestId('help-panel-body')).toBeNull())
  })

  it('패널 안에 포커스가 있을 때 ✕ 로 닫으면 상단 「?」 단추로 포커스가 돌아간다', async () => {
    const { user } = renderScreen(ui(<HelpTrigger />), { path: '/', handlers: helpBundleHandlers() })
    await openPanel(user, '홈 첫머리 본문')
    await user.click(screen.getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByTestId('help-panel-body')).toBeNull())
    await waitFor(() => expect(screen.getByTestId('help-toggle')).toHaveFocus())
  })

  it('패널 안에 포커스가 있을 때 ? 로 닫아도 「?」 단추로, 바깥에 있었으면 포커스를 옮기지 않는다', async () => {
    const { user } = renderScreen(ui(<HelpTrigger />), { path: '/', handlers: helpBundleHandlers() })
    await openPanel(user, '홈 첫머리 본문')
    screen.getByTestId('help-panel-content').focus()
    await user.keyboard('?')
    await waitFor(() => expect(screen.queryByTestId('help-panel-body')).toBeNull())
    await waitFor(() => expect(screen.getByTestId('help-toggle')).toHaveFocus())
    // 바깥(「열기」 단추)에 포커스를 두고 열었다 닫으면 포커스는 그 자리에 남는다.
    await openPanel(user, '홈 첫머리 본문')
    expect(screen.getByRole('button', { name: '열기' })).toHaveFocus()
    await user.keyboard('?')
    await waitFor(() => expect(screen.queryByTestId('help-panel-body')).toBeNull())
    await Promise.resolve()
    expect(screen.getByRole('button', { name: '열기' })).toHaveFocus()
  })

  it('마지막 기록에서 뒤로 가면 사라지는 「뒤로」 대신 본문 영역이 포커스를 받는다', async () => {
    const { user } = renderScreen(ui(), { path: '/', handlers: helpBundleHandlers() })
    await openPanel(user, '홈 첫머리 본문')
    await user.click(screen.getByRole('button', { name: '위젯' }))
    await screen.findByText('위젯 본문.')
    expect(screen.getByTestId('help-panel-content')).toHaveFocus()
    await user.click(screen.getByTestId('help-back'))
    await screen.findByText('홈 첫머리 본문', { exact: false })
    expect(screen.getByTestId('help-panel-content')).toHaveFocus()
  })

  it('⌄ 목록에서 다른 장 절을 고르면 받는 동안 aria-busy, 다 받으면 본문 영역이 포커스를 받는다', async () => {
    const handlers = [
      http.get('/help/manual/agents.json', async () => {
        await delay(50)
        const { helpChapterFixtures } = await import('@/test/kits/help/helpBundleKit')
        return HttpResponse.json(helpChapterFixtures.agents)
      }),
      ...helpBundleHandlers(),
    ]
    const { user } = renderScreen(ui(), { path: '/', handlers, auth: admin })
    await openPanel(user, '홈 첫머리 본문')
    await user.click(screen.getByRole('button', { name: '이 화면 도움말 목록' }))
    await user.click(within(await screen.findByTestId('help-section-menu')).getByRole('button', { name: 'AI 에이전트 관리' }))
    expect(screen.getByTestId('help-panel-content')).toHaveAttribute('aria-busy', 'true')
    await screen.findByText('에이전트 첫머리 본문.')
    expect(screen.getByTestId('help-panel-content')).toHaveAttribute('aria-busy', 'false')
    expect(screen.getByTestId('help-panel-content')).toHaveFocus()
  })
})

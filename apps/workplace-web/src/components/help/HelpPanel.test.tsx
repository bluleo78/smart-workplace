// 도움말 패널 내용(WP-1505) — 주소에 맞는 장 첫머리, ⌄ 목록·브레드크럼·뒤로로 절 사이를 오가는지,
// 관리자 장이 일반 구성원의 목차·관련에서 빠지는지, 묶음을 못 받을 때(목차 404·장 404)의 상태, 자리표시 채움,
// 「✦ AI에게 묻기」(AI 가 있을 때만)와 ✕ 닫기를 본다. 묶음은 MSW 로 준다(helpBundleKit).
// WP-1506: 화면 문맥(포커스한 data-help 칸) 따라가기, 포인터가 패널 위일 때 얼리기, 직접 고름 풀기, 굵은 글자 강조.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
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
    // 검색 칸은 쓸 수 있다(동작은 HelpPanel.search.test.tsx).
    expect(screen.getByRole('combobox', { name: '도움말 검색' })).toBeEnabled()
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

/** 예시 화면(API 토큰) 흉내 — 도움말 id 칸 둘과, 받침 밖에서 주소를 바꿀 navigate 를 내보낸다. 그 주소일 때만 그린다(앱 라우트처럼). */
let navigateTo: ((to: string) => void) | null = null
function TokensScreen() {
  const navigate = useNavigate()
  useEffect(() => {
    navigateTo = navigate
  }, [navigate])
  if (useLocation().pathname !== '/settings/tokens') return null
  return (
    <div data-help="tokens">
      <div data-help="tokens.list">
        <button>폐기</button>
      </div>
      <section data-help="tokens.connect">
        <button>복사</button>
      </section>
    </div>
  )
}

/** 브레드크럼 끝(지금 절 이름). */
function lastCrumb(): string | null {
  const items = within(screen.getByTestId('help-breadcrumb')).getAllByRole('listitem')
  return items[items.length - 1].textContent
}

describe('HelpPanel — 화면 문맥(WP-1506)', () => {
  it('data-help 칸 안 단추에 포커스하면 그 칸 절이 보인다', async () => {
    const { user } = renderScreen(ui(<TokensScreen />), { path: '/settings/tokens', handlers: helpBundleHandlers() })
    await openPanel(user, '내 설정 첫머리 본문')
    act(() => screen.getByRole('button', { name: '폐기' }).focus())
    expect(await screen.findByText('목록 본문.', { exact: false })).toBeInTheDocument()
    expect(lastCrumb()).toBe('API 토큰 목록')
    expect(screen.getByTestId('help-panel-body')).toHaveAttribute('data-help-source', 'focus')
    // 포커스한 단추 이름과 같은 굵은 글자를 강조한다.
    expect(screen.getByText('폐기', { selector: 'strong' })).toHaveAttribute('data-help-active')
    // 문맥으로 바뀔 때는 화면 포커스를 빼앗지 않는다.
    expect(screen.getByRole('button', { name: '폐기' })).toHaveFocus()
  })

  it('포인터가 패널 위에 있는 동안은 문맥으로 바뀌지 않고, 벗어나면 최신 칸으로 맞춘다', async () => {
    const { user } = renderScreen(ui(<TokensScreen />), { path: '/settings/tokens', handlers: helpBundleHandlers() })
    await openPanel(user, '내 설정 첫머리 본문')
    act(() => screen.getByRole('button', { name: '폐기' }).focus())
    await screen.findByText('목록 본문.', { exact: false })
    await user.hover(screen.getByTestId('help-panel-body'))
    act(() => screen.getByRole('button', { name: '복사' }).focus())
    expect(lastCrumb()).toBe('API 토큰 목록')
    await user.unhover(screen.getByTestId('help-panel-body'))
    expect(await screen.findByText('연결 본문.', { exact: false })).toBeInTheDocument()
    expect(lastCrumb()).toBe('도구에 연결하기')
  })

  it('경로 조상을 누르면 뒤로가 생기고, 화면 칸을 만지면 직접 고름이 풀려 그 칸 절로', async () => {
    const { user } = renderScreen(ui(<TokensScreen />), { path: '/settings/tokens', handlers: helpBundleHandlers() })
    await openPanel(user, '내 설정 첫머리 본문')
    act(() => screen.getByRole('button', { name: '폐기' }).focus())
    await screen.findByText('목록 본문.', { exact: false })
    await user.click(within(screen.getByTestId('help-breadcrumb')).getByRole('button', { name: 'API 토큰' }))
    expect(await screen.findByText('API 토큰 본문.')).toBeInTheDocument()
    expect(screen.getByTestId('help-back')).toBeInTheDocument()
    expect(screen.getByTestId('help-panel-body')).toHaveAttribute('data-help-source', 'selected')
    // 뒤로 — 따라 보던 절(목록)로 돌아가면 다시 화면을 따른다(기록 비움).
    await user.click(screen.getByTestId('help-back'))
    expect(await screen.findByText('목록 본문.', { exact: false })).toBeInTheDocument()
    expect(screen.queryByTestId('help-back')).toBeNull()
    expect(screen.getByTestId('help-panel-body')).toHaveAttribute('data-help-source', 'focus')
    // 다시 고른 뒤 화면 단추를 누르면 풀린다.
    await user.click(within(screen.getByTestId('help-breadcrumb')).getByRole('button', { name: 'API 토큰' }))
    await screen.findByText('API 토큰 본문.')
    // 누른 경로 칸이 사라져 user-event 는 패널 벗어남을 떨어진 요소에 보낸다(React 가 받지 못함) — 브라우저처럼 패널에서 포인터가 나간 것을 직접 알린다.
    fireEvent.pointerOut(screen.getByTestId('help-panel-body'), { relatedTarget: document.body })
    await user.click(screen.getByRole('button', { name: '복사' }))
    expect(await screen.findByText('연결 본문.', { exact: false })).toBeInTheDocument()
    expect(screen.queryByTestId('help-back')).toBeNull()
  })

  it('⌄ 목록(패널 밖 포털)을 다시 열어도 직접 고름은 풀리지 않는다', async () => {
    const { user } = renderScreen(ui(<TokensScreen />), { path: '/settings/tokens', handlers: helpBundleHandlers() })
    await openPanel(user, '내 설정 첫머리 본문')
    await user.click(screen.getByRole('button', { name: '이 화면 도움말 목록' }))
    await user.click(within(await screen.findByTestId('help-section-menu')).getByRole('button', { name: 'API 토큰 발급' }))
    await screen.findByText('발급 본문.', { exact: false })
    await user.click(screen.getByRole('button', { name: '이 화면 도움말 목록' }))
    await user.click(within(await screen.findByTestId('help-section-menu')).getByRole('button', { name: 'API 토큰 목록' }))
    await screen.findByText('목록 본문.', { exact: false })
    // 고른 절 둘이 기록에 남았다 — 뒤로 두 번이면 첫머리(따라 보던 절)로.
    await user.click(screen.getByTestId('help-back'))
    expect(await screen.findByText('발급 본문.', { exact: false })).toBeInTheDocument()
    expect(screen.getByTestId('help-back')).toBeInTheDocument()
  })

  it('터치로 패널을 건드리면(pointerType touch) 얼리지 않는다 — 화면 포커스가 곧바로 반영된다', async () => {
    const { user } = renderScreen(ui(<TokensScreen />), { path: '/settings/tokens', handlers: helpBundleHandlers() })
    await openPanel(user, '내 설정 첫머리 본문')
    act(() => screen.getByRole('button', { name: '폐기' }).focus())
    await screen.findByText('목록 본문.', { exact: false })
    fireEvent.pointerOver(screen.getByTestId('help-panel-body'), { pointerType: 'touch', relatedTarget: document.body })
    act(() => screen.getByRole('button', { name: '복사' }).focus())
    expect(await screen.findByText('연결 본문.', { exact: false })).toBeInTheDocument()
    expect(lastCrumb()).toBe('도구에 연결하기')
  })

  it('포인터가 패널 위여도 패널 안에서 고른 절은 곧바로 보이고, 화면 키보드 포커스로 직접 고름이 풀려도 벗어날 때까지 그대로다', async () => {
    const { user } = renderScreen(ui(<TokensScreen />), { path: '/settings/tokens', handlers: helpBundleHandlers() })
    await openPanel(user, '내 설정 첫머리 본문')
    act(() => screen.getByRole('button', { name: '폐기' }).focus())
    await screen.findByText('목록 본문.', { exact: false })
    await user.hover(screen.getByTestId('help-panel-body'))
    await user.click(within(screen.getByTestId('help-breadcrumb')).getByRole('button', { name: 'API 토큰' }))
    expect(await screen.findByText('API 토큰 본문.')).toBeInTheDocument()
    expect(screen.getByTestId('help-panel-body')).toHaveAttribute('data-help-source', 'selected')
    // 화면 키보드 포커스 — 직접 고름은 풀리지만(뒤로 사라짐) 읽던 절은 얼린 채 남는다. 출처는 얼린 값의 selected 그대로(의도).
    act(() => screen.getByRole('button', { name: '복사' }).focus())
    await waitFor(() => expect(screen.queryByTestId('help-back')).toBeNull())
    expect(screen.getByText('API 토큰 본문.')).toBeInTheDocument()
    expect(screen.getByTestId('help-panel-body')).toHaveAttribute('data-help-source', 'selected')
    // 벗어나면 최신 문맥(포커스한 칸)으로 맞춘다. 누른 경로 칸이 사라져 user-event 대신 벗어남을 직접 알린다.
    fireEvent.pointerOut(screen.getByTestId('help-panel-body'), { relatedTarget: document.body })
    expect(await screen.findByText('연결 본문.', { exact: false })).toBeInTheDocument()
    expect(screen.getByTestId('help-panel-body')).toHaveAttribute('data-help-source', 'focus')
  })

  it('묶음을 받는 중에 포인터가 패널에 들어와도, 그려진 뒤 그 내용으로 얼어 화면 포커스로 바뀌지 않는다', async () => {
    const slowIndex = http.get('/help/manual-index.json', async () => {
      await delay(50)
      return HttpResponse.json(helpIndexFixture)
    })
    const { user } = renderScreen(ui(<TokensScreen />), { path: '/settings/tokens', handlers: [slowIndex, ...helpBundleHandlers()] })
    await user.click(screen.getByRole('button', { name: '열기' }))
    // 받는 중(보일 내용 없음)에 패널 위로.
    await user.hover(await screen.findByTestId('help-panel-body'))
    await screen.findByText('내 설정 첫머리 본문', { exact: false })
    act(() => screen.getByRole('button', { name: '복사' }).focus())
    expect(screen.getByText('내 설정 첫머리 본문', { exact: false })).toBeInTheDocument()
    expect(screen.queryByText('연결 본문.', { exact: false })).toBeNull()
  })

  it('직접 고름이 풀린 뒤에도 얼린 채 보이던 고른 절에서 옮겨 가면, 뒤로로 그 절에 돌아온다(따라 보던 절로 치지 않음)', async () => {
    const { user } = renderScreen(ui(<TokensScreen />), { path: '/settings/tokens', handlers: helpBundleHandlers() })
    await openPanel(user, '내 설정 첫머리 본문')
    act(() => screen.getByRole('button', { name: '폐기' }).focus())
    await screen.findByText('목록 본문.', { exact: false })
    await user.hover(screen.getByTestId('help-panel-body'))
    await user.click(within(screen.getByTestId('help-breadcrumb')).getByRole('button', { name: 'API 토큰' }))
    await screen.findByText('API 토큰 본문.')
    // 화면 키보드 포커스로 직접 고름이 풀려도 읽던 「API 토큰」 절은 얼린 채 남는다(출처 selected).
    act(() => screen.getByRole('button', { name: '복사' }).focus())
    await waitFor(() => expect(screen.queryByTestId('help-back')).toBeNull())
    // 포인터를 패널 위에 둔 채(user-event 의 포인터 이동 없이) ⌄ 목록에서 다른 절로 옮긴다.
    fireEvent.click(screen.getByRole('button', { name: '이 화면 도움말 목록' }))
    fireEvent.click(within(await screen.findByTestId('help-section-menu')).getByRole('button', { name: 'API 토큰 발급' }))
    await screen.findByText('발급 본문.', { exact: false })
    // 뒤로 — 사용자가 고른 「API 토큰」 절로 돌아와야 한다(화면 문맥인 「도구에 연결하기」가 아니라).
    fireEvent.click(screen.getByTestId('help-back'))
    expect(await screen.findByText('API 토큰 본문.')).toBeInTheDocument()
    expect(screen.getByTestId('help-panel-body')).toHaveAttribute('data-help-source', 'selected')
  })

  it('포인터가 패널 위인 채 뒤로로 따라 보던 절에 돌아가면 지금 문맥을 보이고, 그 뒤 화면 포커스로는 바뀌지 않는다', async () => {
    const { user } = renderScreen(ui(<TokensScreen />), { path: '/settings/tokens', handlers: helpBundleHandlers() })
    await openPanel(user, '내 설정 첫머리 본문')
    act(() => screen.getByRole('button', { name: '폐기' }).focus())
    await screen.findByText('목록 본문.', { exact: false })
    await user.hover(screen.getByTestId('help-panel-body'))
    await user.click(within(screen.getByTestId('help-breadcrumb')).getByRole('button', { name: 'API 토큰' }))
    await screen.findByText('API 토큰 본문.')
    await user.click(screen.getByTestId('help-back'))
    expect(await screen.findByText('목록 본문.', { exact: false })).toBeInTheDocument()
    expect(screen.queryByTestId('help-back')).toBeNull()
    expect(screen.getByTestId('help-panel-body')).toHaveAttribute('data-help-source', 'focus')
    // 여전히 패널 위 — 다른 칸 포커스로는 바뀌지 않는다(되돌아간 문맥 값으로 다시 얼림).
    act(() => screen.getByRole('button', { name: '복사' }).focus())
    expect(screen.getByText('목록 본문.', { exact: false })).toBeInTheDocument()
    expect(lastCrumb()).toBe('API 토큰 목록')
  })

  it('열린 대화상자가 포커스 칸보다 이기고(출처 dialog), 닫히는 중(data-state=closed)이 되면 포커스 칸으로 돌아온다', async () => {
    const { user } = renderScreen(ui(<TokensScreen />), { path: '/settings/tokens', handlers: helpBundleHandlers() })
    await openPanel(user, '내 설정 첫머리 본문')
    act(() => screen.getByRole('button', { name: '폐기' }).focus())
    await screen.findByText('목록 본문.', { exact: false })
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('data-state', 'open')
    dialog.setAttribute('data-help', 'tokens.issue')
    await act(async () => {
      document.body.appendChild(dialog)
    })
    expect(await screen.findByText('발급 본문.', { exact: false })).toBeInTheDocument()
    expect(lastCrumb()).toBe('API 토큰 발급')
    expect(screen.getByTestId('help-panel-body')).toHaveAttribute('data-help-source', 'dialog')
    // 퇴장 애니메이션 동안 DOM 에 남아도 closed 면 이미 닫힌 것.
    await act(async () => {
      dialog.setAttribute('data-state', 'closed')
    })
    expect(await screen.findByText('목록 본문.', { exact: false })).toBeInTheDocument()
    expect(screen.getByTestId('help-panel-body')).toHaveAttribute('data-help-source', 'focus')
    dialog.remove()
  })

  it('본문 스크롤 위치의 칸이 보이면 출처는 scroll', async () => {
    // 앱 셸 본문(main 안 page-body)과 그 안 칸 — 첫 측정이 기준선(보이는 높이 30%)에 걸친 칸을 고른다.
    const shell = document.createElement('div')
    shell.setAttribute('data-ai-page-root', '')
    shell.innerHTML = '<main><div data-testid="page-body"><div data-help="tokens.connect"></div></div></main>'
    document.body.appendChild(shell)
    const pageBody = shell.querySelector('[data-testid="page-body"]')!
    Object.defineProperty(pageBody, 'clientHeight', { value: 600, configurable: true })
    const rect = (top: number, bottom: number) => () => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) })
    pageBody.getBoundingClientRect = rect(0, 600)
    shell.querySelector('[data-help]')!.getBoundingClientRect = rect(0, 600)
    try {
      const { user } = renderScreen(ui(), { path: '/settings/tokens', handlers: helpBundleHandlers() })
      await user.click(screen.getByRole('button', { name: '열기' }))
      expect(await screen.findByText('연결 본문.', { exact: false })).toBeInTheDocument()
      expect(lastCrumb()).toBe('도구에 연결하기')
      expect(screen.getByTestId('help-panel-body')).toHaveAttribute('data-help-source', 'scroll')
    } finally {
      shell.remove()
    }
  })

  it('포인터가 패널 위인 채 다른 주소에 갔다 돌아와도 옛 얼린 값이 되살아나지 않는다', async () => {
    const { user } = renderScreen(ui(<TokensScreen />), { path: '/settings/tokens', handlers: helpBundleHandlers() })
    await openPanel(user, '내 설정 첫머리 본문')
    act(() => screen.getByRole('button', { name: '폐기' }).focus())
    await screen.findByText('목록 본문.', { exact: false })
    await user.hover(screen.getByTestId('help-panel-body'))
    act(() => navigateTo?.('/'))
    await screen.findByText('홈 첫머리 본문', { exact: false })
    act(() => navigateTo?.('/settings/tokens'))
    // 돌아온 화면에서 포커스한 칸이 지금 문맥 — 옛 얼린 값(목록)이 아니라 그 칸 절.
    act(() => screen.getByRole('button', { name: '복사' }).focus())
    expect(await screen.findByText('연결 본문.', { exact: false })).toBeInTheDocument()
    expect(lastCrumb()).toBe('도구에 연결하기')
  })

  it('포인터가 패널 위인 채 주소가 바뀌면 얼린 값을 버리고 새 주소의 장 첫머리', async () => {
    const { user } = renderScreen(ui(<TokensScreen />), { path: '/settings/tokens', handlers: helpBundleHandlers() })
    await openPanel(user, '내 설정 첫머리 본문')
    act(() => screen.getByRole('button', { name: '폐기' }).focus())
    await screen.findByText('목록 본문.', { exact: false })
    await user.hover(screen.getByTestId('help-panel-body'))
    act(() => navigateTo?.('/'))
    expect(await screen.findByText('홈 첫머리 본문', { exact: false })).toBeInTheDocument()
  })
})

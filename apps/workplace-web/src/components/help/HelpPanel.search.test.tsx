// 도움말 패널 검색 칸(WP-1509) — 입력 → 디바운스 → `GET /api/v1/help/search`, 결과 목록(「결과 N건」·강조 카드),
// ↑/↓·Enter 로 열기, 연 뒤 「다른 결과」 칩, Esc 로 검색 전 내용 복귀, 0건·늦은 응답·빈 질의를 본다.
// 묶음·검색 응답은 MSW 로 준다(helpBundleKit). 받침은 HelpPanel.test.tsx 와 같은 HelpPanelHost 다.
import { screen, waitFor, within } from '@testing-library/react'
import { delay, HttpResponse } from 'msw'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import { helpBundleHandlers, helpSearchHandler, helpSearchHitsFixture } from '@/test/kits/help/helpBundleKit'
import { HelpPanelHost } from '@/test/kits/help/HelpPanelHost'
import { renderScreen, type ScreenUser } from '@/test/renderScreen'

import { HelpPanelProvider, useHelpPanelActions } from './HelpPanelContext'

// 데스크톱 셸로 고정한다(jsdom matchMedia 로는 폭을 바꿀 수 없다).
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false, getIsMobile: () => false }))

// jsdom 폭 0 이면 브레드크럼이 늘 접힌다 — HelpPanel.test.tsx 와 같은 이유로 넉넉한 폭을 준다.
const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1000 })
})
afterAll(() => {
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth)
})

/** 패널 밖에서 절을 고르는 단추(화면의 「연결 방법」·AI 답의 출처 자리, WP-1511). */
function OutsideSelect() {
  const actions = useHelpPanelActions()
  return <button onClick={() => actions?.select({ chapter: 'home', sectionId: 'home.widgets' }, null)}>밖에서 위젯</button>
}

const ui = (
  <AIAssistantProvider hotkeysEnabled={false}>
    <HelpPanelProvider>
      <OutsideSelect />
      <HelpPanelHost openButton />
    </HelpPanelProvider>
  </AIAssistantProvider>
)

// 결과의 둘은 관리자 장 절이다(서버가 관리자에게만 준다) — 열어 볼 수 있게 관리자로 띄운다.
const admin = { isAdmin: true }

/** 홈(`/`)에서 패널을 열고 첫머리 본문이 뜰 때까지 기다린 뒤 검색 칸을 돌려준다. */
async function openPanel(user: ScreenUser) {
  await user.click(screen.getByRole('button', { name: '열기' }))
  await screen.findByText('홈 첫머리 본문', { exact: false })
  return screen.getByRole('combobox', { name: '도움말 검색' })
}

/** 결과 카드들 — 목록이 뜰 때까지 기다린다. */
async function findCards() {
  const list = await screen.findByRole('listbox', { name: '도움말 검색 결과' })
  return within(list).getAllByTestId('help-search-result')
}

describe('HelpPanel 검색', () => {
  it('sends debounced query — 다 쓴 질의로 한 번만 부른다', async () => {
    const queries: string[] = []
    const { user } = renderScreen(ui, { path: '/', handlers: [helpSearchHandler(queries), ...helpBundleHandlers()], auth: admin })
    const input = await openPanel(user)
    await user.type(input, '토큰 만료')
    await findCards()
    expect(queries).toEqual(['토큰 만료'])
  })

  it('blank query does not request — 공백뿐이면 부르지 않고 본문을 그대로 둔다', async () => {
    const queries: string[] = []
    const { user } = renderScreen(ui, { path: '/', handlers: [helpSearchHandler(queries), ...helpBundleHandlers()], auth: admin })
    const input = await openPanel(user)
    await user.type(input, '   ')
    // 디바운스(300ms)가 지나도 요청이 없다 — 부재 확인이라 고정 대기가 불가피하다.
    await new Promise((r) => setTimeout(r, 450))
    expect(queries).toEqual([])
    expect(screen.getByText('홈 첫머리 본문', { exact: false })).toBeInTheDocument()
  })

  it('shows count and highlights first — 결과 N건, 첫 카드 강조, 제목·발췌', async () => {
    const { user } = renderScreen(ui, { path: '/', handlers: [helpSearchHandler(), ...helpBundleHandlers()], auth: admin })
    const input = await openPanel(user)
    await user.type(input, '실행')
    const cards = await findCards()
    expect(screen.getByTestId('help-search-count')).toHaveTextContent('결과 3건')
    expect(cards.map((c) => c.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false'])
    expect(cards[0]).toHaveTextContent('실행')
    expect(cards[0]).toHaveTextContent(helpSearchHitsFixture[0].snippet)
    // 검색 중에는 본문(브레드크럼·절) 자리를 결과가 차지한다.
    expect(screen.queryByText('홈 첫머리 본문', { exact: false })).toBeNull()
    expect(screen.queryByTestId('help-breadcrumb')).toBeNull()
  })

  it('enter opens first result and shows other results — 연 절 위에 나머지가 칩으로, 입력 포커스 유지', async () => {
    const { user } = renderScreen(ui, { path: '/', handlers: [helpSearchHandler(), ...helpBundleHandlers()], auth: admin })
    const input = await openPanel(user)
    await user.type(input, '실행')
    await findCards()
    await user.keyboard('{Enter}')
    expect(await screen.findByText('실행 본문.', { exact: false })).toBeInTheDocument()
    expect(screen.queryByRole('listbox', { name: '도움말 검색 결과' })).toBeNull()
    const other = screen.getByTestId('help-search-other')
    expect(within(other).getAllByRole('button').map((b) => b.textContent)).toEqual(['위젯', '저장소 연결'])
    expect(input).toHaveValue('실행')
    expect(input).toHaveFocus()
    // 직접 고른 것이라 보던 절로 돌아갈 「뒤로」가 생긴다.
    expect(screen.getByTestId('help-back')).toBeInTheDocument()
    // 칩을 누르면 그 절로, 칩 줄은 남고 연 것만 빠진다.
    await user.click(within(other).getByRole('button', { name: '저장소 연결' }))
    expect(await screen.findByText('저장소 연결 본문.')).toBeInTheDocument()
    expect(within(screen.getByTestId('help-search-other')).getAllByRole('button').map((b) => b.textContent)).toEqual(['실행', '위젯'])
  })

  it('arrow down then enter opens second — 끝에서 멈춘다', async () => {
    const { user } = renderScreen(ui, { path: '/', handlers: [helpSearchHandler(), ...helpBundleHandlers()], auth: admin })
    const input = await openPanel(user)
    await user.type(input, '실행')
    await findCards()
    await user.keyboard('{ArrowUp}')
    expect((await findCards())[0]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}')
    expect((await findCards())[2]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowUp}')
    expect((await findCards())[1]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(await screen.findByText('위젯 본문.')).toBeInTheDocument()
  })

  it('click on a card opens it', async () => {
    const { user } = renderScreen(ui, { path: '/', handlers: [helpSearchHandler(), ...helpBundleHandlers()], auth: admin })
    const input = await openPanel(user)
    await user.type(input, '실행')
    const cards = await findCards()
    await user.click(cards[2])
    expect(await screen.findByText('저장소 연결 본문.')).toBeInTheDocument()
    expect(screen.getByTestId('help-search-other')).toBeInTheDocument()
    // 누른 것은 포커스가 칸을 떠난 것이라 옮긴 절의 본문으로 포커스가 간다(Enter 로 연 때와 다르다).
    await waitFor(() => expect(screen.getByTestId('help-panel-content')).toHaveFocus())
  })

  it('escape restores previous content — 목록에서 Esc 면 검색 전 본문', async () => {
    const { user } = renderScreen(ui, { path: '/', handlers: [helpSearchHandler(), ...helpBundleHandlers()], auth: admin })
    const input = await openPanel(user)
    await user.type(input, '실행')
    await findCards()
    await user.keyboard('{Escape}')
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
    expect(await screen.findByText('홈 첫머리 본문', { exact: false })).toBeInTheDocument()
    expect(screen.queryByRole('listbox', { name: '도움말 검색 결과' })).toBeNull()
    expect(screen.queryByTestId('help-back')).toBeNull()
  })

  it('escape after opening keeps opened section — 질의·칩만 지우고 뒤로로 돌아간다', async () => {
    const { user } = renderScreen(ui, { path: '/', handlers: [helpSearchHandler(), ...helpBundleHandlers()], auth: admin })
    const input = await openPanel(user)
    await user.type(input, '실행')
    await findCards()
    await user.keyboard('{Enter}')
    await screen.findByText('실행 본문.', { exact: false })
    await user.keyboard('{Escape}')
    expect(input).toHaveValue('')
    expect(screen.queryByTestId('help-search-other')).toBeNull()
    expect(screen.getByText('실행 본문.', { exact: false })).toBeInTheDocument()
    await user.click(screen.getByTestId('help-back'))
    expect(await screen.findByText('홈 첫머리 본문', { exact: false })).toBeInTheDocument()
  })

  it('editing the query after opening returns to the list', async () => {
    const { user } = renderScreen(ui, { path: '/', handlers: [helpSearchHandler(), ...helpBundleHandlers()], auth: admin })
    const input = await openPanel(user)
    await user.type(input, '실행')
    await findCards()
    await user.keyboard('{Enter}')
    await screen.findByText('실행 본문.', { exact: false })
    await user.type(input, ' 설정')
    expect(await findCards()).toHaveLength(3)
    expect(screen.queryByTestId('help-search-other')).toBeNull()
  })

  it('zero results — 결과 없음, AI에게 묻기는 그대로', async () => {
    const { user } = renderScreen(ui, { path: '/', handlers: [helpSearchHandler([], () => []), ...helpBundleHandlers()], auth: admin })
    const input = await openPanel(user)
    await user.type(input, '없는말')
    expect(await screen.findByTestId('help-search-empty')).toHaveTextContent('결과 없음')
    expect(screen.queryByTestId('help-search-count')).toBeNull()
    expect(screen.getByTestId('help-ask-ai')).toBeInTheDocument()
  })

  it('request error — 검색할 수 없음', async () => {
    const handler = helpSearchHandler([], () => new HttpResponse(null, { status: 500 }))
    const { user } = renderScreen(ui, { path: '/', handlers: [handler, ...helpBundleHandlers()], auth: admin })
    const input = await openPanel(user)
    await user.type(input, '실행')
    expect(await screen.findByTestId('help-search-error')).toHaveTextContent('검색할 수 없음')
  })

  it('staleResponseDoesNotOverride — 늦게 온 앞 질의 응답이 뒤 질의 결과를 덮지 않는다', async () => {
    const handler = helpSearchHandler([], async (q) => {
      if (q === '위젯') {
        await delay(600)
        return [helpSearchHitsFixture[1]]
      }
      return [helpSearchHitsFixture[2]]
    })
    const { user } = renderScreen(ui, { path: '/', handlers: [handler, ...helpBundleHandlers()], auth: admin })
    const input = await openPanel(user)
    await user.type(input, '위젯')
    // 첫 질의 요청이 나간 뒤(디바운스가 지난 뒤) 질의를 바꾼다.
    await new Promise((r) => setTimeout(r, 400))
    await user.clear(input)
    await user.type(input, '저장소')
    await waitFor(() => expect(screen.getAllByTestId('help-search-result').map((c) => c.textContent)).toEqual([expect.stringContaining('저장소 연결')]))
    // 첫 응답이 올 시간이 지나도 둘째 결과 그대로.
    await new Promise((r) => setTimeout(r, 500))
    expect(screen.getAllByTestId('help-search-result').map((c) => c.textContent)).toEqual([expect.stringContaining('저장소 연결')])
  })

  it('enter while the query is changing does nothing — 디바운스 대기·옛 결과 임시 표시 중 Enter 는 옛 결과를 열지 않는다', async () => {
    const handler = helpSearchHandler([], async (q) => {
      if (q === '저장소') {
        await delay(600)
        return [helpSearchHitsFixture[2]]
      }
      return [helpSearchHitsFixture[0]]
    })
    const { user } = renderScreen(ui, { path: '/', handlers: [handler, ...helpBundleHandlers()], auth: admin })
    const input = await openPanel(user)
    await user.type(input, '실행')
    await findCards()
    // 질의를 바꾸고 디바운스(300ms) 안에 Enter — 아직 옛 질의 결과가 보인다.
    await user.type(input, '{Backspace}{Backspace}저장소')
    await user.keyboard('{Enter}')
    expect(screen.queryByTestId('help-search-other')).toBeNull()
    expect(screen.getByRole('listbox', { name: '도움말 검색 결과' })).toBeInTheDocument()
    expect(screen.getByRole('listbox', { name: '도움말 검색 결과' })).toBeInTheDocument()
    // 새 요청이 나간 뒤 응답 전(옛 결과가 placeholder) 에도 Enter 는 무시한다.
    await new Promise((r) => setTimeout(r, 400))
    await user.keyboard('{Enter}')
    expect(screen.queryByTestId('help-search-other')).toBeNull()
    expect(screen.getByRole('listbox', { name: '도움말 검색 결과' })).toBeInTheDocument()
    // 새 결과가 오면 Enter 가 그 결과를 연다.
    await waitFor(() => expect(screen.getAllByTestId('help-search-result').map((c) => c.textContent)).toEqual([expect.stringContaining('저장소 연결')]))
    await user.keyboard('{Enter}')
    expect(await screen.findByText('저장소 연결 본문.')).toBeInTheDocument()
  })

  it('leaving the opened result hides other-results chips — 뒤로로 절을 떠나면 칩이 사라지고 본문은 그대로', async () => {
    const { user } = renderScreen(ui, { path: '/', handlers: [helpSearchHandler(), ...helpBundleHandlers()], auth: admin })
    const input = await openPanel(user)
    await user.type(input, '실행')
    await findCards()
    await user.keyboard('{Enter}')
    await screen.findByText('실행 본문.', { exact: false })
    expect(screen.getByTestId('help-search-other')).toBeInTheDocument()
    await user.click(screen.getByTestId('help-back'))
    expect(await screen.findByText('홈 첫머리 본문', { exact: false })).toBeInTheDocument()
    expect(screen.queryByTestId('help-search-other')).toBeNull()
    // 질의가 남아 있어도 결과 목록이 다시 덮지 않는다.
    expect(screen.queryByRole('listbox', { name: '도움말 검색 결과' })).toBeNull()
  })

  it('snippet fills placeholders — 발췌의 자리표시는 본문처럼 채운다(조건 표기는 서버가 색인 때 지운다)', async () => {
    const hits = [
      {
        ...helpSearchHitsFixture[0],
        snippet: '아이디는 {agent.username} 이다. 서버를 바꾼다.',
      },
    ]
    const { user } = renderScreen(ui, { path: '/', handlers: [helpSearchHandler([], () => hits), ...helpBundleHandlers()], auth: admin })
    const input = await openPanel(user)
    await user.type(input, '실행')
    const cards = await findCards()
    // 값이 없으면 실제 manual-vars.json 처럼 「<표시 이름>」 한 겹으로 보인다.
    expect(cards[0]).toHaveTextContent('아이디는 <AI 아이디> 이다. 서버를 바꾼다.')
    expect(cards[0].textContent).not.toMatch(/[{}]/)
  })

  it('outside select clears search — 패널 밖에서 고른 절은 검색을 지우고 그 절을 보인다(WP-1511)', async () => {
    const { user } = renderScreen(ui, { path: '/', handlers: [helpSearchHandler(), ...helpBundleHandlers()], auth: admin })
    const input = await openPanel(user)
    await user.type(input, '실행')
    await findCards()
    await user.click(screen.getByRole('button', { name: '밖에서 위젯' }))
    expect(await screen.findByText('위젯 본문.', { exact: false })).toBeInTheDocument()
    expect(input).toHaveValue('')
    expect(screen.queryByRole('listbox', { name: '도움말 검색 결과' })).toBeNull()
  })
})

// 통합 검색 팔레트(WP-1353) 화면 테스트 — 트리거·탭·「전체」 묶음·키보드·최근 검색·AI 요청·빈/실패 상태.
// 앱별 API 는 MSW 로 모킹한다(앱을 가리지 않고 같은 기본 핸들러에서 시작해 필요한 것만 덮어쓴다).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, expect, test, vi } from 'vitest'

import { ChatSessionContext } from '@/hooks/chat-session-context'
import { renderScreen } from '@/test/renderScreen'

import { pushRecent } from './recentSearches'
import { SearchTrigger } from './SearchTrigger'

// AI 표면은 공급자 없이 훅 결과만 바꿔 끼운다(실제 Provider 는 앱 셸 전체에 의존).
const ai = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }))
vi.mock('@/components/ai/AIAssistantContext', () => ({ useOptionalAssistant: () => ai.value }))

const API = '/api/v1'

/** 모든 앱이 빈 결과를 주는 기본 핸들러 — 처리 안 된 요청은 테스트를 깨므로 「전체」 탭도 이것으로 안전하다. */
function emptyApis() {
  return [
    http.get(`${API}/wiki/search`, () => HttpResponse.json([])),
    http.get(`${API}/search/drive`, () => HttpResponse.json({ items: [], hasMore: false })),
    http.get(`${API}/me/issues`, () => HttpResponse.json({ items: [], nextCursor: null, hasMore: false })),
    http.get(`${API}/projects`, () => HttpResponse.json({ content: [], page: 0, size: 100, totalElements: 0, totalPages: 1 })),
    http.get(`${API}/contacts`, () => HttpResponse.json({ items: [], nextCursor: null, hasMore: false })),
    http.get(`${API}/mail/accounts`, () => HttpResponse.json([])),
    http.get(`${API}/messaging/channels/discover`, () => HttpResponse.json([])),
    http.get(`${API}/messaging/channels`, () => HttpResponse.json([])),
    http.get(`${API}/messaging/dms`, () => HttpResponse.json([])),
    http.get(`${API}/auth/me`, () => HttpResponse.json({ id: 1, name: '나' })),
  ]
}

const wikiRow = (id: number, title = `배포 문서 ${id}`) => ({
  id,
  spaceId: 3,
  spaceName: '개발',
  title,
  snippet: `…${title}…`,
  updatedAt: '2026-01-01T00:00:00Z',
})

const wikiHandler = (rows: ReturnType<typeof wikiRow>[]) => http.get(`${API}/wiki/search`, () => HttpResponse.json(rows))

const issueHandler = () =>
  http.get(`${API}/me/issues`, () =>
    HttpResponse.json({
      items: [{ id: 1, projectKey: 'WP', number: 1, title: '배포 이슈', status: 'OPEN', statusName: '열림', statusColor: '#000' }],
      nextCursor: null,
      hasMore: false,
    }),
  )

beforeEach(() => {
  ai.value = null
  localStorage.clear()
})

async function openPalette(user: ReturnType<typeof renderScreen>['user']) {
  await user.click(screen.getByTestId('global-search-toggle'))
  return screen.findByTestId('global-search-input')
}

test('트리거를 누르면 가운데 팔레트가 열리고 노트 경로에서는 노트 탭이 골라진다', async () => {
  const { user } = renderScreen(<SearchTrigger />, { path: '/wiki/spaces/3', handlers: emptyApis() })
  const toggle = screen.getByTestId('global-search-toggle')
  expect(toggle).toHaveAttribute('aria-label', '검색 (/)')
  const input = await openPalette(user)
  expect(screen.getByTestId('global-search')).toBeInTheDocument()
  expect(input).toHaveAttribute('placeholder', '모든 앱에서 찾기')
  expect(input).toHaveFocus()
  expect(screen.getByTestId('global-search-tab-wiki')).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByTestId('global-search-tab-all')).toHaveAttribute('aria-selected', 'false')
})

test('홈에서는 전체 탭 — 묶음이 정해진 순서로, 묶음당 3건이고 「노트에서 더 보기」가 노트 탭으로 간다', async () => {
  const { user } = renderScreen(<SearchTrigger />, {
    path: '/',
    handlers: [wikiHandler([1, 2, 3, 4, 5].map((i) => wikiRow(i))), issueHandler(), ...emptyApis()],
  })
  const input = await openPalette(user)
  expect(screen.getByTestId('global-search-tab-all')).toHaveAttribute('aria-selected', 'true')
  fireEvent.change(input, { target: { value: '배포' } })

  const wikiGroup = await screen.findByTestId('global-search-group-wiki')
  const issueGroup = await screen.findByTestId('global-search-group-issues')
  // 작업 묶음이 노트 묶음보다 앞(탭 순서).
  expect(issueGroup.compareDocumentPosition(wikiGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(within(wikiGroup).getAllByRole('option')).toHaveLength(3)
  // 0건 앱(메일 등)의 묶음은 숨는다.
  expect(screen.queryByTestId('global-search-group-mail')).toBeNull()

  await user.click(screen.getByTestId('global-search-more-wiki'))
  expect(screen.getByTestId('global-search-tab-wiki')).toHaveAttribute('aria-selected', 'true')
})

test('한 앱이 500 이면 그 묶음만 「불러오지 못했어요」이고 다른 묶음은 보이며 다시 시도하면 복구된다', async () => {
  let fail = true
  const { user } = renderScreen(<SearchTrigger />, {
    path: '/',
    handlers: [
      issueHandler(),
      http.get(`${API}/wiki/search`, () => (fail ? new HttpResponse(null, { status: 500 }) : HttpResponse.json([wikiRow(1)]))),
      ...emptyApis(),
    ],
  })
  const input = await openPalette(user)
  fireEvent.change(input, { target: { value: '배포' } })

  const retry = await screen.findByTestId('global-search-retry-wiki')
  expect(retry).toHaveTextContent('불러오지 못했어요')
  expect(await screen.findByTestId('global-search-hit-issues:issue:1')).toBeInTheDocument()

  fail = false
  await user.click(within(retry).getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByTestId('global-search-hit-wiki:1')).toBeInTheDocument()
  expect(screen.queryByTestId('global-search-retry-wiki')).toBeNull()
})

test('↓↓ 뒤 Enter 는 두 번째 결과로 이동하고 팔레트가 닫힌다', async () => {
  const { user, location } = renderScreen(<SearchTrigger />, {
    path: '/wiki/spaces/3',
    handlers: [wikiHandler([wikiRow(7), wikiRow(8), wikiRow(9)]), ...emptyApis()],
  })
  const input = await openPalette(user)
  fireEvent.change(input, { target: { value: '배포' } })
  await screen.findByTestId('global-search-hit-wiki:8')
  // 노트 탭은 입력이 settle 된 뒤에야 Enter 가 먹는다 — 결과가 보이면 settle 된 것.
  await waitFor(() => expect(screen.getByTestId('global-search-hit-wiki:7')).toBeInTheDocument())
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  expect(screen.getByTestId('global-search-hit-wiki:8')).toHaveAttribute('aria-selected', 'true')
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(location()).toBe('/wiki/spaces/3/pages/8'))
  expect(screen.queryByTestId('global-search')).toBeNull()
})

test('⌘+Enter 는 새 탭으로 열고 팔레트는 유지한다', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const { user, location } = renderScreen(<SearchTrigger />, { path: '/wiki', handlers: [wikiHandler([wikiRow(7)]), ...emptyApis()] })
  const input = await openPalette(user)
  fireEvent.change(input, { target: { value: '배포' } })
  await screen.findByTestId('global-search-hit-wiki:7')
  fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
  expect(open).toHaveBeenCalledWith('/wiki/spaces/3/pages/7', '_blank', 'noopener')
  expect(screen.getByTestId('global-search')).toBeInTheDocument()
  expect(location()).toBe('/wiki')
  open.mockRestore()
})

test('Tab 은 다음 탭으로, Shift+Tab 은 이전 탭으로 옮기고 입력 포커스를 유지한다', async () => {
  const { user } = renderScreen(<SearchTrigger />, { path: '/', handlers: emptyApis() })
  const input = await openPalette(user)
  fireEvent.keyDown(input, { key: 'Tab' })
  expect(screen.getByTestId('global-search-tab-ai')).toHaveAttribute('aria-selected', 'true')
  fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })
  expect(screen.getByTestId('global-search-tab-all')).toHaveAttribute('aria-selected', 'true')
  expect(input).toHaveFocus()
})

test('한글 조합 중 Enter·Tab 은 무시한다', async () => {
  const { user, location } = renderScreen(<SearchTrigger />, {
    path: '/wiki',
    handlers: [wikiHandler([wikiRow(7)]), ...emptyApis()],
  })
  const input = await openPalette(user)
  fireEvent.change(input, { target: { value: '배포' } })
  await screen.findByTestId('global-search-hit-wiki:7')
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  fireEvent.keyDown(input, { key: 'Tab', isComposing: true })
  expect(location()).toBe('/wiki')
  expect(screen.getByTestId('global-search-tab-wiki')).toHaveAttribute('aria-selected', 'true')
})

test('「/」 로 열리지만 다른 입력칸 안의 「/」 는 열지 않는다', async () => {
  renderScreen(
    <>
      <SearchTrigger />
      <input data-testid="other" />
    </>,
    { handlers: emptyApis() },
  )
  fireEvent.keyDown(screen.getByTestId('other'), { key: '/' })
  expect(screen.queryByTestId('global-search')).toBeNull()
  fireEvent.keyDown(document.body, { key: '/' })
  expect(await screen.findByTestId('global-search')).toBeInTheDocument()
})

test('최근 검색을 누르면 입력에 들어가고 바로 조회된다', async () => {
  pushRecent('배포')
  const { user } = renderScreen(<SearchTrigger />, { path: '/wiki', handlers: [wikiHandler([wikiRow(7)]), ...emptyApis()] })
  const input = await openPalette(user)
  expect(screen.getByText('최근 검색')).toBeInTheDocument()
  await user.click(screen.getByTestId('global-search-recent-0'))
  expect(input).toHaveValue('배포')
  expect(await screen.findByTestId('global-search-hit-wiki:7')).toBeInTheDocument()
})

test('「AI에게 검색 요청하기」는 팔레트를 닫고 새 대화로 검색 문구를 보낸다', async () => {
  const open = vi.fn()
  ai.value = { mode: 'closed', open, dismiss: vi.fn() }
  const newSession = vi.fn()
  const submitQuery = vi.fn().mockResolvedValue(true)
  const { user } = renderScreen(
    <ChatSessionContext.Provider value={{ newSession, submitQuery } as never}>
      <SearchTrigger />
    </ChatSessionContext.Provider>,
    { path: '/wiki', handlers: [wikiHandler([wikiRow(7)]), ...emptyApis()] },
  )
  const input = await openPalette(user)
  // 검색어가 없으면 줄이 없다.
  expect(screen.queryByTestId('global-search-ask-ai')).toBeNull()
  fireEvent.change(input, { target: { value: '배포' } })
  await user.click(await screen.findByTestId('global-search-ask-ai'))
  expect(open).toHaveBeenCalledWith('side')
  expect(newSession).toHaveBeenCalled()
  expect(submitQuery).toHaveBeenCalledWith('「배포」 검색해 줘')
  expect(screen.queryByTestId('global-search')).toBeNull()
})

test('AI 공급자가 없으면 「AI에게 검색 요청하기」 줄을 숨긴다', async () => {
  const { user } = renderScreen(<SearchTrigger />, { path: '/wiki', handlers: [wikiHandler([wikiRow(7)]), ...emptyApis()] })
  const input = await openPalette(user)
  fireEvent.change(input, { target: { value: '배포' } })
  await screen.findByTestId('global-search-hit-wiki:7')
  expect(screen.queryByTestId('global-search-ask-ai')).toBeNull()
})

test('결과가 없으면 빈 문구와 「모든 앱에서 찾기 → 전체」가 보이고 누르면 전체 탭으로 간다', async () => {
  const { user } = renderScreen(<SearchTrigger />, { path: '/wiki', handlers: emptyApis() })
  const input = await openPalette(user)
  fireEvent.change(input, { target: { value: '없는말' } })
  expect(await screen.findByTestId('global-search-empty')).toHaveTextContent('노트에 「없는말」와 맞는 것이 없어요')
  await user.click(screen.getByTestId('global-search-go-all'))
  expect(screen.getByTestId('global-search-tab-all')).toHaveAttribute('aria-selected', 'true')
})

test('현재 앱 탭 목록 끝에는 「다른 앱에서도 찾기 → 전체」가 있다', async () => {
  const { user } = renderScreen(<SearchTrigger />, { path: '/wiki', handlers: [wikiHandler([wikiRow(7)]), ...emptyApis()] })
  const input = await openPalette(user)
  fireEvent.change(input, { target: { value: '배포' } })
  await screen.findByTestId('global-search-hit-wiki:7')
  await user.click(screen.getByTestId('global-search-go-all'))
  expect(screen.getByTestId('global-search-tab-all')).toHaveAttribute('aria-selected', 'true')
})

test('snippet 의 HTML 은 태그를 벗겨 글자로만 그린다', async () => {
  const row = { ...wikiRow(7), snippet: '<b>배포</b> 가이드 <img src=x onerror=alert(1)>' }
  const { user } = renderScreen(<SearchTrigger />, { path: '/wiki', handlers: [wikiHandler([row]), ...emptyApis()] })
  const input = await openPalette(user)
  fireEvent.change(input, { target: { value: '배포' } })
  const hit = await screen.findByTestId('global-search-hit-wiki:7')
  expect(hit).toHaveTextContent('배포 가이드')
  expect(hit.querySelector('b, img')).toBeNull()
})

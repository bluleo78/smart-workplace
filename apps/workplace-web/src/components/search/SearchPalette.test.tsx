// 통합 검색 팔레트(WP-1353) 화면 테스트 — 트리거·탭·「전체」 묶음·키보드·최근 검색·AI 요청·빈/실패 상태.
// 앱별 API 는 MSW 로 모킹한다(앱을 가리지 않고 같은 기본 핸들러에서 시작해 필요한 것만 덮어쓴다).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { ChatSessionContext } from '@/hooks/chat-session-context'
import { renderScreen } from '@/test/renderScreen'

import { loadRecent, pushRecent } from './recentSearches'
import { SearchTrigger } from './SearchTrigger'

// AI 표면은 공급자 없이 훅 결과만 바꿔 끼운다(실제 Provider 는 앱 셸 전체에 의존).
const ai = vi.hoisted(() => ({
  value: null as null | Record<string, unknown>,
}))
vi.mock('@/components/ai/AIAssistantContext', () => ({
  useOptionalAssistant: () => ai.value,
}))

const API = '/api/v1'

/** 모든 앱이 빈 결과를 주는 기본 핸들러 — 처리 안 된 요청은 테스트를 깨므로 「전체」 탭도 이것으로 안전하다. */
function emptyApis() {
  return [
    http.get(`${API}/wiki/search`, () => HttpResponse.json([])),
    http.get(`${API}/search/drive`, () => HttpResponse.json({ items: [], hasMore: false })),
    http.get(`${API}/me/issues`, () => HttpResponse.json({ items: [], nextCursor: null, hasMore: false })),
    http.get(`${API}/projects`, () =>
      HttpResponse.json({
        content: [],
        page: 0,
        size: 100,
        totalElements: 0,
        totalPages: 1,
      }),
    ),
    http.get(`${API}/contacts`, () => HttpResponse.json({ items: [], nextCursor: null, hasMore: false })),
    http.get(`${API}/mail/accounts`, () => HttpResponse.json([])),
    http.get(`${API}/messaging/channels/discover`, () => HttpResponse.json([])),
    http.get(`${API}/messaging/channels`, () => HttpResponse.json([])),
    http.get(`${API}/messaging/dms`, () => HttpResponse.json([])),
    http.get(`${API}/calendar/events/search`, () => HttpResponse.json({ items: [], nextCursor: null, truncated: false })),
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
      items: [
        {
          id: 1,
          projectKey: 'WP',
          number: 1,
          title: '배포 이슈',
          status: 'OPEN',
          statusName: '열림',
          statusColor: '#000',
        },
      ],
      nextCursor: null,
      hasMore: false,
    }),
  )

afterEach(() => vi.unstubAllGlobals())

beforeEach(() => {
  ai.value = null
  localStorage.clear()
})

async function openPalette(user: ReturnType<typeof renderScreen>['user']) {
  await user.click(screen.getByTestId('global-search-toggle'))
  return screen.findByTestId('global-search-input')
}

test('트리거를 누르면 가운데 팔레트가 열리고 노트 경로에서는 노트 탭이 골라진다', async () => {
  const { user } = renderScreen(<SearchTrigger />, {
    path: '/wiki/spaces/3',
    handlers: emptyApis(),
  })
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
  const { user, location } = renderScreen(<SearchTrigger />, {
    path: '/wiki',
    handlers: [wikiHandler([wikiRow(7)]), ...emptyApis()],
  })
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
  const { user } = renderScreen(<SearchTrigger />, {
    path: '/',
    handlers: emptyApis(),
  })
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
  const { user } = renderScreen(<SearchTrigger />, {
    path: '/wiki',
    handlers: [wikiHandler([wikiRow(7)]), ...emptyApis()],
  })
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
  const { user } = renderScreen(<SearchTrigger />, {
    path: '/wiki',
    handlers: [wikiHandler([wikiRow(7)]), ...emptyApis()],
  })
  const input = await openPalette(user)
  fireEvent.change(input, { target: { value: '배포' } })
  await screen.findByTestId('global-search-hit-wiki:7')
  expect(screen.queryByTestId('global-search-ask-ai')).toBeNull()
})

test('결과가 없으면 빈 문구와 「모든 앱에서 찾기 → 전체」가 보이고 누르면 전체 탭으로 간다', async () => {
  const { user } = renderScreen(<SearchTrigger />, {
    path: '/wiki',
    handlers: emptyApis(),
  })
  const input = await openPalette(user)
  fireEvent.change(input, { target: { value: '없는말' } })
  expect(await screen.findByTestId('global-search-empty')).toHaveTextContent('노트에 「없는말」와 맞는 것이 없어요')
  await user.click(screen.getByTestId('global-search-go-all'))
  expect(screen.getByTestId('global-search-tab-all')).toHaveAttribute('aria-selected', 'true')
})

test('현재 앱 탭 목록 끝에는 「다른 앱에서도 찾기 → 전체」가 있다', async () => {
  const { user } = renderScreen(<SearchTrigger />, {
    path: '/wiki',
    handlers: [wikiHandler([wikiRow(7)]), ...emptyApis()],
  })
  const input = await openPalette(user)
  fireEvent.change(input, { target: { value: '배포' } })
  await screen.findByTestId('global-search-hit-wiki:7')
  await user.click(screen.getByTestId('global-search-go-all'))
  expect(screen.getByTestId('global-search-tab-all')).toHaveAttribute('aria-selected', 'true')
})

test('snippet 의 HTML 은 태그를 벗겨 글자로만 그린다', async () => {
  const row = {
    ...wikiRow(7),
    snippet: '<b>배포</b> 가이드 <img src=x onerror=alert(1)>',
  }
  const { user } = renderScreen(<SearchTrigger />, {
    path: '/wiki',
    handlers: [wikiHandler([row]), ...emptyApis()],
  })
  const input = await openPalette(user)
  fireEvent.change(input, { target: { value: '배포' } })
  const hit = await screen.findByTestId('global-search-hit-wiki:7')
  expect(hit).toHaveTextContent('배포 가이드')
  expect(hit.querySelector('b, img')).toBeNull()
})

test('Esc 는 팔레트를 닫고 기본 동작을 막아 AI 패널의 Esc 처리까지 가지 않게 한다', async () => {
  const { user } = renderScreen(<SearchTrigger />, {
    path: '/',
    handlers: emptyApis(),
  })
  const input = await openPalette(user)
  // fireEvent 는 preventDefault 가 불렸으면 false.
  expect(fireEvent.keyDown(input, { key: 'Escape' })).toBe(false)
  await waitFor(() => expect(screen.queryByTestId('global-search')).toBeNull())
})

test('Shift+Enter 는 AI 에게 검색을 요청한다', async () => {
  ai.value = { mode: 'side', open: vi.fn(), dismiss: vi.fn() }
  const newSession = vi.fn()
  const submitQuery = vi.fn().mockResolvedValue(true)
  const { user } = renderScreen(
    <ChatSessionContext.Provider value={{ newSession, submitQuery } as never}>
      <SearchTrigger />
    </ChatSessionContext.Provider>,
    { path: '/wiki', handlers: [wikiHandler([wikiRow(7)]), ...emptyApis()] },
  )
  const input = await openPalette(user)
  fireEvent.change(input, { target: { value: '배포' } })
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
  expect(submitQuery).toHaveBeenCalledWith('「배포」 검색해 줘')
  // 이미 열려 있는 AI 는 모드를 바꾸지 않는다.
  expect((ai.value as { open: ReturnType<typeof vi.fn> }).open).not.toHaveBeenCalled()
})

test('AI 가 전체 화면이면 이동 전에 옆 패널로 내린다', async () => {
  const dismiss = vi.fn()
  ai.value = { mode: 'fullscreen', open: vi.fn(), dismiss }
  const { user, location } = renderScreen(<SearchTrigger />, {
    path: '/wiki',
    handlers: [wikiHandler([wikiRow(7)]), ...emptyApis()],
  })
  const input = await openPalette(user)
  fireEvent.change(input, { target: { value: '배포' } })
  await screen.findByTestId('global-search-hit-wiki:7')
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(location()).toBe('/wiki/spaces/3/pages/7'))
  expect(dismiss).toHaveBeenCalledWith('side')
})

test('한 글자 검색어는 어느 앱에도 요청을 보내지 않는다', async () => {
  let calls = 0
  const count = () => {
    calls += 1
    return HttpResponse.json([])
  }
  const { user } = renderScreen(<SearchTrigger />, {
    path: '/',
    handlers: [http.get(`${API}/wiki/search`, count), ...emptyApis()],
  })
  const input = await openPalette(user)
  fireEvent.change(input, { target: { value: '가' } })
  expect(await screen.findByText('두 글자 이상 입력하면 찾아요')).toBeInTheDocument()
  // 디바운스(250ms)보다 길게 기다려도 요청이 없어야 한다 — 부재 확인이라 고정 대기가 불가피하다.
  await new Promise((r) => setTimeout(r, 400))
  expect(calls).toBe(0)
})

test('결과를 열면 검색어가 최근 검색에 저장된다', async () => {
  const { user } = renderScreen(<SearchTrigger />, {
    path: '/wiki',
    handlers: [wikiHandler([wikiRow(7)]), ...emptyApis()],
  })
  const input = await openPalette(user)
  fireEvent.change(input, { target: { value: '배포' } })
  await screen.findByTestId('global-search-hit-wiki:7')
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(loadRecent()).toEqual(['배포']))
})

test('keyCode 229(조합 직후 Safari) Enter 는 무시한다', async () => {
  const { user, location } = renderScreen(<SearchTrigger />, {
    path: '/wiki',
    handlers: [wikiHandler([wikiRow(7)]), ...emptyApis()],
  })
  const input = await openPalette(user)
  fireEvent.change(input, { target: { value: '배포' } })
  await screen.findByTestId('global-search-hit-wiki:7')
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
  expect(location()).toBe('/wiki')
})

test('열린 채 트리거를 다시 눌러도 팔레트가 닫혔다 다시 열리지 않는다(검색어 유지)', async () => {
  // 실제 앱에서는 TopCenterSlot(pointer-events-auto)이 트리거를 모달의 body 차단 밖에 둔다 — 같은 조건을 만든다.
  const { user } = renderScreen(
    <div style={{ pointerEvents: 'auto' }}>
      <SearchTrigger />
    </div>,
    { path: '/', handlers: emptyApis() },
  )
  const input = await openPalette(user)
  fireEvent.change(input, { target: { value: '배포' } })
  await user.click(screen.getByTestId('global-search-toggle'))
  expect(screen.getByTestId('global-search-input')).toHaveValue('배포')
})

test('다음 쪽이 500 이면 자동으로 다시 부르지 않고 「다시 시도」만 보인다(WP-1353)', async () => {
  // 센티널이 늘 보이는 것으로 가장한 IntersectionObserver — 실패 뒤에도 자동 재조회가 멈추는지 본다.
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      cb: (entries: { isIntersecting: boolean }[]) => void
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        this.cb = cb
      }
      observe() {
        this.cb([{ isIntersecting: true }])
      }
      disconnect() {}
      unobserve() {}
    },
  )
  let page2 = 0
  const first = Array.from({ length: 20 }, (_, i) => wikiRow(i + 1))
  const handler = http.get(`${API}/wiki/search`, ({ request }) => {
    if (new URL(request.url).searchParams.get('offset') === '20') {
      page2 += 1
      return new HttpResponse(null, { status: 500 })
    }
    return HttpResponse.json(first)
  })
  const { user } = renderScreen(<SearchTrigger />, {
    path: '/wiki',
    handlers: [handler, ...emptyApis()],
  })
  const input = await openPalette(user)
  fireEvent.change(input, { target: { value: '배포' } })
  expect(await screen.findByTestId('global-search-error')).toBeInTheDocument()
  // 자동 재시도가 있다면 이 사이에 요청이 더 쌓인다 — 부재 확인이라 고정 대기가 불가피하다.
  await new Promise((r) => setTimeout(r, 300))
  expect(page2).toBe(1)
  expect(screen.getByTestId('global-search-hit-wiki:1')).toBeInTheDocument()
})

test('한 글자 번호(7)는 이슈만 조회하고 다른 앱은 보내지 않는다', async () => {
  let wiki = 0
  let issues = 0
  const { user } = renderScreen(<SearchTrigger />, {
    path: '/',
    handlers: [
      http.get(`${API}/wiki/search`, () => {
        wiki += 1
        return HttpResponse.json([])
      }),
      http.get(`${API}/me/issues`, () => {
        issues += 1
        return HttpResponse.json({
          items: [],
          nextCursor: null,
          hasMore: false,
        })
      }),
      ...emptyApis(),
    ],
  })
  const input = await openPalette(user)
  fireEvent.change(input, { target: { value: '7' } })
  await waitFor(() => expect(issues).toBeGreaterThan(0))
  await new Promise((r) => setTimeout(r, 200))
  expect(wiki).toBe(0)
})

/** 캘린더 검색 응답 한 줄 — 필요한 필드만 덮어쓴다. */
const calendarRow = (id: number, extra: object = {}) => ({
  id,
  title: `주간 회의 ${id}`,
  startsAt: '2026-11-06T01:00:00Z',
  endsAt: '2026-11-06T02:00:00Z',
  allDay: false,
  location: null,
  calendarName: '내 캘린더',
  calendarColor: 'blue',
  recurrenceRule: null,
  occurrenceStart: '2026-11-06T01:00:00Z',
  past: false,
  matchedField: 'TITLE',
  matchedText: null,
  ...extra,
})

const calendarHandler = () =>
  http.get(`${API}/calendar/events/search`, () =>
    HttpResponse.json({
      items: [
        calendarRow(1),
        calendarRow(2, { recurrenceRule: 'FREQ=WEEKLY', calendarName: '팀 캘린더' }),
        calendarRow(3, { matchedField: 'LOCATION', matchedText: '판교 주간회의실' }),
        calendarRow(4, { past: true, startsAt: '2026-10-30T01:00:00Z', occurrenceStart: '2026-10-30T01:00:00Z' }),
      ],
      nextCursor: null,
      truncated: false,
    }),
  )

test('캘린더 탭 — 다가오는/지난 소제목, 반복 아이콘, 캘린더 이름, 장소 둘째 줄 강조, 지난 일정은 흐리게', async () => {
  const { user } = renderScreen(<SearchTrigger />, {
    path: '/calendar',
    handlers: [calendarHandler(), ...emptyApis()],
  })
  const input = await openPalette(user)
  expect(screen.getByTestId('global-search-tab-calendar')).toHaveAttribute('aria-selected', 'true')
  fireEvent.change(input, { target: { value: '주간' } })

  const first = await screen.findByTestId('global-search-hit-calendar:1')
  expect(first).toHaveTextContent('내 캘린더')
  expect(screen.getByTestId('global-search-hit-calendar:2')).toHaveTextContent('매주')
  expect(screen.getByTestId('global-search-hit-calendar:2')).toHaveTextContent('팀 캘린더')
  // 장소 줄 — 라벨 + 맞은 곳 강조
  const loc = screen.getByTestId('global-search-hit-calendar:3')
  expect(loc).toHaveTextContent('장소: 판교 주간회의실')
  expect(within(loc).getAllByText('주간').some((el) => el.tagName === 'MARK')).toBe(true)
  // 소제목은 그룹이 바뀌는 두 자리(다가오는 → 지난)에만
  const subs = screen.getAllByTestId('global-search-subgroup')
  expect(subs.map((s) => s.textContent)).toEqual(['다가오는 일정', '지난 일정'])
  expect(screen.getByTestId('global-search-hit-calendar:4').className).toContain('text-muted-foreground')
  expect(first.className).not.toContain('text-muted-foreground')
})

test('전체 탭 묶음 — 캘린더 3건은 소제목·캘린더 이름 없이 짧은 날짜만', async () => {
  const { user } = renderScreen(<SearchTrigger />, {
    path: '/',
    handlers: [calendarHandler(), ...emptyApis()],
  })
  const input = await openPalette(user)
  fireEvent.change(input, { target: { value: '주간' } })
  await screen.findByTestId('global-search-hit-calendar:1')
  const group = screen.getByTestId('global-search-group-calendar')
  expect(within(group).getAllByRole('option')).toHaveLength(3)
  expect(within(group).queryByTestId('global-search-subgroup')).toBeNull()
  expect(group).not.toHaveTextContent('내 캘린더')
  expect(group).not.toHaveTextContent('(금)')
  expect(screen.getByTestId('global-search-more-calendar')).toBeInTheDocument()
})

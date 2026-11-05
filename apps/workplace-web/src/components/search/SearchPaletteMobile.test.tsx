// 휴대폰 전체 화면 통합 검색(WP-1354) 화면 테스트 — 탭 첫 화면 헤더의 🔍, 전체 화면 열기·시작 탭, 「취소」·뒤로 가기로 닫기,
// 결과로 이동한 뒤 뒤로 가면 검색 전 화면, 목록을 밀면 키보드 내리기, AI 요청은 히스토리를 걷어 낸 뒤 AI 시트 열기.
// 휴대폰 뷰포트는 파일 맨 위에서 한 번 정한다(matchMedia 결과가 파일 안에서 캐시된다). 데스크톱 동작은 SearchPalette.test.tsx 가 지킨다.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, expect, test, vi } from 'vitest'

import { Page } from '@/components/layout/Page'
import { MobileListHeader } from '@/components/mobile/MobileListHeader'
import { ChatSessionContext } from '@/hooks/chat-session-context'
import { hasLiveStateMark } from '@/lib/historyParam'
import { settleHistory } from '@/test/history'
import { renderScreen } from '@/test/renderScreen'
import { mockViewport } from '@/test/viewport'

import { SearchPaletteHost } from './SearchPaletteHost'
import { SEARCH_PALETTE_HISTORY_KEY } from './searchPaletteStore'

mockViewport()

// AI 표면은 공급자 없이 훅 결과만 바꿔 끼운다(실제 Provider 는 앱 셸 전체에 의존).
const ai = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }))
vi.mock('@/components/ai/AIAssistantContext', () => ({
  useOptionalAssistant: () => ai.value,
}))

const API = '/api/v1'

/** 모든 앱이 빈 결과를 주는 기본 핸들러 + 헤더 벨의 안읽음 수. */
function emptyApis() {
  return [
    http.get(`${API}/wiki/search`, () => HttpResponse.json([])),
    http.get(`${API}/search/drive`, () => HttpResponse.json({ items: [], hasMore: false })),
    http.get(`${API}/search/ai-conversations`, () => HttpResponse.json({ items: [], hasMore: false })),
    http.get(`${API}/search/messages`, () => HttpResponse.json({ items: [], hasMore: false })),
    http.get(`${API}/me/issues`, () => HttpResponse.json({ items: [], nextCursor: null, hasMore: false })),
    http.get(`${API}/projects`, () => HttpResponse.json({ content: [], page: 0, size: 100, totalElements: 0, totalPages: 1 })),
    http.get(`${API}/contacts`, () => HttpResponse.json({ items: [], nextCursor: null, hasMore: false })),
    http.get(`${API}/search/mail`, () => HttpResponse.json({ items: [], hasMore: false })),
    http.get(`${API}/messaging/channels/discover`, () => HttpResponse.json([])),
    http.get(`${API}/messaging/channels`, () => HttpResponse.json([])),
    http.get(`${API}/messaging/dms`, () => HttpResponse.json([])),
    http.get(`${API}/calendar/events/search`, () => HttpResponse.json({ items: [], nextCursor: null, truncated: false })),
    http.get(`${API}/notifications/unread-count`, () => HttpResponse.json({ count: 0 })),
    http.get(`${API}/auth/me`, () => HttpResponse.json({ id: 1, name: '나' })),
  ]
}

const wikiHandler = () =>
  http.get(`${API}/wiki/search`, () =>
    HttpResponse.json([{ id: 7, spaceId: 3, spaceName: '개발', title: '배포 문서', snippet: '…배포 문서…', updatedAt: '2026-01-01T00:00:00Z' }]),
  )

/** BrowserRouter 가 history.state 에 심는 지금 항목 번호. */
const historyIdx = () => (window.history.state as { idx?: number } | null)?.idx

/** 탭 첫 화면 목록 헤더 + 휴대폰 셸의 검색 호스트 — 앱 셸(AppLayout)이 휴대폰에서 두는 것과 같은 조합. */
function Shell({ children = <MobileListHeader title="대화" /> }: { children?: React.ReactNode }) {
  return (
    <>
      {children}
      <SearchPaletteHost />
    </>
  )
}

beforeEach(() => {
  ai.value = null
  localStorage.clear()
})

test('탭 첫 화면 목록 헤더 — 🔍 가 알림 벨 바로 왼쪽에 있고, 벨을 숨긴 화면에는 🔍 도 없다', async () => {
  const { unmount } = renderScreen(<MobileListHeader title="대화" />, { path: '/chat', handlers: emptyApis() })
  const header = screen.getByTestId('mobile-list-header')
  const search = within(header).getByRole('button', { name: '검색' })
  expect(search.nextElementSibling).toBe(within(header).getByTestId('mobile-bell'))
  unmount()

  renderScreen(<MobileListHeader title="알림" hideBell />, { path: '/notifications', handlers: emptyApis() })
  expect(screen.queryByTestId('mobile-search-button')).toBeNull()
  expect(screen.queryByTestId('mobile-bell')).toBeNull()
})

test('모바일 PageHeader — 탭 루트에는 🔍 가 벨 왼쪽에 있고, 탭 루트가 아닌 상세에는 없다', async () => {
  const { unmount } = renderScreen(<Page.Header title="캘린더" />, { path: '/calendar', handlers: emptyApis() })
  const search = await screen.findByTestId('mobile-search-button')
  expect(search.nextElementSibling).toBe(screen.getByTestId('mobile-bell'))
  unmount()

  renderScreen(<Page.Header title="이슈" />, { path: '/projects/WP/issues/1', handlers: emptyApis() })
  expect(screen.queryByTestId('mobile-search-button')).toBeNull()
})

test('🔍 를 누르면 전체 화면 검색이 열리고 지금 앱(대화) 탭에서 시작하며 입력에 포커스가 간다', async () => {
  const { user } = renderScreen(<Shell />, { path: '/chat', handlers: emptyApis() })
  await user.click(screen.getByTestId('mobile-search-button'))
  const input = await screen.findByTestId('global-search-input')
  expect(input).toHaveFocus()
  // 휴대폰 전체 화면 껍데기 — 가운데 대화상자(data-slot=dialog-content)가 아니라 보이는 뷰포트에 붙은 원시 레이어.
  const palette = screen.getByTestId('global-search')
  expect(palette).not.toHaveAttribute('data-slot', 'dialog-content')
  expect(palette).toHaveClass('fixed', 'inset-x-0')
  expect(screen.getByTestId('global-search-tab-chat')).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByTestId('global-search-cancel')).toHaveTextContent('취소')
})

test('「취소」는 검색을 닫고 넣었던 히스토리 항목을 걷어 내 열기 전 항목으로 돌아간다', async () => {
  const { user, location } = renderScreen(<Shell />, { path: '/chat', handlers: emptyApis() })
  const before = historyIdx()
  await user.click(screen.getByTestId('mobile-search-button'))
  await screen.findByTestId('global-search-input')
  // 열면 같은 주소에 항목 하나가 늘어난다.
  await waitFor(() => expect(historyIdx()).toBe((before ?? 0) + 1))
  expect(location()).toBe('/chat')
  await user.click(screen.getByTestId('global-search-cancel'))
  await waitFor(() => expect(screen.queryByTestId('global-search')).toBeNull())
  await settleHistory()
  expect(historyIdx()).toBe(before)
  expect(hasLiveStateMark(SEARCH_PALETTE_HISTORY_KEY)).toBe(false)
  expect(location()).toBe('/chat')
})

test('열린 채 뒤로 가기는 검색만 닫고 주소는 열기 전 그대로다', async () => {
  const { user, location } = renderScreen(<Shell />, { path: '/chat', handlers: emptyApis() })
  const before = historyIdx()
  await user.click(screen.getByTestId('mobile-search-button'))
  await screen.findByTestId('global-search-input')
  await waitFor(() => expect(hasLiveStateMark(SEARCH_PALETTE_HISTORY_KEY)).toBe(true))
  act(() => window.history.back())
  await waitFor(() => expect(screen.queryByTestId('global-search')).toBeNull())
  await settleHistory()
  expect(historyIdx()).toBe(before)
  expect(location()).toBe('/chat')
})

test('결과를 고르면 그 화면으로 가고, 거기서 뒤로 가면 검색이 다시 열리지 않고 검색 전 화면이다', async () => {
  const { user, location } = renderScreen(<Shell children={<MobileListHeader title="노트" />} />, {
    path: '/wiki',
    handlers: [wikiHandler(), ...emptyApis()],
  })
  const before = historyIdx()
  await user.click(screen.getByTestId('mobile-search-button'))
  const input = await screen.findByTestId('global-search-input')
  await waitFor(() => expect(hasLiveStateMark(SEARCH_PALETTE_HISTORY_KEY)).toBe(true))
  fireEvent.change(input, { target: { value: '배포' } })
  await user.click(await screen.findByTestId('global-search-hit-wiki:7'))
  await waitFor(() => expect(location()).toBe('/wiki/spaces/3/pages/7'))
  expect(screen.queryByTestId('global-search')).toBeNull()
  await settleHistory()
  // 검색 항목을 대체했으므로 이동한 화면은 열기 전 다음 칸이다(검색 항목 위에 쌓이지 않았다).
  expect(historyIdx()).toBe((before ?? 0) + 1)
  expect(hasLiveStateMark(SEARCH_PALETTE_HISTORY_KEY)).toBe(false)

  act(() => window.history.back())
  await waitFor(() => expect(location()).toBe('/wiki'))
  await settleHistory()
  expect(historyIdx()).toBe(before)
  expect(screen.queryByTestId('global-search')).toBeNull()
})

test('결과 목록을 손가락으로 밀면 입력을 놓아 키보드를 내린다', async () => {
  const { user } = renderScreen(<Shell />, { path: '/wiki', handlers: [wikiHandler(), ...emptyApis()] })
  await user.click(screen.getByTestId('mobile-search-button'))
  const input = await screen.findByTestId('global-search-input')
  fireEvent.change(input, { target: { value: '배포' } })
  const hit = await screen.findByTestId('global-search-hit-wiki:7')
  expect(input).toHaveFocus()
  fireEvent.touchMove(hit)
  expect(input).not.toHaveFocus()
})

test('「AI에게 검색 요청하기」는 검색 항목을 걷어 낸 뒤에 AI 시트를 연다', async () => {
  // 여는 순간의 히스토리를 적어 둔다 — 실제 AI 시트는 이때 자기 항목을 push 하므로, 검색 항목이 아직 남아 있으면 함께 되돌려진다.
  const atOpen: { idx: number | undefined; mark: boolean }[] = []
  const open = vi.fn(() => atOpen.push({ idx: historyIdx(), mark: hasLiveStateMark(SEARCH_PALETTE_HISTORY_KEY) }))
  ai.value = { mode: 'closed', open, dismiss: vi.fn() }
  const newSession = vi.fn()
  const submitQuery = vi.fn().mockResolvedValue(true)
  const { user } = renderScreen(
    <ChatSessionContext.Provider value={{ newSession, submitQuery } as never}>
      <Shell />
    </ChatSessionContext.Provider>,
    { path: '/chat', handlers: emptyApis() },
  )
  const before = historyIdx()
  await user.click(screen.getByTestId('mobile-search-button'))
  const input = await screen.findByTestId('global-search-input')
  await waitFor(() => expect(hasLiveStateMark(SEARCH_PALETTE_HISTORY_KEY)).toBe(true))
  fireEvent.change(input, { target: { value: '배포' } })
  await user.click(await screen.findByTestId('global-search-ask-ai'))
  expect(submitQuery).toHaveBeenCalledWith('「배포」 검색해 줘')
  // AI 시트는 검색 항목이 빠진 뒤(열기 전 항목으로 돌아온 뒤)에 열린다 — 먼저 열면 AI 항목까지 함께 되돌려진다.
  await waitFor(() => expect(open).toHaveBeenCalledWith('side'))
  expect(atOpen).toEqual([{ idx: before, mark: false }])
})

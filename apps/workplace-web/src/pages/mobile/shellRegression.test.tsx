// 모바일 셸 회귀(WP-127·WP-191) — 페이지 테스트(WP-981).
// AI 시트의 세션 스위처, 캘린더 일정 다이얼로그에 칩·사이드 패널 없음, ⌘K 토글·Esc 닫기, 비루트 화면(사이클) 뒤로가기 바 ✦,
// 탭 루트의 탭바 AI·🔔 노출은 조건부 렌더·키 처리라 e2e/pages/mobile/regression.spec.ts 에서 옮겼다.
// 시트 폭·겹침(다이얼로그 위 AI 시트 입력·딤)·작성 도크 위치는 그 E2E 가 지킨다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage, settleHistory } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'

import { calendar, calendarEvent } from '../../../e2e/factories/calendar.factory'
import { createProject } from '../../../e2e/factories/project.factory'

mockViewport()

/** ⌘K — 맥이 아닌 jsdom 에선 Ctrl+K 로 판정된다(ControlOrMeta). */
const pressCmdK = () => fireEvent.keyDown(document, { key: 'k', code: 'KeyK', ctrlKey: true, metaKey: true })

test('AI 시트 — 좌측 세션 목록 없이 헤더 「대화 목록」 드롭다운으로 전환하고, 고르면 메뉴가 닫힌다(#203·#451)', async () => {
  const { user } = renderPage('/', {
    handlers: [
      http.get('/api/v1/home/sessions', () =>
        HttpResponse.json({
          items: [
            { id: 's-mob1', title: '모바일 대화 1', lastMessageAt: '2026-06-10T00:00:00Z', widgetCount: 0 },
            { id: 's-mob2', title: '모바일 대화 2', lastMessageAt: '2026-06-10T01:00:00Z', widgetCount: 0 },
          ],
          nextCursor: null,
        }),
      ),
      http.get('/api/v1/home/sessions/s-mob1/messages', () => HttpResponse.json([])),
    ],
  })
  await user.click(await screen.findByTestId('mobile-tab-ai', {}, { timeout: PAGE_LOAD_TIMEOUT }))
  const sheet = await screen.findByTestId('ai-sheet')
  // 모바일엔 side 가 없다 — 사이드 패널·AI 칩이 없고, 세션 목록 대신 헤더 스위처.
  expect(screen.queryByTestId('ai-side-panel')).not.toBeInTheDocument()
  expect(screen.queryByTestId('chat-launcher')).not.toBeInTheDocument()
  expect(screen.queryByTestId('ai-fs-sessions')).not.toBeInTheDocument()
  // 탭 루트에서도 시트엔 × 가 있다(WP-191).
  expect(within(sheet).getByTestId('ai-panel-close')).toBeInTheDocument()
  await user.click(within(sheet).getByTestId('ai-sheet-session-switcher'))
  const menu = await screen.findByRole('menu', { name: '대화 목록' })
  await user.click(within(menu).getByText('모바일 대화 1'))
  await waitFor(() => expect(screen.queryByRole('menu', { name: '대화 목록' })).not.toBeInTheDocument())
})

test('AI 탭으로 연 시트는 다른 탭(홈)을 누르면 닫힌다', async () => {
  const { user } = renderPage('/', {})
  await user.click(await screen.findByTestId('mobile-tab-ai', {}, { timeout: PAGE_LOAD_TIMEOUT }))
  expect(await screen.findByTestId('ai-sheet')).toBeInTheDocument()
  await user.click(screen.getByTestId('mobile-tab-home'))
  await waitFor(() => expect(screen.queryByTestId('ai-sheet')).not.toBeInTheDocument())
})

test('⌘K 는 AI 시트를 토글하고 Esc 는 닫는다', async () => {
  const { user } = renderPage('/', {})
  // AI 사용 가능 여부가 확정된 뒤(탭바 AI 칸 노출)에 단축키가 등록된다.
  await screen.findByTestId('mobile-tab-ai', {}, { timeout: PAGE_LOAD_TIMEOUT })
  pressCmdK()
  expect(await screen.findByTestId('ai-sheet')).toBeInTheDocument()
  pressCmdK()
  await waitFor(() => expect(screen.queryByTestId('ai-sheet')).not.toBeInTheDocument())
  // 닫기는 history.back() — 그 이동이 끝난 뒤 다시 연다(늦게 온 뒤로 가기가 새로 연 시트를 닫지 않게).
  await settleHistory()
  pressCmdK()
  expect(await screen.findByTestId('ai-sheet')).toBeInTheDocument()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByTestId('ai-sheet')).not.toBeInTheDocument())
})

test('캘린더 일정 다이얼로그는 AI 칩·사이드 패널 없이 열리고 Esc 로 닫힌다', async () => {
  const ev = calendarEvent({ id: 42, title: '주간회의' })
  const { user } = renderPage('/calendar?eventId=42', {
    handlers: [
      http.get('/api/v1/calendars', () => HttpResponse.json([calendar()])),
      http.get('/api/v1/calendar/events', () => HttpResponse.json([ev])),
      http.get('/api/v1/calendar/events/42', () => HttpResponse.json(ev)),
    ],
  })
  expect(await screen.findByTestId('calendar-event-dialog', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
  expect(screen.queryByTestId('chat-launcher')).not.toBeInTheDocument()
  expect(screen.queryByTestId('ai-side-panel')).not.toBeInTheDocument()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByTestId('calendar-event-dialog')).not.toBeInTheDocument())
})

test('탭 루트가 아닌 PageHeader 화면(사이클)은 탭바 없이 뒤로가기 바 ✦ 로 AI 시트를 연다', async () => {
  const { user } = renderPage('/projects/WP/cycles', {
    handlers: [http.get('/api/v1/projects/WP', () => HttpResponse.json(createProject()))],
  })
  await screen.findByTestId('page-header', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(screen.queryByTestId('mobile-tabbar')).not.toBeInTheDocument()
  await user.click(screen.getByTestId('mobile-back-ai'))
  expect(await screen.findByTestId('ai-sheet')).toBeInTheDocument()
})

test('탭 루트 — 캘린더에는 탭바 AI 칸이, 홈 헤더에는 🔔 이 보인다', async () => {
  const view = renderPage('/calendar', {})
  expect(await screen.findByTestId('mobile-tab-ai', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
  view.unmount()
  renderPage('/', {})
  expect(await screen.findByTestId('mobile-bell', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
})

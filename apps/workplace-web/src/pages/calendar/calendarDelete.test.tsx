// 캘린더 삭제(WP-1140) — 편집 창의 「삭제」는 바로 지우지 않고, 소속 일정이 기본 캘린더로 옮겨진다는 확인 창을 거친다.
// 삭제하면 결과를, 실패하면 오류를 토스트로 알린다. 사이드바 ⋯ → 편집 → 삭제 흐름을 CalendarPage 째로 띄워 본다.
import { screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { calendarHandlers, capture, pinNow, renderCalendarPage } from '@/test/kits/calendar/testkit-b8'

import { calendar } from '../../../e2e/factories/calendar.factory'

beforeEach(pinNow)
afterEach(() => vi.useRealTimers())

const CALENDARS = [
  calendar({ id: 1, name: '내 캘린더', isDefault: true }),
  calendar({ id: 5, name: '업무85b', color: 'green', isDefault: false }),
]

/** 사이드바 ⋯ → 편집 → 삭제까지 눌러 확인 창을 연다. */
async function openDeleteConfirm(user: ReturnType<typeof renderCalendarPage>['user']) {
  await user.click(await screen.findByTestId('calendar-menu-5'))
  await user.click(await screen.findByTestId('calendar-edit-5'))
  await user.click(await screen.findByRole('button', { name: '삭제' }))
  return screen.findByTestId('calendar-delete-confirm')
}

describe('캘린더 삭제 확인(WP-1140)', () => {
  test('편집 창의 삭제는 바로 지우지 않고, 일정이 기본 캘린더로 옮겨진다는 확인 창을 띄운다 — 취소하면 지우지 않는다', async () => {
    const del = capture('delete', '/calendars/5')
    const { user } = renderCalendarPage('/calendar', [del.handler, ...calendarHandlers({ calendars: CALENDARS })])

    const confirm = await openDeleteConfirm(user)
    expect(confirm).toHaveTextContent('「업무85b」 캘린더를 삭제할까요?')
    expect(confirm).toHaveTextContent('이 캘린더의 일정은 기본 캘린더(내 캘린더)로 옮겨집니다')
    expect(del.urls).toHaveLength(0)

    await user.click(within(confirm).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByTestId('calendar-delete-confirm')).not.toBeInTheDocument())
    expect(del.urls).toHaveLength(0)
  })

  test('확인하면 DELETE 하고 결과를 토스트로 알린 뒤 확인 창을 닫는다', async () => {
    const del = capture('delete', '/calendars/5')
    const { user } = renderCalendarPage('/calendar', [del.handler, ...calendarHandlers({ calendars: CALENDARS })])

    const confirm = await openDeleteConfirm(user)
    await user.click(within(confirm).getByTestId('calendar-delete-confirm-submit'))

    await waitFor(() => expect(del.urls).toHaveLength(1))
    expect(await screen.findByText('캘린더를 삭제했습니다. 일정은 기본 캘린더로 옮겼습니다')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('calendar-delete-confirm')).not.toBeInTheDocument())
  })

  test('삭제에 실패하면 오류를 토스트로 알리고 확인 창을 남긴다', async () => {
    const del = capture('delete', '/calendars/5', () => HttpResponse.json({ message: '서버 오류' }, { status: 500 }))
    const { user } = renderCalendarPage('/calendar', [del.handler, ...calendarHandlers({ calendars: CALENDARS })])

    const confirm = await openDeleteConfirm(user)
    await user.click(within(confirm).getByTestId('calendar-delete-confirm-submit'))

    await waitFor(() => expect(del.urls).toHaveLength(1))
    expect(await screen.findByText(/캘린더 삭제에 실패했습니다|서버 오류/)).toBeInTheDocument()
    expect(screen.getByTestId('calendar-delete-confirm')).toBeInTheDocument()
  })
})

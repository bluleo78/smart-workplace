// @vitest-environment jsdom
// 캘린더 새 일정 딥링크 ?new=true&attendee=<username>(WP-1767) — 사람 카드의 「일정 잡기」가 상대를 참석자로 채워 연다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { fixClock, renderCalendar } from '@/test/kits/calendar/calendarPageKit'

import { createMember } from '../../../e2e/factories/auth.factory'

fixClock()

const MINJI = createMember({ userId: 22, username: 'minji@x.io', name: '김민지' })
/** 로그인 사용자(id 1, username tester) 본인 — 검색 결과에 섞여 와도 넣지 않아야 한다. */
const ME = createMember({ userId: 1, username: 'tester', name: 'Tester' })

/** 구성원 검색 목 — 요청의 search 를 남기고, username 부분 일치(+접두가 같은 다른 사람)를 돌려준다. */
function membersHandler(searches: (string | null)[], opts: { sizes?: (string | null)[]; hold?: Promise<void> } = {}) {
  const all = [createMember({ userId: 23, username: 'minji@x.io.old', name: '김민지(퇴사)' }), MINJI, ME]
  return http.get('/api/v1/members', async ({ request }) => {
    const params = new URL(request.url).searchParams
    const search = params.get('search')
    searches.push(search)
    opts.sizes?.push(params.get('size'))
    // 응답을 늦출 때 — 그 사이 창을 닫고 다시 여는 경합을 본다.
    if (opts.hold) await opts.hold
    const content = all.filter((m) => !search || m.username.includes(search))
    return HttpResponse.json({ content, page: 0, size: 20, totalElements: content.length, totalPages: 1 })
  })
}

describe('캘린더 딥링크 ?new&attendee', () => {
  test('username 이 같은 멤버가 새 일정 창의 참석자 칩으로 붙는다', async () => {
    const searches: (string | null)[] = []
    await renderCalendar({}, { path: '/calendar?new=true&attendee=minji@x.io', handlers: [membersHandler(searches)] })
    await screen.findByTestId('calendar-event-dialog')
    expect(await screen.findByTestId('attendee-selected-22')).toHaveTextContent('김민지')
    // username 이 정확히 같은 사람만 — 접두가 같은 다른 사람은 넣지 않는다
    expect(screen.queryByTestId('attendee-selected-23')).not.toBeInTheDocument()
    expect(searches).toContain('minji@x.io')
  })

  test('검색은 한 쪽 100명으로 받는다 — 접두가 같은 사람이 많아도 정확히 같은 username 을 찾게', async () => {
    const sizes: (string | null)[] = []
    await renderCalendar({}, { path: '/calendar?new=true&attendee=minji@x.io', handlers: [membersHandler([], { sizes })] })
    expect(await screen.findByTestId('attendee-selected-22')).toBeInTheDocument()
    expect(sizes).toEqual(['100'])
  })

  test('찾는 사이 창을 닫고 「새 일정」을 다시 열면 늦게 온 결과가 새 창에 참석자를 넣지 않는다', async () => {
    let release!: () => void
    const hold = new Promise<void>((r) => {
      release = r
    })
    const searches: (string | null)[] = []
    const { user } = await renderCalendar({}, { path: '/calendar?new=true&attendee=minji@x.io', handlers: [membersHandler(searches, { hold })] })
    const dialog = await screen.findByTestId('calendar-event-dialog')
    await waitFor(() => expect(searches).toContain('minji@x.io'))
    await user.click(within(dialog).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByTestId('calendar-event-dialog')).not.toBeInTheDocument())
    await user.click(screen.getByTestId('calendar-new-event'))
    await screen.findByTestId('calendar-event-dialog')
    release()
    // 결과가 처리될 시간을 준 뒤에도 칩이 없어야 한다 — 같은 응답이 고침 전에는 칩을 붙였다.
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryByTestId('attendee-selected-22')).not.toBeInTheDocument()
    expect(screen.queryByTestId('attendee-selected-chips')).not.toBeInTheDocument()
  })

  test('모르는 username 이면 참석자 없이 창이 열린다', async () => {
    const searches: (string | null)[] = []
    await renderCalendar({}, { path: '/calendar?new=true&attendee=nobody', handlers: [membersHandler(searches)] })
    await screen.findByTestId('calendar-event-dialog')
    await waitFor(() => expect(searches).toContain('nobody'))
    expect(screen.queryByTestId('attendee-selected-chips')).not.toBeInTheDocument()
  })

  test('내 username 이면 넣지 않는다', async () => {
    const searches: (string | null)[] = []
    await renderCalendar({}, { path: '/calendar?new=true&attendee=tester', handlers: [membersHandler(searches)] })
    await screen.findByTestId('calendar-event-dialog')
    await waitFor(() => expect(searches).toContain('tester'))
    expect(screen.queryByTestId('attendee-selected-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('attendee-selected-chips')).not.toBeInTheDocument()
  })

  test('열린 뒤 주소에서 new·attendee 가 지워진다', async () => {
    const { location } = await renderCalendar({}, { path: '/calendar?new=true&attendee=minji@x.io', handlers: [membersHandler([])] })
    await screen.findByTestId('calendar-event-dialog')
    await waitFor(() => {
      expect(location()).not.toContain('new=')
      expect(location()).not.toContain('attendee=')
    })
  })
})

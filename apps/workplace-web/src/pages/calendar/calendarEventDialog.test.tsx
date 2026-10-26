// 캘린더 일정 만들기·수정·삭제와 일정 폼 — 화면 컴포넌트 테스트(WP-966, WP-995).
// 브라우저 없이 판정되는 아래 동작을 e2e/pages/calendar/calendar.spec.ts 에서 옮겼다:
// - 만들기·수정·삭제(확인 대화상자·destructive 버튼)·반복 회차 범위 선택의 payload·쿼리, 저장 중 잠금·같은 틱 연속 클릭 1회
// - 종일 → 시각·payload, 반복 입력 → RRULE, 간격·횟수·종료 날짜 검증 안내(저장 막힘), 폼이 담을 수 없는 반복 규칙 잠금·풀기
//   (규칙 자체는 lib/calendarEventForm.test·recurrence.test 가 지키고, 여기선 폼 입력 → 요청 연결을 본다)
// 본문·사이드바는 calendarPage.test.tsx 가 본다. 상세가 오기 전 참석자 줄 자리 잡기(높이)는 calendar.spec.ts 의 E2E(@layout)가 지킨다.
// 저장 요청·대화상자 전환까지 보려고 CalendarPage 를 renderScreen 으로 띄운다(calendarPageKit). 지금 = 2026-06-10 12:00 KST.
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'

import { calendarEvent, recurringCalendarEvent } from '../../../e2e/factories/calendar.factory'
import { fixClock, renderCalendar } from './calendarPageKit'

fixClock()


// 반복 일정 — 마스터 id 와 6월 안의 주 단위 회차(월 보기에서 모두 보인다).
const MASTER_ID = 5
const OCC_DATES = ['2026-06-08T01:00:00Z', '2026-06-15T01:00:00Z', '2026-06-22T01:00:00Z']
const occTestId = (occ: string) => `calendar-event-${MASTER_ID}-${occ}`

/** 일정 칩을 눌러 대화상자를 연다. */
async function openEvent(user: { click: (el: Element) => Promise<void> }, testId: string) {
  await user.click((await screen.findAllByTestId(testId))[0])
  return screen.findByTestId('calendar-event-dialog')
}

describe('일정 만들기·수정·삭제', () => {
  test('새 일정을 저장하면 POST 하고 대화상자가 닫힌 뒤 다시 불러온 목록에 보인다', async () => {
    const { user, requests } = await renderCalendar()
    await user.click(screen.getByTestId('calendar-new-event'))
    await screen.findByTestId('calendar-event-dialog')
    await user.click(screen.getByTestId('calendar-form-title'))
    await user.paste('점심 약속')
    await user.click(screen.getByTestId('calendar-form-submit'))

    await waitFor(() => expect(screen.queryByTestId('calendar-event-dialog')).not.toBeInTheDocument())
    expect(requests.posts).toHaveLength(1)
    expect(requests.posts[0]).toMatchObject({ title: '점심 약속', allDay: false })
    expect(await screen.findByTestId('calendar-event-999')).toHaveTextContent('점심 약속')
  })

  test('일정을 열어 제목을 바꿔 저장하면 PATCH 하고 목록에 새 제목이 보인다', async () => {
    const { user, requests } = await renderCalendar({ events: [calendarEvent({ id: 1, title: '팀 회의' })] })
    await openEvent(user, 'calendar-event-1')
    const title = screen.getByTestId('calendar-form-title')
    await user.clear(title)
    await user.paste('수정된 회의')
    await user.click(screen.getByTestId('calendar-form-submit'))

    await waitFor(() => expect(screen.queryByTestId('calendar-event-dialog')).not.toBeInTheDocument())
    expect(requests.patches).toHaveLength(1)
    expect(requests.patches[0].url.pathname).toBe('/api/v1/calendar/events/1')
    expect(requests.patches[0].body).toMatchObject({ title: '수정된 회의' })
    await user.click(screen.getByTestId('calendar-view-agenda-btn'))
    expect(await screen.findByText('수정된 회의')).toBeInTheDocument()
  })

  // WP-710 — 목록 응답은 회의를 판정하지 않고 상세(GET /events/{id})에만 onlineMeeting 이 실린다. 주최자 편집 폼에도 참가 버튼.
  test('주최자가 여는 편집 폼에도 회의 참가 버튼이 있고, 새 일정 폼에는 없다 (WP-710)', async () => {
    const joinUrl = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0'
    const meeting = calendarEvent({ id: 1, title: '팀 회의', onlineMeeting: { provider: 'TEAMS', joinUrl } })
    const { user } = await renderCalendar({ events: [calendarEvent({ id: 1, title: '팀 회의' })], detail: () => meeting })
    await openEvent(user, 'calendar-event-1')
    // 읽기 전용 상세가 아니라 편집 폼이다
    expect(screen.getByTestId('calendar-form-title')).toBeInTheDocument()
    const join = await screen.findByTestId('calendar-form-join')
    expect(join).toHaveTextContent('Teams 회의 참가')
    expect(join).toHaveAttribute('href', joinUrl)
    expect(join).toHaveAttribute('target', '_blank')
    expect(join.getAttribute('rel')).toMatch(/noopener/)

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('calendar-event-dialog')).not.toBeInTheDocument(), { timeout: 3000 })
    await user.click(screen.getByTestId('calendar-new-event'))
    await screen.findByTestId('calendar-form-title')
    expect(screen.queryByTestId('calendar-form-join')).not.toBeInTheDocument()
  })

  // #128 — 삭제는 확인 대화상자를 거친다(대화상자가 바뀌어 보이고, 확인해야 DELETE). #142 — 확인 버튼은 destructive 스타일.
  test('삭제 → 확인 대화상자(destructive 버튼)에서 확인하면 DELETE 하고 칩이 사라진다 (#128·#142)', async () => {
    const { user, requests } = await renderCalendar({ events: [calendarEvent({ id: 1 })] })
    await openEvent(user, 'calendar-event-1')
    await user.click(screen.getByTestId('calendar-form-delete'))
    await screen.findByTestId('calendar-confirm-delete-dialog')
    expect(screen.queryByTestId('calendar-event-dialog')).not.toBeInTheDocument()
    const confirm = screen.getByTestId('calendar-confirm-delete-confirm')
    expect(confirm.className).toMatch(/bg-destructive/)

    await user.click(confirm)
    await waitFor(() => expect(screen.queryByTestId('calendar-event-1')).not.toBeInTheDocument())
    expect(requests.deletes.map((u) => u.pathname)).toEqual(['/api/v1/calendar/events/1'])
    expect(screen.queryByTestId('calendar-confirm-delete-dialog')).not.toBeInTheDocument()
  })

  test('삭제 확인에서 취소하면 DELETE 없이 일정이 남는다 (#128)', async () => {
    const { user, requests } = await renderCalendar({ events: [calendarEvent({ id: 1 })] })
    await openEvent(user, 'calendar-event-1')
    await user.click(screen.getByTestId('calendar-form-delete'))
    await user.click(await screen.findByTestId('calendar-confirm-delete-cancel'))
    await waitFor(() => expect(screen.queryByTestId('calendar-confirm-delete-dialog')).not.toBeInTheDocument())
    expect(requests.deletes).toHaveLength(0)
    expect(screen.getAllByTestId('calendar-event-1').length).toBeGreaterThan(0)
  })

  // #130 — 저장 요청이 도는 동안 저장 버튼이 잠기고 「저장 중」을 보인다. 응답 뒤 닫힌다.
  test('저장 요청 중에는 저장 버튼이 비활성·「저장 중」이고 응답 뒤 닫힌다 (#130)', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { user, requests } = await renderCalendar({ holdPost: () => gate })
    await user.click(screen.getByTestId('calendar-new-event'))
    await user.click(await screen.findByTestId('calendar-form-title'))
    await user.paste('점심 약속')
    await user.click(screen.getByTestId('calendar-form-submit'))
    await waitFor(() => expect(requests.posts).toHaveLength(1))
    await waitFor(() => expect(screen.getByTestId('calendar-form-submit')).toBeDisabled())
    expect(screen.getByTestId('calendar-form-submit')).toHaveTextContent('저장 중')
    release()
    await waitFor(() => expect(screen.queryByTestId('calendar-event-dialog')).not.toBeInTheDocument())
  })

  // #584 — React 가 isPending 을 다시 그리기 전에 두 번 눌러도 POST 는 한 번.
  test('저장 버튼을 같은 틱에 두 번 눌러도 일정은 한 번만 만들어진다 (#584)', async () => {
    const { user, requests } = await renderCalendar()
    await user.click(screen.getByTestId('calendar-new-event'))
    await user.click(await screen.findByTestId('calendar-form-title'))
    await user.paste('더블클릭이벤트테스트')
    const submit = screen.getByTestId('calendar-form-submit')
    act(() => {
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await waitFor(() => expect(screen.queryByTestId('calendar-event-dialog')).not.toBeInTheDocument())
    expect(requests.posts).toHaveLength(1)
  })
})

describe('반복 회차 범위 선택 (#111)', () => {
  test('회차 하나만 수정 — PATCH /events/{masterId}?scope=THIS&occurrenceDate=<회차 값 그대로>', async () => {
    const { user, requests } = await renderCalendar({ events: recurringCalendarEvent(MASTER_ID, OCC_DATES) })
    await openEvent(user, occTestId(OCC_DATES[0]))
    const title = screen.getByTestId('calendar-form-title')
    await user.clear(title)
    await user.paste('수정된 회차')
    await user.click(screen.getByTestId('calendar-form-submit'))
    // 저장 → 편집 대화상자는 숨고 범위 선택이 뜬다
    await screen.findByTestId('calendar-recurrence-scope-dialog')
    expect(screen.queryByTestId('calendar-event-dialog')).not.toBeInTheDocument()
    expect(requests.patches).toHaveLength(0)

    await user.click(screen.getByTestId('calendar-recurrence-scope-this'))
    await waitFor(() => expect(requests.patches).toHaveLength(1))
    const { url, body } = requests.patches[0]
    expect(url.pathname).toBe(`/api/v1/calendar/events/${MASTER_ID}`)
    expect(url.searchParams.get('scope')).toBe('THIS')
    expect(url.searchParams.get('occurrenceDate')).toBe(OCC_DATES[0])
    expect(body.title).toBe('수정된 회차')
    expect(body.recurrenceRule).toBeTruthy()
    await waitFor(() => expect(screen.queryByTestId('calendar-recurrence-scope-dialog')).not.toBeInTheDocument())
  })

  test('회차 하나만 삭제 — DELETE /events/{masterId}?scope=THIS&occurrenceDate=<회차 값 그대로>', async () => {
    const { user, requests } = await renderCalendar({ events: recurringCalendarEvent(MASTER_ID, OCC_DATES) })
    await openEvent(user, occTestId(OCC_DATES[0]))
    await user.click(screen.getByTestId('calendar-form-delete'))
    await screen.findByTestId('calendar-recurrence-scope-dialog')
    expect(screen.queryByTestId('calendar-event-dialog')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('calendar-recurrence-scope-this'))
    await waitFor(() => expect(requests.deletes).toHaveLength(1))
    const url = requests.deletes[0]
    expect(url.pathname).toBe(`/api/v1/calendar/events/${MASTER_ID}`)
    expect(url.searchParams.get('scope')).toBe('THIS')
    expect(url.searchParams.get('occurrenceDate')).toBe(OCC_DATES[0])
    await waitFor(() => expect(screen.queryByTestId('calendar-recurrence-scope-dialog')).not.toBeInTheDocument())
  })
})


/** Radix Select — 트리거에 포커스 → Enter 로 열고 옵션을 누른다(jsdom 은 포인터로 열면 레이아웃이 없어 흔들린다). */
async function pick(user: UserEvent, testId: string, option: string) {
  screen.getByTestId(testId).focus()
  await user.keyboard('{Enter}')
  fireEvent.click(await screen.findByRole('option', { name: option }))
  // 닫힌 목록이 트리거로 포커스를 늦게 돌려준다 — 다 닫힌 뒤에 다음 칸을 다뤄야 Enter 가 앞 칸을 다시 열지 않는다.
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
}

/** 값만 바꾼다(키 입력이 의미 없는 칸) — react-hook-form 이 change 를 받는다. */
const setValue = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } })

/** 새 일정 대화상자를 열고 제목을 채운다. */
async function openNew(title: string) {
  const view = await renderCalendar()
  await view.user.click(screen.getByTestId('calendar-new-event'))
  await screen.findByTestId('calendar-event-dialog')
  setValue('calendar-form-title', title)
  return view
}

describe('종일', () => {
  // #575 — 종일 체크가 시작·종료 입력을 자정으로 바꾸고 allDay 로 저장된다.
  test('종일 체크 시 시작/종료 입력이 자정으로 바뀌고 allDay 로 저장된다 (#575)', async () => {
    const { user, requests } = await openNew('종일테스트일정')
    await user.click(screen.getByTestId('calendar-form-allday'))
    expect((screen.getByTestId('calendar-form-start') as HTMLInputElement).value).toMatch(/T00:00$/)
    expect((screen.getByTestId('calendar-form-end') as HTMLInputElement).value).toMatch(/T00:00$/)
    await user.click(screen.getByTestId('calendar-form-submit'))
    await waitFor(() => expect(requests.posts).toHaveLength(1))
    expect(requests.posts[0]).toMatchObject({ allDay: true })
  })

  // WP-711 — 종일을 켰다 끄면 체크 전 시각으로 돌아오고 그 시각으로 저장된다(예전엔 00:00~익일 00:00 시간 일정이 됐다).
  test('종일을 켰다 끄면 원래 시각으로 돌아오고 그 시각으로 저장된다 (WP-711)', async () => {
    const { user, requests } = await renderCalendar({ events: [calendarEvent({ id: 1, title: '주간 회의' })] })
    await user.click((await screen.findAllByTestId('calendar-event-1'))[0])
    await screen.findByTestId('calendar-event-dialog')
    const start = screen.getByTestId('calendar-form-start') as HTMLInputElement
    const end = screen.getByTestId('calendar-form-end') as HTMLInputElement
    const before = { start: start.value, end: end.value }
    expect(before.start).not.toMatch(/T00:00$/)

    await user.click(screen.getByTestId('calendar-form-allday'))
    expect(start.value).toMatch(/T00:00$/)
    await user.click(screen.getByTestId('calendar-form-allday'))
    expect(start).toHaveValue(before.start)
    expect(end).toHaveValue(before.end)

    await user.click(screen.getByTestId('calendar-form-submit'))
    await waitFor(() => expect(requests.patches).toHaveLength(1))
    const body = requests.patches[0].body as { allDay: boolean; startsAt: string; endsAt: string }
    expect(body.allDay).toBe(false)
    expect(new Date(body.startsAt).toISOString()).toBe('2026-06-10T01:00:00.000Z')
    expect(new Date(body.endsAt).toISOString()).toBe('2026-06-10T02:00:00.000Z')
  })
})

describe('반복 입력 → 요청', () => {
  test('빈도·간격·횟수·리마인더가 RRULE·reminderMinutes 로 저장된다', async () => {
    const { user, requests } = await openNew('격주 스프린트')
    await pick(user, 'calendar-form-recurrence-freq', '매주')
    setValue('calendar-form-recurrence-interval', '2')
    await pick(user, 'calendar-form-recurrence-end', '횟수')
    setValue('calendar-form-recurrence-count', '3')
    await pick(user, 'calendar-form-reminder', '10분 전')
    await user.click(screen.getByTestId('calendar-form-submit'))

    await waitFor(() => expect(requests.posts).toHaveLength(1))
    expect(requests.posts[0]).toMatchObject({ recurrenceRule: 'FREQ=WEEKLY;INTERVAL=2;COUNT=3', reminderMinutes: 10 })
    await waitFor(() => expect(screen.queryByTestId('calendar-event-dialog')).not.toBeInTheDocument())
  })

  // WP-760 — 간격은 서버 상한(999)까지만.
  test('반복 간격이 999 를 넘으면 저장하지 않고 안내한다 (WP-760)', async () => {
    const { user, requests } = await openNew('매일 점검')
    await pick(user, 'calendar-form-recurrence-freq', '매일')
    setValue('calendar-form-recurrence-interval', '1000')
    await user.click(screen.getByTestId('calendar-form-submit'))
    expect(await screen.findByText('간격은 999 이하여야 합니다')).toBeInTheDocument()
    expect(screen.getByTestId('calendar-event-dialog')).toBeInTheDocument()
    expect(requests.posts).toHaveLength(0)
  })

  // WP-905 — 횟수도 서버 상한(999)까지만. 21억 넘는 값이면 서버의 「1 이상」 대신 상한 안내.
  test('반복 횟수가 999 를 넘으면 저장하지 않고 상한을 안내한다 (WP-905)', async () => {
    const { user, requests } = await openNew('매일 점검')
    await pick(user, 'calendar-form-recurrence-freq', '매일')
    await pick(user, 'calendar-form-recurrence-end', '횟수')
    setValue('calendar-form-recurrence-count', '2147483648')
    await user.click(screen.getByTestId('calendar-form-submit'))
    expect(await screen.findByText('횟수는 999 이하여야 합니다')).toBeInTheDocument()
    expect(screen.getByTestId('calendar-event-dialog')).toBeInTheDocument()
    expect(requests.posts).toHaveLength(0)
  })

  // WP-904 — 종료 날짜 칸이 내보내는 5자리 연도는 RRULE 조립에서 깨져 「저장」이 아무 반응도 없었다.
  test('반복 종료 날짜 연도가 5자리면 범위 안내를 보이고 저장하지 않는다 (WP-904)', async () => {
    const { user, requests } = await openNew('주간 회의')
    await pick(user, 'calendar-form-recurrence-freq', '매주')
    await pick(user, 'calendar-form-recurrence-end', '날짜까지')
    setValue('calendar-form-recurrence-until', '20260-10-23')
    await user.click(screen.getByTestId('calendar-form-submit'))
    expect(await screen.findByText('날짜는 1900-01-01 ~ 9999-12-31 사이여야 합니다')).toBeInTheDocument()
    expect(screen.getByTestId('calendar-form-recurrence-until')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('calendar-event-dialog')).toBeInTheDocument()
    expect(requests.posts).toHaveLength(0)
  })

  // #114 — 종료 날짜가 시작일보다 이르면 고아 반복이 저장되던 문제.
  test('반복 종료 날짜가 시작일보다 이전이면 검증 안내를 보이고 저장하지 않는다 (#114)', async () => {
    const { user, requests } = await openNew('Orphan 방지')
    setValue('calendar-form-start', '2026-06-19T09:00')
    setValue('calendar-form-end', '2026-06-19T10:00')
    await pick(user, 'calendar-form-recurrence-freq', '매주')
    await pick(user, 'calendar-form-recurrence-end', '날짜까지')
    setValue('calendar-form-recurrence-until', '2026-06-10')
    await user.click(screen.getByTestId('calendar-form-submit'))
    expect(await screen.findByText('반복 종료 날짜는 시작일 이후여야 합니다')).toBeInTheDocument()
    expect(screen.getByTestId('calendar-event-dialog')).toBeInTheDocument()
    expect(requests.posts).toHaveLength(0)
  })
})

describe('폼이 담을 수 없는 반복 규칙 (WP-708)', () => {
  // MCP 로 만든 「매주 월·수」 — 예전엔 폼이 BYDAY 를 버려 저장하면 「매주 월요일」로 바뀌었다.
  const mondayWednesday = () => recurringCalendarEvent(MASTER_ID, OCC_DATES, { recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE' })

  async function openLocked() {
    const view = await renderCalendar({ events: mondayWednesday() })
    await view.user.click(await screen.findByTestId(`calendar-event-${MASTER_ID}-${OCC_DATES[0]}`))
    await screen.findByTestId('calendar-event-dialog')
    return view
  }

  test('반복 칸이 잠기고, 저장해도 원래 규칙 그대로 PATCH 한다', async () => {
    const { user, requests } = await openLocked()
    expect(screen.getByTestId('calendar-form-recurrence-locked')).toHaveTextContent('저장해도 원래 규칙이 유지돼요')
    expect(screen.queryByTestId('calendar-form-recurrence-freq')).not.toBeInTheDocument()
    expect(screen.queryByTestId('calendar-form-recurrence-interval')).not.toBeInTheDocument()

    setValue('calendar-form-title', '수정된 회의')
    await user.click(screen.getByTestId('calendar-form-submit'))
    await user.click(await screen.findByTestId('calendar-recurrence-scope-all'))
    await waitFor(() => expect(requests.patches).toHaveLength(1))
    expect(requests.patches[0].body).toMatchObject({ title: '수정된 회의', recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE' })
  })

  test('「새 규칙으로 바꾸기」로 풀면 「매주」로 채워지고, 반복 안 함으로 저장할 수 있다', async () => {
    const { user, requests } = await openLocked()
    await user.click(screen.getByTestId('calendar-form-recurrence-unlock'))
    expect(screen.queryByTestId('calendar-form-recurrence-locked')).not.toBeInTheDocument()
    expect(screen.getByTestId('calendar-form-recurrence-freq')).toHaveTextContent('매주')
    await pick(user, 'calendar-form-recurrence-freq', '반복 안 함')
    await user.click(screen.getByTestId('calendar-form-submit'))
    await user.click(await screen.findByTestId('calendar-recurrence-scope-all'))
    await waitFor(() => expect(requests.patches).toHaveLength(1))
    expect(requests.patches[0].body.recurrenceRule ?? null).toBeNull()
  })
})

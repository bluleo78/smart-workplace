// 캘린더 태그(WP-714·715·716·801) — 화면 테스트(WP-966). 일정 상세·편집 폼의 태그 칩·피커, 사이드바 「태그」 묶음,
// 태그 이름·색 대화상자, 구독 주소 창의 분기·저장 요청은 브라우저 없이 판정되므로
// e2e/pages/calendar/calendar-tags.spec.ts·calendar-tag-feed.spec.ts 에서 옮겼다.
// 남은 E2E: 앱 일정 피커 PUT·태그 만들기 배선(calendar-tags.spec @wiring), 구독 주소 재발급 배선(calendar-tag-feed.spec @wiring).
// 사이드바 메뉴 → 페이지가 띄우는 대화상자, 편집 폼 저장 → 반복 범위 선택 → PATCH 가 한 화면에서 이어지므로 CalendarPage 를 renderScreen 으로 띄운다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { calendarHandlers, capture, pinNow, renderCalendarPage } from '@/test/kits/calendar/testkit-b8'
import type { CalendarEvent, CalendarTag, TagFeed } from '@/types/calendar'

import { calendar, calendarEvent } from '../../../e2e/factories/calendar.factory'

beforeEach(pinNow)
afterEach(() => vi.useRealTimers())

// 「사내 공유」는 Outlook 범주에서 온 태그(fromOutlook) — 이름 칸이 잠기는지 본다
const TAGS: CalendarTag[] = [
  { id: 1, name: '사내 공유', color: 'violet', eventCount: 12, hasFeed: true, fromOutlook: true },
  { id: 2, name: '운영', color: 'amber', eventCount: 5, hasFeed: false, fromOutlook: false },
]

const CALENDARS = [
  calendar({ id: 1, name: '기본', isDefault: true }),
  calendar({ id: 10, name: '회사 일정', isDefault: false, isReadOnly: true, accountEmail: 'me@corp.kr', provider: 'M365_GRAPH' }),
  // 내 사서함의 쓸 수 있는 Outlook 달력 — 여기 일정의 태그는 Outlook 범주로 써 넣는다(WP-716)
  calendar({ id: 11, name: 'Outlook 일정', isDefault: false, isReadOnly: false, accountEmail: 'me@corp.kr', provider: 'M365_GRAPH' }),
]

/** 내 기본 캘린더의 내가 주최한 앱 일정 — 편집 폼이 열리고 태그를 바꿀 수 있다. */
const myEvent = (over: Partial<CalendarEvent> = {}): CalendarEvent =>
  calendarEvent({
    id: 60,
    title: '내 회의',
    calendarId: 1,
    calendarName: '기본',
    myRole: 'ORGANIZER',
    tags: [{ id: 1, name: '사내 공유', color: 'violet' }],
    tagsEditable: true,
    ...over,
  })

/** 보이는 태그 칩 이름들 — scope 안(편집 폼 태그 줄 등)으로 좁힐 수 있다. */
function chipNames(scope: HTMLElement = document.body) {
  return within(scope)
    .queryAllByTestId('event-detail-tag')
    .map((el) => el.textContent)
}

/** 피커를 열고 태그를 체크한 뒤 Esc 로 닫는다(폼 상태 피커 — 저장하지 않는다). */
async function pickTags(user: ReturnType<typeof renderCalendarPage>['user'], addTestId: string, ids: number[]) {
  await user.click(screen.getByTestId(addTestId))
  const picker = await screen.findByTestId('calendar-tag-picker')
  for (const id of ids) await user.click(within(picker).getByTestId(`calendar-tag-option-${id}`))
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByTestId('calendar-tag-picker')).not.toBeInTheDocument())
}

describe('일정 상세 태그 줄', () => {
  test('공유받은 읽기 전용 달력의 M365 일정은 태그를 보기만 되고 「Outlook에서 바꾸기」 안내가 붙는다', async () => {
    const ev = calendarEvent({
      id: 42, title: 'M365 회의', calendarId: 10, calendarName: '회사 일정', external: true,
      tags: [{ id: 1, name: '사내 공유', color: 'violet' }, { id: 2, name: '운영', color: 'amber' }],
      tagsEditable: false,
    })
    renderCalendarPage('/calendar?eventId=42', calendarHandlers({ calendars: CALENDARS, events: [ev], tags: TAGS }))
    expect(await screen.findByTestId('event-detail-tags-hint')).toHaveTextContent(
      'Outlook 범주에서 가져온 태그예요 · Outlook에서 바꿀 수 있어요',
    )
    expect(chipNames()).toEqual(['사내 공유', '운영'])
    // 읽기 전용이라 「＋ 태그」가 없다
    expect(screen.queryByTestId('event-detail-tag-add')).not.toBeInTheDocument()
  })

  test('내 Outlook 달력의 M365 일정(초대받은 회의)은 피커로 태그를 바꾸면 바로 PUT 하고, Outlook 범주 반영을 알린다 (WP-716)', async () => {
    const ev = calendarEvent({
      id: 43, title: 'Teams 회의', calendarId: 11, calendarName: 'Outlook 일정', external: true, myRole: 'ATTENDEE',
      tags: [{ id: 1, name: '사내 공유', color: 'violet' }], tagsEditable: true, outlookTagScope: 'EVENT',
    })
    const put = capture('put', '/calendar/events/43/tags')
    const { user } = renderCalendarPage(
      '/calendar?eventId=43',
      [put.handler, ...calendarHandlers({ calendars: CALENDARS, events: [ev], tags: TAGS })],
    )
    expect(await screen.findByTestId('event-detail-tags-hint')).toHaveTextContent('Outlook 범주에도 함께 반영돼요 (없던 범주는 색 없이)')
    expect(chipNames()).toEqual(['사내 공유'])
    await user.click(screen.getByTestId('event-detail-tag-add'))
    await user.click(within(await screen.findByTestId('calendar-tag-picker')).getByTestId('calendar-tag-option-2'))
    // 상세 보기 피커는 체크 즉시 현재 선택 전체를 PUT(교체 방식)
    await waitFor(() => expect(put.bodies).toEqual([{ tagIds: [1, 2] }]))
  })

  test('반복 회의 회차(outlookTagScope=SERIES)는 시리즈 전체 범주에 붙는다고 알린다 (WP-716)', async () => {
    const ev = calendarEvent({
      id: 44, title: '주간 Teams 회의', calendarId: 11, calendarName: 'Outlook 일정', external: true, myRole: 'ATTENDEE',
      tags: [], tagsEditable: true, outlookTagScope: 'SERIES',
    })
    renderCalendarPage('/calendar?eventId=44', calendarHandlers({ calendars: CALENDARS, events: [ev], tags: TAGS }))
    expect(await screen.findByTestId('event-detail-tags-hint')).toHaveTextContent(
      '반복 일정 전체의 Outlook 범주에 함께 반영돼요 (없던 범주는 색 없이)',
    )
    expect(screen.getByTestId('event-detail-tag-add')).toBeInTheDocument()
  })

  test('태그가 없고 수정도 못 하는 일정에는 태그 줄이 없다(응답에 tags 가 없는 기존 일정 포함)', async () => {
    const ev = calendarEvent({ id: 7, title: '태그 없는 일정', calendarId: 10, calendarName: '회사 일정', external: true })
    renderCalendarPage('/calendar?eventId=7', calendarHandlers({ calendars: CALENDARS, events: [ev], tags: TAGS }))
    expect(await screen.findByTestId('event-detail-view')).toBeInTheDocument()
    expect(screen.queryByTestId('event-detail-tag')).not.toBeInTheDocument()
    expect(screen.queryByTestId('event-detail-tag-add')).not.toBeInTheDocument()
    expect(screen.queryByTestId('event-detail-tags-hint')).not.toBeInTheDocument()
  })
})

describe('편집·새 일정 폼의 태그(폼 상태, WP-801)', () => {
  test('편집 폼에서 체크해도 바로 저장하지 않고, 「수정」의 PATCH 에 tagIds 로 함께 실린다(따로 PUT 없음)', async () => {
    const ev = myEvent()
    const patch = capture('patch', '/calendar/events/60', () => HttpResponse.json(ev))
    const put = capture('put', '/calendar/events/:id/tags')
    const { user } = renderCalendarPage(
      '/calendar?eventId=60',
      [patch.handler, put.handler, ...calendarHandlers({ calendars: CALENDARS, events: [ev], tags: TAGS })],
    )
    expect(await screen.findByTestId('calendar-form-title')).toHaveValue('내 회의')
    const row = await screen.findByTestId('calendar-form-tags')
    expect(chipNames(row)).toEqual(['사내 공유'])
    await pickTags(user, 'calendar-form-tag-add', [2])
    // 칩은 바로 바뀌지만 저장은 아직 — 다이얼로그도 그대로
    expect(chipNames(screen.getByTestId('calendar-form-tags'))).toEqual(['사내 공유', '운영'])
    expect(patch.bodies).toEqual([])
    expect(put.bodies).toEqual([])
    expect(screen.getByTestId('calendar-event-dialog')).toBeInTheDocument()

    await user.click(screen.getByTestId('calendar-form-submit'))
    await waitFor(() => expect(patch.bodies).toHaveLength(1))
    expect(patch.bodies[0]).toMatchObject({ title: '내 회의', tagIds: [1, 2] })
    await waitFor(() => expect(screen.queryByTestId('calendar-event-dialog')).not.toBeInTheDocument())
    expect(put.bodies).toEqual([])
  })

  test('태그를 바꾸고 「취소」하면 버리고, 다시 열어 그대로 「수정」하면 tagIds 없이 PATCH 한다', async () => {
    const ev = myEvent({ id: 61 })
    const patch = capture('patch', '/calendar/events/61', () => HttpResponse.json(ev))
    const put = capture('put', '/calendar/events/:id/tags')
    const { user } = renderCalendarPage(
      '/calendar',
      [patch.handler, put.handler, ...calendarHandlers({ calendars: CALENDARS, events: [ev], tags: TAGS })],
    )
    await user.click(await screen.findByTestId('calendar-event-61'))
    expect(chipNames(await screen.findByTestId('calendar-form-tags'))).toEqual(['사내 공유'])
    // 「사내 공유」를 빼고 「운영」을 고른 뒤 취소
    await pickTags(user, 'calendar-form-tag-add', [1, 2])
    expect(chipNames(screen.getByTestId('calendar-form-tags'))).toEqual(['운영'])
    await user.click(within(screen.getByTestId('calendar-event-dialog')).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByTestId('calendar-event-dialog')).not.toBeInTheDocument())
    expect(patch.bodies).toEqual([])
    expect(put.bodies).toEqual([])

    // 다시 열면 원래 태그 그대로 — 그대로 「수정」하면 tagIds 가 빠진 PATCH 만(서버가 태그를 건드리지 않는다)
    await user.click(screen.getByTestId('calendar-event-61'))
    expect(chipNames(await screen.findByTestId('calendar-form-tags'))).toEqual(['사내 공유'])
    await user.click(screen.getByTestId('calendar-form-submit'))
    await waitFor(() => expect(patch.bodies).toHaveLength(1))
    expect(patch.bodies[0]).not.toHaveProperty('tagIds')
    await waitFor(() => expect(screen.queryByTestId('calendar-event-dialog')).not.toBeInTheDocument())
    expect(put.bodies).toEqual([])
  })

  test('새 일정 폼에도 태그 줄이 있고, 고른 태그는 일정 POST 에 tagIds 로 함께 실린다', async () => {
    const post = capture('post', '/calendar/events', () =>
      HttpResponse.json(calendarEvent({ id: 999, title: '고객 미팅', calendarId: 1 }), { status: 201 }),
    )
    const put = capture('put', '/calendar/events/:id/tags')
    const { user } = renderCalendarPage(
      '/calendar',
      [post.handler, put.handler, ...calendarHandlers({ calendars: CALENDARS, tags: TAGS })],
    )
    await user.click(await screen.findByTestId('calendar-new-event'))
    fireEvent.change(await screen.findByTestId('calendar-form-title'), { target: { value: '고객 미팅' } })
    expect(chipNames(screen.getByTestId('calendar-form-tags'))).toEqual([])
    await pickTags(user, 'calendar-form-tag-add', [2])
    expect(chipNames(screen.getByTestId('calendar-form-tags'))).toEqual(['운영'])

    await user.click(screen.getByTestId('calendar-form-submit'))
    await waitFor(() => expect(post.bodies).toHaveLength(1))
    expect(post.bodies[0]).toMatchObject({ title: '고객 미팅', tagIds: [2] })
    await waitFor(() => expect(screen.queryByTestId('calendar-event-dialog')).not.toBeInTheDocument())
    expect(put.bodies).toEqual([])
  })

  test('태그를 실은 저장이 실패하면 오류를 알리고 폼·고른 태그가 그대로 남는다', async () => {
    const post = capture('post', '/calendar/events', () =>
      HttpResponse.json({ message: '태그를 찾을 수 없습니다' }, { status: 404 }),
    )
    const { user } = renderCalendarPage('/calendar', [post.handler, ...calendarHandlers({ calendars: CALENDARS, tags: TAGS })])
    await user.click(await screen.findByTestId('calendar-new-event'))
    fireEvent.change(await screen.findByTestId('calendar-form-title'), { target: { value: '회의' } })
    await pickTags(user, 'calendar-form-tag-add', [1])
    await user.click(screen.getByTestId('calendar-form-submit'))

    expect(await screen.findByText('태그를 찾을 수 없습니다')).toBeInTheDocument()
    expect(post.bodies[0]).toMatchObject({ tagIds: [1] })
    // 일정과 태그가 한 요청이라 함께 실패한다 — 다이얼로그·고른 태그가 남아 다시 저장할 수 있다
    expect(screen.getByTestId('calendar-event-dialog')).toBeInTheDocument()
    expect(chipNames(screen.getByTestId('calendar-form-tags'))).toEqual(['사내 공유'])
  })

  test('반복 일정의 태그를 바꿔 저장하면 범위 선택에 「반복 일정 전체」 안내가 붙고, 고른 범위의 PATCH 에 tagIds 가 실린다', async () => {
    const occ = '2026-06-11T01:00:00Z'
    const ev = myEvent({
      id: 70, masterEventId: 70, occurrenceDate: occ, startsAt: occ, endsAt: '2026-06-11T02:00:00Z',
      recurrenceRule: 'FREQ=WEEKLY', title: '주간 회의',
    })
    const patch = capture('patch', '/calendar/events/70', () => HttpResponse.json(ev))
    const { user } = renderCalendarPage('/calendar', [patch.handler, ...calendarHandlers({ calendars: CALENDARS, events: [ev], tags: TAGS })])

    // 태그를 안 바꾸면 안내가 없다
    await user.click(await screen.findByTestId(`calendar-event-70-${occ}`))
    expect(chipNames(await screen.findByTestId('calendar-form-tags'))).toEqual(['사내 공유'])
    await user.click(screen.getByTestId('calendar-form-submit'))
    const scope = await screen.findByTestId('calendar-recurrence-scope-dialog')
    expect(within(scope).queryByTestId('calendar-recurrence-scope-note')).not.toBeInTheDocument()
    await user.click(within(scope).getByRole('button', { name: '취소' }))

    // 태그를 바꾸면 안내가 붙고, 「이후 모든 일정」의 PATCH 하나에 tagIds 가 함께 간다(시리즈를 나누는 서버가 새 시리즈에 붙인다)
    await pickTags(user, 'calendar-form-tag-add', [2])
    await user.click(screen.getByTestId('calendar-form-submit'))
    const scope2 = await screen.findByTestId('calendar-recurrence-scope-dialog')
    expect(within(scope2).getByTestId('calendar-recurrence-scope-note')).toHaveTextContent(
      '태그는 회차마다 따로 붙지 않고 반복 일정에 함께 붙어요',
    )
    await user.click(within(scope2).getByTestId('calendar-recurrence-scope-following'))

    await waitFor(() => expect(patch.bodies).toHaveLength(1))
    expect(patch.urls[0].searchParams.get('scope')).toBe('THIS_AND_FOLLOWING')
    expect(patch.urls[0].searchParams.get('occurrenceDate')).toBe(occ)
    expect(patch.bodies[0]).toMatchObject({ tagIds: [1, 2] })
    await waitFor(() => expect(screen.queryByTestId('calendar-recurrence-scope-dialog')).not.toBeInTheDocument())
  })
})

describe('사이드바 태그 묶음·태그 대화상자', () => {
  test('이름·일정 수·Outlook 안내가 보이고, ⋮ 메뉴로 지우기 확인을 거쳐 DELETE 한다', async () => {
    const del = capture('delete', '/calendar/tags/2')
    const { user } = renderCalendarPage('/calendar', [del.handler, ...calendarHandlers({ calendars: CALENDARS, tags: TAGS })])
    const section = await screen.findByTestId('calendar-tag-section')
    const item = await within(section).findByTestId('calendar-tag-item-1')
    expect(item).toHaveTextContent('사내 공유')
    expect(item).toHaveTextContent('12')
    // 연동 계정(M365)이 있으면 Outlook 범주 안내를 단다
    expect(section).toHaveTextContent('Outlook 범주도 여기 함께 보여요')

    await user.click(screen.getByTestId('calendar-tag-menu-2'))
    await user.click(await screen.findByTestId('calendar-tag-delete-2'))
    const confirm = await screen.findByTestId('calendar-tag-delete-confirm')
    expect(confirm).toHaveTextContent('「운영」 태그를 지울까요?')
    expect(confirm).toHaveTextContent('5개')
    await user.click(within(confirm).getByTestId('calendar-tag-delete-submit'))
    await waitFor(() => expect(del.urls).toHaveLength(1))
  })

  test('사이드바 ＋ 로 새 태그를 만들면 이름과 색이 POST 된다', async () => {
    const post = capture('post', '/calendar/tags', () =>
      HttpResponse.json({ id: 9, name: '출장', color: 'pink', eventCount: 0, hasFeed: false, fromOutlook: false }),
    )
    const { user } = renderCalendarPage('/calendar', [post.handler, ...calendarHandlers({ calendars: CALENDARS, tags: TAGS })])
    await user.click(await screen.findByTestId('calendar-tag-add'))
    fireEvent.change(await screen.findByTestId('calendar-tag-edit-name'), { target: { value: '출장' } })
    await user.click(screen.getByTestId('calendar-tag-color-pink'))
    await user.click(screen.getByTestId('calendar-tag-edit-submit'))
    await waitFor(() => expect(post.bodies).toEqual([{ name: '출장', color: 'pink' }]))
  })

  test('Outlook 범주에서 온 태그는 이름 칸이 잠기고 안내가 보이며, 색만 바꿔 원래 이름 그대로 PATCH 한다', async () => {
    const patch = capture('patch', '/calendar/tags/1', () => HttpResponse.json({ ...TAGS[0], color: 'teal' }))
    const { user } = renderCalendarPage('/calendar', [patch.handler, ...calendarHandlers({ calendars: CALENDARS, tags: TAGS })])
    await user.click(await screen.findByTestId('calendar-tag-menu-1'))
    await user.click(await screen.findByTestId('calendar-tag-edit-1'))

    const name = await screen.findByTestId('calendar-tag-edit-name')
    expect(name).toBeDisabled()
    expect(name).toHaveValue('사내 공유')
    expect(screen.getByTestId('calendar-tag-edit-name-hint')).toHaveTextContent('Outlook 범주에서 온 태그라 이름은 Outlook에서 바꿔 주세요')
    await user.click(screen.getByTestId('calendar-tag-color-teal'))
    await user.click(screen.getByTestId('calendar-tag-edit-submit'))
    await waitFor(() => expect(patch.bodies).toEqual([{ name: '사내 공유', color: 'teal' }]))
  })

  test('앱에서 만든 태그는 이름 칸을 고칠 수 있고 Outlook 안내가 없다', async () => {
    const { user } = renderCalendarPage('/calendar', calendarHandlers({ calendars: CALENDARS, tags: TAGS }))
    await user.click(await screen.findByTestId('calendar-tag-menu-2'))
    await user.click(await screen.findByTestId('calendar-tag-edit-2'))
    expect(await screen.findByTestId('calendar-tag-edit-name')).toBeEnabled()
    expect(screen.queryByTestId('calendar-tag-edit-name-hint')).not.toBeInTheDocument()
  })
})

describe('구독 주소 창(WP-715)', () => {
  const FEED_TAGS: CalendarTag[] = [
    { id: 1, name: '사내 공유', color: 'violet', eventCount: 12, hasFeed: true, fromOutlook: false },
    { id: 2, name: '운영', color: 'amber', eventCount: 5, hasFeed: false, fromOutlook: false },
  ]

  /**
   * 태그 목록을 상태로 서빙하고, 구독 주소 발급(POST)·폐기(DELETE)가 그 태그의 hasFeed 를 실제 서버처럼 바꾸게 한다.
   * 화면은 성공 뒤 태그 목록을 다시 받으므로, 고정 응답이면 hasFeed 가 되돌아가 창이 이전 상태로 돌아간다.
   */
  function statefulFeed(tagId: number, feed: TagFeed) {
    const tags = FEED_TAGS.map((t) => ({ ...t }))
    const calls = { post: 0, del: 0 }
    const handlers = [
      http.get('/api/v1/calendar/tags', () => HttpResponse.json(tags)),
      http.post(`/api/v1/calendar/tags/${tagId}/feed`, () => {
        calls.post++
        tags.find((t) => t.id === tagId)!.hasFeed = true
        return HttpResponse.json(feed)
      }),
      http.delete(`/api/v1/calendar/tags/${tagId}/feed`, () => {
        calls.del++
        tags.find((t) => t.id === tagId)!.hasFeed = false
        return new HttpResponse(null, { status: 204 })
      }),
      http.get(`/api/v1/calendar/tags/${tagId}/feed`, () =>
        tags.find((t) => t.id === tagId)!.hasFeed
          ? HttpResponse.json(feed)
          : HttpResponse.json({ message: '구독 주소가 없습니다' }, { status: 404 }),
      ),
    ]
    return { handlers, calls }
  }

  /** 사이드바 ⋮ → 「구독 주소…」로 창을 연다. */
  async function openFeed(user: ReturnType<typeof renderCalendarPage>['user'], tagId: number) {
    await user.click(await screen.findByTestId(`calendar-tag-menu-${tagId}`))
    await user.click(await screen.findByTestId(`calendar-tag-feed-${tagId}`))
    return screen.findByTestId('calendar-tag-feed-dialog')
  }

  test('구독 주소가 없는 태그는 「구독 주소 만들기」만 보인다', async () => {
    const { user } = renderCalendarPage('/calendar', calendarHandlers({ calendars: CALENDARS, tags: FEED_TAGS }))
    const dialog = await openFeed(user, 2)
    expect(within(dialog).getByTestId('calendar-tag-feed-create')).toBeInTheDocument()
    expect(within(dialog).queryByTestId('calendar-tag-feed-url')).not.toBeInTheDocument()
  })

  test('주소 없애기는 확인 뒤 DELETE 하고, 창은 「구독 주소 만들기」로 돌아간다', async () => {
    const { handlers, calls } = statefulFeed(1, {
      url: 'https://example.test/api/v1/public/calendar/feeds/abc123.ics', createdAt: '2026-06-10T05:00:00Z', eventCount: 12,
    })
    const { user } = renderCalendarPage('/calendar', [...handlers, ...calendarHandlers({ calendars: CALENDARS, tags: FEED_TAGS })])
    const dialog = await openFeed(user, 1)
    expect(await within(dialog).findByTestId('calendar-tag-feed-url')).toBeInTheDocument()
    await user.click(within(dialog).getByTestId('calendar-tag-feed-remove'))
    const confirm = await screen.findByTestId('calendar-tag-feed-confirm')
    expect(confirm).toHaveTextContent('지금 주소는 바로 막히고')
    await user.click(within(confirm).getByTestId('calendar-tag-feed-confirm-submit'))
    await waitFor(() => expect(calls.del).toBe(1))
    expect(await within(dialog).findByTestId('calendar-tag-feed-create')).toBeInTheDocument()
    expect(within(dialog).queryByTestId('calendar-tag-feed-url')).not.toBeInTheDocument()
  })

  test('주소가 없는 태그에서 「구독 주소 만들기」를 누르면 POST 하고 새 주소·일정 수를 보인다', async () => {
    const { handlers, calls } = statefulFeed(2, {
      url: 'https://example.test/api/v1/public/calendar/feeds/fresh789.ics', createdAt: '2026-06-10T06:00:00Z', eventCount: 5,
    })
    const { user } = renderCalendarPage('/calendar', [...handlers, ...calendarHandlers({ calendars: CALENDARS, tags: FEED_TAGS })])
    const dialog = await openFeed(user, 2)
    await user.click(within(dialog).getByTestId('calendar-tag-feed-create'))
    await waitFor(() => expect(calls.post).toBe(1))
    expect(await within(dialog).findByTestId('calendar-tag-feed-url')).toHaveValue(
      'https://example.test/api/v1/public/calendar/feeds/fresh789.ics',
    )
    expect(within(dialog).getByTestId('calendar-tag-feed-count')).toHaveTextContent('지금 이 태그를 붙인 일정 5개')
  })
})

// 캘린더 태그 E2E (WP-714·716) — 일정 상세·편집 폼의 태그 칩·피커, 사이드바 「태그」 묶음의 실제 배선.
// 백엔드 없이 page.route 로 /api/v1/calendar/** 를 모킹한다. 칩 노출·분기 판정은 화면마다 1건씩만 둔다(WP-413).
import type { Page } from '@playwright/test'

import type { CalendarEvent, CalendarTag } from '../../../src/types/calendar'
import { calendar, calendarEvent } from '../../factories/calendar.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

// 타임존 고정 — 호스트 TZ 에 따라 날짜 경계가 달라진다(이슈 #493).
test.use({ timezoneId: 'Asia/Seoul' })

// 「사내 공유」는 Outlook 범주에서 온 태그(fromOutlook) — 이름 칸이 잠기는지 본다
const TAGS: CalendarTag[] = [
  { id: 1, name: '사내 공유', color: 'violet', eventCount: 12, hasFeed: true, fromOutlook: true },
  { id: 2, name: '운영', color: 'amber', eventCount: 5, hasFeed: false, fromOutlook: false },
]

/** 앱 일정(태그 수정 가능) — 초대받은 일정이라 캘린더 목록에 없는 calendarId. */
const appEvent = (over: Partial<CalendarEvent> = {}): CalendarEvent =>
  calendarEvent({
    id: 50,
    title: '주간 개발 회의',
    calendarId: 99,
    calendarName: null,
    myRole: 'ATTENDEE',
    tags: [{ id: 1, name: '사내 공유', color: 'violet' }],
    tagsEditable: true,
    ...over,
  })

/** 일정 목록·상세 + 태그 목록 스텁. 태그 PUT/POST/피드는 각 테스트가 더 구체적으로 다시 모킹한다(나중 등록 우선). */
async function stub(page: Page, events: CalendarEvent[], tags: CalendarTag[] = TAGS) {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  await mockApi(page, 'GET', '/api/v1/calendars', [
    calendar({ id: 1, name: '기본', isDefault: true }),
    calendar({ id: 10, name: '회사 일정', isDefault: false, isReadOnly: true, accountEmail: 'me@corp.kr', provider: 'M365_GRAPH' }),
    // 내 사서함의 쓸 수 있는 Outlook 달력 — 여기 일정의 태그는 Outlook 범주로 써 넣는다(WP-716)
    calendar({ id: 11, name: 'Outlook 일정', isDefault: false, isReadOnly: false, accountEmail: 'me@corp.kr', provider: 'M365_GRAPH' }),
  ])
  await mockApi(page, 'GET', '/api/v1/me/issues', [])
  await mockApi(page, 'GET', '/api/v1/calendar/tags', tags)
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/calendar/events'),
    (route) => {
      const m = new URL(route.request().url()).pathname.match(/\/calendar\/events\/(\d+)$/)
      if (route.request().method() === 'GET') {
        const body = m ? events.find((e) => e.id === Number(m[1])) : events
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      }
      return route.fallback()
    },
  )
}

test('공유받은 읽기 전용 달력의 M365 일정은 태그를 보기만 되고 「Outlook에서 바꾸기」 안내가 붙는다', async ({ authenticatedPage: page }) => {
  await stub(page, [
    calendarEvent({
      id: 42, title: 'M365 회의', calendarId: 10, calendarName: '회사 일정', external: true,
      tags: [{ id: 1, name: '사내 공유', color: 'violet' }, { id: 2, name: '운영', color: 'amber' }],
      tagsEditable: false,
    }),
  ])
  await page.goto('/calendar?eventId=42')
  await expect(page.getByTestId('event-detail-tag')).toHaveText(['사내 공유', '운영'])
  await expect(page.getByTestId('event-detail-tags-hint')).toHaveText('Outlook 범주에서 가져온 태그예요 · Outlook에서 바꿀 수 있어요')
  // 읽기 전용이라 「＋ 태그」가 없다
  await expect(page.getByTestId('event-detail-tag-add')).toHaveCount(0)
})

test('내 Outlook 달력의 M365 일정은 피커로 태그를 바꾸고 Outlook 범주에도 반영된다고 알린다 (WP-716)', async ({ authenticatedPage: page }) => {
  // Teams 로 초대받은 회의의 내 사본 — 주최자가 아니라 상세 보기로 열리지만 태그(내 사서함의 범주)는 바꿀 수 있다
  await stub(page, [
    calendarEvent({
      id: 43, title: 'Teams 회의', calendarId: 11, calendarName: 'Outlook 일정', external: true, myRole: 'ATTENDEE',
      tags: [{ id: 1, name: '사내 공유', color: 'violet' }],
      tagsEditable: true, outlookTagScope: 'EVENT',
    }),
    calendarEvent({
      id: 44, title: '주간 Teams 회의', calendarId: 11, calendarName: 'Outlook 일정', external: true, myRole: 'ATTENDEE',
      tags: [], tagsEditable: true, outlookTagScope: 'SERIES',
    }),
  ])
  const put = await mockApi(page, 'PUT', '/api/v1/calendar/events/43/tags', {}, { capture: true })

  await page.goto('/calendar?eventId=43')
  await expect(page.getByTestId('event-detail-tag')).toHaveText(['사내 공유'])
  await expect(page.getByTestId('event-detail-tags-hint')).toHaveText('Outlook 범주에도 함께 반영돼요 (없던 범주는 색 없이)')
  await page.getByTestId('event-detail-tag-add').click()
  await page.getByTestId('calendar-tag-picker').getByTestId('calendar-tag-option-2').click()
  expect((await put.waitForRequest()).payload).toEqual({ tagIds: [1, 2] })

  // 반복 회의 회차는 시리즈 전체에 붙는다고 알린다
  await page.goto('/calendar?eventId=44')
  await expect(page.getByTestId('event-detail-tags-hint')).toHaveText('반복 일정 전체의 Outlook 범주에 함께 반영돼요 (없던 범주는 색 없이)')
  await expect(page.getByTestId('event-detail-tag-add')).toBeVisible()
})

test('태그가 없고 수정도 못 하는 일정에는 태그 줄이 없다(응답에 tags 가 없는 기존 일정 포함)', async ({ authenticatedPage: page }) => {
  await stub(page, [calendarEvent({ id: 7, title: '태그 없는 일정', calendarId: 10, calendarName: '회사 일정', external: true })])
  await page.goto('/calendar?eventId=7')
  await expect(page.getByTestId('event-detail-view')).toBeVisible()
  await expect(page.getByTestId('event-detail-tag')).toHaveCount(0)
  await expect(page.getByTestId('event-detail-tag-add')).toHaveCount(0)
  await expect(page.getByTestId('event-detail-tags-hint')).toHaveCount(0)
})

test('앱 일정: 피커에서 체크하면 바로 PUT 으로 저장되고, 없는 이름은 만들어 바로 붙인다', async ({ authenticatedPage: page }) => {
  await stub(page, [appEvent()])
  const put = await mockApi(page, 'PUT', '/api/v1/calendar/events/50/tags', {}, { capture: true })
  const post = await mockApi(page, 'POST', '/api/v1/calendar/tags', { id: 9, name: '고객사', color: 'blue', eventCount: 0, hasFeed: false }, { capture: true })

  await page.goto('/calendar?eventId=50')
  await expect(page.getByTestId('event-detail-tag')).toHaveText(['사내 공유'])
  await page.getByTestId('event-detail-tag-add').click()
  const picker = page.getByTestId('calendar-tag-picker')
  await expect(picker.getByTestId('calendar-tag-option-1').getByRole('checkbox')).toBeChecked()

  // 「운영」 체크 → 현재 선택 전체를 PUT (교체 방식)
  await picker.getByTestId('calendar-tag-option-2').click()
  expect((await put.waitForRequest()).payload).toEqual({ tagIds: [1, 2] })

  // 대소문자만 다른 기존 이름은 「만들기」를 내지 않는다
  await page.getByTestId('calendar-tag-search').fill(' 운영 ')
  await expect(page.getByTestId('calendar-tag-create-option')).toHaveCount(0)

  // 없는 이름 → 「「고객사」 태그 만들기」 → POST(이름+이름에서 정한 색) 뒤 새 태그까지 포함해 PUT
  await page.getByTestId('calendar-tag-search').fill('고객사')
  await expect(page.getByTestId('calendar-tag-create-option')).toContainText('「고객사」 태그 만들기')
  await page.getByTestId('calendar-tag-create-option').click()
  const created = (await post.waitForRequest()).payload as { name: string; color: string }
  expect(created.name).toBe('고객사')
  expect(created.color).toMatch(/^(blue|green|red|amber|violet|pink|teal|gray)$/)
  await expect.poll(() => put.lastRequest()?.payload).toEqual({ tagIds: [1, 2, 9] })
})

test('사이드바 태그 묶음: 이름·일정 수가 보이고 ⋮ 메뉴로 지우기 확인을 거쳐 DELETE 한다', async ({ authenticatedPage: page }) => {
  await stub(page, [])
  const del = await mockApi(page, 'DELETE', '/api/v1/calendar/tags/2', {}, { capture: true })
  await page.goto('/calendar')

  const section = page.getByTestId('calendar-tag-section')
  await expect(section.getByTestId('calendar-tag-item-1')).toContainText('사내 공유')
  await expect(section.getByTestId('calendar-tag-item-1')).toContainText('12')
  // 연동 계정(M365)이 있으면 Outlook 범주 안내를 단다
  await expect(section).toContainText('Outlook 범주도 여기 함께 보여요')

  await page.getByTestId('calendar-tag-menu-2').click()
  await page.getByTestId('calendar-tag-delete-2').click()
  const confirm = page.getByTestId('calendar-tag-delete-confirm')
  await expect(confirm).toContainText('「운영」 태그를 지울까요?')
  await expect(confirm).toContainText('5개')
  await confirm.getByTestId('calendar-tag-delete-submit').click()
  await expect.poll(() => del.requests.length).toBe(1)
})

test('사이드바 ＋ 로 새 태그를 만들면 이름과 색이 POST 된다', async ({ authenticatedPage: page }) => {
  await stub(page, [])
  const post = await mockApi(page, 'POST', '/api/v1/calendar/tags', { id: 9, name: '출장', color: 'pink', eventCount: 0, hasFeed: false }, { capture: true })
  await page.goto('/calendar')
  await page.getByTestId('calendar-tag-add').click()
  await page.getByTestId('calendar-tag-edit-name').fill('출장')
  await page.getByTestId('calendar-tag-color-pink').click()
  await page.getByTestId('calendar-tag-edit-submit').click()
  expect((await post.waitForRequest()).payload).toEqual({ name: '출장', color: 'pink' })
})

/** 일정 쓰기 요청(GET 제외)을 보낸 순서대로 「METHOD 경로」로 모은다 — 태그를 따로 PUT 하지 않고 일정 요청 하나로 끝나는지 본다(WP-801). */
function trackEventWrites(page: Page): string[] {
  const writes: string[] = []
  page.on('request', (req) => {
    const path = new URL(req.url()).pathname
    if (req.method() !== 'GET' && path.startsWith('/api/v1/calendar/events')) writes.push(`${req.method()} ${path}`)
  })
  return writes
}

test('편집 폼의 태그는 폼 상태라 체크해도 바로 저장하지 않고, 「수정」의 PATCH 에 tagIds 로 함께 실린다(따로 PUT 없음)', async ({ authenticatedPage: page }) => {
  // 내 기본 캘린더(id 1)의 내가 주최한 일정 → 편집 폼이 열린다
  const ev = appEvent({ id: 60, title: '내 회의', calendarId: 1, calendarName: '기본', myRole: 'ORGANIZER' })
  await stub(page, [ev])
  const patch = await mockApi(page, 'PATCH', '/api/v1/calendar/events/60', ev, { capture: true })
  const writes = trackEventWrites(page)
  await page.goto('/calendar?eventId=60')

  await expect(page.getByTestId('calendar-form-title')).toHaveValue('내 회의')
  const row = page.getByTestId('calendar-form-tags')
  await expect(row.getByTestId('event-detail-tag')).toHaveText(['사내 공유'])
  await row.getByTestId('calendar-form-tag-add').click()
  await page.getByTestId('calendar-tag-picker').getByTestId('calendar-tag-option-2').click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('calendar-tag-picker')).toHaveCount(0)
  // 칩은 바로 바뀌지만 저장은 아직 — 다이얼로그도 그대로
  await expect(row.getByTestId('event-detail-tag')).toHaveText(['사내 공유', '운영'])
  expect(writes).toEqual([])
  await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

  await page.getByTestId('calendar-form-submit').click()
  expect((await patch.waitForRequest()).payload).toMatchObject({ title: '내 회의', tagIds: [1, 2] })
  await expect(page.getByTestId('calendar-event-dialog')).toBeHidden()
  expect(writes).toEqual(['PATCH /api/v1/calendar/events/60'])
})

test('편집 폼에서 태그를 바꾸고 「취소」하면 저장하지 않고 버리며, 태그를 안 바꾼 「수정」은 tagIds 없이 PATCH 한다', async ({ authenticatedPage: page }) => {
  const ev = appEvent({ id: 61, title: '내 회의', calendarId: 1, calendarName: '기본', myRole: 'ORGANIZER' })
  await stub(page, [ev])
  const patch = await mockApi(page, 'PATCH', '/api/v1/calendar/events/61', ev, { capture: true })
  const writes = trackEventWrites(page)
  await page.goto('/calendar')

  await page.getByTestId('calendar-event-61').click()
  const dialog = page.getByTestId('calendar-event-dialog')
  const row = page.getByTestId('calendar-form-tags')
  await expect(row.getByTestId('event-detail-tag')).toHaveText(['사내 공유'])
  // 「사내 공유」를 빼고 「운영」을 고른 뒤 취소
  await row.getByTestId('calendar-form-tag-add').click()
  const picker = page.getByTestId('calendar-tag-picker')
  await picker.getByTestId('calendar-tag-option-1').click()
  await picker.getByTestId('calendar-tag-option-2').click()
  await page.keyboard.press('Escape')
  await expect(row.getByTestId('event-detail-tag')).toHaveText(['운영'])
  await dialog.getByRole('button', { name: '취소' }).click()
  await expect(dialog).toBeHidden()
  expect(writes).toEqual([])

  // 다시 열면 원래 태그 그대로 — 그대로 「수정」하면 tagIds 가 빠진 PATCH 만(서버가 태그를 건드리지 않는다)
  await page.getByTestId('calendar-event-61').click()
  await expect(row.getByTestId('event-detail-tag')).toHaveText(['사내 공유'])
  await page.getByTestId('calendar-form-submit').click()
  expect((await patch.waitForRequest()).payload).not.toHaveProperty('tagIds')
  await expect(dialog).toBeHidden()
  expect(writes).toEqual(['PATCH /api/v1/calendar/events/61'])
})

test('새 일정 폼에도 태그 줄이 있고, 고른 태그는 일정 POST 에 tagIds 로 함께 실린다', async ({ authenticatedPage: page }) => {
  await stub(page, [])
  const post = await mockApi(
    page,
    'POST',
    '/api/v1/calendar/events',
    calendarEvent({ id: 999, title: '고객 미팅', calendarId: 1 }),
    { capture: true },
  )
  const writes = trackEventWrites(page)
  await page.goto('/calendar')
  await page.getByTestId('calendar-new-event').click()
  await page.getByTestId('calendar-form-title').fill('고객 미팅')

  const row = page.getByTestId('calendar-form-tags')
  await expect(row.getByTestId('event-detail-tag')).toHaveCount(0)
  await row.getByTestId('calendar-form-tag-add').click()
  await page.getByTestId('calendar-tag-picker').getByTestId('calendar-tag-option-2').click()
  await page.keyboard.press('Escape')
  await expect(row.getByTestId('event-detail-tag')).toHaveText(['운영'])

  await page.getByTestId('calendar-form-submit').click()
  expect((await post.waitForRequest()).payload).toMatchObject({ title: '고객 미팅', tagIds: [2] })
  await expect(page.getByTestId('calendar-event-dialog')).toBeHidden()
  expect(writes).toEqual(['POST /api/v1/calendar/events'])
})

test('태그를 실은 저장이 실패하면 폼이 그대로 남아 고른 태그를 잃지 않는다', async ({ authenticatedPage: page }) => {
  await stub(page, [])
  const post = await mockApi(page, 'POST', '/api/v1/calendar/events', { message: '태그를 찾을 수 없습니다' }, {
    status: 404,
    capture: true,
  })
  await page.goto('/calendar')
  await page.getByTestId('calendar-new-event').click()
  await page.getByTestId('calendar-form-title').fill('회의')
  await page.getByTestId('calendar-form-tag-add').click()
  await page.getByTestId('calendar-tag-picker').getByTestId('calendar-tag-option-1').click()
  await page.keyboard.press('Escape')
  await page.getByTestId('calendar-form-submit').click()

  expect((await post.waitForRequest()).payload).toMatchObject({ tagIds: [1] })
  await expect(page.getByText('태그를 찾을 수 없습니다')).toBeVisible()
  // 일정과 태그가 한 요청이라 함께 실패한다 — 다이얼로그·고른 태그가 남아 다시 저장할 수 있다
  await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()
  await expect(page.getByTestId('calendar-form-tags').getByTestId('event-detail-tag')).toHaveText(['사내 공유'])
})

test('반복 일정의 태그를 바꿔 저장하면 범위 선택에 「반복 일정 전체」 안내가 붙고, 고른 범위의 PATCH 에 tagIds 가 실린다', async ({ authenticatedPage: page }) => {
  const occ = '2026-06-11T01:00:00Z'
  const ev = appEvent({
    id: 70,
    masterEventId: 70,
    occurrenceDate: occ,
    startsAt: occ,
    endsAt: '2026-06-11T02:00:00Z',
    recurrenceRule: 'FREQ=WEEKLY',
    title: '주간 회의',
    calendarId: 1,
    calendarName: '기본',
    myRole: 'ORGANIZER',
  })
  await stub(page, [ev])
  const patch = await mockApi(page, 'PATCH', '/api/v1/calendar/events/70', ev, { capture: true })
  const writes = trackEventWrites(page)
  await page.goto('/calendar')

  // 태그를 안 바꾸면 안내가 없다
  await page.getByTestId(`calendar-event-70-${occ}`).click()
  await expect(page.getByTestId('calendar-form-tags').getByTestId('event-detail-tag')).toHaveText(['사내 공유'])
  await page.getByTestId('calendar-form-submit').click()
  const scope = page.getByTestId('calendar-recurrence-scope-dialog')
  await expect(scope).toBeVisible()
  await expect(scope.getByTestId('calendar-recurrence-scope-note')).toHaveCount(0)
  await scope.getByRole('button', { name: '취소' }).click()

  // 태그를 바꾸면 안내가 붙고, 「이후 모든 일정」의 PATCH 하나에 tagIds 가 함께 간다(시리즈를 나누는 서버가 새 시리즈에 붙인다)
  await page.getByTestId('calendar-form-tag-add').click()
  await page.getByTestId('calendar-tag-picker').getByTestId('calendar-tag-option-2').click()
  await page.keyboard.press('Escape')
  await page.getByTestId('calendar-form-submit').click()
  await expect(scope.getByTestId('calendar-recurrence-scope-note')).toHaveText('태그는 회차마다 따로 붙지 않고 반복 일정에 함께 붙어요')
  await scope.getByTestId('calendar-recurrence-scope-following').click()

  const req = await patch.waitForRequest()
  expect(req.searchParams.get('scope')).toBe('THIS_AND_FOLLOWING')
  expect(req.searchParams.get('occurrenceDate')).toBe(occ)
  expect(req.payload).toMatchObject({ tagIds: [1, 2] })
  await expect(scope).toBeHidden()
  expect(writes).toEqual(['PATCH /api/v1/calendar/events/70'])
})

test('Outlook 범주에서 온 태그는 이름 칸이 잠기고 안내가 보이며, 색만 바꿔 원래 이름 그대로 PATCH 한다', async ({ authenticatedPage: page }) => {
  await stub(page, [])
  const patch = await mockApi(page, 'PATCH', '/api/v1/calendar/tags/1', { ...TAGS[0], color: 'teal' }, { capture: true })
  await page.goto('/calendar')
  await page.getByTestId('calendar-tag-menu-1').click()
  await page.getByTestId('calendar-tag-edit-1').click()

  await expect(page.getByTestId('calendar-tag-edit-name')).toBeDisabled()
  await expect(page.getByTestId('calendar-tag-edit-name')).toHaveValue('사내 공유')
  await expect(page.getByTestId('calendar-tag-edit-name-hint')).toHaveText('Outlook 범주에서 온 태그라 이름은 Outlook에서 바꿔 주세요')
  await page.getByTestId('calendar-tag-color-teal').click()
  await page.getByTestId('calendar-tag-edit-submit').click()
  expect((await patch.waitForRequest()).payload).toEqual({ name: '사내 공유', color: 'teal' })
})

test('앱에서 만든 태그는 이름 칸을 고칠 수 있고 Outlook 안내가 없다', async ({ authenticatedPage: page }) => {
  await stub(page, [])
  await page.goto('/calendar')
  await page.getByTestId('calendar-tag-menu-2').click()
  await page.getByTestId('calendar-tag-edit-2').click()

  await expect(page.getByTestId('calendar-tag-edit-name')).toBeEnabled()
  await expect(page.getByTestId('calendar-tag-edit-name-hint')).toHaveCount(0)
})

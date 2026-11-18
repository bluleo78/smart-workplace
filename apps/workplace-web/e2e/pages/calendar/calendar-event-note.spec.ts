// 일정 회의록 노트 줄·「노트 연결」 창 390px 레이아웃 E2E(WP-1701). 백엔드 없이 page.route 모킹.
// 긴 제목·긴 공간 이름 카드가 폭을 넘치지 않는지, 휴대폰에서 창이 화면 폭이고 「연결」이 「취소」 위인지는
// 실제 레이아웃이 있어야 알 수 있어 @layout 으로 본다. 잇기·끊기 동작·문구는 vitest(Task 4)가 지킨다.
import { calendarEvent, eventNote, noteSearchResult } from '../../factories/calendar.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { boxOf } from '../../fixtures/layout'

const VIEWPORT = { width: 390, height: 844 }

test('390px 일정 상세 시트의 「회의록」 줄이 넘치지 않는다(WP-1701)', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  await page.setViewportSize(VIEWPORT)

  // 80자 제목 + 긴 공간 이름 — 카드가 줄임표로 접혀야 한다
  const longTitle = '가'.repeat(80)
  const note = eventNote({ title: longTitle, spaceName: '아주 긴 공간 이름 '.repeat(6) })
  // 초대받은 일정(ATTENDEE)은 읽기 전용 상세 시트로 열린다
  const event = calendarEvent({ id: 100, title: '긴 노트 일정', myRole: 'ATTENDEE', myRsvpStatus: 'NEEDS_ACTION' })
  await mockApi(page, 'GET', '/api/v1/calendar/events', [event])
  await mockApi(page, 'GET', '/api/v1/calendar/events/100', event)
  await mockApi(page, 'GET', '/api/v1/calendar/events/100/note', { note })

  await page.goto('/calendar')
  await page.getByTestId('calendar-event-100').first().click()
  const dialog = page.getByTestId('calendar-event-dialog')
  const card = dialog.getByTestId('event-note-card')
  await expect(card).toBeVisible()

  // 카드 글자가 카드 폭을 넘지 않고, 카드·「열기」가 시트 안(화면 안)에 있다
  const overflow = await card.evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  const [cardBox, dialogBox, openBox] = await Promise.all([
    boxOf(card),
    boxOf(dialog),
    boxOf(card.getByTestId('event-note-open')),
  ])
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width)
  expect(openBox.x + openBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width)
  expect(openBox.x + openBox.width).toBeLessThanOrEqual(VIEWPORT.width)
})

test('390px 「노트 연결」 창은 화면 폭이고 「연결」이 「취소」 위에 있다(WP-1701)', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  await page.setViewportSize(VIEWPORT)
  await mockApi(page, 'GET', '/api/v1/calendar/events', [])
  await mockApi(page, 'GET', '/api/v1/wiki/search', [noteSearchResult()])

  await page.goto('/calendar?new=true')
  await page.getByTestId('calendar-form-title').fill('주간 회의')
  await page.getByTestId('event-note-pick').click()
  const dialog = page.getByTestId('note-link-dialog')
  await expect(dialog).toBeVisible()
  await page.getByTestId('note-link-result').first().click()

  // 창 너비 ≥ 화면 - 좌우 16px 씩
  const box = await boxOf(dialog)
  expect(box.width).toBeGreaterThanOrEqual(VIEWPORT.width - 2 * 16)
  expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT.width)

  // 단추가 세로로 쌓이고 「연결」이 「취소」 위
  const [submit, cancel] = await Promise.all([
    boxOf(page.getByTestId('note-link-submit')),
    boxOf(page.getByTestId('note-link-cancel')),
  ])
  expect(submit.y).toBeLessThan(cancel.y)
})

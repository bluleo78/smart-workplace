// 일정 회의록 노트 줄·「노트 연결」 창 390px 레이아웃 E2E(WP-1701). 백엔드 없이 page.route 모킹.
// 긴 제목·긴 공간 이름 카드가 폭을 넘치지 않는지, 휴대폰에서 창이 화면 폭이고 「연결」이 「취소」 위인지는
// 실제 레이아웃이 있어야 알 수 있어 @layout 으로 본다. 잇기·끊기 동작·문구는 vitest(Task 4)가 지킨다.
// 「회의록 만들기」 창(WP-1702)도 390px 에서 화면을 넘치지 않고 「만들기」가 「취소」 위·가득 폭인지 여기서 본다.
// 노트 연결 → 「회의록 만들기」로 넘어갈 때 제목 칸의 포커스·전체 선택(WP-1748)은 실제 포커스 이동이 있어야 판정돼 @input 으로 본다.
import { calendarEvent, eventNote, noteSearchResult } from '../../factories/calendar.factory'
import { wikiSpace } from '../../factories/wiki.factory'
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

test('390px 「회의록 만들기」 창은 화면 안에 들고 「만들기」가 「취소」 위·가득 폭이다(WP-1702)', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  await page.setViewportSize(VIEWPORT)
  await mockApi(page, 'GET', '/api/v1/calendar/events', [])
  // 긴 공간 이름 — 위치 줄이 말줄임으로 접혀야 한다
  await mockApi(page, 'GET', '/api/v1/wiki/spaces', [
    wikiSpace({ id: 1, type: 'PERSONAL', name: '아주 긴 개인 공간 이름 '.repeat(5), ownerId: 1, role: 'OWNER' }),
  ])

  await page.goto('/calendar?new=true')
  await page.getByTestId('calendar-form-title').fill('주간 기획 회의 '.repeat(4))
  await page.getByTestId('calendar-form-location').fill('3층 대회의실 '.repeat(6))
  await page.getByTestId('event-note-create').click()
  const dialog = page.getByTestId('meeting-note-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByTestId('meeting-note-location')).toContainText('아주 긴 개인 공간')

  // 창이 화면 폭 안(좌우 16px 여백 기준)이고 가로로 넘치지 않는다
  const box = await boxOf(dialog)
  expect(box.width).toBeGreaterThanOrEqual(VIEWPORT.width - 2 * 16)
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT.width)
  expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)
  // 위치 줄의 「바꾸기」가 창 안에 남는다
  const change = await boxOf(dialog.getByTestId('meeting-note-location-change'))
  expect(change.x + change.width).toBeLessThanOrEqual(box.x + box.width)

  // 단추가 세로로 쌓이고 「만들기」가 위, 둘 다 같은 가득 폭
  const [submit, cancel] = await Promise.all([
    boxOf(page.getByTestId('meeting-note-submit')),
    boxOf(page.getByTestId('meeting-note-cancel')),
  ])
  expect(submit.y).toBeLessThan(cancel.y)
  expect(Math.round(submit.width)).toBe(Math.round(cancel.width))
  expect(submit.width).toBeGreaterThan(box.width / 2)
})

test('노트 연결의 결과 없음에서 「회의록 만들기」로 넘어오면 제목 칸에 포커스가 있고 전체 선택돼 있다(WP-1748)', { tag: '@input' }, async ({
  authenticatedPage: page,
}) => {
  // 닫히는 노트 연결 창의 FocusScope 가 포커스를 되돌리면서 새 창 제목의 선택이 풀리는지는 실제 포커스 이동이 있어야 안다(jsdom 은 거짓 통과)
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  const event = calendarEvent({ id: 100, title: '주간 기획 회의', myRole: 'ORGANIZER', attendees: [] })
  await mockApi(page, 'GET', '/api/v1/calendar/events', [event])
  await mockApi(page, 'GET', '/api/v1/calendar/events/100', event)
  await mockApi(page, 'GET', '/api/v1/calendar/events/100/note', { note: null })
  await mockApi(page, 'GET', '/api/v1/wiki/search', [])
  await mockApi(page, 'GET', '/api/v1/wiki/spaces', [
    wikiSpace({ id: 1, type: 'PERSONAL', name: '내 노트', ownerId: 1, role: 'OWNER' }),
  ])

  await page.goto('/calendar')
  await page.getByTestId('calendar-event-100').first().click()
  await page.getByTestId('event-note-pick').click()
  const linkDialog = page.getByTestId('note-link-dialog')
  await expect(linkDialog.getByText('검색 결과 없음')).toBeVisible()
  await page.getByTestId('note-link-create').click()

  // 노트 연결 창이 다 사라진 뒤(닫힘 애니메이션·포커스 되돌리기까지 끝난 뒤)에 본다
  await expect(linkDialog).toHaveCount(0)
  const title = page.getByTestId('meeting-note-title')
  await expect(title).toHaveValue('6/10 주간 기획 회의 회의록')
  // 노트 연결 창의 포커스 되돌리기는 그 창이 DOM 에서 빠질 때(위 toHaveCount(0)) 끝난다 — 그 뒤에도 제목 칸에 포커스·전체 선택이 남는다
  await expect(title).toBeFocused()
  const sel = await title.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd, el.value.length])
  expect(sel).toEqual([0, sel[2], sel[2]])
  // 바로 타이핑하면 제목이 통째로 바뀐다
  await page.keyboard.type('새 제목')
  await expect(title).toHaveValue('새 제목')
})

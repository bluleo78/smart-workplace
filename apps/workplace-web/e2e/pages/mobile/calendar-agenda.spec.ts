// 모바일 캘린더 일정 목록(WP-136) — 모바일 첫 화면 = 오늘부터 날짜별로 묶은 목록, 아래로 스크롤하면 30일씩 이어 불러오기,
// 헤더 「10월 ▾」 미니 달력으로 날짜 이동, ☰ 시트는 [새 일정]+캘린더 토글만, 월·주·일 본문 좌우 스와이프.
// 오늘 = 2026-10-13(화) 08:40 KST 고정. 일정 API 는 요청 범위(from/to)와 겹치는 일정만 돌려주는 메모리 스텁이라
// 화면에 보이는 것은 실제로 보낸 요청 범위의 결과다(청크 범위·미니 달력 범위가 틀리면 행이 빠진다).
import type { Page } from '@playwright/test'

import type { CalendarEvent } from '../../../src/types/calendar'
import type { IssueResponse } from '../../../src/types/issue'
import { calendar, calendarEvent } from '../../factories/calendar.factory'
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory'
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'

// 화면 날짜·시간은 로컬 타임존 기준 — 실행 머신과 무관하게 KST 로 고정한다.
test.use({ timezoneId: 'Asia/Seoul' })

const NOW = new Date('2026-10-12T23:40:00Z') // 2026-10-13 08:40 KST
// 청크 범위(30일, 로컬 자정 기준) — 첫 청크는 오늘 00:00 KST 부터.
const CHUNK1 = { from: '2026-10-12T15:00:00.000Z', to: '2026-11-11T15:00:00.000Z' }
const CHUNK2 = { from: '2026-11-11T15:00:00.000Z', to: '2026-12-11T15:00:00.000Z' }
// 미니 달력·월 보기 범위(일요일 시작 6주) — 10월 = 9/27~, 11월 = 11/1~.
const OCT_GRID_FROM = '2026-09-26T15:00:00.000Z'
const NOV_GRID_FROM = '2026-10-31T15:00:00.000Z'

const TEAM = 2 // '팀 일정' 캘린더 id

// 하루 KST 시각 → UTC ISO.
const kst = (date: string, hm: string) => new Date(`${date}T${hm}:00+09:00`).toISOString()

function baseEvents(): CalendarEvent[] {
  const ev = (id: number, title: string, date: string, start: string, end: string, over: Partial<CalendarEvent> = {}) =>
    calendarEvent({ id, title, startsAt: kst(date, start), endsAt: kst(date, end), ...over })
  const team = { calendarId: TEAM, calendarName: '팀 일정', effectiveColor: 'green' }
  return [
    // 오늘(10/13) 3건 — 07:00 은 끝난 일정(흐림), 지금 선은 09:30 앞.
    ev(1, '아침 스탠드업', '2026-10-13', '07:00', '07:30', team),
    ev(2, '주간 스프린트 회의', '2026-10-13', '09:30', '10:30', team),
    ev(3, '고객사 데모 리허설', '2026-10-13', '14:00', '15:30', { location: '3층 회의실' }),
    // 10/14 종일(팀) — 종일 일정은 UTC 자정 표기(종일 복원).
    calendarEvent({ id: 4, title: '모바일 에픽 마감 주간', allDay: true, startsAt: '2026-10-14T00:00:00Z', endsAt: '2026-10-15T00:00:00Z', ...team }),
    ev(5, '모바일 캘린더 시안 리뷰', '2026-10-15', '11:00', '12:00'),
    ev(6, '1:1 면담', '2026-10-16', '16:00', '16:30'),
    ev(7, '4분기 계획 워크숍', '2026-10-20', '13:00', '17:00', team),
    // 10/21~10/31 하루 한 건, 11/1~11/10 하루 두 건 — 목록이 화면보다 길어 첫 진입에 다음 청크를 부르지 않게.
    ...Array.from({ length: 11 }, (_, i) => ev(100 + i, `10월 채우기 ${i}`, `2026-10-${21 + i}`, '10:00', '11:00')),
    ...Array.from({ length: 20 }, (_, i) =>
      ev(200 + i, `11월 초 일정 ${i}`, `2026-11-${String(1 + (i >> 1)).padStart(2, '0')}`, i % 2 ? '15:00' : '09:00', i % 2 ? '16:00' : '10:00'),
    ),
    // 둘째 청크(11/12~12/11)
    ev(300, '11월 하순 회고', '2026-11-20', '10:00', '11:00'),
    ev(301, '12월 초 점검', '2026-12-05', '10:00', '11:00'),
  ]
}

const DUE_ISSUE = createIssue({ id: 7, projectKey: 'WP', number: 136, title: 'WP-136 모바일 캘린더 일정 목록', status: 'IN_PROGRESS', dueDate: '2026-10-14' })

/**
 * 캘린더·일정·이슈 마감 스텁. 일정은 from/to 와 겹치는 것만, 마감은 dueFrom~dueTo(포함) 안의 것만 돌려준다.
 * 반환: 지금까지의 일정 목록 요청(from/to) 기록.
 */
async function stubCalendar(
  page: Page,
  opts: { events?: CalendarEvent[]; issues?: IssueResponse[]; issuesDelayMs?: number } = {},
) {
  await page.clock.setFixedTime(NOW)
  const events = opts.events ?? baseEvents()
  const issues = opts.issues ?? [DUE_ISSUE]
  const requests: { from: string; to: string }[] = []
  await page.route((u) => u.pathname === '/api/v1/calendars', (r) =>
    r.fulfill({ json: [calendar({ id: 1, name: '기본' }), calendar({ id: TEAM, name: '팀 일정', color: 'green', isDefault: false, position: 1 })] }))
  await page.route((u) => u.pathname.startsWith('/api/v1/calendar/events'), (r) => {
    const req = r.request()
    const url = new URL(req.url())
    const m = /\/api\/v1\/calendar\/events\/(\d+)$/.exec(url.pathname)
    if (req.method() === 'GET' && m) return r.fulfill({ json: events.find((e) => e.id === Number(m[1])) })
    if (req.method() !== 'GET') return r.fallback()
    const from = url.searchParams.get('from') ?? ''
    const to = url.searchParams.get('to') ?? ''
    requests.push({ from, to })
    return r.fulfill({ json: events.filter((e) => e.startsAt < to && e.endsAt > from) })
  })
  await page.route((u) => u.pathname === '/api/v1/me/issues', async (r) => {
    const q = new URL(r.request().url()).searchParams
    const dueFrom = q.get('dueFrom') ?? ''
    const dueTo = q.get('dueTo') ?? ''
    // 마감이 일정보다 늦게 오는 상황 재현용 — 서버 응답 지연(테스트 쪽 고정 대기가 아니다).
    if (opts.issuesDelayMs) await new Promise((res) => setTimeout(res, opts.issuesDelayMs))
    await r.fulfill({ json: createIssueSearchResponse(issues.filter((i) => i.dueDate && i.dueDate >= dueFrom && i.dueDate <= dueTo)) })
  })
  return requests
}

/** 목록 스크롤 컨테이너. */
const agendaList = (page: Page) => page.getByTestId('calendar-view-agenda')

/** 목록에서 특정 날짜 묶음이 맨 위에 오도록 스크롤(머리글 sticky 아래로 10px 더). */
async function scrollToDay(page: Page, key: string) {
  await agendaList(page).evaluate((el, k) => {
    const sec = el.querySelector(`[data-day-key="${k}"]`) as HTMLElement
    el.scrollTo({ top: sec.offsetTop + 10 })
  }, key)
}

/** 본문 좌우 끌기 — pointer 이벤트(마우스)로 dx 만큼(board.spec 과 같은 방식). */
async function swipe(page: Page, dx: number) {
  const box = (await page.getByTestId('calendar-swipe-area').boundingBox())!
  const y = box.y + box.height / 2
  const x0 = box.x + box.width / 2 - dx / 2
  await page.mouse.move(x0, y)
  await page.mouse.down()
  await page.mouse.move(x0 + dx / 2, y, { steps: 4 })
  await page.mouse.move(x0 + dx, y, { steps: 4 })
  await page.mouse.up()
}

test('① ② 진입 — 목록이 기본, 오늘부터 날짜별 묶음·건수, 첫 요청은 오늘 00:00 부터 30일 하나뿐', async ({ authenticatedPage: page }) => {
  const requests = await stubCalendar(page)
  await page.goto('/calendar')
  const list = agendaList(page)

  // 보기 선택이 '목록', 도구 줄엔 [오늘] 만(‹ › 없음).
  await expect(page.getByTestId('calendar-view-select')).toHaveValue('agenda')
  await expect(page.getByTestId('calendar-view-month')).toHaveCount(0)
  const toolbar = page.getByTestId('calendar-mobile-toolbar')
  await expect(toolbar.getByTestId('calendar-today')).toBeVisible()
  await expect(toolbar.getByTestId('calendar-prev')).toHaveCount(0)
  await expect(toolbar.getByTestId('calendar-next')).toHaveCount(0)
  // 헤더 제목 = 같은 해라 'M월' 버튼(접힘).
  const toggle = page.getByTestId('calendar-title-toggle')
  await expect(page.getByTestId('calendar-title')).toHaveText('10월')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('page-header').locator('h1')).toHaveText('10월')

  // 오늘 머리글(강조 문구·건수)과 그 아래 행들 — 시간 칸·제목·보조 줄.
  const today = list.getByTestId('calendar-agenda-day-2026-10-13')
  await expect(today).toContainText('오늘 · 10월 13일 (화)')
  await expect(today).toContainText('3건')
  await expect(list.getByTestId('calendar-event-1')).toContainText('07:00')
  await expect(list.getByTestId('calendar-event-1')).toContainText('아침 스탠드업')
  await expect(list.getByTestId('calendar-event-1')).toContainText('팀 일정')
  await expect(list.getByTestId('calendar-event-3')).toContainText('14:00')
  await expect(list.getByTestId('calendar-event-3')).toContainText('15:30')
  await expect(list.getByTestId('calendar-event-3')).toContainText('기본 · 3층 회의실')
  await expect(list.getByTestId('calendar-agenda-now')).toBeVisible()
  // 일정 없는 날(10/17~10/19)은 건너뛰고, 다음 날 묶음은 '오늘' 없이 날짜만.
  await expect(list.getByTestId('calendar-agenda-day-2026-10-14')).toContainText('10월 14일 (수)')
  await expect(list.getByTestId('calendar-agenda-day-2026-10-14')).not.toContainText('오늘')
  await expect(list.getByTestId('calendar-event-4')).toContainText('종일')
  await expect(list.getByTestId('calendar-agenda-day-2026-10-17')).toHaveCount(0)
  // 묶음 순서 = 날짜순(첫 묶음이 오늘).
  const keys = await list.locator('[data-day-key]').evaluateAll((els) => els.slice(0, 4).map((e) => (e as HTMLElement).dataset.dayKey))
  expect(keys).toEqual(['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'])

  // 일정 요청은 첫 청크 하나 — 오늘 00:00 KST ~ 30일 뒤(월 그리드·미니 달력 범위는 목록 보기에서 조회하지 않는다).
  expect(requests).toEqual([CHUNK1])
  await expectNoHorizontalOverflow(page)
})

test('③ 목록 끝까지 스크롤하면 다음 30일을 요청해 그 일정을 이어 보여 주고, 헤더 월이 맨 위 묶음을 따라간다', async ({ authenticatedPage: page }) => {
  const requests = await stubCalendar(page)
  await page.goto('/calendar')
  const list = agendaList(page)
  await expect(list.getByTestId('calendar-agenda-day-2026-10-13')).toBeVisible()
  // 아직 둘째 청크 일정은 없다.
  await expect(list.getByTestId('calendar-event-300')).toHaveCount(0)

  await list.evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
  await expect.poll(() => requests).toContainEqual(CHUNK2)
  const nov20 = list.getByTestId('calendar-agenda-day-2026-11-20')
  await expect(nov20).toContainText('11월 20일 (금)')
  await expect(list.getByTestId('calendar-event-300')).toContainText('11월 하순 회고')

  await scrollToDay(page, '2026-11-20')
  await expect(page.getByTestId('calendar-title')).toHaveText('11월')
  await scrollToDay(page, '2026-10-20')
  await expect(page.getByTestId('calendar-title')).toHaveText('10월')
})

test('회귀 — 이슈 마감이 일정보다 늦게 [] 로 와도 첫 로드부터 헤더 월이 스크롤을 따라간다(접근성 이름 포함)', async ({ authenticatedPage: page }) => {
  const requests = await stubCalendar(page, { issues: [], issuesDelayMs: 800 })
  await page.goto('/calendar')
  const list = agendaList(page)
  // 머리글·행의 접근성 이름 — 화면엔 안 보이는 구분자(", " · " ~ ")가 들어 있다(Chrome 은 flex 항목 경계에 공백을 더 넣는다).
  await expect(page.getByRole('heading', { name: /^오늘 · 10월 13일 \(화\)\s*,\s*3건$/ })).toBeVisible()
  await expect(list.getByRole('button', { name: /^07:00\s*~\s*07:30\s*,\s*아침 스탠드업\s*,\s*팀 일정$/ })).toBeVisible()
  // 다음 청크를 부르지 않는 위치(11/1 묶음이 맨 위)까지만 — 청크가 늘면 묶음이 바뀌어 observer 가 다시 걸려 버그가 가려진다.
  await scrollToDay(page, '2026-11-01')
  await expect(page.getByTestId('calendar-title')).toHaveText('11월')
  expect(requests).toEqual([CHUNK1])
})

test('④ 헤더 제목 탭 → 미니 달력(점·달 넘김) → 날짜 선택 → 접히고 목록이 그 날부터 다시', async ({ authenticatedPage: page }) => {
  const requests = await stubCalendar(page)
  await page.goto('/calendar')
  const list = agendaList(page)
  await expect(list.getByTestId('calendar-agenda-day-2026-10-13')).toBeVisible()

  const toggle = page.getByTestId('calendar-title-toggle')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const mini = page.getByTestId('calendar-mobile-mini')
  await expect(mini).toBeVisible()
  await expect(mini).toContainText('2026년 10월')
  // 패널이 열리면 그 달(6주 그리드) 범위를 조회해 일정 있는 날에 점을 찍는다.
  await expect.poll(() => requests.map((r) => r.from)).toContain(OCT_GRID_FROM)
  await expect(mini.locator('td[data-day="2026-10-14"]')).toHaveClass(/day-has-items/)
  await expect(mini.locator('td[data-day="2026-10-16"]')).toHaveClass(/day-has-items/)
  await expect(mini.locator('td[data-day="2026-10-18"]')).not.toHaveClass(/day-has-items/)
  // 선택일 = 오늘(anchor).
  await expect(mini.locator('td[data-day="2026-10-13"]')).toHaveAttribute('aria-selected', 'true')

  // 패널 안 › — 패널 달만 넘어가고(11월 그리드 조회·점) 본문 목록은 그대로.
  const chunkCount = requests.filter((r) => r.from === CHUNK1.from).length
  await mini.getByRole('button', { name: '다음 달' }).click()
  await expect(mini).toContainText('2026년 11월')
  await expect.poll(() => requests.map((r) => r.from)).toContain(NOV_GRID_FROM)
  await expect(mini.locator('td[data-day="2026-11-20"]')).toHaveClass(/day-has-items/)
  await expect(list.getByTestId('calendar-agenda-day-2026-10-13')).toBeVisible()
  expect(requests.filter((r) => r.from === CHUNK1.from).length).toBe(chunkCount)
  await mini.getByRole('button', { name: '이전 달' }).click()
  await expect(mini).toContainText('2026년 10월')

  // 16일 선택 → 접히고, 목록은 10/16 00:00 KST 부터 다시 조회해 그 날이 첫 묶음.
  await mini.getByRole('button', { name: '2026년 10월 16일 금요일' }).click()
  await expect(mini).toHaveCount(0)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect.poll(() => requests).toContainEqual({ from: '2026-10-15T15:00:00.000Z', to: '2026-11-14T15:00:00.000Z' })
  await expect(list.getByTestId('calendar-agenda-day-2026-10-16')).toContainText('10월 16일 (금)')
  await expect(list.getByTestId('calendar-agenda-day-2026-10-13')).toHaveCount(0)
  await expect(list.locator('[data-day-key]').first()).toHaveAttribute('data-day-key', '2026-10-16')
  await expect(page.getByTestId('calendar-title')).toHaveText('10월')

  // 다시 탭 → 펼침, 한 번 더 → 접힘.
  await toggle.click()
  await expect(mini).toBeVisible()
  // 선택일이 16일로 따라왔다. 이미 고른 날을 다시 눌러도(선택 해제가 아니라) 접힌다.
  await expect(mini.locator('td[data-day="2026-10-16"]')).toHaveAttribute('aria-selected', 'true')
  await mini.getByRole('button', { name: '2026년 10월 16일 금요일' }).click()
  await expect(mini).toHaveCount(0)
  await expect(list.locator('[data-day-key]').first()).toHaveAttribute('data-day-key', '2026-10-16')
  await toggle.click()
  await expect(mini).toBeVisible()
  await toggle.click()
  await expect(mini).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('⑤ 월 보기로 바꾸면 ‹ › 가 돌아오고, 좌우 스와이프로 달이 바뀐다 — 스와이프 뒤에도 일정 탭은 열린다', async ({ authenticatedPage: page }) => {
  const requests = await stubCalendar(page)
  await page.goto('/calendar')
  await expect(agendaList(page).getByTestId('calendar-agenda-day-2026-10-13')).toBeVisible()

  await page.getByTestId('calendar-view-select').selectOption('month')
  await expect(page.getByTestId('calendar-view-month')).toBeVisible()
  await expect(page.getByTestId('calendar-prev')).toBeVisible()
  await expect(page.getByTestId('calendar-next')).toBeVisible()
  await expect(page.getByTestId('calendar-title')).toHaveText('10월')
  await expect.poll(() => requests.map((r) => r.from)).toContain(OCT_GRID_FROM)

  // 왼쪽으로 밀기 → 다음 달(11월 그리드 조회·11월 일정 칩).
  await swipe(page, -150)
  await expect(page.getByTestId('calendar-title')).toHaveText('11월')
  await expect.poll(() => requests.map((r) => r.from)).toContain(NOV_GRID_FROM)
  const chip = page.getByTestId('calendar-view-month').getByTestId('calendar-event-300')
  await expect(chip).toBeVisible()
  // 오른쪽으로 밀기 → 이전 달.
  await swipe(page, 150)
  await expect(page.getByTestId('calendar-title')).toHaveText('10월')
  // 다른 해로 넘어가면 'yyyy년 M월'.
  for (let i = 0; i < 3; i++) await swipe(page, -150)
  await expect(page.getByTestId('calendar-title')).toHaveText('2027년 1월')
  await swipe(page, 150)
  await swipe(page, 150)

  // 스와이프 뒤 그냥 탭 — 일정 칩이 다이얼로그를 연다(스와이프 직후 click 만 막는다).
  await expect(page.getByTestId('calendar-title')).toHaveText('11월')
  await chip.tap()
  await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()
  await expect(page.getByTestId('calendar-form-title')).toHaveValue('11월 하순 회고')
})

test('목록 재진입 — 월 보기에 갔다 오면 불러 둔 뒤 청크 없이 첫 청크부터 다시 보인다', async ({ authenticatedPage: page }) => {
  const requests = await stubCalendar(page)
  await page.goto('/calendar')
  const list = agendaList(page)
  await expect(list.getByTestId('calendar-agenda-day-2026-10-13')).toBeVisible()
  await list.evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
  await expect(list.getByTestId('calendar-event-300')).toBeVisible()

  const select = page.getByTestId('calendar-view-select')
  await select.selectOption('month')
  await expect(page.getByTestId('calendar-view-month')).toBeVisible()
  await select.selectOption('agenda')
  await expect(list.getByTestId('calendar-agenda-day-2026-10-13')).toBeVisible()
  // 청크 1개로 되돌아가 둘째 청크 일정은 다시 스크롤해야 보인다.
  await expect(list.getByTestId('calendar-event-300')).toHaveCount(0)
  expect(await list.evaluate((el) => el.scrollTop)).toBe(0)
  await expect(page.getByTestId('calendar-title')).toHaveText('10월')
  expect(requests.filter((r) => r.from === CHUNK2.from).length).toBe(1)
})

test('⑥ ☰ 시트 — 미니 달력 없이 [새 일정]과 캘린더 토글, 토글을 끄면 목록에서 그 캘린더 일정이 빠진다', async ({ authenticatedPage: page }) => {
  await stubCalendar(page)
  await page.goto('/calendar')
  const list = agendaList(page)
  await expect(list.getByTestId('calendar-event-1')).toBeVisible()

  await page.getByTestId('mobile-sidebar-trigger').click()
  const sheet = page.getByTestId('mobile-sidebar-sheet')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByTestId('calendar-mini')).toHaveCount(0)
  await expect(sheet.locator('[data-slot="calendar"]')).toHaveCount(0)
  await expect(sheet.getByTestId('calendar-new-event')).toBeVisible()
  await expect(sheet.getByTestId('calendar-list-item-1')).toContainText('기본')
  await expect(sheet.getByTestId('calendar-list-item-2')).toContainText('팀 일정')
  await expect(sheet.getByTestId('calendar-layer-issue-dues')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  // 팀 일정 끄기 → 목록에서 팀 일정(1·2·4) 행이 빠지고 오늘 건수가 1건이 된다.
  await sheet.getByTestId('calendar-toggle-2').click()
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(list.getByTestId('calendar-event-1')).toHaveCount(0)
  await expect(list.getByTestId('calendar-event-2')).toHaveCount(0)
  await expect(list.getByTestId('calendar-event-3')).toBeVisible()
  await expect(list.getByTestId('calendar-agenda-day-2026-10-13')).toContainText('1건')

  // [새 일정] → 새 일정 다이얼로그.
  await page.getByTestId('mobile-sidebar-trigger').click()
  await sheet.getByTestId('calendar-new-event').click()
  await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()
})

test('⑦ [오늘] — 멀리 스크롤했거나 다른 날로 옮겼어도 오늘 묶음부터 맨 위로, 뒤 청크는 버린다', async ({ authenticatedPage: page }) => {
  await stubCalendar(page)
  await page.goto('/calendar')
  const list = agendaList(page)
  const today = page.getByTestId('calendar-today')
  await expect(list.getByTestId('calendar-agenda-day-2026-10-13')).toBeVisible()

  // 같은 시작일(오늘)에서 멀리 스크롤 → [오늘].
  await list.evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
  await expect(list.getByTestId('calendar-event-300')).toBeVisible()
  await scrollToDay(page, '2026-11-20')
  await expect(page.getByTestId('calendar-title')).toHaveText('11월')
  await today.click()
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(0)
  await expect(page.getByTestId('calendar-title')).toHaveText('10월')
  await expect(list.getByTestId('calendar-agenda-day-2026-10-13')).toContainText('오늘 · 10월 13일 (화)')
  await expect(list.getByTestId('calendar-event-300')).toHaveCount(0)

  // 다른 날(10/20)로 옮긴 뒤 [오늘] → 다시 오늘부터.
  await page.getByTestId('calendar-title-toggle').click()
  await page.getByTestId('calendar-mobile-mini').getByRole('button', { name: '2026년 10월 20일 화요일' }).click()
  await expect(list.locator('[data-day-key]').first()).toHaveAttribute('data-day-key', '2026-10-20')
  await today.click()
  await expect(list.locator('[data-day-key]').first()).toHaveAttribute('data-day-key', '2026-10-13')
})

test('⑧ 행 탭 → 일정 다이얼로그(그 일정), 닫으면 목록 그대로', async ({ authenticatedPage: page }) => {
  await stubCalendar(page)
  await page.goto('/calendar')
  const list = agendaList(page)
  await list.getByTestId('calendar-event-2').tap()
  const dialog = page.getByTestId('calendar-event-dialog')
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(/\/calendar\?eventId=2$/)
  await expect(page.getByTestId('calendar-form-title')).toHaveValue('주간 스프린트 회의')
  await page.goBack()
  await expect(dialog).toBeHidden()
  await expect(list.getByTestId('calendar-event-2')).toBeVisible()
})

test('⑨ 이슈 마감 행 — ⚑ 마감·이슈 키, 탭하면 이슈 상세로', async ({ authenticatedPage: page }) => {
  await stubCalendar(page)
  await page.goto('/calendar')
  const row = agendaList(page).getByTestId('calendar-issue-due-7')
  await expect(row).toContainText('마감')
  await expect(row).toContainText('WP-136 모바일 캘린더 일정 목록')
  await expect(row).toContainText('이슈 마감 · WP-136')
  // 마감은 그 날(10/14) 묶음 안 — 종일 일정 다음.
  await expect(agendaList(page).getByTestId('calendar-agenda-day-2026-10-14')).toContainText('2건')
  await row.tap()
  await expect(page).toHaveURL(/\/projects\/WP\/issues\/136$/)
})

test('회귀 — 불러온 범위 끝 다음 날(dueTo 포함일) 마감은 숨긴다', async ({ authenticatedPage: page }) => {
  // 첫 청크 to = 11/12 00:00 KST → 마감 조회 dueTo = 11-12(포함). 11-11 마감은 보이고 11-12 마감은 아직 숨긴다.
  await stubCalendar(page, {
    issues: [
      createIssue({ id: 11, projectKey: 'WP', number: 1, title: '안쪽 마감', status: 'IN_PROGRESS', dueDate: '2026-11-11' }),
      createIssue({ id: 12, projectKey: 'WP', number: 2, title: '경계 마감', status: 'IN_PROGRESS', dueDate: '2026-11-12' }),
    ],
  })
  await page.goto('/calendar')
  const list = agendaList(page)
  await expect(list.getByTestId('calendar-agenda-day-2026-10-13')).toBeVisible()
  await expect(list.getByTestId('calendar-issue-due-11')).toHaveCount(1)
  await expect(list.getByTestId('calendar-issue-due-12')).toHaveCount(0)
  // 다음 청크를 불러오면 11-12 마감이 제 날 묶음에 들어온다.
  await list.evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
  await expect(list.getByTestId('calendar-issue-due-12')).toHaveCount(1)
  await expect(list.locator('[data-day-key="2026-11-12"]')).toContainText('경계 마감')
})

// 모바일 캘린더 일정 목록(WP-136) — 모바일 첫 화면 = 오늘부터 날짜별로 묶은 목록, 아래로 스크롤하면 30일씩 이어 불러오기,
// 헤더 「10월 ▾」 미니 달력으로 날짜 이동, ☰ 시트는 [새 일정]+캘린더 토글만, 월·주·일 본문 좌우 스와이프.
// 오늘 = 2026-10-13(화) 08:40 KST 고정. 일정 API 는 요청 범위(from/to)와 겹치는 일정만 돌려주는 메모리 스텁이라
// 화면에 보이는 것은 실제로 보낸 요청 범위의 결과다(청크 범위·미니 달력 범위가 틀리면 행이 빠진다).
import type { Page } from '@playwright/test'

import type { CalendarEvent } from '../../../src/types/calendar'
import type { IssueResponse } from '../../../src/types/issue'
import { calendar, calendarEvent } from '../../factories/calendar.factory'
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory'
import { expect, expectNoHorizontalOverflow, test, toCalendarMonthView } from '../../fixtures/mobile.fixture'
import { touchDrag } from '../../fixtures/touch'

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
  opts: {
    events?: CalendarEvent[]
    issues?: IssueResponse[]
    issuesDelayMs?: number
    runningClock?: boolean
    // true 를 돌려주는 동안 이슈 마감 조회를 500 으로 실패시킨다(자동 재시도까지 실패 — 다시 시도 줄 검증용).
    failDues?: () => boolean
  } = {},
) {
  // runningClock — 시간이 흐르는 가짜 시계(page.clock.fastForward 로 앱 타이머까지 경과). 기본은 고정 시각.
  if (opts.runningClock) await page.clock.install({ time: NOW })
  else await page.clock.setFixedTime(NOW)
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
    if (opts.failDues?.()) return r.fulfill({ status: 500, json: { message: 'boom' } })
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

/**
 * 본문 좌우 끌기 — 실제 터치 입력(touchDrag, CDP). 마우스 pointer 이벤트는 touch-action 을 무시해
 * "브라우저가 가로 끌기를 패닝으로 가로채 pointercancel" 하는 실제 기기 동작을 재현하지 못한다(주·일 그리드 회귀).
 * yRatio — 스와이프 영역 안 세로 위치(0~1). 기본은 가운데(월 그리드 셀·주/일 시간 그리드 스크롤 영역 안).
 */
async function swipe(page: Page, dx: number, yRatio = 0.6) {
  const box = (await page.getByTestId('calendar-swipe-area').boundingBox())!
  const y = box.y + box.height * yRatio
  const cx = box.x + box.width / 2
  await touchDrag(page, { x: cx - dx / 2, y }, { x: cx + dx / 2, y })
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
  const toolbar = page.getByTestId('calendar-mobile-toolbar')
  await expect(toolbar).toBeVisible()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const mini = page.getByTestId('calendar-mobile-mini')
  await expect(mini).toBeVisible()
  await expect(mini).toContainText('2026년 10월')
  // 펼친 동안 도구 줄을 숨겨 패널 바로 아래 목록이 이어진다(시안 ③) — 목록 윗변 = 패널 아랫변.
  await expect(toolbar).toHaveCount(0)
  const panelBox = (await mini.boundingBox())!
  expect(Math.round((await list.boundingBox())!.y)).toBe(Math.round(panelBox.y + panelBox.height))
  // 패널 폭 전체 7열(가운데 280px 가 아니라) · 날짜 버튼과 ‹ › 는 44×44 터치 영역.
  expect((await mini.locator('table').boundingBox())!.width).toBeGreaterThan(340)
  for (const btn of [
    mini.getByRole('button', { name: '2026년 10월 14일 수요일' }),
    mini.getByRole('button', { name: '다음 달' }),
    mini.getByRole('button', { name: '이전 달' }),
  ]) {
    const b = (await btn.boundingBox())!
    expect(b.width).toBeGreaterThanOrEqual(44)
    expect(b.height).toBeGreaterThanOrEqual(44)
  }
  // 패널이 열리면 그 달(6주 그리드) 범위를 조회해 일정 있는 날에 점을 찍는다.
  await expect.poll(() => requests.map((r) => r.from)).toContain(OCT_GRID_FROM)
  await expect(mini.locator('td[data-day="2026-10-14"]')).toHaveClass(/day-has-items/)
  await expect(mini.locator('td[data-day="2026-10-16"]')).toHaveClass(/day-has-items/)
  await expect(mini.locator('td[data-day="2026-10-18"]')).not.toHaveClass(/day-has-items/)
  // 선택일 = 오늘(anchor).
  await expect(mini.locator('td[data-day="2026-10-13"]')).toHaveAttribute('aria-selected', 'true')
  // 고른 날(채운 primary 원)의 점은 원 안 글자색이라 보인다 — 고르지 않은 날 점(primary)과 색이 달라야 한다.
  const dotColor = (day: string) =>
    mini.locator(`td[data-day="${day}"]`).evaluate((el) => getComputedStyle(el, '::after').backgroundColor)
  await expect(mini.locator('td[data-day="2026-10-13"]')).toHaveClass(/day-has-items/)
  const selectedBtnBg = await mini
    .getByRole('button', { name: '2026년 10월 13일 화요일' })
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(await dotColor('2026-10-13')).not.toBe(selectedBtnBg)
  expect(await dotColor('2026-10-14')).toBe(selectedBtnBg)

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
  await expect(toolbar).toBeVisible()
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

  await toCalendarMonthView(page)
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

test('⑤-2 주 보기 — 시간 그리드(자체 세로 스크롤) 위에서 터치로 좌우 스와이프해도 다음·이전 주로 넘어간다', async ({ authenticatedPage: page }) => {
  const requests = await stubCalendar(page)
  await page.goto('/calendar')
  await expect(agendaList(page).getByTestId('calendar-agenda-day-2026-10-13')).toBeVisible()
  await page.getByTestId('calendar-view-select').selectOption('week')
  const week = page.getByTestId('calendar-view-week')
  await expect(week).toBeVisible()
  // 이번 주(10/11~10/17) — 10/13 일정은 있고 10/20 일정은 없다.
  await expect(week.getByTestId('calendar-event-2')).toBeVisible()
  await expect(week.getByTestId('calendar-event-7')).toHaveCount(0)

  // 시간 그리드 스크롤 영역 안에서 왼쪽으로 밀기 → 다음 주(10/18~) 범위 조회·10/20 일정 표시.
  await swipe(page, -150)
  await expect.poll(() => requests.map((r) => r.from)).toContain('2026-10-17T15:00:00.000Z')
  await expect(week.getByTestId('calendar-event-7')).toBeVisible()
  await expect(week.getByTestId('calendar-event-2')).toHaveCount(0)
  // 오른쪽으로 밀기 → 이전 주로 복귀.
  await swipe(page, 150)
  await expect(week.getByTestId('calendar-event-2')).toBeVisible()
  await expect(week.getByTestId('calendar-event-7')).toHaveCount(0)
  // 세로 스크롤은 그대로 된다(pan-y 는 세로 패닝을 브라우저에 남긴다).
  await expect(page.getByTestId('calendar-title')).toHaveText('10월')
})

test('미니 달력 접근성 — 제목 이름은 달 그대로, 펼침 상태·설명, 닫히면 포커스가 제목으로, Esc 로 접힘, 본문 이동에 패널 달이 따라간다', async ({ authenticatedPage: page }) => {
  await stubCalendar(page)
  await page.goto('/calendar')
  await expect(agendaList(page).getByTestId('calendar-agenda-day-2026-10-13')).toBeVisible()
  const toggle = page.getByTestId('calendar-title-toggle')
  const mini = page.getByTestId('calendar-mobile-mini')

  // 제목(h1)·버튼 이름은 보이는 달 그대로, 동작은 설명으로. 닫혀 있으면 aria-controls 없음.
  await expect(page.getByRole('heading', { level: 1, name: '10월', exact: true })).toBeVisible()
  await expect(toggle).toHaveAccessibleName('10월')
  await expect(toggle).toHaveAccessibleDescription('날짜를 골라 이동하는 달력')
  await expect(toggle).not.toHaveAttribute('aria-controls')
  // 제목 버튼 터치 높이 44px 이상 — 헤더(56px)는 그대로.
  expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  expect((await page.getByTestId('page-header').boundingBox())!.height).toBe(56)

  // 펼침 → aria-controls 가 패널을 가리킨다. 날짜 선택으로 접히면 포커스가 제목 버튼으로 돌아온다.
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-controls', 'calendar-mobile-mini')
  await expect(page.locator('#calendar-mobile-mini')).toBeVisible()
  await mini.getByRole('button', { name: '2026년 10월 15일 목요일' }).click()
  await expect(mini).toHaveCount(0)
  await expect(toggle).toBeFocused()
  await expect(toggle).not.toHaveAttribute('aria-controls')

  // 패널 안(‹ › 버튼)에 포커스가 있을 때 Esc → 접히고 포커스는 제목 버튼.
  await toggle.click()
  await mini.getByRole('button', { name: '다음 달' }).focus()
  await page.keyboard.press('Escape')
  await expect(mini).toHaveCount(0)
  await expect(toggle).toBeFocused()
  // 제목 버튼에 포커스가 있을 때 Esc 도 접는다.
  await toggle.click()
  await expect(mini).toBeVisible()
  await toggle.focus()
  await page.keyboard.press('Escape')
  await expect(mini).toHaveCount(0)

  // 펼친 채 본문 달이 바뀌면 패널 달도 따라간다. 펼친 동안엔 도구 줄(‹ ›·[오늘])이 숨으므로 월 본문 스와이프로 넘긴다.
  await toCalendarMonthView(page)
  await toggle.click()
  await expect(mini).toContainText('2026년 10월')
  await swipe(page, -150, 0.8)
  await expect(page.getByTestId('calendar-title')).toHaveText('11월')
  await expect(mini).toContainText('2026년 11월')
  await expect(mini.locator('td[data-day="2026-11-20"]')).toHaveClass(/day-has-items/)
  await swipe(page, 150, 0.8)
  await expect(page.getByTestId('calendar-title')).toHaveText('10월')
  await expect(mini).toContainText('2026년 10월')
})

test('목록 재진입 — 월 보기에 갔다 오면 불러 둔 뒤 청크 없이 첫 청크부터 다시 보인다', async ({ authenticatedPage: page }) => {
  const requests = await stubCalendar(page)
  await page.goto('/calendar')
  const list = agendaList(page)
  await expect(list.getByTestId('calendar-agenda-day-2026-10-13')).toBeVisible()
  await list.evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
  await expect(list.getByTestId('calendar-event-300')).toBeVisible()
  // 맨 위로 되돌린 뒤 바꾼다 — 목록에서 다른 보기로 가면 헤더가 보여 주던 달(맨 위 묶음)이 기준이라(CR3), 끝에 둔 채면 11월 월 보기가 된다.
  await list.evaluate((el) => el.scrollTo({ top: 0 }))
  await expect(page.getByTestId('calendar-title')).toHaveText('10월')

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
  // 체크박스는 정사각형(행 높이 규칙이 체크박스에 걸려 16×44 막대가 되던 회귀), 체크박스를 품은 행은 44px 터치 높이.
  for (const id of ['calendar-toggle-2', 'calendar-layer-issue-dues']) {
    const cb = (await sheet.getByTestId(id).boundingBox())!
    expect(cb.width).toBe(cb.height)
    expect((await sheet.getByTestId(id).locator('..').boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
  expect((await sheet.getByTestId('calendar-list-item-2').boundingBox())!.height).toBeGreaterThanOrEqual(44)

  // 팀 일정 끄기 — 체크박스가 아니라 이름을 탭해도 토글된다 → 목록에서 팀 일정(1·2·4) 행이 빠지고 오늘 건수가 1건이 된다.
  await sheet.getByTestId('calendar-list-item-2').getByText('팀 일정', { exact: true }).tap()
  await expect(sheet.getByTestId('calendar-toggle-2')).toHaveAttribute('aria-checked', 'false')
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

// WP-578: 시트 안 버튼·메뉴 항목은 링크가 아니라 시트가 남아 다이얼로그를 닫은 뒤에도 화면을 덮었다.
// 시트 밖 다이얼로그를 여는 동작은 누르는 즉시(메뉴 항목은 메뉴가 닫힌 뒤) 시트를 닫아야 하고, 화면 잠금이 남지 않아야 한다.
for (const { name, act, dialog } of [
  { name: '새 일정', act: ['calendar-new-event'], dialog: 'calendar-event-dialog' },
  { name: '캘린더 추가', act: ['calendar-add'], dialog: 'calendar-edit-dialog' },
  { name: '⋯ 편집', act: ['calendar-menu-1', 'calendar-edit-1'], dialog: 'calendar-edit-dialog' },
  { name: '⋯ 모든 일정 삭제', act: ['calendar-menu-1', 'calendar-reset-1'], dialog: 'calendar-reset-confirm' },
]) {
  test(`☰ 시트 [${name}] — 시트가 닫히고 다이얼로그만 남으며, 닫은 뒤 화면을 계속 쓸 수 있다`, async ({ authenticatedPage: page }) => {
    await stubCalendar(page)
    await page.goto('/calendar')
    await page.getByTestId('mobile-sidebar-trigger').click()
    const sheet = page.getByTestId('mobile-sidebar-sheet')
    await expect(sheet).toBeVisible()
    for (const id of act) await page.getByTestId(id).click()
    await expect(page.getByTestId(dialog)).toBeVisible()
    await expect(sheet).toBeHidden()
    // 닫히는 시트의 초점 복귀(☰)가 다이얼로그의 초점을 빼앗지 않아야 한다.
    await expect.poll(() => page.getByTestId(dialog).evaluate((el) => el.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId(dialog)).toBeHidden()
    await expect(sheet).toBeHidden()
    await expect(page.locator('body')).not.toHaveCSS('pointer-events', 'none')
    await page.getByTestId('mobile-sidebar-trigger').click()
    await expect(sheet).toBeVisible()
  })
}

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
  // 청크가 1개로 돌아가 둘째 청크 일정(11/20)이 사라진다 — 줄어든 목록이 맨 위로 가기 전 한 프레임에 끝 센티널이 보이거나,
  // 클릭 전에 쌓인 센티널 콜백이 reset 뒤에 불려 둘째 청크를 다시 붙이던 경합의 회귀 방지. (page.clock 고정이라 요청 수는 캐시
  // 히트로 무의미 — DOM 으로 본다.) 뒤이은 동작(미니 달력 열기)을 기다린 뒤에도 여전히 없어야 한다.
  await expect(list.getByTestId('calendar-event-300')).toHaveCount(0)

  // 다른 날(10/20)로 옮긴 뒤 [오늘] → 다시 오늘부터.
  await page.getByTestId('calendar-title-toggle').click()
  await expect(page.getByTestId('calendar-mobile-mini')).toBeVisible()
  await expect(list.getByTestId('calendar-event-300')).toHaveCount(0)
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

test('⑧-1 일정 다이얼로그 — 시작·종료 칸은 한 줄씩 전체 폭이라 시각까지 보인다(WP-635)', async ({ authenticatedPage: page }) => {
  await stubCalendar(page)
  await page.goto('/calendar')
  await agendaList(page).getByTestId('calendar-event-2').tap()
  const start = page.getByTestId('calendar-form-start')
  const end = page.getByTestId('calendar-form-end')
  await expect(start).toHaveValue('2026-10-13T09:30')
  const s = (await start.boundingBox())!
  const e = (await end.boundingBox())!
  // 반 폭(150px)이면 「10/13/2026,」 뒤 시각이 잘린다 — 전체 폭으로 세로로 쌓인다.
  expect(s.width).toBeGreaterThan(300)
  expect(Math.abs(e.x - s.x)).toBeLessThan(1)
  expect(e.y).toBeGreaterThan(s.y + s.height)
  await expectNoHorizontalOverflow(page)
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

// 시작일 전에 시작해 이어지는 일정(WP-136 A1) — 10/11~10/16 종일 학회(동기화 UTC 자정, 끝 배타 10/17)·어제 밤부터 오늘 09:00 까지의 점검.
// 끝이 정확히 오늘 자정인 일정(시간·종일)은 오늘 묶음에 들어오지 않는다.
function ongoingEvents(): CalendarEvent[] {
  return [
    calendarEvent({ id: 400, title: '추계 학회', allDay: true, startsAt: '2026-10-11T00:00:00Z', endsAt: '2026-10-17T00:00:00Z' }),
    calendarEvent({ id: 401, title: '야간 배포 점검', startsAt: kst('2026-10-12', '22:00'), endsAt: kst('2026-10-13', '09:00') }),
    calendarEvent({ id: 402, title: '어제 밤 끝난 회의', startsAt: kst('2026-10-12', '22:00'), endsAt: kst('2026-10-13', '00:00') }),
    calendarEvent({ id: 403, title: '어제 종일', allDay: true, startsAt: '2026-10-12T00:00:00Z', endsAt: '2026-10-13T00:00:00Z' }),
  ]
}

test('진행 중 일정 — 어제 시작한 여러 날 일정이 오늘(시작일) 묶음 맨 앞에 끝 날짜와 함께 보이고, 미니 달력으로 고른 날에도 보인다', async ({ authenticatedPage: page }) => {
  await stubCalendar(page, { events: [...baseEvents(), ...ongoingEvents()] })
  await page.goto('/calendar')
  const list = agendaList(page)
  const today = list.locator('[data-day-key="2026-10-13"]')

  // 오늘 묶음 = 이어지는 일정 2건 + 오늘 일정 3건. 끝이 정확히 오늘 자정인 일정은 없다. 어제 묶음은 만들지 않는다.
  await expect(list.getByTestId('calendar-agenda-day-2026-10-13')).toContainText('5건')
  await expect(list.getByTestId('calendar-event-402')).toHaveCount(0)
  await expect(list.getByTestId('calendar-event-403')).toHaveCount(0)
  await expect(list.locator('[data-day-key]').first()).toHaveAttribute('data-day-key', '2026-10-13')
  // 순서 — 이어지는 일정이 종일 그룹 자리(맨 앞, 제목순) → 그 날 시간 일정.
  const order = await today.locator('[data-testid^="calendar-event-"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid))
  expect(order).toEqual(['calendar-event-401', 'calendar-event-400', 'calendar-event-1', 'calendar-event-2', 'calendar-event-3'])
  // 시간 칸 — 종일은 "종일 / ~10/16"(마지막 날), 시간 일정은 "시작 날짜 / ~끝 시각(오늘 안에 끝남)".
  await expect(list.getByRole('button', { name: /^종일\s+~10\/16\s*,\s*추계 학회/ })).toBeVisible()
  await expect(list.getByRole('button', { name: /^10\/12\s+~09:00\s*,\s*야간 배포 점검/ })).toBeVisible()
  // 지금 선은 여전히 오늘 시간 일정 사이(끝난 07:00 다음, 09:30 앞) — 이어지는 일정이 선을 맨 위로 끌어올리지 않는다.
  const afterNow = await list.getByTestId('calendar-agenda-now').evaluate((el) => (el.nextElementSibling as HTMLElement).dataset.testid)
  expect(afterNow).toBe('calendar-event-2')

  // 미니 달력으로 학회 기간 중 날(10/16)을 고르면 그 날 묶음 맨 앞에 학회가 보인다(시간 일정 점검은 이미 끝나 없다).
  await page.getByTestId('calendar-title-toggle').click()
  await page.getByTestId('calendar-mobile-mini').getByRole('button', { name: '2026년 10월 16일 금요일' }).click()
  await expect(list.locator('[data-day-key]').first()).toHaveAttribute('data-day-key', '2026-10-16')
  const oct16 = list.locator('[data-day-key="2026-10-16"]')
  await expect(oct16.locator('[data-testid^="calendar-event-"]').first()).toHaveAttribute('data-testid', 'calendar-event-400')
  await expect(oct16.getByTestId('calendar-event-400')).toContainText('~10/16')
  await expect(list.getByTestId('calendar-event-401')).toHaveCount(0)
  // 다른 날 묶음엔 다시 나오지 않는다(시작일 묶음 한 번만).
  await expect(list.getByTestId('calendar-event-400')).toHaveCount(1)
})

test('월 보기에서 다른 달로 넘긴 뒤 목록으로 바꾸면 그 달 1일부터, 이번 달이면 오늘부터 보인다', async ({ authenticatedPage: page }) => {
  const requests = await stubCalendar(page)
  await page.goto('/calendar')
  const list = agendaList(page)
  await expect(list.getByTestId('calendar-agenda-day-2026-10-13')).toBeVisible()
  const select = page.getByTestId('calendar-view-select')

  // 월 보기 › › → 12월(anchor 12/13). 목록으로 → 12/1 부터 조회해 12/5 일정이 첫 묶음(12/13 부터면 숨는다).
  await select.selectOption('month')
  await page.getByTestId('calendar-next').click()
  await page.getByTestId('calendar-next').click()
  await expect(page.getByTestId('calendar-title')).toHaveText('12월')
  await select.selectOption('agenda')
  await expect.poll(() => requests).toContainEqual({ from: '2026-11-30T15:00:00.000Z', to: '2026-12-30T15:00:00.000Z' })
  await expect(list.getByTestId('calendar-event-301')).toContainText('12월 초 점검')
  await expect(list.locator('[data-day-key]').first()).toHaveAttribute('data-day-key', '2026-12-05')
  await expect(page.getByTestId('calendar-title')).toHaveText('12월')

  // 다시 월 보기에서 이번 달(10월)로 돌아와 목록 → 10/1 이 아니라 오늘부터.
  await select.selectOption('month')
  await page.getByTestId('calendar-prev').click()
  await page.getByTestId('calendar-prev').click()
  await expect(page.getByTestId('calendar-title')).toHaveText('10월')
  await select.selectOption('agenda')
  await expect(list.locator('[data-day-key]').first()).toHaveAttribute('data-day-key', '2026-10-13')
  await expect(list.getByTestId('calendar-agenda-day-2026-10-13')).toContainText('오늘 · 10월 13일 (화)')
})

test('열어 둔 채 시간이 흐르면 지금 선이 따라가고, 자정을 넘기면 목록이 새 오늘부터 다시 시작한다', async ({ authenticatedPage: page }) => {
  const requests = await stubCalendar(page, { runningClock: true })
  await page.goto('/calendar')
  const list = agendaList(page)
  const nextAfterNow = () =>
    list.getByTestId('calendar-agenda-now').evaluate((el) => (el.nextElementSibling as HTMLElement | null)?.dataset.testid ?? null)
  // 끝난 일정은 행 투명도 대신 제목을 보조 줄과 같은 흐린 글자색으로 — 제목·보조 줄 색이 같아지면 흐림.
  const row2 = list.getByTestId('calendar-event-2')
  const color = (text: string) => row2.getByText(text, { exact: true }).evaluate((el) => getComputedStyle(el).color)
  // 08:40 — 지금 선은 09:30 회의 앞, 그 회의는 아직 흐리지 않다.
  await expect(list.getByTestId('calendar-agenda-day-2026-10-13')).toContainText('오늘 · 10월 13일 (화)')
  await expect.poll(nextAfterNow).toBe('calendar-event-2')
  expect(await color('주간 스프린트 회의')).not.toBe(await color('팀 일정'))
  expect(await row2.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')

  // 10:41 로 — 09:30~10:30 회의가 끝나 선이 14:00 앞으로 옮겨 가고, 끝난 회의 제목은 흐린 글자색.
  await page.clock.fastForward('02:01:00')
  await expect.poll(nextAfterNow).toBe('calendar-event-3')
  expect(await color('주간 스프린트 회의')).toBe(await color('팀 일정'))
  expect(await row2.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')

  // 다음 날 00:01 로 — 오늘부터 보던 목록은 새 오늘(10/14)부터 다시 조회해 그 날이 '오늘' 묶음이 된다.
  await page.clock.fastForward('13:20:00')
  await expect.poll(() => requests).toContainEqual({ from: '2026-10-13T15:00:00.000Z', to: '2026-11-12T15:00:00.000Z' })
  await expect(list.locator('[data-day-key]').first()).toHaveAttribute('data-day-key', '2026-10-14')
  await expect(list.getByTestId('calendar-agenda-day-2026-10-14')).toContainText('오늘 · 10월 14일 (수)')
  await expect(list.getByTestId('calendar-agenda-day-2026-10-13')).toHaveCount(0)
})

test('자정을 넘길 때 목록을 아래로 읽는 중이면 그대로 두고(오늘 강조만 옮김), 화면에 돌아오면 새 오늘부터 다시', async ({ authenticatedPage: page }) => {
  const requests = await stubCalendar(page, { runningClock: true })
  await page.goto('/calendar')
  const list = agendaList(page)
  await expect(list.getByTestId('calendar-agenda-day-2026-10-13')).toContainText('오늘 · 10월 13일 (화)')
  // 첫 묶음 아래(11/1 묶음이 맨 위)까지 내려 읽는 중 — 헤더가 11월로 바뀐 것으로 맨 위 날짜가 반영됐음을 확인.
  await scrollToDay(page, '2026-11-01')
  await expect(page.getByTestId('calendar-title')).toHaveText('11월')
  const scrolled = await list.evaluate((el) => el.scrollTop)

  // 다음 날 00:01 — 새 오늘(10/14) 머리글이 "오늘" 로 강조되는 같은 렌더에서 따라가기 판정이 끝난다. 따라갔다면 새 청크를 받는 동안
  // 스켈레톤이라 10/13 묶음이 남아 있을 수 없다.
  await page.clock.fastForward('15:21:00')
  await expect(list.getByTestId('calendar-agenda-day-2026-10-14')).toContainText('오늘 · 10월 14일 (수)')
  await expect(list.getByTestId('calendar-agenda-day-2026-10-13')).toHaveCount(1)
  await expect(list.getByTestId('calendar-agenda-day-2026-10-13')).not.toContainText('오늘')
  // 스크롤 위치 유지 — 10/13 이 더는 오늘이 아니라 그 묶음의 지금 선(2px)이 빠진 만큼만 브라우저 스크롤 고정이 보정한다(맨 위로 튀지 않음).
  expect(Math.abs((await list.evaluate((el) => el.scrollTop)) - scrolled)).toBeLessThan(10)
  await expect(page.getByTestId('calendar-title')).toHaveText('11월')
  const newChunk = { from: '2026-10-13T15:00:00.000Z', to: '2026-11-12T15:00:00.000Z' }
  expect(requests).not.toContainEqual(newChunk)

  // 앱으로 돌아오면(visibilitychange → visible) 스크롤 중이었어도 새 오늘부터 다시.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect.poll(() => requests).toContainEqual(newChunk)
  await expect(list.locator('[data-day-key]').first()).toHaveAttribute('data-day-key', '2026-10-14')
  await expect(list.getByTestId('calendar-agenda-day-2026-10-13')).toHaveCount(0)
})

test('자정에 따라가지 않은 뒤 미니 달력으로 지난 오늘을 직접 고르면, 화면에 돌아와도 그 날을 그대로 둔다', async ({ authenticatedPage: page }) => {
  const requests = await stubCalendar(page, { runningClock: true })
  await page.goto('/calendar')
  const list = agendaList(page)
  await expect(list.getByTestId('calendar-agenda-day-2026-10-13')).toBeVisible()
  await scrollToDay(page, '2026-11-01')
  await expect(page.getByTestId('calendar-title')).toHaveText('11월')
  await page.clock.fastForward('15:21:00')
  await expect(list.getByTestId('calendar-agenda-day-2026-10-14')).toContainText('오늘 · 10월 14일 (수)')
  await expect(list.getByTestId('calendar-agenda-day-2026-10-13')).toHaveCount(1)

  // 10/13 을 직접 고른다 — 미니 달력은 헤더 달(11월)로 열리므로 이전 달로 넘겨 고른다. 목록이 그 날부터 맨 위로.
  const mini = page.getByTestId('calendar-mobile-mini')
  await page.getByTestId('calendar-title-toggle').click()
  await mini.getByRole('button', { name: '이전 달' }).click()
  await mini.getByRole('button', { name: '2026년 10월 13일 화요일' }).click()
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(0)
  await expect(list.locator('[data-day-key]').first()).toHaveAttribute('data-day-key', '2026-10-13')

  // 화면 복귀 — 고른 날을 덮고 새 오늘로 옮겨 가지 않는다(새 오늘 청크 요청도 없다).
  // 복귀 판정이 반영된 뒤를 보장하려고 이어서 미니 달력을 열어 달을 넘기고 그 조회까지 기다린 다음 단언한다(복귀 이벤트가 먼저 처리된다).
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  // 10·11월 그리드는 이미 받았으므로, 아직 받지 않은 9월(8/30 KST 시작)로 넘겨 그 새 조회를 신호로 쓴다.
  await page.getByTestId('calendar-title-toggle').click()
  await mini.getByRole('button', { name: '이전 달' }).click()
  await expect.poll(() => requests.map((r) => r.from)).toContain('2026-08-29T15:00:00.000Z')
  await expect(list.locator('[data-day-key]').first()).toHaveAttribute('data-day-key', '2026-10-13')
  expect(requests).not.toContainEqual({ from: '2026-10-13T15:00:00.000Z', to: '2026-11-12T15:00:00.000Z' })
})

test('목록에서 다음 달까지 내린 뒤 월 보기로 바꾸면 헤더가 보여 주던 달(목록 시작 달이 아니라)이 열린다', async ({ authenticatedPage: page }) => {
  const requests = await stubCalendar(page)
  await page.goto('/calendar')
  const list = agendaList(page)
  await expect(list.getByTestId('calendar-agenda-day-2026-10-13')).toBeVisible()
  await list.evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
  await expect(list.getByTestId('calendar-event-300')).toBeVisible()
  await scrollToDay(page, '2026-11-20')
  await expect(page.getByTestId('calendar-title')).toHaveText('11월')

  // 목록 시작(10/13)을 쓰면 10월 월 보기로 튄다 — 헤더가 보여 주던 11월 그대로.
  await toCalendarMonthView(page)
  await expect(page.getByTestId('calendar-title')).toHaveText('11월')
  await expect.poll(() => requests.map((r) => r.from)).toContain(NOV_GRID_FROM)
  await expect(page.getByTestId('calendar-view-month').getByText('11월 하순 회고')).toBeVisible()
})

test('이슈 마감 조회가 실패해도 일정은 보이고, 하단 다시 시도 줄로 마감까지 되살린다', async ({ authenticatedPage: page }) => {
  let failDues = true
  await stubCalendar(page, { failDues: () => failDues })
  await page.goto('/calendar')
  const list = agendaList(page)
  const retry = list.getByRole('button', { name: '일부 일정을 불러오지 못했습니다 — 다시 시도' })
  await expect(retry).toBeVisible()
  // 일정 행은 그대로, 마감 행만 빠져 있다.
  await expect(list.getByTestId('calendar-event-2')).toBeVisible()
  await expect(list.getByTestId('calendar-issue-due-7')).toHaveCount(0)

  failDues = false
  await retry.click()
  await expect(list.getByTestId('calendar-issue-due-7')).toBeVisible()
  await expect(retry).toHaveCount(0)
})

test('일정이 없으면 90일(빈 청크 3개)에서 자동 불러오기를 멈추고 "다음 30일 더 보기" 로 한 청크씩', async ({ authenticatedPage: page }) => {
  const requests = await stubCalendar(page, { events: [], issues: [] })
  await page.goto('/calendar')
  const list = agendaList(page)
  const more = list.getByRole('button', { name: '다음 30일 더 보기' })
  await expect(more).toBeVisible()
  await expect(list.getByTestId('calendar-agenda-empty')).toHaveText('앞으로 90일간 일정이 없습니다')
  // 첫 조회라 캐시가 없다 — 요청 기록이 곧 청크 수. 12청크까지 이어 부르지 않고 3개에서 멈춘다.
  const CHUNK3 = { from: '2026-12-11T15:00:00.000Z', to: '2027-01-10T15:00:00.000Z' }
  expect(requests).toEqual([CHUNK1, CHUNK2, CHUNK3])

  await more.tap()
  await expect(list.getByTestId('calendar-agenda-empty')).toHaveText('앞으로 120일간 일정이 없습니다')
  await expect(more).toBeVisible()
  expect(requests).toEqual([CHUNK1, CHUNK2, CHUNK3, { from: '2027-01-10T15:00:00.000Z', to: '2027-02-09T15:00:00.000Z' }])
})

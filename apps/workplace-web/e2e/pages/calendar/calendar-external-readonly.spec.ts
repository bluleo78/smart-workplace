// 외부 동기화 캘린더(isReadOnly) 사이드바 표시 + 이벤트 다이얼로그 읽기전용 E2E.
// 백엔드 없이 page.route 로 /api/v1/calendars 를 모킹한다. (이슈 #501)
import type { Page } from '@playwright/test'

import type { Attendee, Calendar, CalendarEvent } from '../../../src/types/calendar'
import { calendar, calendarEvent, recurringCalendarEvent } from '../../factories/calendar.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

// 타임존 고정 — 이슈 #493 교훈: 호스트 TZ 에 따라 날짜 경계가 달라지므로 반드시 핀.
test.use({ timezoneId: 'Asia/Seoul' })

/** 캘린더 목록 + 이벤트 기본 스텁 */
async function stubCalendars(page: Page, calendars: Calendar[]) {
  await mockApi(page, 'GET', '/api/v1/calendars', calendars)
  await mockApi(page, 'GET', '/api/v1/calendar/events', [calendarEvent()])
  await mockApi(page, 'GET', '/api/v1/me/issues', [])
}

/**
 * 이벤트 목록 + 단일 이벤트 상세(GET /events/{id}) + 캘린더 목록 스텁.
 * 이벤트 클릭 → 다이얼로그 열기 시나리오에 사용.
 */
async function stubForDialog(page: Page, calendars: Calendar[], events: CalendarEvent[]) {
  await mockApi(page, 'GET', '/api/v1/calendars', calendars)
  await mockApi(page, 'GET', '/api/v1/me/issues', [])

  // /api/v1/calendar/events 경로 패밀리 — 목록 + 단일 상세 분기 처리
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/calendar/events'),
    (route) => {
      const method = route.request().method()
      const pathname = new URL(route.request().url()).pathname

      // GET /events/{id} — 단일 상세
      if (method === 'GET' && pathname.match(/\/calendar\/events\/\d+$/)) {
        const id = Number(pathname.split('/').pop())
        const detail = events.find((e) => e.id === id) ?? events[0]
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(detail),
        })
      }

      // GET /events — 목록
      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(events),
        })
      }

      return route.fallback()
    },
  )
}

test(
  '외부 캘린더(isReadOnly:true)에 읽기전용 배지가 표시되고 편집 버튼이 없다',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    // 외부(M365) 캘린더 id=10, 로컬 캘린더 id=1
    await stubCalendars(page, [
      calendar({ id: 1, name: '기본', color: 'blue', isDefault: true, isReadOnly: false }),
      calendar({
        id: 10,
        name: 'M365 캘린더',
        color: 'indigo',
        isDefault: false,
        isReadOnly: true,
        accountEmail: 'dh.yang@iacloud.kr',
        provider: 'M365_GRAPH',
      }),
    ])

    await page.goto('/calendar')

    // 두 캘린더 모두 사이드바에 렌더된다.
    await expect(page.getByTestId('calendar-list-item-1')).toBeVisible()
    await expect(page.getByTestId('calendar-list-item-10')).toBeVisible()

    // 연동 캘린더는 계정 섹션(이메일 + 공급자 pill) 안에, 로컬 캘린더는 그 밖에 놓인다.
    // 그룹핑·라벨 규칙 자체는 calendar.test(groupCalendarsBySource·providerLabel)가 지킨다.
    const acctSection = page.getByTestId('calendar-account-section-dh.yang@iacloud.kr')
    await expect(acctSection).toContainText('dh.yang@iacloud.kr')
    await expect(acctSection).toContainText('M365')
    await expect(acctSection.getByTestId('calendar-list-item-10')).toBeVisible()
    await expect(acctSection.getByTestId('calendar-list-item-1')).toHaveCount(0)

    // 외부 캘린더(id=10): 읽기전용 배지가 보여야 한다.
    const externalRow = page.getByTestId('calendar-list-item-10')
    await expect(externalRow.getByTestId('calendar-readonly-badge')).toBeVisible()
    await expect(externalRow.getByTestId('calendar-readonly-badge')).toContainText('읽기 전용')

    // 외부 캘린더(id=10): 읽기전용 = 케밥 메뉴 트리거가 없어야 한다.
    await expect(page.getByTestId('calendar-menu-10')).toHaveCount(0)

    // 로컬 캘린더(id=1): 케밥 메뉴 트리거가 있어야 한다 (숨겨진 상태라도 DOM 에 존재).
    await expect(page.getByTestId('calendar-menu-1')).toHaveCount(1)

    // 로컬 캘린더(id=1): 읽기전용 배지가 없어야 한다.
    const localRow = page.getByTestId('calendar-list-item-1')
    await expect(localRow.getByTestId('calendar-readonly-badge')).toHaveCount(0)
  },
)

test('외부 캘린더의 가시성 토글(체크박스)은 읽기전용이어도 동작한다', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

  await stubCalendars(page, [
    calendar({
      id: 10,
      name: 'M365 캘린더',
      color: 'indigo',
      isDefault: false,
      isReadOnly: true,
      accountEmail: 'dh.yang@iacloud.kr',
      provider: 'M365_GRAPH',
    }),
  ])

  await page.goto('/calendar')

  // 체크박스가 렌더된다.
  await expect(page.getByTestId('calendar-toggle-10')).toBeVisible()

  // 체크박스를 클릭해도 오류 없이 토글된다 (읽기전용 = 내용 편집 불가, 표시 토글은 가능).
  await page.getByTestId('calendar-toggle-10').click()
  // 재클릭으로 원상복구 — 오류 없이 완료되면 PASS.
  await page.getByTestId('calendar-toggle-10').click()
})

// ────────────────────────────────────────────────────────────
// 이벤트 다이얼로그 읽기전용 검증 (이슈 #501 Task 9)
// ────────────────────────────────────────────────────────────

test(
  '새 일정 다이얼로그 캘린더 선택에 읽기전용 컨테이너가 노출되지 않는다',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    // 로컬 캘린더 id=1, 외부(읽기전용) 캘린더 id=10
    await stubCalendars(page, [
      calendar({ id: 1, name: '기본', color: 'blue', isDefault: true, isReadOnly: false }),
      calendar({
        id: 10,
        name: 'M365 캘린더',
        color: 'indigo',
        isDefault: false,
        isReadOnly: true,
        accountEmail: 'dh.yang@iacloud.kr',
        provider: 'M365_GRAPH',
      }),
    ])

    await page.goto('/calendar')

    // 새 일정 생성 버튼 클릭 → 다이얼로그 열기
    await page.getByTestId('calendar-new-event').click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    // 캘린더 선택을 열어 옵션 확인
    await page.getByTestId('calendar-form-calendar').click()

    // 로컬 캘린더(id=1)는 옵션에 있어야 한다
    await expect(page.getByRole('option', { name: '기본' })).toBeVisible()

    // 읽기전용 외부 캘린더(id=10)는 옵션에 없어야 한다
    await expect(page.getByRole('option', { name: 'M365 캘린더' })).toHaveCount(0)
  },
)

test(
  '외부 캘린더(isReadOnly) 이벤트 클릭 시 다이얼로그가 읽기전용으로 열린다',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    // 외부 캘린더(id=10)에 속하는 이벤트
    const readonlyEvent = calendarEvent({
      id: 42,
      title: 'M365 회의',
      calendarId: 10,
      calendarName: 'M365 캘린더',
      startsAt: '2026-06-10T01:00:00Z',
      endsAt: '2026-06-10T02:00:00Z',
    })

    await stubForDialog(
      page,
      [
        calendar({ id: 1, name: '기본', color: 'blue', isDefault: true, isReadOnly: false }),
        calendar({
          id: 10,
          name: 'M365 캘린더',
          color: 'indigo',
          isDefault: false,
          isReadOnly: true,
          accountEmail: 'dh.yang@iacloud.kr',
          provider: 'M365_GRAPH',
        }),
      ],
      [readonlyEvent],
    )

    await page.goto('/calendar')

    // 이벤트 칩 클릭 → 다이얼로그 열기
    await page.getByTestId('calendar-event-42').first().click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    // 동기화 라벨이 표시되어야 한다
    await expect(page.getByTestId('event-synced-label')).toBeVisible()
    await expect(page.getByTestId('event-synced-label')).toContainText('M365에서 동기화됨')

    // 입력칸 대신 상세 보기로 열린다 — 제목·장소가 텍스트로 보이고 입력칸은 없다 (이슈 #501, WP-708)
    await expect(page.getByTestId('event-detail-view')).toBeVisible()
    await expect(page.getByTestId('event-detail-title')).toHaveText('M365 회의')
    await expect(page.getByTestId('event-detail-calendar')).toHaveText('M365 캘린더')
    await expect(page.getByTestId('calendar-form-title')).toHaveCount(0)
    await expect(page.getByTestId('calendar-form-location')).toHaveCount(0)

    // 저장(수정) 버튼이 없어야 한다
    await expect(page.getByTestId('calendar-form-submit')).toHaveCount(0)

    // 삭제 버튼도 없어야 한다
    await expect(page.getByTestId('calendar-form-delete')).toHaveCount(0)
  },
)

test(
  '로컬 캘린더 이벤트는 다이얼로그가 편집 가능 상태로 열린다 (회귀)',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    // 로컬 캘린더(id=1)에 속하는 이벤트
    const localEvent = calendarEvent({
      id: 1,
      title: '팀 회의',
      calendarId: 1,
      calendarName: '기본',
      startsAt: '2026-06-10T01:00:00Z',
      endsAt: '2026-06-10T02:00:00Z',
    })

    await stubForDialog(
      page,
      [
        calendar({ id: 1, name: '기본', color: 'blue', isDefault: true, isReadOnly: false }),
      ],
      [localEvent],
    )

    await page.goto('/calendar')

    // 이벤트 칩 클릭 → 다이얼로그 열기
    await page.getByTestId('calendar-event-1').first().click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    // 동기화 라벨이 없어야 한다
    await expect(page.getByTestId('event-synced-label')).toHaveCount(0)

    // 제목 입력이 활성화되어야 한다 (편집 가능)
    await expect(page.getByTestId('calendar-form-title')).toBeEnabled()

    // 저장(수정) 버튼이 있어야 한다
    await expect(page.getByTestId('calendar-form-submit')).toBeVisible()
  },
)

// WP-200 주최자만 수정 판정(동기화 사본·초대 일정·내가 주최한 일정)은 calendarEventForm.test(eventEditability)가 지킨다.

test('M365 Teams 초대 — 상세 보기는 설명을 펼치고 링크를 열 수 있으며 다이얼로그 본문 하나만 스크롤된다(WP-708)', async ({
  authenticatedPage: page,
}) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  // Teams 안내문 + 긴 본문 — 예전엔 3줄 설명 칸 안에서 따로 스크롤되고 링크를 누를 수 없었다.
  const teamsUrl = 'https://teams.microsoft.com/meet/46286105292202?p=Xk2'
  const longBody = `${'회의 안건 메모\n'.repeat(30)}Microsoft Teams 모임\n참가: ${teamsUrl}\n모임 ID: 462 861 052 922 02`
  const person = (userId: number, name: string): Attendee => ({
    userId, username: `u${userId}`, name, kind: 'HUMAN', role: 'ATTENDEE',
    rsvpStatus: 'ACCEPTED', invitedByUserId: null, externalEmail: null,
  })
  const teamsEvent = calendarEvent({
    id: 43,
    title: '[아이에이클라우드] DCP-46 과제 컨소시엄 연구개발계획서 작성 방안 논의',
    calendarId: 10,
    calendarName: 'M365 캘린더',
    location: 'SynergiA',
    description: longBody,
    external: true,
    myRole: 'ATTENDEE',
    myRsvpStatus: 'NEEDS_ACTION',
    attendees: [
      // 외부 주최자는 이메일로, 내 행(id 1)은 주최자 바로 다음으로 정렬된다.
      { ...person(0, 'Jayden'), userId: null, kind: 'EXTERNAL', role: 'ORGANIZER', externalEmail: 'jayden@partner.kr' },
      person(2, '참석자2'), person(3, '참석자3'), person(4, '참석자4'), person(5, '참석자5'),
      { ...person(1, '나'), rsvpStatus: 'NEEDS_ACTION' },
      person(6, '참석자6'),
    ],
  })
  await stubForDialog(
    page,
    [
      calendar({ id: 1, name: '기본', color: 'blue', isDefault: true, isReadOnly: false }),
      calendar({ id: 10, name: 'M365 캘린더', color: 'indigo', isDefault: false, isReadOnly: true, provider: 'M365_GRAPH' }),
    ],
    [teamsEvent],
  )
  await page.goto('/calendar')
  await page.getByTestId('calendar-event-43').first().click()
  const view = page.getByTestId('event-detail-view')
  await expect(view).toBeVisible()

  // 시간 한 줄·장소, 값 없는 알림·반복 행은 숨김
  await expect(view.getByTestId('event-detail-time')).toHaveText('6월 10일 (수) · 오전 10:00 – 11:00')
  await expect(view.getByTestId('event-detail-location')).toHaveText('SynergiA')
  await expect(view.getByTestId('event-detail-reminder')).toHaveCount(0)
  await expect(view.getByTestId('event-detail-recurrence')).toHaveCount(0)

  // 참석자 — 요약, 주최자(외부는 이메일)·나 순서, 5명 뒤로 접기
  const attendeesRow = view.getByTestId('event-detail-attendees')
  await expect(attendeesRow).toContainText('참석자 7명 · 수락 6, 대기 1')
  const rows = attendeesRow.getByTestId('event-detail-attendee')
  await expect(rows).toHaveCount(5)
  await expect(rows.nth(0)).toContainText('jayden@partner.kr')
  await expect(rows.nth(0)).toContainText('주최자')
  await expect(rows.nth(1)).toContainText('나(나)')
  const toggle = attendeesRow.getByTestId('event-detail-attendees-toggle')
  await expect(toggle).toHaveText('외 2명 더 보기')
  await toggle.click()
  await expect(rows).toHaveCount(7)
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')

  // 설명 속 URL 은 새 탭으로 여는 링크
  const link = view.getByRole('link', { name: teamsUrl })
  await expect(link).toHaveAttribute('href', teamsUrl)
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', /noopener/)

  // 스크롤은 본문 하나 — 설명 문단은 잘리지 않고(안쪽 스크롤 없음) 본문 컨테이너가 넘친다
  const desc = view.getByTestId('event-detail-description').locator('p')
  const inner = await desc.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
  expect(inner.sh).toBeLessThanOrEqual(inner.ch + 1)
  const outer = await view.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
  expect(outer.sh).toBeGreaterThan(outer.ch)

  // M365 일정의 응답은 Outlook 에서 — 응답 줄·편집 입력칸이 없다
  await expect(page.getByTestId('event-detail-rsvp')).toHaveCount(0)
  await expect(page.getByTestId('calendar-event-dialog').locator('input, textarea')).toHaveCount(0)
})

test('반복 일정 회차를 열면 상세(시리즈 마스터)가 와도 누른 회차의 날짜를 보인다(WP-708)', async ({
  authenticatedPage: page,
}) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  // 다른 사람 캘린더(99)의 매주 회의에 초대받았다 — 상세 GET 은 첫 회차(마스터) 시각을 돌려준다.
  const occ = ['2026-06-08T01:00:00Z', '2026-06-15T01:00:00Z', '2026-06-22T01:00:00Z']
  const series = recurringCalendarEvent(7, occ, { calendarId: 99, calendarName: '기본', title: '주간 회의', myRole: 'ATTENDEE' })
  await stubForDialog(page, [calendar({ id: 1, name: '기본', isDefault: true })], series)
  const detail = page.waitForResponse((r) => /\/calendar\/events\/7$/.test(new URL(r.url()).pathname))
  await page.goto('/calendar')
  await page.getByTestId(`calendar-event-7-${occ[1]}`).click()
  await detail
  const time = page.getByTestId('event-detail-time')
  await expect(time).toContainText('6월 15일 (월) · 오전 10:00 – 11:00')
  await expect(time).not.toContainText('6월 8일')
  await expect(page.getByTestId('event-detail-recurrence')).toHaveText('매주 월요일')
})

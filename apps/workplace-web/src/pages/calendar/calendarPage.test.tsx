// 캘린더 화면(본문·사이드바) — 화면 컴포넌트 테스트(WP-966, WP-995).
// 브라우저 없이 판정되는 아래 동작을 e2e/pages/calendar/ 의 calendar.spec.ts·calendar-issue-due.spec.ts·calendar-realtime.spec.ts·
// calendar-sidebar.spec.ts·calendar-reset.spec.ts·calendar-containers.spec.ts 에서 옮겼다(issue-due·realtime·containers spec 은 전부 옮겨 지웠다):
// - 본문: 헤더 접근성 이름·보기 전환, 요일·오늘 강조 표기, 일정 색, 반복 회차 표시
// - 이슈 마감 오버레이(조회 범위·칸·이동), resource.changed 실시간 반영
// - 사이드바: 미니 달력(한국어·이동·선택·점), 표시 토글, 캘린더 목록·만들기, 케밥 메뉴(모든 일정 삭제·연동 캘린더 제약)
// 일정 만들기·수정·삭제와 일정 폼은 calendarEventDialog.test.tsx 가 본다(같은 화면을 두 파일로 나눠 한 파일이 1분 넘게 돌지 않게).
// 기하(칸 정렬·높이·배지 넘침·월 칸 넘침)·끌기·키보드 포커스·새로고침 뒤 유지·화면 배선 1건은 그 E2E 들이 태그를 달고 지킨다.
// 사이드바의 동작도 상태를 페이지가 쥐고 있어 CalendarPage 를 renderScreen 으로 띄운다(App·앱 셸 없이, calendarPageKit).
// 지금 = 2026-06-10 12:00 KST(vitest 는 TZ=Asia/Seoul).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { setAccessToken } from '@/api/client'
import { useEventStream } from '@/hooks/useEventStream'
import { CalendarPage } from '@/pages/calendar/CalendarPage'
import { dueIssue, fixClock, renderCalendar } from '@/test/kits/calendar/calendarPageKit'
import { controllableEvents, resourceChangedFrame } from '@/test/kits/projects/issueDetailEvents'

import { calendar, calendarEvent, recurringCalendarEvent } from '../../../e2e/factories/calendar.factory'

fixClock()

// 반복 일정 — 마스터 id 와 6월 안의 주 단위 회차(월 보기에서 모두 보인다).
const MASTER_ID = 5
const OCC_DATES = ['2026-06-08T01:00:00Z', '2026-06-15T01:00:00Z', '2026-06-22T01:00:00Z']
const occTestId = (occ: string) => `calendar-event-${MASTER_ID}-${occ}`

describe('헤더·보기·표기', () => {
  // #818 — ‹ › 의 이름이 글리프만이면 무의미하고, 뷰 버튼의 선택 상태가 배경색으로만 보이던 회귀.
  test('이전/다음 버튼 이름이 보기 단위를 따르고 뷰 버튼이 aria-pressed 로 선택을 알린다 (#818)', async () => {
    const { user } = await renderCalendar()
    expect(screen.getByTestId('calendar-prev')).toHaveAccessibleName('이전 달')
    expect(screen.getByTestId('calendar-next')).toHaveAccessibleName('다음 달')
    expect(screen.getByTestId('calendar-view-month-btn')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('calendar-view-week-btn')).toHaveAttribute('aria-pressed', 'false')

    await user.click(screen.getByTestId('calendar-view-day-btn'))
    expect(screen.getByTestId('calendar-prev')).toHaveAccessibleName('이전 날')
    expect(screen.getByTestId('calendar-next')).toHaveAccessibleName('다음 날')
    expect(screen.getByTestId('calendar-view-day-btn')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('calendar-view-month-btn')).toHaveAttribute('aria-pressed', 'false')
  })

  // #176 — date-fns 로케일이 빠지면 요일이 「Mon」 으로 나왔다. 목록·주·일 보기 날짜 머리 모두 한국어.
  test('목록·주·일 보기의 요일이 한국어로 표시된다 (#176)', async () => {
    vi.setSystemTime(new Date('2026-06-08T03:00:00Z')) // 2026-06-08 = 월요일
    const { user } = await renderCalendar({
      events: [calendarEvent({ id: 1, startsAt: '2026-06-08T01:00:00Z', endsAt: '2026-06-08T02:00:00Z' })],
    })
    await user.click(screen.getByTestId('calendar-view-agenda-btn'))
    const agenda = await screen.findByTestId('calendar-view-agenda')
    await within(agenda).findByText(/6\.8 \(월\)/)
    expect(agenda).not.toHaveTextContent(/Mon/)

    for (const v of ['week', 'day'] as const) {
      await user.click(screen.getByTestId(`calendar-view-${v}-btn`))
      const grid = await screen.findByTestId(`calendar-view-${v}`)
      expect(within(grid).getByText('6.8 (월)')).toBeInTheDocument()
      expect(grid).not.toHaveTextContent(/Mon/)
    }
  })

  // #257 — 주·일 보기에서 오늘 날짜 머리만 primary 배지로 강조한다.
  test('주·일 보기에서 오늘 날짜 머리만 primary 배지로 강조된다 (#257)', async () => {
    vi.setSystemTime(new Date('2026-06-16T03:00:00Z')) // 2026-06-16 = 화요일
    const { user } = await renderCalendar()
    await user.click(screen.getByTestId('calendar-view-week-btn'))
    const week = await screen.findByTestId('calendar-view-week')
    const badge = within(week).getByTestId('calendar-today-badge')
    expect(badge).toHaveTextContent('6.16 (화)')
    expect(badge).toHaveClass('bg-primary')
    // 다른 날은 배지 없이 글자만
    expect(within(week).getByText('6.15 (월)')).not.toHaveClass('bg-primary')
    expect(within(week).getAllByTestId('calendar-today-badge')).toHaveLength(1)

    await user.click(screen.getByTestId('calendar-view-day-btn'))
    const day = await screen.findByTestId('calendar-view-day')
    expect(within(day).getByTestId('calendar-today-badge')).toHaveTextContent('6.16 (화)')
    expect(within(day).getByTestId('calendar-today-badge')).toHaveClass('bg-primary')
  })

  // 종일 일정 타임존(KST) — 다중일 종일 [6/8, 6/10) 은 8·9일 두 칸에 걸치고 배타적 끝인 10일엔 없다.
  // 주 보기 종일 행만 eventsOnDay 를 따로 부르는 호출부라 그 연결을 본다(규칙 자체는 lib/calendar.test 가 지킨다).
  test('주 보기 종일 행 — 다중일 종일 일정이 걸친 날 칸마다 표시된다', async () => {
    const { user } = await renderCalendar({
      events: [
        calendarEvent({ id: 1, title: '워크숍', allDay: true, startsAt: '2026-06-08T00:00:00Z', endsAt: '2026-06-10T00:00:00Z' }),
      ],
    })
    await user.click(screen.getByTestId('calendar-view-week-btn'))
    await screen.findByTestId('calendar-view-week')
    await waitFor(() => expect(screen.getAllByTestId('calendar-event-1')).toHaveLength(2))
  })

  // WP-952 — 일정 색 = 직접 고른 색 › 첫 태그 색 › 캘린더 색. 남은 태그 색은 블록 앞 작은 점.
  test('태그가 붙은 일정은 월·주 보기에서 첫 태그 색으로 칠하고, 직접 고른 색이 먼저다 (WP-952)', async () => {
    const tag = (id: number, name: string, color: string) => ({ id, name, color })
    const { user } = await renderCalendar({
      events: [
        calendarEvent({ id: 1, title: '고객 미팅', tags: [tag(1, '고객', 'amber'), tag(2, '전사', 'violet')] }),
        calendarEvent({ id: 2, title: '직접 색 고른 일정', startsAt: '2026-06-10T04:00:00Z', endsAt: '2026-06-10T05:00:00Z', color: 'red', effectiveColor: 'red', tags: [tag(1, '고객', 'amber')] }),
        calendarEvent({ id: 3, title: '태그 없는 일정', startsAt: '2026-06-10T06:00:00Z', endsAt: '2026-06-10T07:00:00Z' }),
      ],
    })
    const chip = (id: number) => screen.getAllByTestId(`calendar-event-${id}`)[0]
    await screen.findByTestId('calendar-event-1')
    expect(chip(1).className).toMatch(/bg-amber-700/)
    const dots = within(chip(1)).getByTestId('calendar-event-extra-tags').querySelectorAll('span')
    expect(dots).toHaveLength(1)
    expect(dots[0].className).toMatch(/bg-violet-500/)
    expect(chip(2).className).toMatch(/bg-red-/)
    expect(within(chip(2)).queryByTestId('calendar-event-extra-tags')).not.toBeInTheDocument()
    expect(chip(3).className).toMatch(/bg-blue-600/)

    await user.click(screen.getByTestId('calendar-view-week-btn'))
    await screen.findByTestId('calendar-view-week')
    expect(chip(1).className).toMatch(/bg-amber-700/)
    expect(chip(2).className).toMatch(/bg-red-/)
    expect(chip(3).className).toMatch(/bg-blue-600/)
  })

  // #111·#174 — 마스터 id 를 공유하는 회차가 각자 고유 testid(복합 키)로 월·목록 보기에 모두 그려진다.
  test('반복 일정의 회차가 월·목록 보기에 각자 표시된다 (#111·#174)', async () => {
    const { user } = await renderCalendar({ events: recurringCalendarEvent(MASTER_ID, OCC_DATES) })
    for (const occ of OCC_DATES) expect(await screen.findByTestId(occTestId(occ))).toBeInTheDocument()

    await user.click(screen.getByTestId('calendar-view-agenda-btn'))
    const agenda = await screen.findByTestId('calendar-view-agenda')
    for (const occ of OCC_DATES) expect(within(agenda).getByTestId(occTestId(occ))).toBeInTheDocument()
  })
})

describe('이슈 마감 오버레이 (#109)', () => {
  // 조회 범위(assignee=me·dueFrom·dueTo)가 빠지면 가시 범위 밖·전체가 섞여도 화면은 멀쩡해 보인다 — 쿼리를 직접 본다.
  test('내 이슈 마감이 그 날 칸에만 칩으로 보이고, 조회는 보이는 범위로 하며, 누르면 이슈로 간다', async () => {
    const { user, requests, location } = await renderCalendar({ issues: [dueIssue()] })
    const cell = screen.getByTestId('calendar-cell-2026-06-12')
    const chip = await within(cell).findByTestId('calendar-issue-due-7')
    expect(chip).toHaveTextContent('로그인 버그')
    // 날짜 매칭 회귀(모든 칸에 렌더) 방지 + 일정 칩과 구분
    expect(screen.getAllByTestId('calendar-issue-due-7')).toHaveLength(1)
    expect(screen.queryByTestId('calendar-event-7')).not.toBeInTheDocument()

    const q = requests.meIssues[0]
    expect(q.get('assignee')).toBe('me')
    const dueFrom = q.get('dueFrom') ?? ''
    const dueTo = q.get('dueTo') ?? ''
    expect(dueFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(dueTo).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(dueFrom <= '2026-06-12' && '2026-06-12' <= dueTo).toBe(true)

    await user.click(chip)
    expect(location()).toBe('/projects/WP/issues/42')
  })

  // 주 보기 종일 줄·목록 보기는 월 보기와 다른 렌더 경로라 따로 본다.
  test('주 보기 종일 줄과 목록 보기에도 마감 이슈가 보인다', async () => {
    const { user } = await renderCalendar({
      issues: [dueIssue()],
      events: [calendarEvent({ id: 1, title: '팀 회의', startsAt: '2026-06-11T01:00:00Z', endsAt: '2026-06-11T02:00:00Z' })],
    })
    await user.click(screen.getByTestId('calendar-view-week-btn'))
    const week = await screen.findByTestId('calendar-view-week')
    expect(await within(week).findByTestId('calendar-issue-due-7')).toHaveTextContent('로그인 버그')

    await user.click(screen.getByTestId('calendar-view-agenda-btn'))
    const agenda = await screen.findByTestId('calendar-view-agenda')
    expect(within(agenda).getByTestId('calendar-event-1')).toBeInTheDocument()
    const dueRow = within(agenda).getByTestId('calendar-issue-due-7')
    expect(dueRow).toHaveTextContent('마감')
    expect(dueRow).toHaveTextContent('WP-42')
  })
})

describe('일정 변경 실시간 반영 (WP-61)', () => {
  // 통합 SSE 는 앱 셸(AppLayout)이 구독한다 — 화면만 띄우므로 같은 훅(useEventStream)을 곁에 붙여 프레임 → 무효화 → 재조회를 본다.
  // 스트림은 액세스 토큰이 있어야 연결하고, 연결될 때 생성 중 AI 대화를 다시 맞추려 /ai/chat/active 를 부른다.
  function Streamed() {
    useEventStream(1)
    return <CalendarPage />
  }
  afterEach(() => setAccessToken(null))

  async function renderStreamed(events: ReturnType<typeof calendarEvent>[]) {
    setAccessToken('test-token')
    const sse = controllableEvents()
    const view = await renderCalendar(
      { events },
      { handlers: [sse.handler, http.get('/api/v1/ai/chat/active', () => HttpResponse.json({ items: [], limit: 3 }))] },
      <Streamed />,
    )
    return { ...view, sse }
  }

  test('서버에서 만든 일정이 새로고침 없이 나타난다', async () => {
    const { state, sse } = await renderStreamed([calendarEvent({ id: 1, title: '주간 회의' })])
    expect(await screen.findByTestId('calendar-event-1')).toHaveTextContent('주간 회의')
    expect(screen.queryByText('AI 가 잡은 미팅')).not.toBeInTheDocument()

    state.events = [...state.events, calendarEvent({ id: 77, title: 'AI 가 잡은 미팅', startsAt: '2026-06-11T01:00:00Z', endsAt: '2026-06-11T02:00:00Z' })]
    await sse.push(resourceChangedFrame({ resource: 'calendar-event', op: 'created', scopeType: 'USER', scopeId: 1, ids: [77], actorId: 99 }))
    expect(await screen.findByTestId('calendar-event-77')).toHaveTextContent('AI 가 잡은 미팅')
  })

  test('서버에서 지운 일정이 화면에서 사라진다', async () => {
    const { state, sse } = await renderStreamed([
      calendarEvent({ id: 1, title: '주간 회의' }),
      calendarEvent({ id: 2, title: '삭제될 회의' }),
    ])
    expect(await screen.findByTestId('calendar-event-2')).toHaveTextContent('삭제될 회의')
    state.events = state.events.filter((e) => e.id !== 2)
    await sse.push(resourceChangedFrame({ resource: 'calendar-event', op: 'deleted', scopeType: 'USER', scopeId: 1, ids: [2], actorId: 99 }))
    await waitFor(() => expect(screen.queryByTestId('calendar-event-2')).not.toBeInTheDocument())
    expect(screen.getByTestId('calendar-event-1')).toBeInTheDocument()
  })
})

// ─── 사이드바 ───

// 로컬 기본(1) + 로컬 업무(2) + M365 연동 쓰기 가능(10, accountEmail 보유)
const LOCAL_AND_LINKED = [
  calendar({ id: 1, name: '기본', isDefault: true }),
  calendar({ id: 2, name: '업무', isDefault: false }),
  calendar({ id: 10, name: 'Calendar', isDefault: false, isReadOnly: false, accountEmail: 'me@iacloud.kr', provider: 'M365_GRAPH' }),
]

const mini = () => screen.getByTestId('calendar-mini')
/** 미니 달력의 그 날 칸(<td data-day=ISO>). */
const miniDay = (iso: string) => mini().querySelector(`[data-day="${iso}"]`) as HTMLElement

describe('미니 달력', () => {
  // #652 — 래퍼 기본 locale={ko} 가 빠지면 「Su Mo Tu」, #793 — 이동 버튼 이름이 영문 기본값.
  test('요일 머리·캡션이 한국어이고 이전/다음 달 버튼 이름도 한국어다 (#652·#793)', async () => {
    await renderCalendar()
    expect(mini()).toHaveTextContent('2026년 6월')
    for (const d of ['일', '월', '화']) expect(mini()).toHaveTextContent(d)
    expect(mini()).not.toHaveTextContent('Su')
    expect(mini()).not.toHaveTextContent('Mo')
    expect(within(mini()).getByRole('button', { name: '이전 달' })).toBeInTheDocument()
    expect(within(mini()).getByRole('button', { name: '다음 달' })).toBeInTheDocument()
    expect(within(mini()).queryByRole('button', { name: /previous month|next month/i })).not.toBeInTheDocument()
  })

  test('미니 달력과 본문 날짜가 양방향으로 따라간다', async () => {
    const { user } = await renderCalendar()
    expect(screen.getByTestId('calendar-title')).toHaveTextContent('2026년 6월')
    // 미니 → 본문
    await user.click(within(mini()).getByRole('button', { name: '다음 달' }))
    expect(screen.getByTestId('calendar-title')).toHaveTextContent('2026년 7월')
    expect(mini()).toHaveTextContent('2026년 7월')
    // 본문 → 미니
    await user.click(screen.getByTestId('calendar-today'))
    expect(screen.getByTestId('calendar-title')).toHaveTextContent('2026년 6월')
    expect(mini()).toHaveTextContent('2026년 6월')
  })

  test('미니 달력에서 날짜를 고르면 선택 표시되고 본문 기준일이 그 날로 바뀐다', async () => {
    const { user } = await renderCalendar()
    await user.click(within(miniDay('2026-06-20')).getByRole('button'))
    await waitFor(() => expect(within(miniDay('2026-06-20')).getByRole('button')).toHaveAttribute('data-selected-single', 'true'))
    await user.click(screen.getByTestId('calendar-view-day-btn'))
    expect(await screen.findByTestId('calendar-view-day')).toHaveTextContent('6.20')
  })

  test('일정·마감이 있는 날에만 점을 찍는다', async () => {
    await renderCalendar({
      events: [calendarEvent({ id: 1, calendarId: 1, startsAt: '2026-06-11T01:00:00Z', endsAt: '2026-06-11T02:00:00Z' })],
      issues: [dueIssue('2026-06-13')],
    })
    await waitFor(() => expect(miniDay('2026-06-11').className).toMatch(/day-has-items/))
    await waitFor(() => expect(miniDay('2026-06-13').className).toMatch(/day-has-items/))
    expect(miniDay('2026-06-15').className).not.toMatch(/day-has-items/)
  })
})

// 토글별 표시 규칙은 lib/calendar.test(isEventVisible·markedDays)가 지키고, 여기선 세 토글이 그리드에 이어지는지 본다.
test('표시 토글로 이슈 마감·초대받은 일정·캘린더별 일정을 끄고 켠다', async () => {
  const { user } = await renderCalendar({
    events: [
      calendarEvent({ id: 1, title: '팀 회의', calendarId: 1, startsAt: '2026-06-11T01:00:00Z', endsAt: '2026-06-11T02:00:00Z' }),
      // 내 캘린더가 아닌(초대받은) 일정
      calendarEvent({ id: 2, title: '초대 일정', calendarId: 99, startsAt: '2026-06-11T03:00:00Z', endsAt: '2026-06-11T04:00:00Z' }),
    ],
    issues: [dueIssue('2026-06-11')],
  })
  expect(await screen.findByTestId('calendar-event-1')).toBeInTheDocument()
  expect(await screen.findByTestId('calendar-issue-due-7')).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: '캘린더 표시: 기본' })).toBeInTheDocument()

  await user.click(screen.getByTestId('calendar-layer-issue-dues'))
  expect(screen.queryByTestId('calendar-issue-due-7')).not.toBeInTheDocument()
  expect(screen.getByTestId('calendar-event-1')).toBeInTheDocument()

  expect(screen.getByTestId('calendar-event-2')).toBeInTheDocument()
  await user.click(screen.getByTestId('calendar-layer-invited'))
  expect(screen.queryByTestId('calendar-event-2')).not.toBeInTheDocument()
  expect(screen.getByTestId('calendar-event-1')).toBeInTheDocument()

  await user.click(screen.getByTestId('calendar-toggle-1'))
  expect(screen.queryByTestId('calendar-event-1')).not.toBeInTheDocument()
})

describe('캘린더 관리', () => {
  /** 케밥 메뉴를 연다(호버 없이도 누를 수 있다 — 보이는지는 E2E @input·@layout 몫). */
  async function openMenu(user: { click: (el: Element) => Promise<void> }, id: number) {
    await user.click(screen.getByTestId(`calendar-menu-${id}`))
    await screen.findByTestId(`calendar-edit-${id}`)
  }

  // WP-687 — 이름은 서버 상한(100자)까지만 들어간다. 저장하면 { name, color } 로 POST 하고 목록이 새로 불린다.
  test('캘린더 목록이 보이고, ＋ 로 이름·색을 골라 만들면 POST 뒤 목록에 나타난다', async () => {
    const { user, requests } = await renderCalendar({
      calendars: [calendar({ id: 1, name: '기본', color: 'blue', isDefault: true }), calendar({ id: 2, name: '업무', color: 'green', isDefault: false })],
    })
    expect(screen.getByTestId('calendar-list-item-1')).toHaveTextContent('기본')
    expect(screen.getByTestId('calendar-list-item-2')).toHaveTextContent('업무')

    await user.click(screen.getByTestId('calendar-add'))
    const name = (await screen.findByTestId('calendar-edit-name')) as HTMLInputElement
    expect(name).toHaveAttribute('maxLength', '100')
    await user.click(name)
    await user.paste('가'.repeat(101))
    expect(name.value).toBe('가'.repeat(100))
    await user.clear(name)
    await user.paste('개인')
    await user.click(screen.getByTestId('calendar-color-green'))
    await user.click(screen.getByTestId('calendar-edit-submit'))

    await waitFor(() => expect(requests.calendarPosts).toHaveLength(1))
    expect(requests.calendarPosts[0]).toMatchObject({ name: '개인', color: 'green' })
    await waitFor(() => expect(screen.queryByTestId('calendar-edit-dialog')).not.toBeInTheDocument())
    expect(await screen.findByTestId('calendar-list-item-99')).toHaveTextContent('개인')
  })

  // 확인하면 리셋 POST 뒤 일정 목록이 무효화돼 다시 불린다(무효화 키 회귀 가드).
  test('로컬 캘린더 케밥 「모든 일정 삭제」 → 확인하면 POST .../reset 하고 일정을 다시 불러온다', async () => {
    const { user, requests } = await renderCalendar({ calendars: LOCAL_AND_LINKED })
    await waitFor(() => expect(requests.eventLists).toBeGreaterThan(0))
    await openMenu(user, 1)
    await user.click(screen.getByTestId('calendar-reset-1'))
    expect(await screen.findByTestId('calendar-reset-confirm')).toHaveTextContent('기본의 모든 일정을 영구 삭제합니다')
    const before = requests.eventLists
    await user.click(screen.getByTestId('calendar-reset-confirm-submit'))
    await waitFor(() => expect(requests.resets).toEqual([1]))
    await waitFor(() => expect(requests.eventLists).toBeGreaterThan(before))
  })

  // #608 — 연동 캘린더를 로컬에서 지우면 동기화가 다시 만들어 고아 데이터가 생긴다. 일괄 삭제·삭제 버튼을 감추고 이름 경고를 보인다.
  test('연동 캘린더는 케밥에 「모든 일정 삭제」가 없고, 편집 대화상자에 삭제 버튼 대신 이름 경고가 있다 (#608)', async () => {
    const { user } = await renderCalendar({ calendars: LOCAL_AND_LINKED })
    await openMenu(user, 10)
    expect(screen.queryByTestId('calendar-reset-10')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('calendar-edit-10'))
    const dialog = await screen.findByTestId('calendar-edit-dialog')
    expect(screen.getByTestId('calendar-edit-name')).toHaveValue('Calendar')
    expect(screen.getByTestId('calendar-edit-external-warning')).toHaveTextContent('실제 계정 캘린더명과 동기화되지 않습니다')
    expect(within(dialog).queryByRole('button', { name: '삭제' })).not.toBeInTheDocument()
  })

  test('로컬(기본 아닌) 캘린더 편집 대화상자에는 삭제 버튼이 있고 외부 경고가 없다 (#608 회귀)', async () => {
    const { user } = await renderCalendar({ calendars: LOCAL_AND_LINKED })
    await openMenu(user, 2)
    await user.click(screen.getByTestId('calendar-edit-2'))
    const dialog = await screen.findByTestId('calendar-edit-dialog')
    expect(screen.queryByTestId('calendar-edit-external-warning')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '삭제' })).toBeInTheDocument()
  })
})

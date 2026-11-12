// 「내 작업 · 개요」 탭(WP-1484) — 화면 테스트(renderScreen). 탭 기억(첫 방문 개요 → 그다음 마지막 탭), 위젯 렌더(숫자·문구),
// 「완료한 이슈」 카드·추이 막대 → 할당 탭 완료 목록 주소, 직전 같은 기간 툴팁, 기간·단위 전환 → 요청 파라미터, 타일 전환, 빈 상태(처음 쓰는 사람), 실패 → 다시 시도.
// 모두 API 응답·주소가 화면으로 바뀌는 판정이라 브라우저 없이 본다(apps/workplace-web/CLAUDE.md 「테스트 종류 판정」).
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import type { MeOverviewResponse, WorkProfile, WorkProfileAnalyzeResponse } from '@/types/meOverview'

import { createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { createEmptyMeOverview as emptyOverview, createMeOverview as overview } from '../../../e2e/factories/meOverview.factory'
import { createEmptyWorkProfile, createWorkProfile } from '../../../e2e/factories/workProfile.factory'
import MyTasksIndexRedirect from './MyTasksIndexRedirect'
import MyTasksPage from './MyTasksPage'

beforeEach(() => {
  localStorage.clear()
})

type Respond = (sp: URLSearchParams) => MeOverviewResponse | Response
/** 업무 프로파일(WP-1485) 조회·다시 분석 응답자 — 응답 본문 또는 오류 Response. */
type ProfileRespond = (sp: URLSearchParams) => WorkProfile | Response
type AnalyzeRespond = (sp: URLSearchParams) => WorkProfileAnalyzeResponse | Response
interface ProfileOptions {
  profile?: ProfileRespond
  analyze?: AnalyzeRespond
}

function routes() {
  return (
    <Routes>
      <Route path="/me/tasks" element={<MyTasksIndexRedirect />} />
      <Route path="/me/tasks/:tab" element={<MyTasksPage />} />
      <Route path="*" element={null} />
    </Routes>
  )
}

/** 내 작업 화면 — 개요·업무 프로파일 API 요청 파라미터를 모아 두고, 다른 탭 목록은 빈 응답. */
function renderTasks(path: string, respond: Respond = () => overview(), opts: ProfileOptions = {}) {
  const seen: URLSearchParams[] = []
  const profileSeen: URLSearchParams[] = []
  const analyzeSeen: URLSearchParams[] = []
  const profile = opts.profile ?? (() => createWorkProfile())
  const analyze = opts.analyze ?? (() => ({ outcome: 'STARTED' as const, profile: createWorkProfile({ status: 'PENDING' }) }))
  const json = (body: object) => (body instanceof Response ? body : HttpResponse.json(body))
  const view = renderScreen(routes(), {
    path,
    handlers: [
      http.get('/api/v1/me/overview', ({ request }) => {
        const sp = new URL(request.url).searchParams
        seen.push(sp)
        const body = respond(sp)
        return body instanceof Response ? body : HttpResponse.json(body)
      }),
      http.get('/api/v1/me/work-profile', ({ request }) => {
        const sp = new URL(request.url).searchParams
        profileSeen.push(sp)
        return json(profile(sp))
      }),
      http.post('/api/v1/me/work-profile/analyze', ({ request }) => {
        const sp = new URL(request.url).searchParams
        analyzeSeen.push(sp)
        return json(analyze(sp))
      }),
      http.get('/api/v1/me/issues', () => HttpResponse.json(createIssueSearchResponse([]))),
      http.get('/api/v1/me/watched-issues', () => HttpResponse.json(createIssueSearchResponse([]))),
    ],
  })
  return { ...view, seen, profileSeen, analyzeSeen }
}

describe('내 작업 · 개요', () => {
  test('처음 들어오면 개요, 다른 탭을 본 뒤 다시 들어오면 마지막에 본 탭', async () => {
    const first = renderTasks('/me/tasks')
    await waitFor(() => expect(first.location()).toBe('/me/tasks/overview'))
    expect(await screen.findByTestId('overview')).toBeInTheDocument()
    // 탭 순서 — 개요가 맨 앞.
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['개요', '할당', '내가 만든', '구독'])
    await first.user.click(screen.getByRole('tab', { name: '할당' }))
    await waitFor(() => expect(first.location()).toBe('/me/tasks/assigned'))
    first.unmount()

    const again = renderTasks('/me/tasks')
    await waitFor(() => expect(again.location()).toBe('/me/tasks/assigned'))
    again.unmount()

    // 잘못된 탭 주소도 마지막에 본 탭으로 바로잡는다.
    const bogus = renderTasks('/me/tasks/bogus')
    await waitFor(() => expect(bogus.location()).toBe('/me/tasks/assigned'))
  })

  test('어제/오늘·숫자 넷·마감 준수가 응답 숫자와 앱 말투(해요체·완료·마감·제때/늦게)로 그려진다', async () => {
    const { seen } = renderTasks('/me/tasks/overview')
    const yesterday = await screen.findByTestId('overview-yesterday')
    expect(within(yesterday).getByRole('heading')).toHaveTextContent(/^어제 11월 10일 \(화\)$/)
    expect(yesterday).toHaveTextContent('완료 2건')
    expect(yesterday).toHaveTextContent('AI와 함께 1건 · 제때 1건')
    expect(yesterday).toHaveTextContent('새로 만든 이슈 2건')
    const today = screen.getByTestId('overview-today')
    expect(within(today).getByRole('heading')).toHaveTextContent(/^오늘 11월 11일 \(수\)할당 탭에서 보기$/)
    expect(today).toHaveTextContent('마감 지남 3건')
    expect(today).toHaveTextContent('최장 6일 지남')
    expect(today).toHaveTextContent('오늘 마감 2건')
    expect(today).toHaveTextContent('답변 필요 4건')
    expect(today).toHaveTextContent('AI가 질문함')
    expect(within(today).getByRole('link', { name: '할당 탭에서 보기' })).toHaveAttribute('href', '/me/tasks/assigned')
    // 기본 요청 — 이번 달·일별.
    expect(seen[0].get('period')).toBe('MONTH')
    expect(seen[0].get('granularity')).toBe('DAY')

    // 숫자 카드 — 기간을 제목에 되풀이하지 않고, 비교는 「직전 같은 기간」.
    const stats = screen.getByTestId('overview-stats')
    expect(stats).not.toHaveTextContent('이번 달')
    expect(stats).not.toHaveTextContent('지난 기간')
    const completed = screen.getByTestId('stat-completed')
    expect(completed).toHaveTextContent('완료한 이슈3')
    expect(completed).toHaveTextContent('AI와 함께 1건 ·직전 같은 기간 5건')
    expect(screen.getByTestId('stat-due')).toHaveTextContent('제때 / 늦게1/1')
    expect(screen.getByTestId('stat-due')).toHaveTextContent('마감 있던 2건 중 50% 제때')
    expect(screen.getByTestId('stat-lead')).toHaveTextContent('평균 처리 기간2.8일')
    expect(screen.getByTestId('stat-lead')).toHaveTextContent('만든 날부터 완료까지 ·직전 같은 기간 3.6일')
    expect(screen.getByTestId('stat-created')).toHaveTextContent('새로 만든 이슈3직전 같은 기간 4건')

    const due = screen.getByTestId('overview-due')
    expect(within(due).getByRole('heading')).toHaveTextContent('마감 준수 마감 있던 2건')
    expect(due).toHaveTextContent('제때 완료1')
    expect(due).toHaveTextContent('늦게 완료1')
    expect(screen.getByTestId('overview-due-rate')).toHaveTextContent('50%')
    expect(screen.getByTestId('overview-due-meta')).toHaveTextContent('늦은 1건은 평균 2일 늦었어요 ·직전 같은 기간 75%')
    expect(due).toHaveTextContent('가장 늦게 완료한 이슈')
    expect(within(screen.getByTestId('overview-late-top')).getByRole('link')).toHaveTextContent('WP-1465노트 표 붙여넣기2일 늦음')
    const trend = screen.getByTestId('overview-trend')
    expect(trend).toHaveTextContent('완료 추이하루 평균 0.3건')
    expect(trend).toHaveTextContent('그중 늦게 완료')
    expect(trend).toHaveTextContent('막대를 눌러 그 기간에 완료한 이슈 보기')
  })

  test('「끝낸 일」 목록은 없고 화면은 맡은 이슈로 끝난다', async () => {
    renderTasks('/me/tasks/overview')
    const page = await screen.findByTestId('overview')
    expect(screen.queryByTestId('overview-closed')).toBeNull()
    expect(page).not.toHaveTextContent('끝낸 일')
    expect(page.lastElementChild).toBe(screen.getByTestId('overview-upcoming'))
  })

  test('「완료한 이슈」 카드를 누르면 할당 탭 완료 목록이 이 기간·완료(취소 제외)로 열린다', async () => {
    const { user, location } = renderTasks('/me/tasks/overview')
    const link = await screen.findByTestId('stat-completed-link')
    expect(link).toHaveAttribute('href', '/me/tasks/assigned?status=DONE&closedIn=2026-11-01%7E2026-11-11')
    await user.click(link)
    await waitFor(() => expect(location()).toBe('/me/tasks/assigned?status=DONE&closedIn=2026-11-01%7E2026-11-11'))
  })

  test('추이 막대는 그 칸의 기간으로 할당 탭 완료 목록을 연다(툴팁·aria 는 완료 n건 (늦게 n건) / 새로 만든 이슈 n건)', async () => {
    const { user, location } = renderTasks('/me/tasks/overview')
    const late = await screen.findByRole('link', { name: '11월 10일 (화) · 완료 2건 (늦게 1건) · 새로 만든 이슈 2건' })
    expect(late).toHaveAttribute('href', '/me/tasks/assigned?status=DONE&closedIn=2026-11-10%7E2026-11-10')
    // 늦게 완료가 없으면 괄호를 뺀다.
    const bar = screen.getByRole('link', { name: '11월 9일 (월) · 완료 1건 · 새로 만든 이슈 1건' })
    await user.click(bar)
    await waitFor(() => expect(location()).toBe('/me/tasks/assigned?status=DONE&closedIn=2026-11-09%7E2026-11-09'))
  })

  test('주별 추이 막대는 그 주(기간 안으로 잘린 칸)로 건다', async () => {
    const weekly = overview({
      granularity: 'WEEK',
      buckets: [
        { start: '2026-11-01', end: '2026-11-01', completed: 0, overdue: 0, created: 0 },
        { start: '2026-11-02', end: '2026-11-08', completed: 1, overdue: 0, created: 1 },
        { start: '2026-11-09', end: '2026-11-11', completed: 2, overdue: 1, created: 2 },
      ],
    })
    const { user } = renderTasks('/me/tasks/overview', () => weekly)
    await screen.findByTestId('overview')
    await user.click(within(screen.getByRole('group', { name: '막대 단위' })).getByRole('button', { name: '주별' }))
    const link = await screen.findByRole('link', { name: /^11월 9일 ~ 11월 11일 · 완료 2건/ })
    expect(link).toHaveAttribute('href', '/me/tasks/assigned?status=DONE&closedIn=2026-11-09%7E2026-11-11')
  })

  test('「직전 같은 기간」에 초점을 주면 실제 비교 날짜를 툴팁으로 보인다', async () => {
    renderTasks('/me/tasks/overview')
    const compare = await screen.findByTestId('stat-completed-compare')
    expect(compare).toHaveTextContent('직전 같은 기간 5건')
    fireEvent.focus(compare)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('10월 21일~31일과 비교')
  })

  test('기간·추이 단위를 바꾸면 그 값으로 다시 부르고 기간은 주소에 남는다', async () => {
    const { user, seen, location } = renderTasks('/me/tasks/overview', (sp) => overview({ period: (sp.get('period') ?? 'MONTH') as MeOverviewResponse['period'] }))
    await screen.findByTestId('overview')
    const periods = within(screen.getByRole('group', { name: '조회 기간' }))
    expect(screen.getByTestId('overview-period')).toHaveTextContent('나에게만 보여요')
    expect(periods.getByRole('button', { name: '이번 달' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(periods.getByRole('button', { name: '이번 주' }))
    await waitFor(() => expect(location()).toBe('/me/tasks/overview?period=WEEK'))
    await waitFor(() => expect(seen.at(-1)?.get('period')).toBe('WEEK'))
    await user.click(within(screen.getByRole('group', { name: '막대 단위' })).getByRole('button', { name: '주별' }))
    await waitFor(() => expect(seen.at(-1)?.get('granularity')).toBe('WEEK'))
    expect(seen.at(-1)?.get('period')).toBe('WEEK')

    // 기본(이번 달)으로 되돌리면 주소에서 뺀다.
    await user.click(periods.getByRole('button', { name: '이번 달' }))
    await waitFor(() => expect(location()).toBe('/me/tasks/overview'))
  })

  test('맡은 이슈 — 건수가 있는 첫 타일이 골라져 있고, 타일을 누르면 상위 목록이 바뀐다', async () => {
    const { user } = renderTasks('/me/tasks/overview')
    const card = await screen.findByTestId('overview-upcoming')
    expect(within(card).getByRole('heading')).toHaveTextContent('맡은 이슈 열린 이슈 18건')
    expect(within(card).getByRole('group', { name: '맡은 이슈 분류' })).toHaveTextContent('마감 지남3 7일 안 마감4 답변 필요4 마감 여유·없음7')
    expect(screen.getByTestId('upcoming-tile-overdue')).toHaveAttribute('aria-pressed', 'true')
    const list = () => screen.getByTestId('overview-upcoming-list')
    expect(list()).toHaveTextContent('WP-1294genia 실행기 첫 응답 지연AI 개발자16일 지남')
    // AI 태그 앞에는 Bot 아이콘(에이전트 주체, §7.2).
    expect(list().querySelector('svg.lucide-bot')).not.toBeNull()
    await user.click(screen.getByTestId('upcoming-tile-waiting'))
    expect(screen.getByTestId('upcoming-tile-waiting')).toHaveAttribute('aria-pressed', 'true')
    expect(list()).toHaveTextContent('WP-1310답을 기다리는 일마감 없음')
    await user.click(screen.getByTestId('upcoming-tile-dueSoon'))
    expect(list()).toHaveTextContent('마감 임박 일2일 남음')
    // 상위가 없는 묶음.
    await user.click(screen.getByTestId('upcoming-tile-other'))
    expect(screen.queryByTestId('overview-upcoming-list')).toBeNull()
    expect(card).toHaveTextContent('해당하는 이슈가 없어요')
    expect(within(card).getByRole('link', { name: '할당 탭에서 보기' })).toHaveAttribute('href', '/me/tasks/assigned')
  })

  test('처음 쓰는 사람은 위젯마다 짧은 안내가 보인다', async () => {
    renderTasks('/me/tasks/overview', () => emptyOverview())
    expect(await screen.findByTestId('overview-trend-empty')).toHaveTextContent('이 기간에 완료한 이슈가 없어요')
    expect(screen.getByTestId('overview-due-empty')).toHaveTextContent('이슈를 완료하면 마감 준수율을 보여 드려요')
    expect(screen.getByTestId('overview-upcoming-empty')).toHaveTextContent('지금 맡은 열린 이슈가 없어요')
    expect(screen.getByTestId('overview-yesterday')).toHaveTextContent('어제 완료하거나 만든 이슈가 없어요')
    expect(screen.getByTestId('stat-lead')).toHaveTextContent('—')
    expect(screen.getByTestId('stat-due')).toHaveTextContent('마감이 있던 이슈가 없어요')
  })

  test('완료는 있는데 모두 마감 없음이면 마감 준수에 「—」 대신 안내, 늦은 건이 없으면 평균 대신 사실만', async () => {
    const o = overview()
    renderTasks('/me/tasks/overview', () =>
      overview({ current: { ...o.current, onTime: 0, overdue: 0, noDue: 3, onTimeRate: null, overdueLateDaysAvg: null }, lateTop: [] }),
    )
    expect(await screen.findByTestId('overview-due-nodue')).toHaveTextContent('마감이 있던 이슈가 없어요')
    expect(screen.queryByTestId('overview-due-rate')).toBeNull()
  })

  test('늦게 완료한 이슈가 없으면 「늦은 0건은 평균 —」 대신 그 사실을 말한다', async () => {
    const o = overview()
    renderTasks('/me/tasks/overview', () => overview({ current: { ...o.current, onTime: 2, overdue: 0, overdueLateDaysAvg: null, onTimeRate: 1 }, lateTop: [] }))
    expect(await screen.findByTestId('overview-due-meta')).toHaveTextContent('늦게 완료한 이슈가 없어요 ·직전 같은 기간 75%')
  })

  test('불러오기 실패는 다시 시도, 누르면 다시 부른다', async () => {
    let fail = true
    const { user, seen } = renderTasks('/me/tasks/overview', () => (fail ? HttpResponse.json({}, { status: 500 }) : overview()))
    const error = await screen.findByTestId('overview-error')
    expect(error).toHaveTextContent('개요를 불러오지 못했습니다')
    fail = false
    await user.click(within(error).getByRole('button', { name: /다시 시도/ }))
    expect(await screen.findByTestId('overview')).toBeInTheDocument()
    expect(seen.length).toBe(2)
  })
})

// 업무 프로파일 카드(WP-1485) — 응답 → 카드 문구·태그, 기간 → 요청, PENDING 다시 읽기, 다시 분석 결과 토스트, 빈·실패 상태.
describe('업무 프로파일', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('제목·부제·상태줄·요약·안내·세 그룹이 그려진다', async () => {
    renderTasks('/me/tasks/overview')
    const card = await screen.findByTestId('overview-work-profile')
    const c = within(card)
    expect(await c.findByText('업무 프로파일')).toBeInTheDocument()
    expect(c.getByText('끝낸 이슈에서 분석 · 보고서 원자료')).toBeInTheDocument()
    // 상태줄 — 날짜 표기(오늘/n월 n일)는 지금 시각에 따라 다르므로 앞부분만 본다(정확한 표기는 workProfileModel.test.ts).
    expect(c.getByTestId('work-profile-status')).toHaveTextContent(/^이번 달 37건 분석 · /)
    expect(c.getByText(createWorkProfile().summary!)).toBeInTheDocument()
    expect(c.getByText('AI 가 끝낸 이슈의 제목·본문·라벨·검토 기록을 읽고 씁니다. 나만 볼 수 있어요.')).toBeInTheDocument()
    expect(c.getByTestId('work-profile-tasks')).toHaveTextContent('주요 업무기능 개발 12결함 수정 19')
    expect(c.getByTestId('work-profile-areas')).toHaveTextContent('자주 일한 영역이슈 트래커 9메일 4')
    // 역량 — 숫자 없이 이름만.
    expect(c.getByTestId('work-profile-skills')).toHaveTextContent(/^역량ReactSpring Boot$/)
    expect(c.getByRole('button', { name: '다시 분석' })).toBeEnabled()
    expect(c.queryByRole('button', { name: '보고서 만들기' })).toBeNull()
    // AI 결과 영역은 AiContent 한 곳이 「AI 분석」 로 표시하고, 요약·주요 업무가 그 안에 든다.
    const ai = c.getByTestId('work-profile-ai')
    expect(within(ai).getByText('AI 분석')).toBeInTheDocument()
    expect(within(ai).getByText(createWorkProfile().summary!)).toBeInTheDocument()
    expect(within(ai).getByTestId('work-profile-tasks')).toBeInTheDocument()
    // 「다시 분석」 버튼은 AiIcon.
    expect(c.getByRole('button', { name: '다시 분석' }).querySelector('svg.lucide-sparkles')).not.toBeNull()
  })

  test('빈 상태에는 AI 분석 영역이 없다', async () => {
    renderTasks('/me/tasks/overview', undefined, { profile: () => createEmptyWorkProfile() })
    const card = await screen.findByTestId('overview-work-profile')
    await within(card).findByText('이 기간에 끝낸 이슈가 없어 분석할 것이 없어요')
    expect(within(card).queryByTestId('work-profile-ai')).toBeNull()
  })

  test('카드가 맡은 이슈보다 앞, 추이보다 뒤', async () => {
    renderTasks('/me/tasks/overview')
    await screen.findByTestId('overview')
    const order = ['overview-trend', 'overview-due', 'overview-work-profile', 'overview-upcoming'].map((id) => screen.getByTestId(id))
    for (let i = 0; i < order.length - 1; i++) {
      expect(order[i].compareDocumentPosition(order[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  test('기간을 바꾸면 그 기간으로 다시 읽는다', async () => {
    const { user, profileSeen } = renderTasks('/me/tasks/overview', undefined, {
      profile: (sp) => createWorkProfile({ period: (sp.get('period') ?? 'MONTH') as WorkProfile['period'] }),
    })
    const card = await screen.findByTestId('overview-work-profile')
    await waitFor(() => expect(profileSeen[0]?.get('period')).toBe('MONTH'))
    await user.click(within(screen.getByRole('group', { name: '조회 기간' })).getByRole('button', { name: '이번 주' }))
    await waitFor(() => expect(profileSeen.at(-1)?.get('period')).toBe('WEEK'))
    await waitFor(() => expect(within(card).getByTestId('work-profile-status')).toHaveTextContent(/^이번 주 37건 분석/))
  })

  test('PENDING 이면 「분석하는 중」·버튼 비활성, 3초 뒤 READY 로 바뀐다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let calls = 0
    renderTasks('/me/tasks/overview', undefined, {
      profile: () => (calls++ === 0 ? createWorkProfile({ status: 'PENDING', summary: null, tasks: [], areas: [], skills: [], analyzedAt: null }) : createWorkProfile()),
    })
    const card = await screen.findByTestId('overview-work-profile')
    expect(await within(card).findByText('분석하는 중…')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: '다시 분석' })).toBeDisabled()
    // 분석 중에는 AiIcon 대신 회전 스피너 — 접근 이름은 그대로.
    const busyBtn = within(card).getByRole('button', { name: '다시 분석' })
    expect(busyBtn.querySelector('svg.lucide-loader-circle')).not.toBeNull()
    expect(busyBtn.querySelector('svg.lucide-sparkles')).toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(3000)
    })
    expect(await within(card).findByText(createWorkProfile().summary!)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: '다시 분석' })).toBeEnabled()
    expect(within(card).getByRole('button', { name: '다시 분석' }).querySelector('svg.lucide-sparkles')).not.toBeNull()
  })

  test('다시 분석 → UNCHANGED 면 「바뀐 것이 없어 그대로 둡니다」 토스트', async () => {
    const { user, analyzeSeen } = renderTasks('/me/tasks/overview', undefined, {
      analyze: () => ({ outcome: 'UNCHANGED', profile: createWorkProfile() }),
    })
    const card = await screen.findByTestId('overview-work-profile')
    await user.click(await within(card).findByRole('button', { name: '다시 분석' }))
    expect(await screen.findByText('바뀐 것이 없어 그대로 둡니다')).toBeInTheDocument()
    expect(analyzeSeen[0].get('period')).toBe('MONTH')
  })

  test('다시 분석 → 429 면 서버 문구 「오늘은 더 분석할 수 없어요」 토스트', async () => {
    const { user } = renderTasks('/me/tasks/overview', undefined, {
      analyze: () => HttpResponse.json({ status: 429, message: '오늘은 더 분석할 수 없어요' }, { status: 429 }),
    })
    const card = await screen.findByTestId('overview-work-profile')
    await user.click(await within(card).findByRole('button', { name: '다시 분석' }))
    expect(await screen.findByText('오늘은 더 분석할 수 없어요')).toBeInTheDocument()
  })

  test('다시 분석 → STARTED 면 카드가 곧장 「분석하는 중」으로 바뀐다', async () => {
    const { user } = renderTasks('/me/tasks/overview')
    const card = await screen.findByTestId('overview-work-profile')
    await user.click(await within(card).findByRole('button', { name: '다시 분석' }))
    expect(await within(card).findByText('분석하는 중…')).toBeInTheDocument()
  })

  test('끝낸 이슈가 없으면 빈 상태 문구', async () => {
    renderTasks('/me/tasks/overview', undefined, { profile: () => createEmptyWorkProfile() })
    const card = await screen.findByTestId('overview-work-profile')
    expect(await within(card).findByText('이 기간에 끝낸 이슈가 없어 분석할 것이 없어요')).toBeInTheDocument()
    expect(within(card).queryByTestId('work-profile-tasks')).toBeNull()
    expect(within(card).queryByTestId('work-profile-areas')).toBeNull()
    expect(within(card).queryByTestId('work-profile-skills')).toBeNull()
  })

  test('FAILED 면 오류 문구와 이전 내용', async () => {
    renderTasks('/me/tasks/overview', undefined, {
      profile: () => createWorkProfile({ status: 'FAILED', error: 'AI 비서가 설정되지 않아 분석할 수 없어요' }),
    })
    const card = await screen.findByTestId('overview-work-profile')
    expect(await within(card).findByText('AI 비서가 설정되지 않아 분석할 수 없어요')).toBeInTheDocument()
    expect(within(card).getByText(createWorkProfile().summary!)).toBeInTheDocument()
    expect(within(card).getByTestId('work-profile-tasks')).toHaveTextContent('기능 개발 12')
  })

  test('첫 분석이 실패한 FAILED(0건)는 빈 상태 대신 오류 문구를 보인다', async () => {
    renderTasks('/me/tasks/overview', undefined, {
      profile: () => ({ ...createEmptyWorkProfile(), status: 'FAILED', error: 'AI 비서가 설정되지 않아 분석할 수 없어요' }),
    })
    const card = await screen.findByTestId('overview-work-profile')
    expect(await within(card).findByText('AI 비서가 설정되지 않아 분석할 수 없어요')).toBeInTheDocument()
    expect(within(card).queryByTestId('overview-work-profile-empty')).toBeNull()
  })

  test('결과 없는 FAILED 면 AI 분석 영역(work-profile-ai)은 없고 오류 문구는 보인다', async () => {
    renderTasks('/me/tasks/overview', undefined, {
      profile: () => ({ ...createEmptyWorkProfile(), status: 'FAILED', error: 'AI 비서가 설정되지 않아 분석할 수 없어요' }),
    })
    const card = await screen.findByTestId('overview-work-profile')
    expect(await within(card).findByTestId('work-profile-error')).toBeInTheDocument()
    expect(within(card).queryByTestId('work-profile-ai')).toBeNull()
  })

  test('끝낸 이슈가 없는 NONE 이면 「다시 분석」을 누를 수 없다', async () => {
    renderTasks('/me/tasks/overview', undefined, { profile: () => createEmptyWorkProfile() })
    const card = await screen.findByTestId('overview-work-profile')
    await within(card).findByText('이 기간에 끝낸 이슈가 없어 분석할 것이 없어요')
    expect(within(card).getByRole('button', { name: '다시 분석' })).toBeDisabled()
  })

  test('프로파일 조회 실패는 개요 전체를 막지 않는다', async () => {
    let fail = true
    const { user, profileSeen } = renderTasks('/me/tasks/overview', undefined, {
      profile: () => (fail ? HttpResponse.json({}, { status: 500 }) : createWorkProfile()),
    })
    expect(await screen.findByTestId('overview')).toBeInTheDocument()
    const card = screen.getByTestId('overview-work-profile')
    const retry = await within(card).findByRole('button', { name: /다시 시도/ })
    fail = false
    await user.click(retry)
    expect(await within(card).findByText(createWorkProfile().summary!)).toBeInTheDocument()
    expect(profileSeen.length).toBe(2)
  })
})

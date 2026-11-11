// 「내 작업 · 개요」 탭(WP-1484) — 화면 테스트(renderScreen). 탭 기억(첫 방문 개요 → 그다음 마지막 탭), 위젯 렌더(숫자·배지·날짜 묶음),
// 기간·단위 전환 → 요청 파라미터, 타일 전환, 막대 클릭 → 끝낸 일 목록이 그 칸으로, 줄 펼치기, 빈 상태(처음 쓰는 사람), 실패 → 다시 시도.
// 모두 API 응답·주소가 화면으로 바뀌는 판정이라 브라우저 없이 본다(apps/workplace-web/CLAUDE.md 「테스트 종류 판정」).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, test } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import type { MeOverviewResponse } from '@/types/meOverview'

import { createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { createEmptyMeOverview as emptyOverview, createMeOverview as overview } from '../../../e2e/factories/meOverview.factory'
import MyTasksIndexRedirect from './MyTasksIndexRedirect'
import MyTasksPage from './MyTasksPage'

beforeEach(() => {
  localStorage.clear()
})

type Respond = (sp: URLSearchParams) => MeOverviewResponse | Response

function routes() {
  return (
    <Routes>
      <Route path="/me/tasks" element={<MyTasksIndexRedirect />} />
      <Route path="/me/tasks/:tab" element={<MyTasksPage />} />
      <Route path="*" element={null} />
    </Routes>
  )
}

/** 내 작업 화면 — 개요 API 요청 파라미터를 모아 두고, 다른 탭 목록은 빈 응답. */
function renderTasks(path: string, respond: Respond = () => overview()) {
  const seen: URLSearchParams[] = []
  const view = renderScreen(routes(), {
    path,
    handlers: [
      http.get('/api/v1/me/overview', ({ request }) => {
        const sp = new URL(request.url).searchParams
        seen.push(sp)
        const body = respond(sp)
        return body instanceof Response ? body : HttpResponse.json(body)
      }),
      http.get('/api/v1/me/issues', () => HttpResponse.json(createIssueSearchResponse([]))),
      http.get('/api/v1/me/watched-issues', () => HttpResponse.json(createIssueSearchResponse([]))),
    ],
  })
  return { ...view, seen }
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

  test('어제/오늘·숫자 넷·기한 준수가 응답 숫자로 그려진다', async () => {
    const { seen } = renderTasks('/me/tasks/overview')
    const yesterday = await screen.findByTestId('overview-yesterday')
    expect(yesterday).toHaveTextContent('11월 10일 (화)')
    expect(yesterday).toHaveTextContent('2 건 끝냄')
    expect(yesterday).toHaveTextContent('그중 AI와 함께 1 · 기한 내 1')
    expect(yesterday).toHaveTextContent('2 건 새로 만듦')
    const today = screen.getByTestId('overview-today')
    expect(today).toHaveTextContent('3 건 기한 지남')
    expect(today).toHaveTextContent('가장 오래된 것 6일')
    expect(today).toHaveTextContent('2 건 오늘 마감')
    expect(today).toHaveTextContent('4 건 나를 기다림')
    expect(within(today).getByRole('link', { name: '할당 탭에서 보기' })).toHaveAttribute('href', '/me/tasks/assigned')
    // 기본 요청 — 이번 달·일별.
    expect(seen[0].get('period')).toBe('MONTH')
    expect(seen[0].get('granularity')).toBe('DAY')

    expect(screen.getByTestId('stat-completed')).toHaveTextContent('끝낸 이슈 · 이번 달3지난 기간 5 · 그중 AI와 함께 1')
    expect(screen.getByTestId('stat-due')).toHaveTextContent('1/1')
    expect(screen.getByTestId('stat-due')).toHaveTextContent('마감 있는 2건 · 준수율 50%')
    expect(screen.getByTestId('stat-lead')).toHaveTextContent('2.8일')
    expect(screen.getByTestId('stat-lead')).toHaveTextContent('지난 기간 3.6일')
    expect(screen.getByTestId('stat-created')).toHaveTextContent('지난 기간 4')

    expect(screen.getByTestId('overview-due-rate')).toHaveTextContent('50%')
    expect(screen.getByTestId('overview-due-meta')).toHaveTextContent('늦은 1건 · 평균 2일 늦음 · 지난 기간 준수율 75%')
    expect(within(screen.getByTestId('overview-late-top')).getByRole('link')).toHaveTextContent('WP-1465노트 표 붙여넣기2일')
    expect(screen.getByTestId('overview-trend')).toHaveTextContent('하루 평균 0.3건')
  })

  test('끝낸 일은 날짜별 묶음·배지·AI 태그·소요일, 펼치면 요청 내용과 마지막 코멘트', async () => {
    const { user } = renderTasks('/me/tasks/overview')
    const day10 = await screen.findByTestId('closed-day-2026-11-10')
    expect(day10).toHaveTextContent('11월 10일 (화) · 끝냄 2 · 만듦 2')
    expect(screen.getByTestId('closed-day-2026-11-09')).toHaveTextContent('끝냄 1 · 만듦 1')
    const row = screen.getByTestId('closed-row-1467')
    expect(row).toHaveTextContent('WP-1467드라이브 복원AI 개발자2기한 내1.5일')
    expect(screen.getByTestId('closed-row-1465')).toHaveTextContent('2일 늦음')
    expect(screen.getByTestId('closed-row-1447')).toHaveTextContent('마감 없음')
    // 「모두 보기」 — 할당 탭 완료 목록에 이 기간을 건다.
    expect(screen.getByTestId('overview-closed-all')).toHaveAttribute('href', '/me/tasks/assigned?status=DONE&closedIn=2026-11-01%7E2026-11-11')

    expect(screen.queryByTestId('closed-detail-1467')).toBeNull()
    await user.click(within(row).getByRole('button', { name: 'WP-1467 요청 내용 펼치기' }))
    const detail = screen.getByTestId('closed-detail-1467')
    expect(detail).toHaveTextContent('요청일괄 삭제한 묶음에서 하나만 복원')
    expect(detail).toHaveTextContent('마지막 코멘트AI 개발자2 — 복원 단위를 바꿨어요')
  })

  test('막대를 누르면 끝낸 일 목록이 그날로 좁혀지고, 칩으로 되돌린다', async () => {
    const { user } = renderTasks('/me/tasks/overview')
    const bar = await screen.findByRole('button', { name: '11월 9일 (월) · 끝냄 1 · 새로 만듦 1 · 기한 초과 0' })
    await user.click(bar)
    expect(bar).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('closed-day-2026-11-09')).toBeInTheDocument()
    expect(screen.queryByTestId('closed-day-2026-11-10')).toBeNull()
    expect(screen.getByTestId('overview-closed-picked')).toHaveTextContent('11월 9일 (월)만 보는 중')
    // 일이 없는 날을 누르면 그 칸엔 없다고 알린다.
    await user.click(screen.getByRole('button', { name: '11월 3일 (화) · 끝냄 0 · 새로 만듦 0 · 기한 초과 0' }))
    expect(screen.getByTestId('overview-closed-empty')).toHaveTextContent('이 칸에 끝낸 이슈가 없어요')
    await user.click(screen.getByTestId('overview-closed-picked'))
    expect(screen.getByTestId('closed-day-2026-11-10')).toBeInTheDocument()
    expect(screen.getByTestId('closed-day-2026-11-09')).toBeInTheDocument()
  })

  test('기간·추이 단위를 바꾸면 그 값으로 다시 부르고 기간은 주소에 남는다', async () => {
    const { user, seen, location } = renderTasks('/me/tasks/overview', (sp) => overview({ period: (sp.get('period') ?? 'MONTH') as MeOverviewResponse['period'] }))
    await screen.findByTestId('overview')
    const periods = within(screen.getByRole('group', { name: '기간' }))
    expect(screen.getByTestId('overview-period')).toHaveTextContent('나만 볼 수 있어요')
    expect(periods.getByRole('button', { name: '이번 달' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(periods.getByRole('button', { name: '이번 주' }))
    await waitFor(() => expect(location()).toBe('/me/tasks/overview?period=WEEK'))
    await waitFor(() => expect(seen.at(-1)?.get('period')).toBe('WEEK'))
    expect(await screen.findByText(/끝낸 이슈 · 이번 주/)).toBeInTheDocument()

    await user.click(within(screen.getByRole('group', { name: '추이 단위' })).getByRole('button', { name: '주별' }))
    await waitFor(() => expect(seen.at(-1)?.get('granularity')).toBe('WEEK'))
    expect(seen.at(-1)?.get('period')).toBe('WEEK')

    // 기본(이번 달)으로 되돌리면 주소에서 뺀다.
    await user.click(periods.getByRole('button', { name: '이번 달' }))
    await waitFor(() => expect(location()).toBe('/me/tasks/overview'))
  })

  test('앞으로 할 일 — 건수가 있는 첫 타일이 골라져 있고, 타일을 누르면 상위 목록이 바뀐다', async () => {
    const { user } = renderTasks('/me/tasks/overview')
    const card = await screen.findByTestId('overview-upcoming')
    expect(card).toHaveTextContent('맡은 열린 이슈 18')
    expect(screen.getByTestId('upcoming-tile-overdue')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('upcoming-tile-other')).toHaveTextContent('그 밖7')
    const list = () => screen.getByTestId('overview-upcoming-list')
    expect(list()).toHaveTextContent('WP-1294genia 실행기 첫 응답 지연AI 개발자16일 지남')
    await user.click(screen.getByTestId('upcoming-tile-waiting'))
    expect(screen.getByTestId('upcoming-tile-waiting')).toHaveAttribute('aria-pressed', 'true')
    expect(list()).toHaveTextContent('WP-1310답을 기다리는 일마감 없음')
    await user.click(screen.getByTestId('upcoming-tile-dueSoon'))
    expect(list()).toHaveTextContent('마감 임박 일2일 남음')
    // 상위가 없는 묶음.
    await user.click(screen.getByTestId('upcoming-tile-other'))
    expect(screen.queryByTestId('overview-upcoming-list')).toBeNull()
    expect(within(card).getByRole('link', { name: '할당 탭에서 모두 보기' })).toHaveAttribute('href', '/me/tasks/assigned')
  })

  test('처음 쓰는 사람은 위젯마다 짧은 안내가 보인다', async () => {
    renderTasks('/me/tasks/overview', () => emptyOverview())
    expect(await screen.findByTestId('overview-trend-empty')).toHaveTextContent('이 기간에 끝낸 이슈가 없어요')
    expect(screen.getByTestId('overview-due-empty')).toBeInTheDocument()
    expect(screen.getByTestId('overview-upcoming-empty')).toHaveTextContent('맡은 열린 이슈가 없어요')
    expect(screen.getByTestId('overview-closed-empty')).toHaveTextContent('이 기간에 끝낸 이슈가 없어요')
    expect(screen.getByTestId('overview-yesterday')).toHaveTextContent('어제 끝내거나 만든 이슈가 없어요')
    expect(screen.getByTestId('stat-lead')).toHaveTextContent('—')
    expect(screen.getByTestId('stat-due')).toHaveTextContent('준수율 —')
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

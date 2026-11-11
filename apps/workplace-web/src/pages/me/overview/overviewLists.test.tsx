// 개요 탭 목록 카드(WP-1484) — 앞으로 할 일 타일 선택이 데이터를 따라가는지, 끝낸 일 목록이 잘렸을 때 전체 수·「모두 보기」 안내.
// 받은 데이터 → 화면 판정이라 브라우저 없이 본다(apps/workplace-web/CLAUDE.md 「테스트 종류 판정」).
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test } from 'vitest'

import type { Upcoming } from '@/types/meOverview'

import { createClosedItem, createMeOverview, createUpcomingItem, overviewDays } from '../../../../e2e/factories/meOverview.factory'
import { ClosedListCard, UpcomingCard } from './OverviewLists'

const upcoming = (over: Partial<Upcoming>): Upcoming => ({
  openAssigned: 5,
  overdue: 0,
  dueSoon: 0,
  waiting: 0,
  other: 0,
  overdueTop: [],
  dueSoonTop: [],
  waitingTop: [],
  otherTop: [],
  ...over,
})

describe('앞으로 할 일 타일 선택', () => {
  test('고른 타일이 데이터가 바뀌어 0건이 되면 건수 있는 첫 타일로 돌아간다', async () => {
    const user = userEvent.setup()
    const first = upcoming({
      overdue: 1,
      overdueTop: [createUpcomingItem(1, '기한 지난 일', '2026-11-05')],
      other: 2,
      otherTop: [createUpcomingItem(2, '그 밖의 일', null)],
    })
    const ui = (u: Upcoming) => (
      <MemoryRouter>
        <UpcomingCard upcoming={u} today="2026-11-11" />
      </MemoryRouter>
    )
    const { rerender } = render(ui(first))
    expect(screen.getByTestId('upcoming-tile-overdue')).toHaveAttribute('aria-pressed', 'true')

    // 빈 타일을 직접 누르면 같은 데이터 동안은 그 타일에 머문다(「없어요」 안내).
    await user.click(screen.getByTestId('upcoming-tile-waiting'))
    expect(screen.getByTestId('upcoming-tile-waiting')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('이 묶음에 든 이슈가 없어요')).toBeInTheDocument()

    // 「그 밖」을 고른 뒤 데이터가 바뀌어도 그 타일에 건수가 있으면 유지.
    await user.click(screen.getByTestId('upcoming-tile-other'))
    const second = { ...first, overdue: 0, overdueTop: [] }
    rerender(ui(second))
    expect(screen.getByTestId('upcoming-tile-other')).toHaveAttribute('aria-pressed', 'true')

    // 「그 밖」이 비면 건수 있는 첫 타일(마감 임박)로.
    rerender(ui({ ...second, other: 0, otherTop: [], dueSoon: 1, dueSoonTop: [createUpcomingItem(3, '마감 임박 일', '2026-11-13')] }))
    expect(screen.getByTestId('upcoming-tile-dueSoon')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('overview-upcoming-list')).toHaveTextContent('마감 임박 일')
  })
})

describe('끝낸 일 목록 자르기', () => {
  const renderClosed = (picked: { start: string; end: string } | null = null) => {
    // 서버가 최근 1건만 실었고 기간 전체는 60건 — 11-03 에 끝낸 일은 목록 밖.
    const data = createMeOverview({
      closed: [createClosedItem({ issueId: 9, number: 9, title: '최근 끝냄', closedDate: '2026-11-10' })],
      closedTotal: 60,
      dailyTotals: overviewDays(1, 11, (d) => (d === '2026-11-03' ? { completed: 4 } : d === '2026-11-10' ? { completed: 1 } : {})),
    })
    render(
      <MemoryRouter>
        <ClosedListCard data={data} label="이번 달" picked={picked} onClearPick={() => {}} />
      </MemoryRouter>,
    )
  }

  test('잘렸으면 머리에 전체 수, 「모두 보기」에 전체 수를 함께 보인다', () => {
    renderClosed()
    expect(screen.getByTestId('overview-closed')).toHaveTextContent('이번 달 60건 · 최근 끝낸 순')
    expect(screen.getByTestId('overview-closed-all')).toHaveTextContent('모두 보기 (60건)')
    expect(screen.getByTestId('overview-closed-truncated')).toHaveTextContent('최근 1건만 보여요 · 모두 보기 (60건)')
  })

  test('고른 칸의 끝낸 일이 목록 밖이면 「없어요」 대신 「모두 보기」로 안내한다', () => {
    renderClosed({ start: '2026-11-03', end: '2026-11-03' })
    expect(screen.queryByTestId('overview-closed-empty')).toBeNull()
    const beyond = screen.getByTestId('overview-closed-beyond')
    expect(beyond).toHaveTextContent('이 칸에 끝낸 이슈는 최근 1건 밖이에요 · 모두 보기')
    expect(beyond.querySelector('a')).toHaveAttribute('href', '/me/tasks/assigned?status=DONE&closedIn=2026-11-01%7E2026-11-11')
  })

  test('잘리지 않았으면 전체 수 표기·안내 없이 「모두 보기」만', () => {
    render(
      <MemoryRouter>
        <ClosedListCard data={createMeOverview()} label="이번 달" picked={null} onClearPick={() => {}} />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('overview-closed-all')).toHaveTextContent(/^모두 보기$/)
    expect(screen.queryByTestId('overview-closed-truncated')).toBeNull()
  })
})

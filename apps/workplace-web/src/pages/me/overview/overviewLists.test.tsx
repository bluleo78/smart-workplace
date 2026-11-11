// 개요 탭 목록 카드(WP-1484) — 맡은 이슈 타일 선택이 데이터를 따라가는지.
// 받은 데이터 → 화면 판정이라 브라우저 없이 본다(apps/workplace-web/CLAUDE.md 「테스트 종류 판정」).
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test } from 'vitest'

import type { Upcoming } from '@/types/meOverview'

import { createUpcomingItem } from '../../../../e2e/factories/meOverview.factory'
import { UpcomingCard } from './OverviewLists'

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

describe('맡은 이슈 타일 선택', () => {
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
    expect(screen.getByText('해당하는 이슈가 없어요')).toBeInTheDocument()

    // 「마감 여유·없음」을 고른 뒤 데이터가 바뀌어도 그 타일에 건수가 있으면 유지.
    await user.click(screen.getByTestId('upcoming-tile-other'))
    const second = { ...first, overdue: 0, overdueTop: [] }
    rerender(ui(second))
    expect(screen.getByTestId('upcoming-tile-other')).toHaveAttribute('aria-pressed', 'true')

    // 「마감 여유·없음」이 비면 건수 있는 첫 타일(7일 안 마감)으로.
    rerender(ui({ ...second, other: 0, otherTop: [], dueSoon: 1, dueSoonTop: [createUpcomingItem(3, '마감 임박 일', '2026-11-13')] }))
    expect(screen.getByTestId('upcoming-tile-dueSoon')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('overview-upcoming-list')).toHaveTextContent('마감 임박 일')
  })
})

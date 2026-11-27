// AgendaView(데스크톱 목록 보기) — 거절한 일정 표시(WP-2149).
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import { calendarEvent } from '../../../../e2e/factories/calendar.factory'
import { AgendaView } from './AgendaView'

describe('AgendaView 거절 일정 (WP-2149)', () => {
  const at = { startsAt: '2026-11-21T01:00:00Z', endsAt: '2026-11-21T02:00:00Z', myRole: 'ATTENDEE' as const }
  const declined = calendarEvent({ id: 1, title: '거절 회의', myRsvpStatus: 'DECLINED', ...at })
  const accepted = calendarEvent({ id: 2, title: '수락 회의', myRsvpStatus: 'ACCEPTED', ...at })

  function setup() {
    const onSelectEvent = vi.fn()
    renderWithProviders(
      <AgendaView
        events={[declined, accepted]}
        issueDues={[]}
        anchor={new Date(2026, 10, 21)}
        onCreateAt={vi.fn()}
        onSelectEvent={onSelectEvent}
        onSelectIssue={vi.fn()}
      />,
    )
    return { onSelectEvent }
  }

  it('거절한 일정은 흐린 글자 + 「거절」 배지(제목 앞) + 제목 취소선', () => {
    setup()
    const row = screen.getByTestId('calendar-event-1')
    const badge = within(row).getByTestId('calendar-event-declined-badge')
    const title = within(row).getByText('거절 회의')
    expect(badge).toHaveTextContent('거절')
    expect(title).toHaveClass('line-through')
    expect(title.closest('.text-muted-foreground')).not.toBeNull()
    expect(badge.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('수락한 일정은 배지·취소선 없이 그대로', () => {
    setup()
    const row = screen.getByTestId('calendar-event-2')
    expect(within(row).queryByTestId('calendar-event-declined-badge')).toBeNull()
    expect(row.querySelector('.line-through')).toBeNull()
  })

  it('거절한 일정도 누르면 상세가 열린다', async () => {
    const { onSelectEvent } = setup()
    await userEvent.click(screen.getByTestId('calendar-event-1'))
    expect(onSelectEvent).toHaveBeenCalledWith(declined)
  })
})

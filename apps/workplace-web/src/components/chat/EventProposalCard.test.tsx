// 일정 제안 카드 — 기간 줄과 위임자 편집 칸의 종일 처리(WP-1120).
// 기간 문자열 규칙 자체는 lib/calendar.test.ts(proposalTimeRange)가 지키고, 여기서는 카드가 제안의 종일 여부를 넘겨
// 그 규칙으로 그리는지(예전엔 종일이 「00:00 ~ 00:00」), 편집 칸이 종일을 날짜로 보이고 고친 날짜를 자정 경계로 보내는지 본다.
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'
import type { MessageProposal } from '@/types/messaging'

import { EventProposalCard } from './EventProposalCard'

const base: MessageProposal = {
  id: 1,
  proposedByUserId: 1,
  actionType: 'calendar.create_event',
  status: 'CONFIRMED',
  title: '종일 워크숍',
  priority: null,
  projectName: null,
  projectKey: null,
  candidates: [],
  resultIssueKey: 'event:501',
  startsAt: '2026-11-04T00:00:00Z',
  endsAt: '2026-11-05T00:00:00Z',
  location: null,
  allDay: true,
  conflicts: null,
  attendees: null,
}

function renderCard(proposal: MessageProposal, currentUserId = 1, onConfirm = vi.fn()) {
  renderWithProviders(
    <EventProposalCard proposal={proposal} currentUserId={currentUserId} onConfirm={onConfirm} onReject={() => {}} />,
  )
  return screen.getByTestId(`event-proposal-card-${proposal.id}`)
}

const pending = { ...base, status: 'PENDING' as const, resultIssueKey: null }

describe('EventProposalCard 기간 줄 (WP-1120)', () => {
  it('승인한 종일 제안은 시각 없이 날짜와 (종일)', () => {
    const card = renderCard(base)
    expect(card).toHaveTextContent('2026-11-04 (종일)')
    expect(card).not.toHaveTextContent('09:00')
  })

  it('거부한 이틀 제안은 끝나는 날짜까지', () => {
    const card = renderCard({
      ...base,
      status: 'REJECTED',
      title: '이틀 출장',
      allDay: false,
      startsAt: '2026-11-06T01:00:00Z',
      endsAt: '2026-11-07T03:00:00Z',
    })
    expect(card).toHaveTextContent('2026-11-06 10:00 ~ 11-07 12:00')
  })

  it('남이 보는 확인 대기 블록도 같은 규칙', () => {
    renderCard(pending, 2)
    expect(screen.getByTestId('event-proposal-pending-1')).toHaveTextContent('2026-11-04 (종일)')
  })
})

describe('EventProposalCard 위임자 편집 칸 — 종일 제안 (WP-1120)', () => {
  it('종일 제안은 날짜 칸으로 보이고(종료는 마지막 날), 고치지 않고 승인하면 시작·종료를 보내지 않는다', () => {
    const onConfirm = vi.fn()
    renderCard(pending, 1, onConfirm)
    const starts = screen.getByTestId('event-proposal-starts-1')
    expect(starts).toHaveAttribute('type', 'date')
    expect(starts).toHaveValue('2026-11-04')
    expect(screen.getByTestId('event-proposal-ends-1')).toHaveValue('2026-11-04')
    fireEvent.click(screen.getByTestId('event-proposal-confirm-1'))
    expect(onConfirm).toHaveBeenCalledWith({ title: '종일 워크숍', location: undefined })
  })

  it('종료일을 고치면 현지 자정 경계 [시작일, 마지막 날 + 1) 로 보낸다', () => {
    const onConfirm = vi.fn()
    renderCard(pending, 1, onConfirm)
    fireEvent.change(screen.getByTestId('event-proposal-ends-1'), { target: { value: '2026-11-05' } })
    fireEvent.click(screen.getByTestId('event-proposal-confirm-1'))
    expect(onConfirm).toHaveBeenCalledWith({
      title: '종일 워크숍',
      startsAt: '2026-11-03T15:00:00.000Z',
      endsAt: '2026-11-05T15:00:00.000Z',
      location: undefined,
    })
  })

  it('종료일이 시작일보다 앞서면 승인을 막는다 — 같은 날은 하루 일정이라 막지 않는다', () => {
    renderCard(pending)
    expect(screen.getByTestId('event-proposal-confirm-1')).toBeEnabled()
    fireEvent.change(screen.getByTestId('event-proposal-ends-1'), { target: { value: '2026-11-03' } })
    expect(screen.getByTestId('event-proposal-range-error-1')).toHaveTextContent('종료일은 시작일보다 앞설 수 없습니다')
    expect(screen.getByTestId('event-proposal-confirm-1')).toBeDisabled()
  })

  it('시각 제안은 그대로 시각 칸', () => {
    renderCard({ ...pending, allDay: false, startsAt: '2026-11-06T01:00:00Z', endsAt: '2026-11-07T03:00:00Z' })
    expect(screen.getByTestId('event-proposal-starts-1')).toHaveAttribute('type', 'datetime-local')
    expect(screen.getByTestId('event-proposal-starts-1')).toHaveValue('2026-11-06T10:00')
  })
})

// 개요 카드 리포트 줄(WP-1483) — 「주간 리포트 · 11월 16일 (월) 09:00 · 한 줄」, 「리포트 전체 보기」 링크, 「지난 리포트 ▾」 목록(배지·제목·이번 회차·수정됨,
// 맨 아래 「노트에서 모두 보기」), 최신이 없으면 그리지 않음.
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'
import type { ProjectReportCardResponse } from '@/types/projectReport'

import { OverviewReportLine } from './OverviewReportLine'

// 기준: 2026-11-18 15:00 KST(수).
const NOW = new Date('2026-11-18T06:00:00Z')

const report = (over: Partial<ProjectReportCardResponse> = {}): ProjectReportCardResponse => ({
  latest: {
    pageId: 101,
    title: '11월 3주차 주간 리포트',
    periodStart: '2026-11-09',
    periodEnd: '2026-11-15',
    createdAt: '2026-11-16T00:00:00Z',
    badge: 'WARN',
    line: '검토 대기가 늘어 일정이 밀렸어요.',
    edited: false,
  },
  past: [
    { pageId: 101, title: '11월 3주차 주간 리포트', periodStart: '2026-11-09', badge: 'WARN', edited: false },
    { pageId: 90, title: '11월 2주차 주간 리포트', periodStart: '2026-11-02', badge: 'ON_TRACK', edited: true },
    { pageId: 80, title: '11월 1주차 주간 리포트', periodStart: '2026-10-26', badge: 'RISK', edited: false },
  ],
  reportsPageId: 7,
  cadenceLabel: '주간',
  ...over,
})

const openPast = () => userEvent.click(screen.getByRole('button', { name: /지난 리포트/ }))

describe('OverviewReportLine', () => {
  test('rendersLabelDateAndLine — 「주간 리포트 · 11월 16일 (월) 09:00 · 한 줄」', () => {
    renderWithProviders(<OverviewReportLine report={report()} projectKey="WP" now={NOW} />)
    const line = screen.getByTestId('overview-report-line')
    expect(line).toHaveTextContent('주간 리포트')
    expect(line).toHaveTextContent('11월 16일 (월) 09:00')
    expect(line).toHaveTextContent('검토 대기가 늘어 일정이 밀렸어요.')
    expect(screen.getByTestId('overview-report-summary')).toHaveTextContent(
      '주간 리포트 · 11월 16일 (월) 09:00 · 검토 대기가 늘어 일정이 밀렸어요.',
    )
  })

  test('격주 리포트면 머리 이름도 「격주 리포트」', () => {
    renderWithProviders(<OverviewReportLine report={report({ cadenceLabel: '격주' })} projectKey="WP" now={NOW} />)
    expect(screen.getByTestId('overview-report-summary')).toHaveTextContent('격주 리포트 · 11월 16일 (월) 09:00')
  })

  test('fullReportLinkGoesToNotesTab — 「리포트 전체 보기」는 프로젝트 노트 탭의 그 페이지', () => {
    renderWithProviders(<OverviewReportLine report={report()} projectKey="WP" now={NOW} />)
    expect(screen.getByRole('link', { name: '리포트 전체 보기' })).toHaveAttribute('href', '/projects/WP/notes/101')
  })

  test('pastDropdownListsBadgesAndMarks — 배지 칩·제목, 최신에 「이번 회차」, 고친 것에 「수정됨」', async () => {
    renderWithProviders(<OverviewReportLine report={report()} projectKey="WP" now={NOW} />)
    await openPast()
    const items = screen.getAllByTestId('overview-report-past-item')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('주의')
    expect(items[0]).toHaveTextContent('11월 3주차 주간 리포트')
    expect(items[0]).toHaveTextContent('이번 회차')
    expect(items[0]).not.toHaveTextContent('수정됨')
    expect(items[1]).toHaveTextContent('순조로움')
    expect(items[1]).toHaveTextContent('수정됨')
    expect(items[1]).not.toHaveTextContent('이번 회차')
    expect(items[2]).toHaveTextContent('위험')
    expect(items[1]).toHaveAttribute('href', '/projects/WP/notes/90')
  })

  test('pastDropdownFooterOpensReportsPage — 「노트에서 모두 보기」는 「리포트」 페이지', async () => {
    renderWithProviders(<OverviewReportLine report={report()} projectKey="WP" now={NOW} />)
    await openPast()
    expect(screen.getByRole('menuitem', { name: '노트에서 모두 보기' })).toHaveAttribute('href', '/projects/WP/notes/7')
  })

  test('「리포트」 페이지가 없으면 「노트에서 모두 보기」를 두지 않는다', async () => {
    renderWithProviders(<OverviewReportLine report={report({ reportsPageId: null })} projectKey="WP" now={NOW} />)
    await openPast()
    expect(screen.queryByRole('menuitem', { name: '노트에서 모두 보기' })).not.toBeInTheDocument()
  })

  test('한 줄이 없으면 그 세그먼트를 뺀다', () => {
    const r = report()
    renderWithProviders(<OverviewReportLine report={{ ...r, latest: { ...r.latest!, line: null } }} projectKey="WP" now={NOW} />)
    expect(screen.getByTestId('overview-report-summary').textContent?.trim()).toBe('주간 리포트 · 11월 16일 (월) 09:00')
  })

  test('rendersNothingWhenNoLatest — 최신이 없으면(공간 비멤버·리포트 없음) 아무것도 그리지 않는다', () => {
    const { container } = renderWithProviders(
      <OverviewReportLine report={{ latest: null, past: [], reportsPageId: null, cadenceLabel: null }} projectKey="WP" now={NOW} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

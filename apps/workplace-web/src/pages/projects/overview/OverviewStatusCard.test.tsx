// 프로젝트 개요 맨 위 「프로젝트 상태」 카드(WP-1479) — 배지 문구 셋, 갱신·다음 시각 문구(오늘·다른 날·지난 다음 시각은 뺌), 요약이 없으면 카드 없음.
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'
import type { ProjectStatusSummary } from '@/types/projectOverview'
import type { ProjectReportCardResponse } from '@/types/projectReport'

import { OverviewStatusCard } from './OverviewStatusCard'

// 기준: 2026-11-11 15:00 KST.
const NOW = new Date('2026-11-11T06:00:00Z')

const summary = (over: Partial<ProjectStatusSummary> = {}): ProjectStatusSummary => ({
  badge: 'ON_TRACK',
  summary: '이번 사이클은 예정대로 끝날 것 같아요.',
  checkedAt: '2026-11-11T14:00:00+09:00',
  nextRunAt: '2026-11-11T16:00:00+09:00',
  ...over,
})

describe('OverviewStatusCard', () => {
  test.each([
    ['ON_TRACK', '순조로움'],
    ['WARN', '주의'],
    ['RISK', '위험'],
  ] as const)('배지 %s → 「%s」', (badge, label) => {
    render(<OverviewStatusCard status={summary({ badge })} projectKey="WP" now={NOW} />)
    expect(screen.getByTestId('overview-status-badge')).toHaveTextContent(label)
  })

  test('제목·요약 글과 오늘 시각 문구 「AI 요약 · 오늘 14:00 갱신 · 다음 16:00」', () => {
    render(<OverviewStatusCard status={summary()} projectKey="WP" now={NOW} />)
    const card = screen.getByTestId('overview-status-card')
    expect(card).toHaveTextContent('프로젝트 상태')
    expect(card).toHaveTextContent('이번 사이클은 예정대로 끝날 것 같아요.')
    expect(screen.getByTestId('overview-status-meta')).toHaveTextContent('AI 요약 · 오늘 14:00 갱신 · 다음 16:00')
  })

  test('오늘이 아닌 시각은 날짜를 붙인다', () => {
    render(
      <OverviewStatusCard
        status={summary({ checkedAt: '2026-11-10T14:00:00+09:00', nextRunAt: '2026-11-12T09:00:00+09:00' })}
        projectKey="WP"
        now={NOW}
      />,
    )
    expect(screen.getByTestId('overview-status-meta')).toHaveTextContent('AI 요약 · 11월 10일 14:00 갱신 · 다음 11월 12일 09:00')
  })

  test('다음 점검 시각이 이미 지났으면 「· 다음 …」을 빼고 갱신 시각까지만 보인다', () => {
    // 15:00 기준 — 다음 점검 14:30 은 지났다(곧 다시 살피지만 지난 시각을 「다음」으로 보이지 않는다).
    render(<OverviewStatusCard status={summary({ nextRunAt: '2026-11-11T14:30:00+09:00' })} projectKey="WP" now={NOW} />)
    const meta = screen.getByTestId('overview-status-meta')
    expect(meta).toHaveTextContent('AI 요약 · 오늘 14:00 갱신')
    expect(meta).not.toHaveTextContent('다음')
  })

  test('요약이 없으면(null) 카드를 그리지 않는다', () => {
    const { container } = render(<OverviewStatusCard status={null} projectKey="WP" now={NOW} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('overview-status-card')).not.toBeInTheDocument()
  })
})

describe('OverviewStatusCard 리포트 줄(WP-1483)', () => {
  const report: ProjectReportCardResponse = {
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
    past: [],
    reportsPageId: 7,
    cadenceLabel: '주간',
  }

  test('rendersReportLineWithoutStatusSummary — 상태 요약이 없어도 리포트가 있으면 카드에 리포트 줄만 그린다', () => {
    renderWithProviders(<OverviewStatusCard status={null} report={report} projectKey="WP" now={NOW} />)
    expect(screen.getByTestId('overview-status-card')).toBeInTheDocument()
    expect(screen.getByTestId('overview-report-line')).toHaveTextContent('주간 리포트 · 11월 16일 (월) 09:00')
    expect(screen.queryByTestId('overview-status-badge')).not.toBeInTheDocument()
    expect(screen.queryByText('프로젝트 상태')).not.toBeInTheDocument()
  })

  test('상태 요약과 리포트가 함께면 요약 아래에 리포트 줄', () => {
    renderWithProviders(<OverviewStatusCard status={summary()} report={report} projectKey="WP" now={NOW} />)
    const card = screen.getByTestId('overview-status-card')
    expect(card).toHaveTextContent('프로젝트 상태')
    expect(screen.getByTestId('overview-report-line')).toBeInTheDocument()
  })

  test('최신 리포트가 없으면 리포트 줄을 그리지 않는다', () => {
    renderWithProviders(
      <OverviewStatusCard status={summary()} report={{ ...report, latest: null }} projectKey="WP" now={NOW} />,
    )
    expect(screen.queryByTestId('overview-report-line')).not.toBeInTheDocument()
  })
})

// 관계 한 줄(WP-991) — 상태는 글자 없이 아이콘만 두고, 이름은 aria-label·툴팁(마우스)·팝오버(터치)로 알린다.
// 한 줄 배치·hover 툴팁 같은 기하·실제 호버는 E2E(dependencies.spec 「링크 행은 한 줄로」)가 맡는다.
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import { IssueLinkRow } from './IssueLinkRow'

const coarse = vi.hoisted(() => ({ value: false }))
vi.mock('@/hooks/useIsCoarsePointer', () => ({ useIsCoarsePointer: () => coarse.value }))

const link = {
  number: 5,
  title: '결제 모듈 환불 처리',
  status: 'IN_PROGRESS',
  statusName: '검토 중',
  statusColor: 'PURPLE',
  type: { id: 1, name: 'BUG', colorToken: 'RED', icon: 'Bug' } as const,
}

describe('IssueLinkRow — 상태 표시', () => {
  beforeEach(() => {
    coarse.value = false
  })

  it('상태 이름을 글자로 그리지 않고 상태 아이콘의 이름으로 알린다', () => {
    renderWithProviders(<IssueLinkRow projectKey="WP" link={link} />)
    const row = screen.getByTestId('issue-link-row-5')
    expect(row).not.toHaveTextContent('검토 중')
    expect(screen.getByRole('img', { name: '상태: 검토 중' })).toBeInTheDocument()
  })

  it('상태 이름이 없는 응답이면 범주 라벨로 알린다', () => {
    renderWithProviders(<IssueLinkRow projectKey="WP" link={{ ...link, status: 'DONE', statusName: undefined }} />)
    expect(screen.getByRole('img', { name: '상태: 완료' })).toBeInTheDocument()
  })

  it('마우스 데스크톱: 키보드로 상태 아이콘에 포커스하면 상태 이름 툴팁이 뜬다', async () => {
    renderWithProviders(<IssueLinkRow projectKey="WP" link={link} />)
    await userEvent.tab()
    expect(screen.getByTestId('issue-link-status-5')).toHaveFocus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('검토 중')
  })

  it('터치 기기: 상태 아이콘을 탭하면 상태 이름이 팝오버로 보인다', async () => {
    coarse.value = true
    renderWithProviders(<IssueLinkRow projectKey="WP" link={link} />)
    expect(screen.queryByText('검토 중')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId('issue-link-status-5'))
    expect(await screen.findByText('검토 중')).toBeInTheDocument()
  })
})

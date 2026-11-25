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

// WP-2101 — 관계·차단 줄의 끝난 이슈 제목은 목록·카드와 같은 규칙(WP-2099)으로 흐리게, 취소는 삭선까지.
describe('IssueLinkRow — 끝난 이슈 제목 흐림·삭선', () => {
  beforeEach(() => {
    coarse.value = false
  })

  const titleLink = (status: string) => {
    renderWithProviders(<IssueLinkRow projectKey="WP" link={{ ...link, status, statusName: undefined }} />)
    return screen.getByRole('link', { name: link.title })
  }

  it('완료 줄은 흐리고 호버 때 원래 색이며 삭선은 없다', () => {
    const a = titleLink('DONE')
    expect(a).toHaveClass('text-muted-foreground', 'group-hover:text-foreground')
    expect(a).not.toHaveClass('line-through')
  })

  it('취소 줄은 흐리고 삭선도 있다', () => {
    const canceled = titleLink('CANCELED')
    expect(canceled).toHaveClass('text-muted-foreground', 'group-hover:text-foreground', 'line-through')
    // 호버 밑줄이 삭선을 덮지 않게 둘을 함께 그리는 규칙이 붙는다
    expect(canceled).toHaveClass('hover:[&.line-through]:[text-decoration-line:underline_line-through]')
  })

  it('열린 줄은 흐리지도 삭선되지도 않는다', () => {
    const a = titleLink('TODO')
    expect(a).not.toHaveClass('text-muted-foreground')
    expect(a).not.toHaveClass('line-through')
  })
})

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

// 이슈 상태 선택(WP-808) — 옵션이 프로젝트 상태 이름이고, 고른 상태(ProjectStatus)를 그대로 넘기는지, DONE 범주 전환 시
// 미완료 선행 확인 다이얼로그(#827)가 범주로 판정되는지 지킨다. PATCH 배선은 E2E(issue-list 상세 상태 선택)가 맡는다.
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import type { IssueLinkSummary } from '../../../types/issue'
import type { ProjectStatus } from '../../../types/projectStatus'
import { IssueStatusSelect } from './IssueStatusSelect'

const statuses: ProjectStatus[] = [
  { id: 1, name: '할 일', category: 'TODO', position: 0 },
  { id: 2, name: '진행 중', category: 'IN_PROGRESS', position: 1 },
  { id: 12, name: '검토 중', category: 'IN_PROGRESS', position: 2 },
  { id: 13, name: '배포됨', category: 'DONE', position: 3 },
  { id: 3, name: '완료', category: 'DONE', position: 4 },
  { id: 4, name: '취소', category: 'CANCELED', position: 5 },
]

const blocker: IssueLinkSummary = { number: 7, title: '선행 작업', status: 'IN_PROGRESS' } as IssueLinkSummary

describe('IssueStatusSelect — 프로젝트 상태', () => {
  it('프로젝트 상태 이름을 옵션으로 보이고 고르면 그 상태를 넘긴다', async () => {
    const onChange = vi.fn()
    renderWithProviders(<IssueStatusSelect value={2} statuses={statuses} onChange={onChange} />)
    // 트리거는 현재 상태 이름을 보인다.
    expect(screen.getByTestId('issue-status-select')).toHaveTextContent('진행 중')

    await userEvent.click(screen.getByTestId('issue-status-select'))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      '할 일', '진행 중', '검토 중', '배포됨', '완료', '취소',
    ])
    await userEvent.click(screen.getByRole('option', { name: '검토 중' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].id).toBe(12)
  })

  it('긴 상태 이름은 트리거에서 말줄임 span 으로 감싸고 전체 이름을 title 로 둔다 (WP-808)', () => {
    const long = '고객 확인 및 QA 승인 대기 중인 아주 긴 상태 이름입니다'
    renderWithProviders(
      <IssueStatusSelect value={20} statuses={[...statuses, { id: 20, name: long, category: 'IN_PROGRESS', position: 9 }]} onChange={vi.fn()} />,
    )
    const trigger = screen.getByTestId('issue-status-select')
    expect(trigger).toHaveAttribute('title', long)
    const name = trigger.querySelector('span.truncate')
    expect(name).toHaveTextContent(long)
    expect(name).toHaveClass('min-w-0')
  })

  it('상태 목록 로딩 중에도 응답 이름을 title·말줄임으로 보인다', () => {
    renderWithProviders(<IssueStatusSelect value={12} statuses={[]} currentName="검토 중" onChange={vi.fn()} />)
    const trigger = screen.getByTestId('issue-status-select')
    expect(trigger).toHaveAttribute('title', '검토 중')
    expect(trigger.querySelector('span.truncate')).toHaveTextContent('검토 중')
  })

  it('DONE 범주 상태를 고르고 blockedBy 가 있으면 확인 다이얼로그', async () => {
    const onChange = vi.fn()
    renderWithProviders(
      <IssueStatusSelect value={2} statuses={statuses} onChange={onChange} blockedBy={[blocker]} projectKey="WP" />,
    )
    await userEvent.click(screen.getByTestId('issue-status-select'))
    await userEvent.click(screen.getByRole('option', { name: '배포됨' }))

    // 사용자 정의 DONE 범주 상태도 범주로 판정해 바로 바꾸지 않고 확인을 받는다.
    expect(onChange).not.toHaveBeenCalled()
    expect(await screen.findByTestId('status-done-blocked-dialog')).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('status-done-blocked-confirm'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].id).toBe(13)
  })

  it('상태 목록 로딩 중(빈 목록)이면 트리거에 응답의 상태 이름을 보인다', () => {
    renderWithProviders(<IssueStatusSelect value={12} statuses={[]} currentName="검토 중" onChange={vi.fn()} />)
    expect(screen.getByTestId('issue-status-select')).toHaveTextContent('검토 중')
  })
})

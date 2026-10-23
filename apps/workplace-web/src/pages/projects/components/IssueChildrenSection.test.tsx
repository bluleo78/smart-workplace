// IssueChildrenSection — 하위 목록 조회가 실패하면 진행률(「1/2」)만 남은 빈 목록 대신 실패 안내 + 다시 시도(WP-858).
// 이슈 상세 화면 배선은 subtasks E2E 가 맡고, 여기서는 조회 실패 분기만 본다.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import { IssueChildrenSection } from './IssueChildrenSection'

const searchIssues = vi.hoisted(() => vi.fn())

vi.mock('../../../api/issues', () => ({
  searchIssues,
  issuesApi: { create: vi.fn() },
}))
vi.mock('../../../hooks/queries/useIssueTypes', () => ({
  useIssueTypes: () => ({ data: [] }),
}))
vi.mock('../../../hooks/queries/useProjects', () => ({
  useProject: () => ({ data: undefined }),
}))

const props = {
  projectKey: 'WP',
  parentNumber: 1,
  parentTypeName: 'TASK',
  parentStatus: 'TODO',
  childCount: 2,
  childDoneCount: 1,
}

describe('IssueChildrenSection — 하위 목록 조회 실패', () => {
  beforeEach(() => {
    searchIssues.mockReset()
  })

  it('조회가 실패하면 실패 안내를 보이고, 다시 시도하면 하위 이슈를 그린다', async () => {
    searchIssues.mockRejectedValueOnce(new Error('500')).mockResolvedValueOnce({
      items: [{ id: 10, number: 10, title: '살아 있는 하위', status: 'TODO', type: null, createdAt: '2026-10-22T00:00:00Z', labels: [], assignees: [], agentWork: [] }],
      nextCursor: null,
    })
    renderWithProviders(<IssueChildrenSection {...props} />)

    const error = await screen.findByTestId('children-load-error')
    expect(error).toHaveTextContent('하위 이슈를 불러오지 못했습니다')

    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(screen.getByTestId('child-row-10')).toHaveTextContent('살아 있는 하위'))
    expect(screen.queryByTestId('children-load-error')).not.toBeInTheDocument()
  })
})

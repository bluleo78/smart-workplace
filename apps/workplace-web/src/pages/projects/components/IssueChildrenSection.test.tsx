// IssueChildrenSection — 하위 목록 조회가 실패하면 진행률(「1/2」)만 남은 빈 목록 대신 실패 안내 + 다시 시도(WP-858).
// 이슈 상세 화면 배선은 subtasks E2E 가 맡고, 여기서는 조회 실패 분기와 하위 행 이슈 키(WP-1635)만 본다.
import { screen, waitFor, within } from '@testing-library/react'
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

// WP-1635 — 하위 목록에 제목만 있으면 어느 이슈인지 바로 알 수 없어, 같은 프로젝트 하위 행에도 이슈 키를 보인다.
describe('IssueChildrenSection — 하위 행 이슈 키', () => {
  beforeEach(() => {
    searchIssues.mockReset()
  })

  it('같은 프로젝트 하위 태스크 행에 유형 아이콘과 제목 사이로 이슈 키를 보인다', async () => {
    searchIssues.mockResolvedValueOnce({
      items: [{ id: 12, number: 12, title: '키가 보일 하위', status: 'TODO', type: { id: 3, name: 'SUBTASK', icon: 'ListChecks', colorToken: 'GRAY', system: true }, createdAt: '2026-10-22T00:00:00Z', labels: [], assignees: [], agentWork: [] }],
      nextCursor: null,
    })
    renderWithProviders(<IssueChildrenSection {...props} />)

    const row = await screen.findByTestId('child-row-12')
    const key = within(row).getByTestId('child-row-key')
    expect(key).toHaveTextContent('WP-12')
    // 키는 링크가 아닌 텍스트 — 행의 링크는 제목 하나뿐이다(탭 순서·스크린리더 중복 방지).
    expect(within(row).getAllByRole('link')).toHaveLength(1)
    expect(key.compareDocumentPosition(within(row).getByRole('link', { name: '키가 보일 하위' }))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    // 유형 아이콘 → 키 순서 — 아이콘이 키보다 앞에 온다.
    expect(within(row).getByTestId('issue-type-badge-3').compareDocumentPosition(key)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })
})

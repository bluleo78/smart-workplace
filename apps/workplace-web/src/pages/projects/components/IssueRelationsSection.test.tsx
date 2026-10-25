// 이슈 「관계」 그룹 본문 — 편집 권한 분기(WP-503 을 잇는다)와 묶음 표시(WP-887).
// 서버는 멤버만 관계·의존성·외부 링크를 바꾸게 한다. 비멤버(disabled)에겐 제거·수정 조작을 그리지 않아 누른 뒤 403 을 받는 일이 없게 한다.
// 화면 배선(그룹 머리 「＋ 관계 추가」가 사라지는지)은 E2E(open-issue-permissions)가 맡는다(WP-413).
import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import type { IssueExternalLinkView, IssueLinkSummary, IssueRelationView } from '../../../types/issue'
import { IssueRelationsSection } from './IssueRelationsSection'

vi.mock('../../../hooks/queries/useIssueDependencies', () => ({
  useAddIssueDependency: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveIssueDependency: () => ({ mutate: vi.fn() }),
}))
vi.mock('../../../hooks/queries/useIssueRelations', () => ({
  useAddIssueRelation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveIssueRelation: () => ({ mutate: vi.fn() }),
  useAddIssueExternalLink: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateIssueExternalLink: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveIssueExternalLink: () => ({ mutate: vi.fn() }),
  useIssueLookup: () => ({ data: [], isFetching: false, isError: false }),
}))
vi.mock('../../../hooks/queries/useIssueRelationTypes', () => ({
  useIssueRelationTypes: () => ({ data: undefined, isError: false }),
}))
vi.mock('@/hooks/useIsCoarsePointer', () => ({ useIsCoarsePointer: () => false }))

const type = { id: 1, name: 'TASK', colorToken: 'BLUE', icon: 'Circle' } as const

const link = {
  number: 3,
  title: '선행 작업',
  status: 'IN_PROGRESS',
  dueDate: null,
  type,
} as IssueLinkSummary

const relation: IssueRelationView = {
  id: 9,
  typeId: 2,
  typeCode: 'RELATES',
  label: '관련',
  side: 'source',
  issue: { projectKey: 'WPV', number: 28, title: '다른 프로젝트 이슈', status: 'TODO', type },
}

const external: IssueExternalLinkView = {
  id: 5,
  typeId: 6,
  typeCode: 'PARENT_EPIC',
  label: '에픽에 속함',
  side: 'source',
  url: 'https://iacloud.atlassian.net/browse/CL-1867',
  key: 'CL-1867',
  title: 'v1.7.0 버그 픽스',
}

function renderSection(disabled: boolean, overrides: Partial<Parameters<typeof IssueRelationsSection>[0]> = {}) {
  return renderWithProviders(
    <IssueRelationsSection
      projectKey="OPNQA"
      issueNumber={1}
      blockedBy={[link]}
      blocks={[]}
      relations={[relation]}
      externalLinks={[external]}
      disabled={disabled}
      {...overrides}
    />,
  )
}

describe('IssueRelationsSection — 편집 권한', () => {
  it('편집 가능(멤버): 차단·관계·외부 링크 줄에 제거·수정 조작이 있다', () => {
    renderSection(false)
    expect(screen.getByTestId('issue-link-remove-3')).toBeInTheDocument()
    expect(screen.getByTestId('issue-relation-remove-9')).toBeInTheDocument()
    expect(screen.getByTestId('issue-external-link-edit-5')).toBeInTheDocument()
    expect(screen.getByTestId('issue-external-link-remove-5')).toBeInTheDocument()
  })

  it('편집 불가(OPEN 비멤버): 줄은 그대로 보이고 제거·수정 조작은 없다', () => {
    renderSection(true)
    expect(screen.getByTestId('issue-link-row-3')).toHaveTextContent('선행 작업')
    expect(screen.getByTestId('issue-relation-row-9')).toHaveTextContent('다른 프로젝트 이슈')
    expect(screen.getByTestId('issue-external-link-row-5')).toHaveTextContent('v1.7.0 버그 픽스')
    expect(screen.queryByTestId('issue-link-remove-3')).not.toBeInTheDocument()
    expect(screen.queryByTestId('issue-relation-remove-9')).not.toBeInTheDocument()
    expect(screen.queryByTestId('issue-external-link-edit-5')).not.toBeInTheDocument()
    expect(screen.queryByTestId('issue-external-link-remove-5')).not.toBeInTheDocument()
  })
})

describe('IssueRelationsSection — 묶음 표시', () => {
  it('줄이 있는 묶음만 그리고, 같은 프로젝트는 #번호 · 다른 프로젝트는 키로 보인다', () => {
    renderSection(false)
    // 차단됨만 있고 차단 중은 비어 있어 「차단 중」 묶음이 없다.
    expect(screen.getByTestId('blocked-by-list')).toBeInTheDocument()
    expect(screen.queryByTestId('blocks-list')).not.toBeInTheDocument()
    expect(screen.getByText('차단됨 (선행 필요)')).toBeInTheDocument()
    expect(screen.queryByText('차단 중')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('issue-link-row-3')).getByText('#3')).toBeInTheDocument()
    expect(within(screen.getByTestId('issue-relation-row-9')).getByText('WPV-28')).toBeInTheDocument()
    expect(within(screen.getByTestId('issue-relation-row-9')).getByRole('link')).toHaveAttribute(
      'href',
      '/projects/WPV/issues/28',
    )
  })

  it('외부 링크는 말·키·제목을 보이고 새 탭으로 연다(opener 를 끊는다)', () => {
    renderSection(false)
    const row = screen.getByTestId('issue-external-link-row-5')
    expect(row).toHaveTextContent('에픽에 속함')
    expect(row).toHaveTextContent('CL-1867')
    const a = within(row).getByRole('link')
    expect(a).toHaveAttribute('href', external.url)
    expect(a).toHaveAttribute('target', '_blank')
    expect(a).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('아무 관계도 없으면 「없음」 한 줄', () => {
    renderSection(false, { blockedBy: [], relations: [], externalLinks: [] })
    expect(screen.getByTestId('issue-relations-section')).toHaveTextContent('없음')
    expect(screen.queryByTestId('blocked-by-list')).not.toBeInTheDocument()
  })
})

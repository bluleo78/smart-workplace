// 의존성 섹션 편집 권한 분기(WP-503) — 서버는 멤버만 의존성 추가·제거를 허용한다. 비멤버(disabled)에겐 추가 버튼을 막고
// 제거 조작을 그리지 않아 누른 뒤 403 을 받는 일이 없게 한다. 화면 배선은 E2E(open-issue-permissions)가 맡는다(WP-413).
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import type { IssueLinkSummary } from '../../../types/issue'
import { IssueDependenciesSection } from './IssueDependenciesSection'

vi.mock('../../../hooks/queries/useIssueDependencies', () => ({
  useAddIssueDependency: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveIssueDependency: () => ({ mutate: vi.fn() }),
}))
vi.mock('@/hooks/useIsCoarsePointer', () => ({ useIsCoarsePointer: () => false }))

const link = {
  number: 3,
  title: '선행 작업',
  status: 'IN_PROGRESS',
  dueDate: null,
  type: { id: 1, name: 'TASK', colorToken: 'BLUE', icon: 'Circle' },
} as IssueLinkSummary

function renderSection(disabled: boolean) {
  return renderWithProviders(
    <IssueDependenciesSection projectKey="OPNQA" issueNumber={1} blockedBy={[link]} blocks={[]} disabled={disabled} />,
  )
}

describe('IssueDependenciesSection — 편집 권한', () => {
  it('편집 가능(멤버): 추가 버튼이 켜져 있고 행에 제거 버튼이 있다', () => {
    renderSection(false)
    expect(screen.getByTestId('issue-link-picker-trigger-blockedBy')).toBeEnabled()
    expect(screen.getByTestId('issue-link-picker-trigger-blocks')).toBeEnabled()
    expect(screen.getByTestId('issue-link-remove-3')).toBeInTheDocument()
  })

  it('편집 불가(OPEN 비멤버): 추가 버튼은 꺼지고 제거 버튼은 없다 — 연결된 이슈는 그대로 보인다', () => {
    renderSection(true)
    expect(screen.getByTestId('issue-link-picker-trigger-blockedBy')).toBeDisabled()
    expect(screen.getByTestId('issue-link-picker-trigger-blocks')).toBeDisabled()
    expect(screen.getByTestId('issue-link-row-3')).toHaveTextContent('선행 작업')
    expect(screen.queryByTestId('issue-link-remove-3')).not.toBeInTheDocument()
  })
})

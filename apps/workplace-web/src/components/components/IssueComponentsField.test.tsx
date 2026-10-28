// IssueComponentsField(WP-933) 모드 분기 — 사용 중 구성요소가 없으면 칸이 없고, 보관된 값만 붙은 이슈는 읽기 전용(피커 없음),
// 사용 중인 것이 있으면 값이 없을 때 줄 전체 「＋ 추가」·값이 있으면 칩 뒤 「＋」(권한 없으면 값만, WP-1079). 실제 저장 배선은 E2E 가 맡는다.
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import type { ComponentResponse } from '../../types/component'
import { IssueComponentsField } from './IssueComponentsField'

const state = vi.hoisted(() => ({ data: [] as unknown[] }))

vi.mock('@/hooks/queries/useComponents', () => ({
  useComponents: () => ({ isSuccess: true, data: state.data }),
  useUpdateIssueComponents: () => ({ mutate: vi.fn(), isPending: false }),
}))

const comp = (id: number, name: string, archived = false): ComponentResponse => ({
  id, name, description: null, defaultAssignee: null, defaultAssigneeValid: true, archived, issueCount: 0,
})

describe('IssueComponentsField', () => {
  beforeEach(() => {
    state.data = []
  })

  it('사용 중 구성요소가 없고 붙은 것도 없으면 그리지 않는다', () => {
    state.data = [comp(1, 'Old', true)]
    renderWithProviders(<IssueComponentsField projectKey="WP" issueNumber={1} current={[]} />)
    expect(screen.queryByTestId('issue-components-field')).not.toBeInTheDocument()
  })

  it('보관된 값만 붙은 이슈는 값만 읽기 전용으로 보인다(피커 없음)', () => {
    state.data = [comp(1, 'Old', true)]
    renderWithProviders(
      <IssueComponentsField projectKey="WP" issueNumber={1} current={[{ id: 1, name: 'Old', archived: true }]} />,
    )
    expect(screen.getByTestId('issue-components')).toHaveTextContent('Old')
    expect(screen.queryByTestId('component-picker-trigger')).not.toBeInTheDocument()
  })

  it('사용 중 구성요소가 있으면 값이 없을 때 줄 전체가 「＋ 추가」, 값이 있으면 칩 뒤 「＋」(WP-1079)', () => {
    state.data = [comp(1, 'Compute')]
    const { unmount } = renderWithProviders(<IssueComponentsField projectKey="WP" issueNumber={1} current={[]} />)
    expect(screen.getByTestId('component-picker-trigger')).toHaveTextContent('추가')
    unmount()
    renderWithProviders(<IssueComponentsField projectKey="WP" issueNumber={1} current={[{ id: 1, name: 'Compute', archived: false }]} />)
    expect(screen.getByTestId('issue-components')).toContainElement(screen.getByTestId('component-picker-trigger'))
  })

  it('권한이 없으면 고르기 없이 값만 — 비어 있으면 「없음」', () => {
    state.data = [comp(1, 'Compute')]
    renderWithProviders(<IssueComponentsField projectKey="WP" issueNumber={1} current={[]} disabled />)
    expect(screen.getByTestId('issue-components')).toHaveTextContent('없음')
    expect(screen.queryByTestId('component-picker-trigger')).not.toBeInTheDocument()
  })
})

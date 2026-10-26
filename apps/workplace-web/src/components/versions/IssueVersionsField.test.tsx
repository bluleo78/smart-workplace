// IssueVersionsField(WP-888) — 보관 안 된 버전이 없으면 줄이 없고, 보관된 값만 붙은 이슈는 읽기 전용(피커 없음),
// 있으면 칩 + 피커(권한 없으면 비활성). 칩은 버전 상세 링크. 실제 저장 배선은 E2E 가 맡는다.
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import type { VersionResponse } from '../../types/version'
import { IssueVersionsField } from './IssueVersionsField'

const state = vi.hoisted(() => ({ data: [] as unknown[] }))

vi.mock('@/hooks/queries/useVersions', () => ({
  useVersions: () => ({ isSuccess: true, data: state.data }),
  useUpdateIssueVersions: () => ({ mutate: vi.fn(), isPending: false }),
}))

const ver = (id: number, name: string, status: VersionResponse['status'] = 'UNRELEASED'): VersionResponse => ({
  id, name, description: null, startDate: null, releaseDate: null, status, releasedAt: null,
  progress: { done: 0, inProgress: 0, todo: 0 }, affectsCount: 0,
})

describe('IssueVersionsField', () => {
  beforeEach(() => {
    state.data = []
  })

  it('보관 안 된 버전이 없고 붙은 것도 없으면 그리지 않는다', () => {
    state.data = [ver(1, 'Old', 'ARCHIVED')]
    renderWithProviders(<IssueVersionsField projectKey="WP" issueNumber={1} kind="fix" current={[]} />)
    expect(screen.queryByTestId('issue-fix-versions-field')).not.toBeInTheDocument()
  })

  it('보관된 값만 붙은 이슈는 값만 읽기 전용으로 보인다(피커 없음)', () => {
    state.data = [ver(1, 'Old', 'ARCHIVED')]
    renderWithProviders(
      <IssueVersionsField projectKey="WP" issueNumber={1} kind="affects" current={[{ id: 1, name: 'Old', status: 'ARCHIVED' }]} />,
    )
    expect(screen.getByTestId('issue-affects-versions')).toHaveTextContent('Old')
    expect(screen.getByText('영향 버전')).toBeInTheDocument()
    expect(screen.queryByTestId('affects-version-picker-trigger')).not.toBeInTheDocument()
  })

  it('보관 안 된 버전이 있으면 피커가 있고, 권한이 없으면 비활성', () => {
    state.data = [ver(1, '1.0')]
    renderWithProviders(<IssueVersionsField projectKey="WP" issueNumber={1} kind="fix" current={[]} disabled />)
    expect(screen.getByTestId('issue-fix-versions')).toHaveTextContent('없음')
    expect(screen.getByTestId('fix-version-picker-trigger')).toBeDisabled()
  })

  it('칩을 누르면 버전 상세로 가는 링크다', () => {
    state.data = [ver(7, '1.0')]
    renderWithProviders(
      <IssueVersionsField projectKey="WP" issueNumber={1} kind="fix" current={[{ id: 7, name: '1.0', status: 'UNRELEASED' }]} />,
    )
    expect(screen.getByTestId('version-chip-7')).toHaveAttribute('href', '/projects/WP/versions/7')
  })
})

// IssueVersionsField(WP-888) — 보관 안 된 버전이 없으면 줄이 없고, 보관된 값만 붙은 이슈는 읽기 전용(피커 없음),
// 있으면 값이 없을 때 줄 전체 「＋ 추가」·값이 있으면 칩 뒤 「＋」(권한 없으면 고르기 없이 값만, WP-1079). 칩은 버전 상세 링크. 실제 저장 배선은 E2E 가 맡는다.
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

  it('보관 안 된 버전이 있으면 값이 없을 때 줄 전체가 「＋ 추가」, 값이 있으면 칩 뒤 「＋」', () => {
    state.data = [ver(1, '1.0'), ver(2, '1.1')]
    const { unmount } = renderWithProviders(<IssueVersionsField projectKey="WP" issueNumber={1} kind="fix" current={[]} />)
    expect(screen.getByTestId('fix-version-picker-trigger')).toHaveTextContent('추가')
    expect(screen.getByTestId('issue-fix-versions')).not.toHaveTextContent('없음')
    unmount()
    renderWithProviders(
      <IssueVersionsField projectKey="WP" issueNumber={1} kind="fix" current={[{ id: 1, name: '1.0', status: 'UNRELEASED' }]} />,
    )
    const values = screen.getByTestId('issue-fix-versions')
    expect(values).toHaveTextContent('1.0')
    expect(values).toContainElement(screen.getByTestId('fix-version-picker-trigger'))
    expect(screen.getByTestId('fix-version-picker-trigger')).not.toHaveTextContent('추가')
  })

  it('권한이 없으면 고르기 없이 값만 — 비어 있으면 「없음」', () => {
    state.data = [ver(1, '1.0')]
    renderWithProviders(<IssueVersionsField projectKey="WP" issueNumber={1} kind="fix" current={[]} disabled />)
    expect(screen.getByTestId('issue-fix-versions')).toHaveTextContent('없음')
    expect(screen.queryByTestId('fix-version-picker-trigger')).not.toBeInTheDocument()
  })

  it('칩을 누르면 버전 상세로 가는 링크다', () => {
    state.data = [ver(7, '1.0')]
    renderWithProviders(
      <IssueVersionsField projectKey="WP" issueNumber={1} kind="fix" current={[{ id: 7, name: '1.0', status: 'UNRELEASED' }]} />,
    )
    expect(screen.getByTestId('version-chip-7')).toHaveAttribute('href', '/projects/WP/versions/7')
  })
})

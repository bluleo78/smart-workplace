// MemberManagement 모드 분기 — 개인 프로젝트(agentOnly)는 「AI 어시스턴트」 섹션·추가 버튼·역할 선택 없음,
// 팀 프로젝트는 「멤버」 섹션·「멤버 추가」·역할 선택(#418). 설정 페이지 배선과 POST payload 는
// E2E(project-members @smoke)가 맡는다(WP-413).
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import { MemberManagement } from './MemberManagement'

vi.mock('@/hooks/queries/useProjectMembers', () => {
  const mutation = { mutateAsync: vi.fn() }
  return {
    useProjectMembers: () => ({ isLoading: false, data: [] }),
    useAddMember: () => mutation,
    useUpdateMemberRole: () => mutation,
    useRemoveMember: () => mutation,
  }
})
// picker 는 닫힌 상태라 조회하지 않지만, 훅 자체는 렌더마다 불리므로 빈 결과로 끊는다.
vi.mock('@/hooks/queries/useUserSearch', () => ({
  useUserSearch: () => ({ isLoading: false, isError: false, data: { content: [] } }),
}))

describe('MemberManagement — 개인/팀 프로젝트 모드', () => {
  it('agentOnly(개인 프로젝트): 「AI 어시스턴트」 헤딩·추가 버튼, 「멤버」 헤딩·역할 선택 없음', () => {
    renderWithProviders(<MemberManagement projectKey="MY" agentOnly />)
    expect(screen.getByRole('heading', { name: 'AI 어시스턴트' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '멤버' })).not.toBeInTheDocument()
    expect(screen.getByTestId('member-add-trigger')).toHaveTextContent('AI 어시스턴트 추가')
    expect(screen.queryByLabelText('역할')).not.toBeInTheDocument()
  })

  it('팀 프로젝트: 「멤버」 헤딩·「멤버 추가」 버튼·역할 선택', () => {
    renderWithProviders(<MemberManagement projectKey="WP" />)
    expect(screen.getByRole('heading', { name: '멤버' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'AI 어시스턴트' })).not.toBeInTheDocument()
    expect(screen.getByTestId('member-add-trigger')).toHaveTextContent('멤버 추가')
    expect(screen.getByLabelText('역할')).toBeInTheDocument()
  })
})

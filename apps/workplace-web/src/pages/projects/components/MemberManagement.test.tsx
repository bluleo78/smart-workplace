// MemberManagement 모드 분기 — 개인 프로젝트(agentOnly)는 「AI 어시스턴트」 섹션·추가 버튼·역할 선택 없음(추가·멤버 행 모두),
// 팀 프로젝트는 「멤버」 섹션·「멤버 추가」·역할 선택(#418). 설정 페이지 배선과 POST payload 는
// E2E(project-members @smoke)가 맡는다(WP-413).
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { useUserSearchInfinite } from '@/hooks/queries/useUserSearch'
import { renderWithProviders } from '@/test/renderWithProviders'

import { MemberManagement } from './MemberManagement'

// 테스트마다 바꿔 넣는 멤버 목록 — vi.mock 팩토리가 끌어올려지므로 hoisted 로 공유한다.
const membersState = vi.hoisted(() => ({ data: [] as unknown[] }))

vi.mock('@/hooks/queries/useProjectMembers', () => {
  const mutation = { mutateAsync: vi.fn() }
  return {
    useProjectMembers: () => ({ isLoading: false, data: membersState.data }),
    useAddMember: () => mutation,
    useUpdateMemberRole: () => mutation,
    useRemoveMember: () => mutation,
    // 멤버 부서(WP-1057) — 이 파일은 모드 분기만 보므로 부서는 없다. 부서 행은 MemberManagementDepartments.test.tsx 가 본다.
    useProjectMemberGroups: () => ({ isLoading: false, data: [] }),
    useAddMemberGroup: () => mutation,
    useRemoveMemberGroup: () => mutation,
  }
})
// picker 는 닫힌 상태라 조회하지 않지만, 훅 자체는 렌더마다 불리므로 빈 결과로 끊는다.
// 이어 받기 훅 stub — satisfies 로 실제 반환 모양과 어긋나면(필드 이름 변경 등) 타입 검사에서 걸리게 한다.
// trimPickerPages 는 한 번만 만들어 창 닫힘 effect 가 렌더마다 다시 돌지 않게 한다.
vi.mock('@/hooks/queries/useUserSearch', () => {
  const infinite = {
    isLoading: false,
    isError: false,
    data: undefined,
    candidates: [],
    hasNextPage: false,
    trimPickerPages: () => {},
  } satisfies Partial<ReturnType<typeof useUserSearchInfinite>>
  return {
    useUserSearch: () => ({ isLoading: false, isError: false, data: { content: [] } }),
    useUserSearchInfinite: () => infinite,
  }
})

describe('MemberManagement — 개인/팀 프로젝트 모드', () => {
  beforeEach(() => {
    membersState.data = []
  })

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

  // WP-856: 개인 프로젝트의 역할은 고정(주인 = 소유자, AI = 멤버)이라 멤버 행에도 역할 선택을 두지 않고 글자로만 보인다.
  // 주인은 제거할 수도 없어 제거 버튼을 두지 않는다.
  it('agentOnly(개인 프로젝트): 멤버 행의 역할은 선택 없이 글자로만, 주인은 제거 버튼 없음', () => {
    membersState.data = [
      { userId: 1, username: 'me', name: '나', kind: 'HUMAN', role: 'OWNER', active: true },
      { userId: 2, username: 'bot', name: '봇', kind: 'AGENT', role: 'MEMBER', active: true },
    ]
    renderWithProviders(<MemberManagement projectKey="MY" agentOnly ownerId={1} />)
    expect(screen.queryByRole('combobox', { name: '나 역할' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '봇 역할' })).not.toBeInTheDocument()
    expect(screen.getByTestId('member-role-1')).toHaveTextContent('소유자')
    expect(screen.getByTestId('member-role-2')).toHaveTextContent('멤버')
    // 주인(사람)은 제거할 수 없어 제거 버튼이 없고, AI 는 제거할 수 있다.
    expect(screen.queryByTestId('member-remove-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('member-remove-2')).toBeInTheDocument()
  })

  it('팀 프로젝트: 멤버 행에 역할 선택', () => {
    membersState.data = [
      { userId: 1, username: 'me', name: '나', kind: 'HUMAN', role: 'OWNER', active: true },
    ]
    renderWithProviders(<MemberManagement projectKey="WP" />)
    expect(screen.getByRole('combobox', { name: '나 역할' })).toBeInTheDocument()
  })
})

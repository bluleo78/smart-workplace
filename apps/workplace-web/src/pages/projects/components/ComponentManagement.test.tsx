// ComponentManagement(WP-933) 권한·빈 상태 분기 — OWNER/ADMIN(canManage)은 추가·편집·보관 버튼, 멤버는 읽기 전용,
// 비어 있으면 안내 문구, 보관된 것은 「보관한 구성요소 N개 보기」 접기 안, 무효 담당자는 경고.
// 설정 페이지 배선·요청 payload 는 E2E 가 맡는다(WP-413).
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import type { ComponentResponse } from '../../../types/component'
import { ComponentManagement } from './ComponentManagement'

const state = vi.hoisted(() => ({ data: [] as unknown[] }))

vi.mock('@/hooks/queries/useComponents', () => {
  const mutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }
  return {
    useComponents: () => ({ isLoading: false, isSuccess: true, data: state.data }),
    useCreateComponent: () => mutation,
    useUpdateComponent: () => mutation,
    useDeleteComponent: () => mutation,
  }
})
vi.mock('@/hooks/queries/useProjectMembers', () => ({
  useProjectMembers: () => ({ isLoading: false, data: [] }),
}))

const comp = (id: number, name: string, extra: Partial<ComponentResponse> = {}): ComponentResponse => ({
  id, name, description: null, defaultAssignee: null, defaultAssigneeValid: true, archived: false, issueCount: 0, ...extra,
})

describe('ComponentManagement', () => {
  beforeEach(() => {
    state.data = []
  })

  it('비어 있으면 안내 문구를 보인다', () => {
    renderWithProviders(<ComponentManagement projectKey="WP" canManage />)
    expect(
      screen.getByText('영역별로 이슈를 나누고 영역 담당자를 자동으로 붙여요. 구성요소를 추가하면 이슈에 칸이 생겨요.'),
    ).toBeInTheDocument()
  })

  it('OWNER/ADMIN 은 추가·편집·보관 버튼이 있다', () => {
    state.data = [comp(1, 'Compute', { issueCount: 3 })]
    renderWithProviders(<ComponentManagement projectKey="WP" canManage />)
    expect(screen.getByTestId('component-add')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Compute 편집' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Compute 보관' })).toBeInTheDocument()
    expect(screen.getByTestId('component-row-1')).toHaveTextContent('3')
  })

  it('멤버(관리 권한 없음)는 읽기 전용 — 추가·편집·보관 버튼이 없다', () => {
    state.data = [comp(1, 'Compute')]
    renderWithProviders(<ComponentManagement projectKey="WP" canManage={false} />)
    expect(screen.getByTestId('component-row-1')).toHaveTextContent('Compute')
    expect(screen.queryByTestId('component-add')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Compute 편집' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Compute 보관' })).not.toBeInTheDocument()
  })

  it('보관한 구성요소는 접어 두고 「보관한 구성요소 N개 보기」로 펼치면 복원·삭제가 보인다', () => {
    state.data = [comp(1, 'Compute'), comp(2, 'Legacy', { archived: true })]
    renderWithProviders(<ComponentManagement projectKey="WP" canManage />)
    expect(screen.queryByTestId('component-row-2')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '보관한 구성요소 1개 보기' }))
    expect(screen.getByTestId('component-row-2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Legacy 복원' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Legacy 삭제' })).toBeInTheDocument()
  })

  it('담당자가 구성원이 아니게 되면 경고를 보인다', () => {
    state.data = [
      comp(1, 'Compute', {
        defaultAssignee: { id: 9, username: 'gone', name: '떠난 사람', kind: 'HUMAN' },
        defaultAssigneeValid: false,
      }),
    ]
    renderWithProviders(<ComponentManagement projectKey="WP" canManage />)
    expect(screen.getByText('프로젝트 구성원이 아니에요 — 자동 지정을 건너뛰어요')).toBeInTheDocument()
  })
})

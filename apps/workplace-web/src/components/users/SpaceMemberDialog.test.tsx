// 공간 멤버 다이얼로그 분기(WP-582) — 소유자/비소유자 노출, 마지막 소유자 잠금, 역할 변경·제거가 넘기는 값.
// 실제 API 배선(추가 POST·목록 반영)은 노트·드라이브 E2E 가 화면별 1건씩 맡는다.
import { fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SpaceMember } from '@/lib/spaceRoles'
import { renderWithProviders } from '@/test/renderWithProviders'

import { SpaceMemberDialog } from './SpaceMemberDialog'

// 멤버 검색 훅은 끊는다 — 다이얼로그 분기만 본다.
vi.mock('@/hooks/queries/useUserSearch', () => ({
  useUserSearch: () => ({ isLoading: false, isError: false, data: { content: [] } }),
}))

const onAdd = vi.fn()
const onChangeRole = vi.fn()
const onRemove = vi.fn()
const onOpenChange = vi.fn()

function renderDialog(members: SpaceMember[], canManage: boolean, ownerId = 1) {
  return renderWithProviders(
    <SpaceMemberDialog
      open
      onOpenChange={onOpenChange}
      spaceName="제품기획팀"
      ownerId={ownerId}
      members={members}
      canManage={canManage}
      roleHint="편집자는 고칠 수 있어요."
      removeHint={(name) => `${name} 제거 안내`}
      onAdd={onAdd}
      onChangeRole={onChangeRole}
      onRemove={onRemove}
      testIdPrefix="drive"
    />,
  )
}

// renderWithProviders 의 로그인 사용자는 id 1.
const ME_OWNER: SpaceMember = { userId: 1, name: '나', role: 'OWNER' }
const EDITOR: SpaceMember = { userId: 2, name: '김민지', role: 'EDITOR' }
const VIEWER: SpaceMember = { userId: 3, name: '이하은', role: 'VIEWER' }

describe('SpaceMemberDialog', () => {
  beforeEach(() => {
    onAdd.mockReset()
    onChangeRole.mockReset()
    onRemove.mockReset()
    onOpenChange.mockReset()
  })

  it('소유자가 아니면 명단과 한국어 역할만 보이고, 추가·변경·제거는 없다', () => {
    renderDialog([ME_OWNER, EDITOR, VIEWER], false)
    expect(screen.getByText('멤버 3명')).toBeInTheDocument()
    expect(screen.getByTestId('drive-member-role-1')).toHaveTextContent('소유자')
    expect(screen.getByTestId('drive-member-role-2')).toHaveTextContent('편집자')
    expect(screen.getByTestId('drive-member-role-3')).toHaveTextContent('보기 전용')
    expect(screen.queryByTestId('drive-member-add-trigger')).not.toBeInTheDocument()
    expect(screen.queryByTestId('drive-member-role-select-2')).not.toBeInTheDocument()
    expect(screen.queryByTestId('drive-member-remove-2')).not.toBeInTheDocument()
  })

  it('내 행에는 (나) 표시가 붙는다', () => {
    renderDialog([ME_OWNER, EDITOR], false)
    expect(within(screen.getByTestId('drive-member-row-1')).getByText('(나)')).toBeInTheDocument()
    expect(within(screen.getByTestId('drive-member-row-2')).queryByText('(나)')).not.toBeInTheDocument()
  })

  it('소유자가 한 명뿐이면 그 사람의 역할 변경·제거를 막고, 다른 멤버는 바꿀 수 있다', () => {
    renderDialog([ME_OWNER, EDITOR], true)
    expect(screen.getByTestId('drive-member-add-trigger')).toBeInTheDocument()
    expect(screen.getByTestId('drive-member-role-select-1')).toBeDisabled()
    expect(screen.getByTestId('drive-member-remove-1')).toBeDisabled()
    expect(screen.getByTestId('drive-member-role-select-2')).toBeEnabled()
    expect(screen.getByTestId('drive-member-remove-2')).toBeEnabled()
  })

  it('소유자가 둘이면 내 행(=생성자)만 막히고, 다른 소유자는 바꿀 수 있다', () => {
    renderDialog([ME_OWNER, { userId: 4, name: '정도윤', role: 'OWNER' }], true, 1)
    expect(screen.getByTestId('drive-member-role-select-1')).toBeDisabled()
    expect(screen.getByTestId('drive-member-role-select-4')).toBeEnabled()
  })

  it('생성자 행은 내가 아니어도, 소유자가 여럿이어도 막힌다(WP-656)', () => {
    renderDialog(
      [{ userId: 9, name: '만든이', role: 'OWNER' }, { userId: 4, name: '정도윤', role: 'OWNER' }, EDITOR],
      true,
      9,
    )
    expect(screen.getByTestId('drive-member-role-select-9')).toBeDisabled()
    expect(screen.getByTestId('drive-member-role-select-4')).toBeEnabled()
  })

  it('역할을 고르면 그 멤버와 새 역할을 넘긴다', () => {
    renderDialog([ME_OWNER, EDITOR], true)
    fireEvent.change(screen.getByTestId('drive-member-role-select-2'), { target: { value: 'VIEWER' } })
    expect(onChangeRole).toHaveBeenCalledWith(2, 'VIEWER')
  })

  it('제거는 확인 뒤에만 넘기고, 확인 문구에 이름이 들어간다', () => {
    renderDialog([ME_OWNER, EDITOR], true)
    fireEvent.click(screen.getByTestId('drive-member-remove-2'))
    expect(screen.getByText('김민지 제거 안내')).toBeInTheDocument()
    expect(onRemove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('drive-member-remove-confirm'))
    expect(onRemove).toHaveBeenCalledWith(2)
    // 다른 사람을 뺄 때는 창을 그대로 둔다.
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('부서 멤버를 넘기지 않으면 부서 행·조직 수 없이 예전 사람 검색 창을 쓴다(WP-1052)', () => {
    renderDialog([ME_OWNER, EDITOR, VIEWER], true)
    expect(screen.getByTestId('drive-member-count')).toHaveTextContent(/^멤버 3명$/)
    expect(screen.queryByTestId(/drive-member-group-/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('drive-member-add-trigger'))
    // 사람만 고르는 예전 창(MemberSearchPopover) — 사람·조직 공통 선택 창은 열리지 않는다.
    expect(screen.getByTestId('member-search-popover')).toBeInTheDocument()
    expect(screen.queryByTestId('drive-member-picker-search')).not.toBeInTheDocument()
    expect(screen.queryByTestId('share-target-search')).not.toBeInTheDocument()
  })

  it('소유자가 둘이어도 내 행 제거는 막혀 스스로 뺄 수 없다(WP-656)', () => {
    renderDialog([ME_OWNER, { userId: 4, name: '정도윤', role: 'OWNER' }], true, 1)
    expect(screen.getByTestId('drive-member-remove-1')).toBeDisabled()
  })

  // WP-1102 — 실효 역할은 직접 역할과 부서 역할 중 높은 쪽. 직접 역할을 낮춰도 부서로 더 높으면 사람 행에 「조직으로 …」를 보인다.
  it('부서 역할이 직접 역할보다 높을 때만 사람 행에 「조직으로 편집자」를 보인다', () => {
    renderDialog(
      [
        ME_OWNER,
        { ...VIEWER, departmentRole: 'EDITOR' },
        { ...EDITOR, departmentRole: 'VIEWER' },
        { userId: 4, name: '정도윤', role: 'EDITOR', departmentRole: 'EDITOR' },
      ],
      true,
    )
    expect(screen.getByTestId('drive-member-department-role-3')).toHaveTextContent('조직으로 편집자')
    // 부서 역할이 같거나 낮으면 직접 역할이 실효 역할이라 안내하지 않는다.
    expect(screen.queryByTestId('drive-member-department-role-2')).toBeNull()
    expect(screen.queryByTestId('drive-member-department-role-4')).toBeNull()
    expect(screen.queryByTestId('drive-member-department-role-1')).toBeNull()
  })
})

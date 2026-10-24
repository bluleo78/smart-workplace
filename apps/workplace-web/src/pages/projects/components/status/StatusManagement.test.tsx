// 설정 「상태」 섹션(WP-809)의 권한·비활성 경우의 수 — 멤버 읽기 전용, 상한 20 의 「+ 추가」, 범주 경계의 이동·삭제.
// 실제 요청·끌기·스크롤 배선은 E2E(settings-statuses.spec).
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'
import type { ProjectStatus } from '@/types/projectStatus'

import { StatusManagement } from './StatusManagement'

// vi.mock 팩토리는 파일 맨 위로 끌어올려지므로 그 안에서 쓰는 값은 vi.hoisted 로 함께 올린다.
const h = vi.hoisted(() => ({
  statuses: [] as ProjectStatus[],
  counts: undefined as Record<number, number> | undefined,
  mutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('@/hooks/queries/useProjectStatuses', () => ({
  NO_STATUSES: [],
  useProjectStatuses: () => ({ data: h.statuses, isLoading: false }),
  useStatusIssueCounts: () => h.counts,
  useCreateProjectStatus: h.mutation,
  useUpdateProjectStatus: h.mutation,
  useReorderProjectStatuses: h.mutation,
  useDeleteProjectStatus: h.mutation,
}))

/** 기본 4상태 + 진행 중 범주에 하나 더(id 12). */
function base(): ProjectStatus[] {
  return [
    { id: 1, name: '할 일', category: 'TODO', position: 0, color: 'GRAY' },
    { id: 2, name: '진행 중', category: 'IN_PROGRESS', position: 1, color: 'BLUE' },
    { id: 12, name: '코드 리뷰 중', category: 'IN_PROGRESS', position: 2, color: 'PURPLE' },
    { id: 3, name: '완료', category: 'DONE', position: 3, color: 'GREEN' },
    { id: 4, name: '취소', category: 'CANCELED', position: 4, color: 'GRAY' },
  ]
}

const openMenu = (id: number) => userEvent.click(screen.getByTestId(`status-menu-${id}`))

describe('StatusManagement', () => {
  beforeEach(() => {
    h.statuses = base()
    h.counts = undefined
  })

  it('멤버는 손잡이·⋯·추가가 없다', () => {
    renderWithProviders(<StatusManagement projectKey="WP" canEdit={false} />)
    expect(screen.getByTestId('status-row-12')).toHaveTextContent('코드 리뷰 중')
    expect(screen.queryByTestId('status-drag-12')).toBeNull()
    expect(screen.queryByTestId('status-menu-12')).toBeNull()
    expect(screen.queryByTestId('status-add-IN_PROGRESS')).toBeNull()
  })

  it('OWNER 는 손잡이·⋯·추가가 있다', () => {
    renderWithProviders(<StatusManagement projectKey="WP" canEdit />)
    expect(screen.getByTestId('status-drag-12')).toBeInTheDocument()
    expect(screen.getByTestId('status-menu-12')).toBeInTheDocument()
    for (const c of ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED']) expect(screen.getByTestId(`status-add-${c}`)).toBeEnabled()
  })

  it('20개면 추가가 비활성이고 툴팁 문구', async () => {
    h.statuses = [
      ...base(),
      ...Array.from({ length: 15 }, (_, i): ProjectStatus => ({
        id: 100 + i,
        name: `상태 ${i}`,
        category: 'TODO',
        position: 10 + i,
        color: 'GRAY',
      })),
    ]
    renderWithProviders(<StatusManagement projectKey="WP" canEdit />)
    for (const c of ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED']) expect(screen.getByTestId(`status-add-${c}`)).toBeDisabled()
    // 막힌 버튼은 포인터·포커스를 받지 않아 감싼 칸이 툴팁을 띄운다.
    await userEvent.hover(screen.getByTestId('status-add-TODO').parentElement!)
    expect((await screen.findAllByText('상태는 프로젝트당 20개까지예요')).length).toBeGreaterThan(0)
  })

  it('19개면 추가할 수 있다', () => {
    h.statuses = [
      ...base(),
      ...Array.from({ length: 14 }, (_, i): ProjectStatus => ({ id: 100 + i, name: `상태 ${i}`, category: 'TODO', position: 10 + i })),
    ]
    renderWithProviders(<StatusManagement projectKey="WP" canEdit />)
    expect(screen.getByTestId('status-add-TODO')).toBeEnabled()
  })

  it('범주 마지막 상태의 삭제가 비활성이다', async () => {
    renderWithProviders(<StatusManagement projectKey="WP" canEdit />)
    await openMenu(3)
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: '삭제' })).toHaveAttribute('aria-disabled', 'true')
    expect(menu).toHaveTextContent('범주의 마지막 상태는 지울 수 없어요')
  })

  it('범주에 다른 상태가 있으면 삭제할 수 있다', async () => {
    renderWithProviders(<StatusManagement projectKey="WP" canEdit />)
    await openMenu(12)
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: '삭제' })).not.toHaveAttribute('aria-disabled')
    expect(menu).not.toHaveTextContent('범주의 마지막 상태는 지울 수 없어요')
  })

  it('범주 첫 상태의 위로 이동이 비활성이다', async () => {
    renderWithProviders(<StatusManagement projectKey="WP" canEdit />)
    await openMenu(2)
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: '위로 이동' })).toHaveAttribute('aria-disabled', 'true')
    expect(within(menu).getByRole('menuitem', { name: '아래로 이동' })).not.toHaveAttribute('aria-disabled')
  })

  it('범주 끝 상태의 아래로 이동이 비활성이다', async () => {
    renderWithProviders(<StatusManagement projectKey="WP" canEdit />)
    await openMenu(12)
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: '위로 이동' })).not.toHaveAttribute('aria-disabled')
    expect(within(menu).getByRole('menuitem', { name: '아래로 이동' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('「기본」은 범주의 첫 상태에만 붙는다', () => {
    renderWithProviders(<StatusManagement projectKey="WP" canEdit={false} />)
    expect(screen.getByTestId('status-default-badge-2')).toBeInTheDocument()
    expect(screen.queryByTestId('status-default-badge-12')).toBeNull()
  })

  it('이슈 수를 받기 전엔 칸을 비우고, 받은 뒤 묶음이 없는 상태는 0개', () => {
    const { rerender } = renderWithProviders(<StatusManagement projectKey="WP" canEdit={false} />)
    expect(screen.getByTestId('status-row-12')).not.toHaveTextContent('개')
    h.counts = { 2: 1204 }
    rerender(<StatusManagement projectKey="WP" canEdit={false} />)
    expect(screen.getByTestId('status-row-2')).toHaveTextContent('1,204개')
    expect(screen.getByTestId('status-row-12')).toHaveTextContent('0개')
  })
})

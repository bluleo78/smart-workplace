// 설정 「상태」 섹션(WP-809)의 권한·비활성 경우의 수 — 멤버 읽기 전용, 상한 20 의 「+ 추가」, 범주 경계의 이동·삭제.
// 실제 요청·끌기·스크롤 배선은 E2E(settings-statuses.spec).
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SORTABLE_ROLE_DESCRIPTION } from '@/lib/dnd/useSortableItem'
import { renderWithProviders } from '@/test/renderWithProviders'
import type { ProjectStatus } from '@/types/projectStatus'

import { StatusManagement } from './StatusManagement'

// vi.mock 팩토리는 파일 맨 위로 끌어올려지므로 그 안에서 쓰는 값은 vi.hoisted 로 함께 올린다.
const h = vi.hoisted(() => ({
  statuses: [] as ProjectStatus[],
  counts: undefined as Record<number, number> | undefined,
  mutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  // 상태 생성 mutateAsync — 테스트마다 성공·실패를 바꾼다(WP-1658).
  createAsync: vi.fn(),
}))

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('@/hooks/queries/useProjectStatuses', () => ({
  NO_STATUSES: [],
  useProjectStatuses: () => ({ data: h.statuses, isLoading: false }),
  useStatusIssueCounts: () => h.counts,
  useCreateProjectStatus: () => ({ mutate: vi.fn(), mutateAsync: h.createAsync, isPending: false }),
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

/** 할 일 범주에 더 붙일 상태 n개(id 는 startId 부터) — 상한(20) 경계를 만든다. */
function extraTodo(n: number, startId = 100): ProjectStatus[] {
  return Array.from({ length: n }, (_, i) => ({
    id: startId + i,
    name: `추가 ${startId + i}`,
    category: 'TODO' as const,
    position: 10 + startId + i,
    color: 'GRAY' as const,
  }))
}

describe('StatusManagement', () => {
  beforeEach(() => {
    h.statuses = base()
    h.counts = undefined
    h.createAsync.mockReset()
    h.createAsync.mockResolvedValue(undefined)
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
    // 손잡이의 스크린리더 설명은 dnd-kit 기본 영어 「sortable」이 아니라 한국어(WP-1549).
    expect(screen.getByTestId('status-drag-12')).toHaveAttribute('aria-roledescription', SORTABLE_ROLE_DESCRIPTION)
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
    await userEvent.hover(screen.getByTestId('status-add-TODO').closest('[data-disabled-reason-wrapper]')!)
    expect((await screen.findAllByText('상태는 프로젝트당 20개까지예요')).length).toBeGreaterThan(0)
  })

  // WP-1856: 상한으로 막혔다 풀려도 「+ 추가」 버튼이 다시 만들어지지 않고(초점 유지), 막힌 감싸개에 이름이 붙는다.
  it('막힌 감싸개에는 `<이름> — <이유>` 이름이 붙고, 풀려도 버튼은 같은 노드이며 data-add-slot 이 감싸개에서 버튼으로 옮겨 간다', () => {
    h.statuses = [...base(), ...extraTodo(15)]
    const { rerender } = renderWithProviders(<StatusManagement projectKey="WP" canEdit />)
    const button = screen.getByTestId('status-add-TODO')
    const wrapper = button.closest('[data-disabled-reason-wrapper]')!
    expect(wrapper).toHaveAttribute('aria-label', '할 일 범주에 상태 추가 — 상태는 프로젝트당 20개까지예요')
    // 막힌 동안은 감싸개가 이름 있는 button 역할이고 안의 disabled 버튼은 따로 노출되지 않는다.
    expect(screen.getByRole('button', { name: '할 일 범주에 상태 추가 — 상태는 프로젝트당 20개까지예요' })).toBe(wrapper)
    expect(button.closest('[inert]')).not.toBeNull()
    expect(wrapper).toHaveAttribute('data-add-slot', 'TODO')
    expect(button).not.toHaveAttribute('data-add-slot')

    h.statuses = [...base(), ...extraTodo(14)]
    rerender(<StatusManagement projectKey="WP" canEdit />)
    expect(screen.getByTestId('status-add-TODO')).toBe(button)
    expect(button.closest('[data-disabled-reason-wrapper]')).toBe(wrapper)
    expect(wrapper).not.toHaveAttribute('aria-label')
    expect(wrapper).not.toHaveAttribute('role')
    expect(screen.getByRole('button', { name: '할 일 범주에 상태 추가' })).toBe(button)
    expect(wrapper).not.toHaveAttribute('data-add-slot')
    expect(button).toHaveAttribute('data-add-slot', 'TODO')
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

  // 「+ 추가」 입력 줄을 닫으면(Esc·취소·저장 성공) 포커스가 BODY 로 떨어지지 않고 그 범주의 「추가」 버튼으로 돌아온다(WP-1658).
  describe('추가 입력 줄을 닫은 뒤 포커스', () => {
    it('입력에서 Esc 를 누르면 그 범주의 추가 버튼으로 돌아온다', async () => {
      renderWithProviders(<StatusManagement projectKey="WP" canEdit />)
      await userEvent.click(screen.getByTestId('status-add-TODO'))
      expect(screen.getByLabelText('새 상태 이름')).toHaveFocus()
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByTestId('status-add-form-TODO')).toBeNull()
      expect(screen.getByTestId('status-add-TODO')).toHaveFocus()
    })

    it('「취소」 버튼을 누르면 그 범주의 추가 버튼으로 돌아온다', async () => {
      renderWithProviders(<StatusManagement projectKey="WP" canEdit />)
      await userEvent.click(screen.getByTestId('status-add-TODO'))
      await userEvent.click(within(screen.getByTestId('status-add-form-TODO')).getByRole('button', { name: '취소' }))
      expect(screen.queryByTestId('status-add-form-TODO')).toBeNull()
      expect(screen.getByTestId('status-add-TODO')).toHaveFocus()
    })

    it('다른 범주(진행 중)에서 닫으면 그 범주의 버튼으로 돌아온다', async () => {
      renderWithProviders(<StatusManagement projectKey="WP" canEdit />)
      await userEvent.click(screen.getByTestId('status-add-IN_PROGRESS'))
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByTestId('status-add-form-IN_PROGRESS')).toBeNull()
      expect(screen.getByTestId('status-add-IN_PROGRESS')).toHaveFocus()
    })

    it('저장에 성공하면 그 범주의 추가 버튼으로 돌아온다', async () => {
      renderWithProviders(<StatusManagement projectKey="WP" canEdit />)
      await userEvent.click(screen.getByTestId('status-add-TODO'))
      await userEvent.type(screen.getByLabelText('새 상태 이름'), '검토 대기{Enter}')
      expect(h.createAsync).toHaveBeenCalledWith(expect.objectContaining({ name: '검토 대기', category: 'TODO' }))
      await waitFor(() => expect(screen.queryByTestId('status-add-form-TODO')).toBeNull())
      expect(screen.getByTestId('status-add-TODO')).toHaveFocus()
    })

    it('저장으로 상한(20)에 닿으면 막힌 버튼을 감싼 툴팁 칸으로 돌아온다', async () => {
      h.statuses = [...base(), ...extraTodo(14)]
      // 실제 훅처럼 목록 재조회가 끝난 뒤(20개) 저장이 끝난다.
      h.createAsync.mockImplementation(async ({ name }: { name: string }) => {
        h.statuses = [...h.statuses, { id: 999, name, category: 'TODO', position: 99, color: 'GRAY' }]
      })
      renderWithProviders(<StatusManagement projectKey="WP" canEdit />)
      await userEvent.click(screen.getByTestId('status-add-TODO'))
      await userEvent.type(screen.getByLabelText('새 상태 이름'), '검토 대기{Enter}')
      await waitFor(() => expect(screen.queryByTestId('status-add-form-TODO')).toBeNull())
      const button = screen.getByTestId('status-add-TODO')
      expect(button).toBeDisabled()
      expect(button.closest('[data-disabled-reason-wrapper]')).toHaveFocus()
    })

    it('입력 줄을 연 사이 상한에 닿은 뒤 Esc 로 닫으면 툴팁 칸으로 돌아온다', async () => {
      h.statuses = [...base(), ...extraTodo(14)]
      const { rerender } = renderWithProviders(<StatusManagement projectKey="WP" canEdit />)
      await userEvent.click(screen.getByTestId('status-add-TODO'))
      h.statuses = [...h.statuses, ...extraTodo(1, 200)]
      rerender(<StatusManagement projectKey="WP" canEdit />)
      expect(screen.getByTestId('status-add-TODO')).toBeDisabled()
      await userEvent.click(screen.getByLabelText('새 상태 이름'))
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByTestId('status-add-form-TODO')).toBeNull()
      expect(screen.getByTestId('status-add-TODO').closest('[data-disabled-reason-wrapper]')).toHaveFocus()
    })

    it('늦게 끝난 저장은 그 사이 연 다른 범주 입력 줄을 닫거나 포커스를 뺏지 않는다', async () => {
      let resolve!: () => void
      h.createAsync.mockImplementation(() => new Promise<void>((r) => (resolve = r)))
      renderWithProviders(<StatusManagement projectKey="WP" canEdit />)
      await userEvent.click(screen.getByTestId('status-add-TODO'))
      await userEvent.type(screen.getByLabelText('새 상태 이름'), '검토 대기{Enter}')
      expect(h.createAsync).toHaveBeenCalled()
      // 저장 대기 중에 진행 중 범주의 입력 줄을 연다.
      await userEvent.click(screen.getByTestId('status-add-IN_PROGRESS'))
      const input = within(screen.getByTestId('status-add-form-IN_PROGRESS')).getByLabelText('새 상태 이름')
      expect(input).toHaveFocus()
      await act(async () => resolve())
      expect(screen.getByTestId('status-add-form-IN_PROGRESS')).toBeInTheDocument()
      expect(input).toHaveFocus()
      expect(screen.getByTestId('status-add-TODO')).not.toHaveFocus()
    })

    it('저장에 실패하면 입력 줄이 남고 포커스는 입력에 있다', async () => {
      h.createAsync.mockRejectedValue(new Error('network'))
      renderWithProviders(<StatusManagement projectKey="WP" canEdit />)
      await userEvent.click(screen.getByTestId('status-add-TODO'))
      await userEvent.type(screen.getByLabelText('새 상태 이름'), '검토 대기{Enter}')
      expect(await screen.findByTestId('status-add-error')).toBeInTheDocument()
      expect(screen.getByLabelText('새 상태 이름')).toHaveFocus()
    })
  })
})

// 상위 에픽 고르기(WP-1018) — 번호를 몰라도 제목 일부로 에픽을 찾아 연결한다.
// 「1.7」을 치면 제목에 그 글자가 든 에픽이 후보로 뜨고, 고르면(클릭·Enter) 그 번호로 저장한다. 번호 입력·비워 해제는 그대로다.
// SUBTASK 부모 편집은 번호 입력만 두고 에픽 후보를 부르지 않는다. 데이터 훅은 끊고 mutateAsync 로 보낸 값을 본다.
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '../../../test/renderWithProviders'
import { IssueParentPicker } from './IssueParentPicker'

const mutateAsync = vi.fn<(parentNumber: number | null) => Promise<void>>(() => Promise.resolve())
const useProjectEpics = vi.fn<(key: string, enabled?: boolean) => unknown>(() => ({
  epicType: { id: 9, name: 'EPIC' },
  epics: [
    { number: 3, title: '로그인 개편' },
    { number: 12, title: 'v1.7.0 제품개선' },
    { number: 120, title: '결제 v1.7 대응' },
  ],
  loading: false,
}))

vi.mock('../../../hooks/queries/useProjectEpics', () => ({
  useProjectEpics: (key: string, enabled?: boolean) => useProjectEpics(key, enabled),
}))
vi.mock('../../../hooks/queries/useUpdateIssueParent', () => ({
  useUpdateIssueParent: () => ({ mutateAsync, isPending: false }),
}))

function renderPicker(props: { currentParentNumber?: number | null; isSubtask?: boolean } = {}) {
  const onClose = vi.fn()
  renderWithProviders(
    <IssueParentPicker
      projectKey="WP"
      issueNumber={50}
      currentParentNumber={props.currentParentNumber ?? null}
      isSubtask={props.isSubtask}
      onClose={onClose}
    />,
  )
  return { onClose, input: screen.getByTestId('parent-number-input') }
}

describe('IssueParentPicker — 상위 에픽 제목 검색', () => {
  beforeEach(() => {
    mutateAsync.mockClear()
    useProjectEpics.mockClear()
  })

  it('제목 일부(「1.7」)를 치면 맞는 에픽만 후보로 뜨고, 고르면 그 번호로 연결한다', async () => {
    const { onClose, input } = renderPicker()
    fireEvent.change(input, { target: { value: '1.7' } })
    expect(screen.getByTestId('parent-epic-option-12')).toHaveTextContent('#12v1.7.0 제품개선')
    expect(screen.getByTestId('parent-epic-option-120')).toBeInTheDocument()
    expect(screen.queryByTestId('parent-epic-option-3')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId('parent-epic-option-120'))
    expect(mutateAsync).toHaveBeenCalledWith(120)
    expect(onClose).toHaveBeenCalled()
  })

  it('키보드로 고른다 — 아래 화살표로 두 번째 후보로 옮기고 Enter 면 그 에픽', async () => {
    const user = userEvent.setup()
    const { input } = renderPicker()
    await user.click(input)
    await user.paste('v1.7')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(mutateAsync).toHaveBeenCalledTimes(1)
    expect(mutateAsync).toHaveBeenCalledWith(120)
  })

  it('맞는 에픽이 없으면 안내를 보이고, 번호가 아닌 글자는 저장 버튼이 막힌다', () => {
    const { input } = renderPicker()
    fireEvent.change(input, { target: { value: '없는 제목' } })
    expect(screen.getByText('맞는 에픽이 없습니다')).toBeInTheDocument()
    expect(screen.getByTestId('parent-save')).toBeDisabled()
  })

  it('목록에 없는 번호를 쳐도 저장하면 그 번호로 연결한다(닫힌 에픽 등)', async () => {
    const { input } = renderPicker()
    fireEvent.change(input, { target: { value: '#77' } })
    expect(screen.getByTestId('parent-typed-option')).toHaveTextContent('#77 로 연결')
    await userEvent.click(screen.getByTestId('parent-save'))
    expect(mutateAsync).toHaveBeenCalledWith(77)
  })

  it('친 번호가 후보에 있으면 「친 값」 항목을 따로 두지 않는다', () => {
    const { input } = renderPicker()
    fireEvent.change(input, { target: { value: '12' } })
    expect(screen.queryByTestId('parent-typed-option')).not.toBeInTheDocument()
    expect(screen.getByTestId('parent-epic-option-12')).toBeInTheDocument()
  })

  it('비우고 저장하면 부모를 해제한다', async () => {
    const { input } = renderPicker({ currentParentNumber: 12 })
    expect(input).toHaveValue('12')
    fireEvent.change(input, { target: { value: '' } })
    await userEvent.click(screen.getByTestId('parent-save'))
    expect(mutateAsync).toHaveBeenCalledWith(null)
  })

  it('비우고 Enter 면 첫 후보가 아니라 부모 해제다', async () => {
    const user = userEvent.setup()
    const { input } = renderPicker({ currentParentNumber: 12 })
    await user.clear(input)
    expect(screen.getByTestId('parent-typed-option')).toHaveTextContent('상위 에픽 해제')
    await user.keyboard('{Enter}')
    expect(mutateAsync).toHaveBeenCalledTimes(1)
    expect(mutateAsync).toHaveBeenCalledWith(null)
  })

  it('친 번호가 다른 에픽 제목에 걸려도 Enter 는 친 번호다 — 화살표로 옮겼을 때만 후보', async () => {
    const user = userEvent.setup()
    const { input } = renderPicker()
    await user.click(input)
    await user.paste('7')
    // 「7」은 제목 「v1.7…」에 걸려 후보가 뜨지만, 사용자는 목록에 없는 #7 을 원했다.
    expect(screen.getByTestId('parent-epic-option-12')).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(mutateAsync).toHaveBeenLastCalledWith(7)

    // 화살표로 옮기면 그 후보 — 맨 위 「#7 로 연결」 다음이 #12, End 는 마지막 #120.
    mutateAsync.mockClear()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(mutateAsync).toHaveBeenCalledWith(12)
    await user.keyboard('{End}{Enter}')
    expect(mutateAsync).toHaveBeenLastCalledWith(120)
  })

  it('입력·후보 목록에 읽을 이름이 붙는다', () => {
    renderPicker()
    expect(screen.getByRole('combobox', { name: '에픽 번호 또는 제목' })).toBe(screen.getByTestId('parent-number-input'))
    expect(screen.getByRole('listbox', { name: '에픽 후보' })).toBeInTheDocument()
  })

  it('SUBTASK 부모 편집은 번호 입력만 두고 에픽 후보를 부르지 않는다', () => {
    const { input } = renderPicker({ currentParentNumber: 5, isSubtask: true })
    expect(input).toHaveAttribute('type', 'number')
    expect(screen.queryByTestId('parent-epic-candidates')).not.toBeInTheDocument()
    expect(useProjectEpics).toHaveBeenCalledWith('WP', false)
    fireEvent.change(input, { target: { value: '' } })
    expect(screen.getByTestId('parent-save')).toBeDisabled()
  })
})

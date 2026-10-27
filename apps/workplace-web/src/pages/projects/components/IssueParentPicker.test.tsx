// 상위 에픽 고르기(WP-1018) — 번호를 몰라도 제목 일부로 에픽을 찾아 연결한다.
// 「1.7」을 치면 제목에 그 글자가 든 에픽이 후보로 뜨고, 고르면(클릭·Enter) 그 번호로 저장한다. 번호 입력·비워 해제는 그대로다.
// SUBTASK 부모 편집은 번호 입력만 두고 에픽 후보를 부르지 않는다. 데이터 훅은 끊고 mutateAsync 로 보낸 값을 본다.
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '../../../test/renderWithProviders'
import { IssueParentPicker } from './IssueParentPicker'

const mutateAsync = vi.fn<(parent: number | { projectKey?: string | null; number: number } | null) => Promise<void>>(() => Promise.resolve())
// 다른 프로젝트 에픽 찾기(WP-1039) — 기본은 결과 없음. 찾기 요청·저장 payload 는 IssueParentSlot.test.tsx(MSW)가 본다.
const useOtherProjectEpics = vi.fn<(q: string, key: string, enabled?: boolean) => unknown>(() => ({ epics: [], searching: false }))
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
vi.mock('../../../hooks/queries/useOtherProjectEpics', () => ({
  useOtherProjectEpics: (q: string, key: string, enabled?: boolean) => useOtherProjectEpics(q, key, enabled),
}))
vi.mock('../../../hooks/queries/useUpdateIssueParent', () => ({
  useUpdateIssueParent: () => ({ mutateAsync, isPending: false }),
}))

// 부모 요약 — 번호만 다르게(같은 프로젝트), projectKey 를 주면 다른 프로젝트 에픽.
const parentRef = (number: number, projectKey?: string) =>
  ({ number, title: `에픽 ${number}`, type: { id: 9, name: 'EPIC', icon: 'Zap', colorToken: 'PURPLE', system: true }, projectKey }) as never

function renderPicker(props: { currentParent?: ReturnType<typeof parentRef> | null; isSubtask?: boolean } = {}) {
  const onClose = vi.fn()
  renderWithProviders(
    <IssueParentPicker
      projectKey="WP"
      issueNumber={50}
      currentParent={props.currentParent ?? null}
      isSubtask={props.isSubtask}
      onClose={onClose}
    />,
  )
  return { onClose, input: screen.getByTestId('parent-number-input') }
}

describe('IssueParentPicker — 상위 에픽 제목 검색', () => {
  beforeEach(() => {
    mutateAsync.mockClear()
    useOtherProjectEpics.mockClear()
    useProjectEpics.mockClear()
  })

  it('제목 일부(「1.7」)를 치면 맞는 에픽만 후보로 뜨고, 고르면 그 번호로 연결한다', async () => {
    const { onClose, input } = renderPicker()
    fireEvent.change(input, { target: { value: '1.7' } })
    expect(screen.getByTestId('parent-epic-option-12')).toHaveTextContent('#12v1.7.0 제품개선')
    expect(screen.getByTestId('parent-epic-option-120')).toBeInTheDocument()
    expect(screen.queryByTestId('parent-epic-option-3')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId('parent-epic-option-120'))
    expect(mutateAsync).toHaveBeenCalledWith({ number: 120 })
    expect(onClose).toHaveBeenCalled()
  })

  it('키보드로 고른다 — 아래 화살표로 두 번째 후보로 옮기고 Enter 면 그 에픽', async () => {
    const user = userEvent.setup()
    const { input } = renderPicker()
    await user.click(input)
    await user.paste('v1.7')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(mutateAsync).toHaveBeenCalledTimes(1)
    expect(mutateAsync).toHaveBeenCalledWith({ number: 120 })
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
    expect(mutateAsync).toHaveBeenCalledWith({ number: 77 })
  })

  it('친 번호가 후보에 있으면 「친 값」 항목을 따로 두지 않는다', () => {
    const { input } = renderPicker()
    fireEvent.change(input, { target: { value: '12' } })
    expect(screen.queryByTestId('parent-typed-option')).not.toBeInTheDocument()
    expect(screen.getByTestId('parent-epic-option-12')).toBeInTheDocument()
  })

  it('비우고 저장하면 부모를 해제한다', async () => {
    const { input } = renderPicker({ currentParent: parentRef(12) })
    expect(input).toHaveValue('12')
    fireEvent.change(input, { target: { value: '' } })
    await userEvent.click(screen.getByTestId('parent-save'))
    expect(mutateAsync).toHaveBeenCalledWith(null)
  })

  it('비우고 Enter 면 첫 후보가 아니라 부모 해제다', async () => {
    const user = userEvent.setup()
    const { input } = renderPicker({ currentParent: parentRef(12) })
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
    expect(mutateAsync).toHaveBeenLastCalledWith({ number: 7 })

    // 화살표로 옮기면 그 후보 — 맨 위 「#7 로 연결」 다음이 #12, End 는 마지막 #120.
    mutateAsync.mockClear()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(mutateAsync).toHaveBeenCalledWith({ number: 12 })
    await user.keyboard('{End}{Enter}')
    expect(mutateAsync).toHaveBeenLastCalledWith({ number: 120 })
  })

  it('입력·후보 목록에 읽을 이름이 붙는다', () => {
    renderPicker()
    expect(screen.getByRole('combobox', { name: '에픽 번호 또는 제목' })).toBe(screen.getByTestId('parent-number-input'))
    expect(screen.getByRole('listbox', { name: '에픽 후보' })).toBeInTheDocument()
  })

  it('다른 프로젝트 에픽 부모면 키로 열고, 찾은 다른 프로젝트 에픽을 고르면 키로 연결한다 (WP-1039)', async () => {
    useOtherProjectEpics.mockImplementation((q: string) => ({
      epics: q
        ? [
            // 지금 부모(PLAN-12)도 찾기에 걸리지만 후보로는 다시 보이지 않는다.
            { projectKey: 'PLAN', number: 12, title: '지금 에픽', status: 'TODO', type: null },
            { projectKey: 'PLAN', number: 3, title: '분기 계획', status: 'TODO', type: null },
          ]
        : [],
      searching: false,
    }))
    const { input } = renderPicker({ currentParent: parentRef(12, 'PLAN') })
    expect(input).toHaveValue('PLAN-12')
    // 연 순간 채운 키(지금 부모)로는 찾지 않는다 — 입력을 고친 뒤부터 찾는다.
    expect(useOtherProjectEpics).toHaveBeenLastCalledWith('PLAN-12', 'WP', false)
    expect(screen.queryByTestId('parent-other-epic-option-PLAN-12')).not.toBeInTheDocument()
    expect(screen.getByTestId('parent-current-option')).toHaveTextContent('현재PLAN-12에픽 12')
    const option = screen.getByTestId('parent-other-epic-option-PLAN-3')
    expect(option).toHaveTextContent('PLAN-3분기 계획')
    await userEvent.click(option)
    expect(mutateAsync).toHaveBeenCalledWith({ projectKey: 'PLAN', number: 3 })
    useOtherProjectEpics.mockImplementation(() => ({ epics: [], searching: false }))
  })

  it('지금 부모로 연 직후 Enter 는 그대로 닫는다 — 헛 PATCH 없음 (WP-1039)', async () => {
    const user = userEvent.setup()
    const { input, onClose } = renderPicker({ currentParent: parentRef(12, 'PLAN') })
    await user.click(input)
    await user.keyboard('{Enter}')
    expect(mutateAsync).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('같은 프로젝트 지금 부모 번호를 그대로 저장하면 요청 없이 닫는다 (WP-1039)', async () => {
    const { onClose } = renderPicker({ currentParent: parentRef(12) })
    // 지금 부모 #12 는 후보·친 값 항목에서 빠진다.
    expect(screen.queryByTestId('parent-epic-option-12')).not.toBeInTheDocument()
    expect(screen.queryByTestId('parent-typed-option')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId('parent-save'))
    expect(mutateAsync).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('지금 부모는 상한(20건) 전에 빠진다 — 지금 부모가 앞에 있어도 후보 20건이 다 보인다 (WP-1039)', () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ number: i + 1, title: `에픽 제목 ${i + 1}` }))
    useProjectEpics.mockImplementation(() => ({ epicType: { id: 9, name: 'EPIC' }, epics: many, loading: false }))
    try {
      const { input } = renderPicker({ currentParent: parentRef(1) })
      fireEvent.change(input, { target: { value: '' } })
      const shown = screen.getAllByTestId(/^parent-epic-option-/)
      expect(shown).toHaveLength(20)
      expect(screen.queryByTestId('parent-epic-option-1')).not.toBeInTheDocument()
      expect(screen.getByTestId('parent-epic-option-21')).toBeInTheDocument()
    } finally {
      useProjectEpics.mockReset()
      useProjectEpics.mockImplementation(() => ({
        epicType: { id: 9, name: 'EPIC' },
        epics: [
          { number: 3, title: '로그인 개편' },
          { number: 12, title: 'v1.7.0 제품개선' },
          { number: 120, title: '결제 v1.7 대응' },
        ],
        loading: false,
      }))
    }
  })

  it('입력을 고쳐도 지금 부모에 맞으면 「현재」 줄을 보인다 — 빈 「맞는 에픽이 없습니다」가 아니다 (WP-1039)', () => {
    // 같은 프로젝트 지금 부모 #3 — 「#3」으로 고쳐 쳐도(처음 값 「3」과 다름) 「현재」로 보인다.
    const { input, onClose } = renderPicker({ currentParent: parentRef(3) })
    fireEvent.change(input, { target: { value: '#3' } })
    expect(screen.getByTestId('parent-current-option')).toHaveTextContent('현재WP-3에픽 3')
    expect(screen.queryByText('맞는 에픽이 없습니다')).not.toBeInTheDocument()
    expect(screen.queryByTestId('parent-typed-option')).not.toBeInTheDocument()
    // 맞지 않는 값이면 「현재」는 사라진다.
    fireEvent.change(input, { target: { value: '결제' } })
    expect(screen.queryByTestId('parent-current-option')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('다른 프로젝트 지금 부모는 키(대소문자 무시)를 다시 쳐도 「현재」 줄로 보인다 (WP-1039)', () => {
    const { input } = renderPicker({ currentParent: parentRef(12, 'PLAN') })
    fireEvent.change(input, { target: { value: 'plan-12' } })
    expect(screen.getByTestId('parent-current-option')).toHaveTextContent('현재PLAN-12에픽 12')
  })

  it('가려진 부모로 열면 Enter 한 번에 연결이 풀리지 않는다 — 해제는 화살표로 골라야 한다 (WP-1039)', async () => {
    const user = userEvent.setup()
    const hidden = { number: 0, title: null, type: null, hidden: true } as never
    const { input, onClose } = renderPicker({ currentParent: hidden })
    expect(input).toHaveValue('')
    expect(screen.getByTestId('parent-current-option')).toHaveTextContent('현재볼 수 없는 에픽')
    await user.click(input)
    await user.keyboard('{Enter}')
    expect(mutateAsync).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
    // 아래 화살표로 「상위 에픽 해제」를 고르면 그때 해제한다.
    await user.keyboard('{ArrowDown}')
    expect(screen.getByTestId('parent-typed-option')).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(mutateAsync).toHaveBeenCalledWith(null)
  })

  it('SUBTASK 부모 편집은 번호 입력만 두고 에픽 후보를 부르지 않는다', () => {
    const { input } = renderPicker({ currentParent: parentRef(5), isSubtask: true })
    expect(input).toHaveAttribute('type', 'number')
    expect(screen.queryByTestId('parent-epic-candidates')).not.toBeInTheDocument()
    expect(useProjectEpics).toHaveBeenCalledWith('WP', false)
    // 다른 프로젝트 에픽도 찾지 않는다 — 하위 태스크 부모는 같은 프로젝트만(WP-1038).
    expect(useOtherProjectEpics).toHaveBeenLastCalledWith('5', 'WP', false)
    fireEvent.change(input, { target: { value: '' } })
    expect(screen.getByTestId('parent-save')).toBeDisabled()
  })
})

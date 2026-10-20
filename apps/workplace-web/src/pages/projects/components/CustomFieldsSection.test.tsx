// 커스텀 필드 저장 debounce(WP-503) — 필드마다 마지막 값을 300ms 뒤 따로 저장한다.
// 예전엔 타이머 하나를 공유해 앞 필드의 저장이 취소되고 입력이 조용히 사라졌다. PUT 배선은 E2E(custom-fields)가 맡는다.
import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import type { IssueFieldDef, IssueFieldEntry } from '../../../types/customField'
import { CustomFieldsSection } from './CustomFieldsSection'

const defs = [
  { id: 1, name: '고객사', type: 'TEXT', options: null },
  { id: 2, name: '견적', type: 'NUMBER', options: null },
] as IssueFieldDef[]
const mutate = vi.fn()
vi.mock('../../../hooks/queries/useCustomFields', () => ({ useCustomFields: () => ({ data: defs }) }))
vi.mock('../../../hooks/queries/useUpdateIssueFields', () => ({ useUpdateIssueFields: () => ({ mutate }) }))

const section = (current: IssueFieldEntry[] = []) => (
  <CustomFieldsSection projectKey="WP" issueNumber={1} current={current} />
)
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms))

describe('CustomFieldsSection — 필드별 저장 debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mutate.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it('300ms 안에 두 필드를 바꿔도 각 필드가 따로 한 번씩 저장된다', () => {
    renderWithProviders(section())
    fireEvent.change(screen.getByTestId('field-input-1'), { target: { value: '아이에이' } })
    wait(100)
    fireEvent.change(screen.getByTestId('field-input-2'), { target: { value: '5' } })
    wait(300)

    expect(mutate).toHaveBeenCalledTimes(2)
    expect(mutate).toHaveBeenCalledWith([{ defId: 1, value: '아이에이' }])
    expect(mutate).toHaveBeenCalledWith([{ defId: 2, value: 5 }])
  })

  it('같은 필드를 연달아 바꾸면 마지막 값만 한 번 저장된다', () => {
    renderWithProviders(section())
    const input = screen.getByTestId('field-input-1')
    fireEvent.change(input, { target: { value: '아' } })
    wait(100)
    fireEvent.change(input, { target: { value: '아이' } })
    wait(300)

    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith([{ defId: 1, value: '아이' }])
  })

  it('300ms 안에 화면이 닫혀도(언마운트) 기다리던 변경을 바로 보낸다', () => {
    const { unmount } = renderWithProviders(section())
    fireEvent.change(screen.getByTestId('field-input-1'), { target: { value: '닫기 직전' } })
    unmount()

    expect(mutate).toHaveBeenCalledWith([{ defId: 1, value: '닫기 직전' }])
  })

  it('원래 값으로 되돌려도 보낸다 — 앞 저장이 반영되기 전 되돌리기를 놓치지 않는다', () => {
    // 서버 값 X → Y 저장(아직 재조회 전) → 다시 X. 서버 값(X)과 같다고 건너뛰면 서버에 Y 가 남는다.
    renderWithProviders(section([{ defId: 1, name: '고객사', type: 'TEXT', value: 'X' }]))
    const input = screen.getByTestId('field-input-1')
    fireEvent.change(input, { target: { value: 'Y' } })
    wait(300)
    fireEvent.change(input, { target: { value: 'X' } })
    wait(300)

    expect(mutate).toHaveBeenNthCalledWith(1, [{ defId: 1, value: 'Y' }])
    expect(mutate).toHaveBeenNthCalledWith(2, [{ defId: 1, value: 'X' }])
  })

  it('다른 필드 저장 뒤 서버 값이 새로 와도 아직 보내지 않은 입력은 지킨다', () => {
    const { rerender } = renderWithProviders(section())
    fireEvent.change(screen.getByTestId('field-input-1'), { target: { value: '입력 중' } })
    rerender(section([{ defId: 2, name: '견적', type: 'NUMBER', value: 7 }]))

    expect(screen.getByTestId('field-input-1')).toHaveValue('입력 중')
    expect(screen.getByTestId('field-input-2')).toHaveValue(7)
  })
})

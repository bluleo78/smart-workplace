// 메일 표 넣기 격자(WP-1524) — 칸 수·호버 미리보기·클릭/끌기/키보드/터치로 행×열을 고르는 동작.
import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import { MailTableGridPicker } from './MailTableGridPicker'

/** r행 c열 칸 버튼. */
function cell(r: number, c: number) {
  return screen.getByRole('button', { name: `${r}행 ${c}열 표` })
}

describe('MailTableGridPicker', () => {
  it('max 만큼 칸을 그린다', () => {
    renderWithProviders(<MailTableGridPicker max={6} touch={false} onPick={vi.fn()} />)
    expect(screen.getAllByRole('button')).toHaveLength(36)
    expect(screen.getByText('표 넣기')).toBeInTheDocument()
  })

  it('칸에 올리면 머리 문구가 행×열을 보여 주고 누르면 그 크기로 넣는다', async () => {
    const onPick = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<MailTableGridPicker max={6} touch={false} onPick={onPick} />)
    fireEvent.pointerEnter(cell(3, 4))
    expect(screen.getByText('표 넣기 — 3 × 4')).toBeInTheDocument()
    await user.click(cell(3, 4))
    expect(onPick).toHaveBeenCalledWith(3, 4)
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('화살표·Enter 로도 고른다', async () => {
    const onPick = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<MailTableGridPicker max={6} touch={false} onPick={onPick} />)
    act(() => cell(1, 1).focus())
    expect(screen.getByText('표 넣기 — 1 × 1')).toBeInTheDocument()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByText('표 넣기 — 1 × 2')).toBeInTheDocument()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByText('표 넣기 — 2 × 2')).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(2, 2)
  })

  it('끌어서 놓으면 놓은 칸 크기로 한 번만 넣고, 뒤따르는 click 은 무시한다', () => {
    const onPick = vi.fn()
    renderWithProviders(<MailTableGridPicker max={6} touch={false} onPick={onPick} />)
    fireEvent.pointerDown(cell(1, 1))
    fireEvent.pointerEnter(cell(3, 4))
    fireEvent.pointerUp(cell(3, 4))
    fireEvent.click(cell(3, 4))
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(3, 4)
  })

  it('실제 끌기처럼 click 이 칸 밖(격자)으로 가도 이후 키보드 선택은 삼켜지지 않는다', async () => {
    const onPick = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<MailTableGridPicker max={6} touch={false} onPick={onPick} />)
    fireEvent.pointerDown(cell(1, 1))
    fireEvent.pointerEnter(cell(3, 4))
    fireEvent.pointerUp(cell(3, 4))
    fireEvent.click(screen.getByTestId('mail-table-grid'))
    expect(onPick).toHaveBeenCalledTimes(1)
    act(() => cell(2, 2).focus())
    await user.keyboard('{Enter}')
    expect(onPick).toHaveBeenCalledTimes(2)
    expect(onPick).toHaveBeenLastCalledWith(2, 2)
  })

  it('칸에서 시작한 끌기를 격자 밖에서 놓으면 끌기가 끝나, 뒤의 칸 pointerup 이 표를 넣지 않는다', () => {
    const onPick = vi.fn()
    renderWithProviders(<MailTableGridPicker max={6} touch={false} onPick={onPick} />)
    fireEvent.pointerDown(cell(1, 1))
    fireEvent.pointerEnter(cell(3, 4))
    // 격자 밖(문서)에서 놓는다 — 칸 핸들러는 불리지 않는다.
    fireEvent.pointerUp(document.body)
    fireEvent.pointerUp(cell(2, 2))
    expect(onPick).not.toHaveBeenCalled()
    // 취소(pointercancel)도 같다.
    fireEvent.pointerDown(cell(1, 1))
    fireEvent.pointerCancel(document.body)
    fireEvent.pointerUp(cell(2, 2))
    expect(onPick).not.toHaveBeenCalled()
    // 새 끌기는 여전히 놓은 칸 크기로 넣는다.
    fireEvent.pointerDown(cell(1, 1))
    fireEvent.pointerUp(cell(2, 3))
    expect(onPick).toHaveBeenCalledWith(2, 3)
  })

  it('터치 모드는 미리보기 없이 탭 한 번에 넣는다', async () => {
    const onPick = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<MailTableGridPicker max={6} touch onPick={onPick} />)
    await user.click(cell(2, 5))
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(2, 5)
    expect(screen.getByText('표 넣기')).toBeInTheDocument()
  })
})

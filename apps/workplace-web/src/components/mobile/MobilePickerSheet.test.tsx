// MobilePickerSheet — 옵션 이름에 labelClassName 을 입히고 검색은 label 로 거른다(WP-2101: 끝난 에픽 제목 흐림·삭선).
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import { MobilePickerSheet, type PickerOption } from './MobilePickerSheet'

const options: PickerOption[] = [
  { value: 'a', label: '진행 에픽' },
  { value: 'b', label: '취소된 에픽', labelClassName: 'line-through' },
]

function renderSheet() {
  return render(
    <MobilePickerSheet open onClose={vi.fn()} title="에픽" options={options} value={null} onSelect={vi.fn()} searchable />,
  )
}

test('labelClassName 이 있는 옵션의 이름 요소만 그 클래스를 갖는다', () => {
  renderSheet()
  expect(screen.getByText('취소된 에픽')).toHaveClass('line-through')
  expect(screen.getByText('진행 에픽')).not.toHaveClass('line-through')
})

test('검색어는 label 로 옵션을 거른다', () => {
  renderSheet()
  fireEvent.change(screen.getByTestId('mobile-picker-sheet-search'), { target: { value: '취소' } })
  expect(screen.getByText('취소된 에픽')).toBeInTheDocument()
  expect(screen.queryByText('진행 에픽')).not.toBeInTheDocument()
})

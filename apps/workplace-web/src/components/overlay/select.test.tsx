// 공용 선택 창 — 배치(popper/item-aligned)는 열 때의 탭바 유무로 정하고, 열린 동안 탭바가 바뀌어도 그대로 둔다(WP-806).
// 열린 채 배치가 바뀌면 Radix 가 목록을 다시 마운트해 스크롤·포커스가 날아간다.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { setMobileTabBarHeight } from '@/lib/mobileTabBar'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'

// popper 배치일 때만 Radix 가 감싸는 요소 — item-aligned 엔 없다.
const popperWrapper = () => document.querySelector('[data-radix-popper-content-wrapper]')

function renderSelect() {
  render(
    <Select defaultValue="a">
      <SelectTrigger aria-label="선택">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="a">가</SelectItem>
        <SelectItem value="b">나</SelectItem>
      </SelectContent>
    </Select>,
  )
}

/** 키보드로 연다 — 포인터 열기는 jsdom 에 없는 포인터 캡처 API 를 쓴다. */
function open() {
  fireEvent.keyDown(screen.getByRole('combobox', { name: '선택' }), { key: 'Enter' })
  expect(screen.getByRole('listbox')).toBeInTheDocument()
}

describe('Select 배치 고정', () => {
  afterEach(() => act(() => setMobileTabBarHeight(null)))

  it('탭바 없이 연 목록은 열린 동안 탭바가 나타나도 item-aligned 그대로, 다시 열면 popper', () => {
    renderSelect()
    open()
    expect(popperWrapper()).toBeNull()

    act(() => setMobileTabBarHeight(49))
    expect(popperWrapper()).toBeNull()

    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    open()
    expect(popperWrapper()).not.toBeNull()
  })

  it('탭바가 보일 때 연 목록은 열린 동안 탭바가 사라져도 popper 그대로', () => {
    act(() => setMobileTabBarHeight(49))
    renderSelect()
    open()
    expect(popperWrapper()).not.toBeNull()

    act(() => setMobileTabBarHeight(null))
    expect(popperWrapper()).not.toBeNull()
  })
})

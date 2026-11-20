// useListFocusRescue 의 행 선택자 인자(WP-1845) — 기본(data-message-id)과 다른 표식을 쓰는 목록(알림 인박스)도
// 행이 빠지면 같은 자리 행으로 포커스를 옮기는지 본다.
import { act, render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { useListFocusRescue } from '@/hooks/useListFocusRescue'

/** 행마다 지우기 버튼이 있는 목록 — attr 이름으로 행 표식을 달고, selector 를 넘기면 훅에 그대로 준다. */
function List({ ids, attr, selector }: { ids: number[]; attr: string; selector?: string }) {
  const ref = useListFocusRescue(ids, undefined, selector)
  return (
    <div ref={ref}>
      {ids.map((id) => (
        <div key={id} {...{ [attr]: id }}>
          <button type="button">지우기 {id}</button>
        </div>
      ))}
    </div>
  )
}

describe('useListFocusRescue 행 선택자', () => {
  test('사용자 선택자를 넘기면 그 표식의 행으로 포커스를 옮긴다', () => {
    const { rerender } = render(<List ids={[1, 2, 3]} attr="data-row-id" selector="[data-row-id]" />)
    act(() => screen.getByText('지우기 2').focus())
    rerender(<List ids={[1, 3]} attr="data-row-id" selector="[data-row-id]" />)
    expect(document.activeElement).toHaveAttribute('data-row-id', '3')
  })

  test('선택자를 넘기지 않으면 기본 표식(data-message-id) 행으로 옮긴다', () => {
    const { rerender } = render(<List ids={[1, 2, 3]} attr="data-message-id" />)
    act(() => screen.getByText('지우기 2').focus())
    rerender(<List ids={[1, 3]} attr="data-message-id" />)
    expect(document.activeElement).toHaveAttribute('data-message-id', '3')
  })

  // 기본 선택자는 다른 표식의 행을 모른다 — 사용자 선택자가 실제로 쓰였는지를 위 첫 테스트와 대조해 확인한다.
  test('기본 선택자로는 다른 표식의 행을 찾지 못해 포커스를 옮기지 않는다', () => {
    const { rerender } = render(<List ids={[1, 2, 3]} attr="data-row-id" />)
    act(() => screen.getByText('지우기 2').focus())
    rerender(<List ids={[1, 3]} attr="data-row-id" />)
    expect(document.activeElement).not.toHaveAttribute('data-row-id')
  })
})

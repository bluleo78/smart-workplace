// DisabledReasonTooltip 테스트 (WP-1852) — reason 이 없으면 감싸개가 Tab 정지·이름 없이 남고,
// reason 이 생기고 사라질 때 초점이 버튼 ↔ 감싸개로 넘어가는지 확인한다.
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DisabledReasonTooltip } from './disabled-reason-tooltip'

/** reason 에 따라 안의 버튼을 막는 하네스 — rerender 로 reason 만 바꿔 같은 노드가 유지되는지 본다. */
function Harness({ reason }: { reason: string | null }) {
  return (
    <div>
      <button data-testid="other">바깥</button>
      <DisabledReasonTooltip reason={reason} data-testid="wrap" aria-label={reason ?? undefined}>
        <button disabled={reason != null} data-testid="btn">
          실행
        </button>
      </DisabledReasonTooltip>
    </div>
  )
}

/** jsdom 은 :focus-visible 을 믿을 만하게 판정하지 않으므로 그 선택자만 고정값으로 돌려주고 나머지는 원래대로 둔다. */
function mockFocusVisible(value: boolean) {
  const original = Element.prototype.matches
  return vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, sel: string) {
    if (sel === ':focus-visible') return value
    return original.call(this, sel)
  })
}

/** 감싸개 속성 시험용 — 안은 늘 같은 버튼이라 reason·속성만 받는다. */
function wrapEl(props: { reason: string | null } & Record<string, unknown>) {
  return (
    <DisabledReasonTooltip data-testid="w" {...props}>
      <button>x</button>
    </DisabledReasonTooltip>
  )
}

describe('DisabledReasonTooltip', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reason 이 없으면 감싸개는 Tab 정지가 아니고 이름도 없다', () => {
    const { getByTestId } = render(<Harness reason={null} />)
    const wrap = getByTestId('wrap')
    // Tab 순서 밖(-1) — 초점만 쥘 수 있게 남겨 두어야 풀리는 순간 브라우저가 초점을 떨어뜨리지 않는다.
    expect(wrap).toHaveAttribute('tabindex', '-1')
    expect(wrap).not.toHaveAttribute('aria-label')
  })

  it('label 을 주면 막혔을 때 이름이 `label — reason` 이고, 명시한 aria-label 이 이기며, reason 이 없으면 이름이 없다', () => {
    const view = (props: { reason: string | null; 'aria-label'?: string }) => (
      <DisabledReasonTooltip label="상태 추가" data-testid="wrap" {...props}>
        <button>추가</button>
      </DisabledReasonTooltip>
    )
    const { getByTestId, rerender } = render(view({ reason: '꽉 찼어요' }))
    expect(getByTestId('wrap')).toHaveAttribute('aria-label', '상태 추가 — 꽉 찼어요')
    rerender(view({ reason: '꽉 찼어요', 'aria-label': '직접' }))
    expect(getByTestId('wrap')).toHaveAttribute('aria-label', '직접')
    rerender(view({ reason: null }))
    expect(getByTestId('wrap')).not.toHaveAttribute('aria-label')
  })

  it('reason 이 생길 때 초점이 안의 버튼에 있으면 감싸개로 옮긴다', () => {
    mockFocusVisible(true)
    const { getByTestId, rerender } = render(<Harness reason={null} />)
    const btn = getByTestId('btn')
    btn.focus()
    expect(btn).toHaveFocus()
    rerender(<Harness reason="실행 중이에요" />)
    expect(getByTestId('wrap')).toHaveFocus()
    expect(getByTestId('btn')).toBe(btn)
  })

  it('reason 이 사라질 때 초점이 감싸개에 있으면 안의 버튼으로 옮긴다', () => {
    const { getByTestId, rerender } = render(<Harness reason="x" />)
    getByTestId('wrap').focus()
    rerender(<Harness reason={null} />)
    expect(getByTestId('btn')).toHaveFocus()
  })

  it('초점이 감싸개 밖에 있으면 옮기지 않는다', () => {
    const { getByTestId, rerender } = render(<Harness reason={null} />)
    const other = getByTestId('other')
    other.focus()
    rerender(<Harness reason="실행 중이에요" />)
    expect(other).toHaveFocus()
  })

  it('reason 을 null→문자열→null 로 바꿔도 제어/비제어 경고가 없고 null 일 때 툴팁 내용이 없다', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { getByTestId, queryByRole, rerender } = render(<Harness reason={null} />)
    expect(queryByRole('tooltip')).toBeNull()
    rerender(<Harness reason="실행 중이에요" />)
    rerender(<Harness reason={null} />)
    expect(queryByRole('tooltip')).toBeNull()
    expect(getByTestId('wrap')).toHaveAttribute('tabindex', '-1')
    const logged = [...errSpy.mock.calls, ...warnSpy.mock.calls].map((c) => c.join(' '))
    expect(logged.filter((m) => /controlled/i.test(m))).toEqual([])
  })

  it('reason 이 다른 reason 으로 바뀌면 초점을 옮기지 않는다', () => {
    const { getByTestId, rerender } = render(<Harness reason="a" />)
    const wrap = getByTestId('wrap')
    wrap.focus()
    rerender(<Harness reason="b" />)
    expect(wrap).toHaveFocus()
  })

  it('마우스 클릭 초점(:focus-visible 아님)이면 reason 이 생겨도 감싸개로 옮기지 않는다', () => {
    mockFocusVisible(false)
    const { getByTestId, rerender } = render(<Harness reason={null} />)
    const btn = getByTestId('btn')
    btn.focus()
    rerender(<Harness reason="실행 중이에요" />)
    expect(getByTestId('wrap')).not.toHaveFocus()
  })

  it('reason 이 null 이면 호버·초점에도 aria-describedby 가 없고 닫힌 상태다', () => {
    const { getByTestId } = render(<Harness reason={null} />)
    const wrap = getByTestId('wrap')
    fireEvent.pointerMove(wrap)
    fireEvent.focus(wrap)
    fireEvent.mouseEnter(wrap)
    expect(wrap).not.toHaveAttribute('aria-describedby')
    expect(wrap).toHaveAttribute('data-state', 'closed')
  })

  it('reason 이 null 이면 호출자가 tabIndex 를 넘겨도 Tab 정지가 아니고, 있으면 호출자 값이 이긴다', () => {
    const { getByTestId, rerender } = render(wrapEl({ reason: null, tabIndex: 5 }))
    expect(getByTestId('w')).toHaveAttribute('tabindex', '-1')
    rerender(wrapEl({ reason: '이유', tabIndex: 5 }))
    expect(getByTestId('w')).toHaveAttribute('tabindex', '5')
    rerender(wrapEl({ reason: '이유' }))
    expect(getByTestId('w')).toHaveAttribute('tabindex', '0')
  })

  it('막혀 이름이 있는 동안 감싸개가 button 역할로 `label — reason` 이름을 갖고, 안의 막힌 버튼은 따로 노출되지 않는다', () => {
    const view = (reason: string | null) => (
      <DisabledReasonTooltip label="상태 추가" reason={reason} data-testid="wrap">
        <button disabled={reason != null}>추가</button>
      </DisabledReasonTooltip>
    )
    const { getByTestId, rerender } = render(view('꽉 찼어요'))
    const wrap = getByTestId('wrap')
    expect(screen.getByRole('button', { name: '상태 추가 — 꽉 찼어요' })).toBe(wrap)
    expect(wrap).toHaveAttribute('aria-disabled', 'true')
    // 안쪽은 inert 라 안의 막힌 버튼은 보조기기에서 숨고 초점·클릭도 받지 않는다(중첩·중복 버튼 없음).
    // (testing-library 는 inert 를 접근 불가로 치지 않아 속성으로 확인한다.)
    const inner = wrap.querySelector('button')!
    expect(inner.closest('[inert]')).not.toBeNull()
    // 풀리면 같은 노드가 남은 채 역할·숨김이 사라지고 진짜 버튼이 이름 「추가」로 노출된다.
    rerender(view(null))
    expect(getByTestId('wrap')).toBe(wrap)
    expect(wrap.querySelector('button')).toBe(inner)
    expect(wrap).not.toHaveAttribute('role')
    expect(wrap).not.toHaveAttribute('aria-disabled')
    expect(wrap.querySelector('[inert]')).toBeNull()
    expect(screen.getByRole('button', { name: '추가' })).toBe(inner)
  })

  it('이름이 없으면(label·aria-label 없음) 막혀도 역할·inert 를 달지 않는다', () => {
    const { getByTestId } = render(wrapEl({ reason: '이유' }))
    expect(getByTestId('w')).not.toHaveAttribute('role')
    expect(getByTestId('w').querySelector('[inert]')).toBeNull()
  })

  it('aria-label 은 호출자가 줄 때만 있고(기본값 없음), reason 이 null 이면 없다', () => {
    // 기본값을 reason 으로 두면 이름을 넘기지 않던 호출부(상태 「+ 추가」 등)의 이름이 사유로 덮인다(PR #1526 리뷰).
    const { getByTestId, rerender } = render(wrapEl({ reason: '이유' }))
    expect(getByTestId('w')).not.toHaveAttribute('aria-label')
    rerender(wrapEl({ reason: '이유', 'aria-label': '이름' }))
    expect(getByTestId('w')).toHaveAttribute('aria-label', '이름')
    rerender(wrapEl({ reason: null, 'aria-label': '이름' }))
    expect(getByTestId('w')).not.toHaveAttribute('aria-label')
  })

  it('풀릴 때 초점 받을 수 있는 요소가 없으면(막힌 버튼뿐) 옮기지 않는다', () => {
    const { getByTestId, rerender } = render(
      <DisabledReasonTooltip reason="x" data-testid="w">
        <button disabled>d</button>
      </DisabledReasonTooltip>,
    )
    getByTestId('w').focus()
    rerender(
      <DisabledReasonTooltip reason={null} data-testid="w">
        <button disabled>d</button>
      </DisabledReasonTooltip>,
    )
    // 감싸개가 초점을 그대로 쥔다(body 로 떨어지면 실패).
    expect(getByTestId('w')).toHaveFocus()
  })

  it('툴팁이 열린 채 reason 이 사라지면 닫아, 다음에 reason 이 생겨도 호버·초점 없이 저절로 뜨지 않는다', () => {
    const { getByTestId, queryByRole, rerender } = render(wrapEl({ reason: '실행 중이에요' }))
    // 키보드 초점으로 툴팁을 연다(Radix 는 초점에 연다).
    fireEvent.focus(getByTestId('w'))
    expect(queryByRole('tooltip')).not.toBeNull()
    // 실행이 끝나 reason 이 사라지고, 초점도 감싸개를 떠난다.
    rerender(wrapEl({ reason: null }))
    fireEvent.blur(getByTestId('w'))
    // 다시 막혀도(마우스 클릭·예약 실행) 초점·호버가 없으니 툴팁이 뜨지 않는다.
    rerender(wrapEl({ reason: '실행 중이에요' }))
    expect(queryByRole('tooltip')).toBeNull()
  })
})

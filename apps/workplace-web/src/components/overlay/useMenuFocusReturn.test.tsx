// useMenuFocusReturn — 메뉴를 닫은 뒤 아무도 초점을 가져가지 않았으면 연 요소로 돌려준다(WP-1778).
import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it } from 'vitest'

import { useMenuFocusReturn } from './useMenuFocusReturn'

/** 훅 결과를 테스트 밖으로 꺼내기 위한 핸들. */
interface Handle {
  onCloseAutoFocus: (e: Event) => void
}

/** 메뉴 흉내 — open 일 때만 input 을 그리고, 훅의 핸들러를 handle 에 노출한다. */
function Harness({
  open,
  showButton = true,
  handleRef,
  origin,
}: {
  open: boolean
  showButton?: boolean
  origin?: HTMLElement | null
  handleRef: { current: Handle | null }
}) {
  const result = useMenuFocusReturn(open, origin)
  // 렌더 중이 아니라 effect 에서 핸들을 내보낸다.
  useEffect(() => {
    handleRef.current = result
  })
  return (
    <div>
      {showButton && <button data-testid="btn">열기</button>}
      <input data-testid="input2" />
      {open && <input data-testid="menu-input" />}
    </div>
  )
}

/** 다음 애니메이션 프레임까지 기다린다. */
async function nextFrame() {
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
}

function q(testid: string) {
  return document.querySelector(`[data-testid="${testid}"]`) as HTMLElement
}

describe('useMenuFocusReturn', () => {
  it('닫힌 뒤 초점이 body 면 연 요소로 돌려준다', async () => {
    const handleRef = { current: null as Handle | null }
    const { rerender } = render(<Harness open={false} handleRef={handleRef} />)
    q('btn').focus()
    rerender(<Harness open handleRef={handleRef} />)
    q('menu-input').focus()
    rerender(<Harness open={false} handleRef={handleRef} />) // input 제거 → 초점 body
    expect(document.activeElement).toBe(document.body)
    const e = new Event('x', { cancelable: true })
    handleRef.current!.onCloseAutoFocus(e)
    expect(e.defaultPrevented).toBe(true)
    await nextFrame()
    expect(document.activeElement).toBe(q('btn'))
  })

  it('다음 프레임에 다른 요소가 초점을 가지면 그대로 둔다', async () => {
    const handleRef = { current: null as Handle | null }
    const { rerender } = render(<Harness open={false} handleRef={handleRef} />)
    q('btn').focus()
    rerender(<Harness open handleRef={handleRef} />)
    rerender(<Harness open={false} handleRef={handleRef} />)
    handleRef.current!.onCloseAutoFocus(new Event('x', { cancelable: true }))
    q('input2').focus()
    await nextFrame()
    expect(document.activeElement).toBe(q('input2'))
  })

  it('열 때 초점이 body 였으면 아무것도 하지 않는다', async () => {
    const handleRef = { current: null as Handle | null }
    const { rerender } = render(<Harness open={false} handleRef={handleRef} />)
    ;(document.activeElement as HTMLElement | null)?.blur()
    rerender(<Harness open handleRef={handleRef} />)
    rerender(<Harness open={false} handleRef={handleRef} />)
    handleRef.current!.onCloseAutoFocus(new Event('x', { cancelable: true }))
    await nextFrame()
    expect(document.activeElement).toBe(document.body)
  })

  it('기억한 요소가 문서에서 빠졌으면 돌려주지 않는다', async () => {
    const handleRef = { current: null as Handle | null }
    const { rerender } = render(<Harness open={false} handleRef={handleRef} />)
    q('btn').focus()
    rerender(<Harness open handleRef={handleRef} />)
    rerender(<Harness open showButton={false} handleRef={handleRef} />)
    rerender(<Harness open={false} showButton={false} handleRef={handleRef} />)
    handleRef.current!.onCloseAutoFocus(new Event('x', { cancelable: true }))
    await nextFrame()
    expect(document.activeElement).toBe(document.body)
  })

  it('열린 동안 다시 렌더돼도 처음 기억한 요소를 유지한다', async () => {
    const handleRef = { current: null as Handle | null }
    const { rerender } = render(<Harness open={false} handleRef={handleRef} />)
    q('btn').focus()
    rerender(<Harness open handleRef={handleRef} />)
    q('menu-input').focus()
    rerender(<Harness open handleRef={handleRef} />) // open 그대로 재렌더
    rerender(<Harness open={false} handleRef={handleRef} />)
    handleRef.current!.onCloseAutoFocus(new Event('x', { cancelable: true }))
    await nextFrame()
    expect(document.activeElement).toBe(q('btn'))
  })

  it('처음부터 열린 채 마운트돼도 그때의 초점 요소를 기억한다', async () => {
    const handleRef = { current: null as Handle | null }
    const host = document.createElement('button')
    document.body.appendChild(host)
    host.focus()
    const { rerender } = render(<Harness open handleRef={handleRef} />)
    rerender(<Harness open={false} handleRef={handleRef} />)
    ;(document.activeElement as HTMLElement | null)?.blur()
    handleRef.current!.onCloseAutoFocus(new Event('x', { cancelable: true }))
    await nextFrame()
    expect(document.activeElement).toBe(host)
    host.remove()
  })

  describe('origin(메뉴를 연 요소)이 주어졌을 때', () => {
    /** 행(row) 안에 ⋯ 단추와 일반 단추가 있는 DOM 을 문서에 붙인다. */
    function makeRow() {
      const row = document.createElement('div')
      const inner = document.createElement('button')
      const more = document.createElement('button')
      more.setAttribute('aria-haspopup', 'menu')
      row.append(inner, more)
      document.body.appendChild(row)
      return { row, inner, more }
    }

    it('우클릭처럼 초점이 origin 밖(무관한 입력 칸)이면 행의 ⋯ 단추로 돌려준다', async () => {
      const handleRef = { current: null as Handle | null }
      const { row, more } = makeRow()
      const { rerender } = render(<Harness open={false} handleRef={handleRef} origin={row} />)
      q('input2').focus()
      rerender(<Harness open handleRef={handleRef} origin={row} />)
      rerender(<Harness open={false} handleRef={handleRef} origin={row} />)
      ;(document.activeElement as HTMLElement | null)?.blur()
      handleRef.current!.onCloseAutoFocus(new Event('x', { cancelable: true }))
      await nextFrame()
      expect(document.activeElement).toBe(more)
      expect(document.activeElement).not.toBe(q('input2'))
      row.remove()
    })

    it('기억한 요소가 origin 안이면 그 요소로 돌려준다', async () => {
      const handleRef = { current: null as Handle | null }
      const { row, inner } = makeRow()
      const { rerender } = render(<Harness open={false} handleRef={handleRef} origin={row} />)
      inner.focus()
      rerender(<Harness open handleRef={handleRef} origin={row} />)
      rerender(<Harness open={false} handleRef={handleRef} origin={row} />)
      ;(document.activeElement as HTMLElement | null)?.blur()
      handleRef.current!.onCloseAutoFocus(new Event('x', { cancelable: true }))
      await nextFrame()
      expect(document.activeElement).toBe(inner)
      row.remove()
    })

    it('⋯ 단추가 없으면 origin 자체로 돌려준다', async () => {
      const handleRef = { current: null as Handle | null }
      const row = document.createElement('div')
      row.tabIndex = -1
      document.body.appendChild(row)
      const { rerender } = render(<Harness open={false} handleRef={handleRef} origin={row} />)
      q('input2').focus()
      rerender(<Harness open handleRef={handleRef} origin={row} />)
      rerender(<Harness open={false} handleRef={handleRef} origin={row} />)
      ;(document.activeElement as HTMLElement | null)?.blur()
      handleRef.current!.onCloseAutoFocus(new Event('x', { cancelable: true }))
      await nextFrame()
      expect(document.activeElement).toBe(row)
      row.remove()
    })

    it('닫힐 때 origin 이 사라져도(IssueRowMenu 처럼) 열 때 기억한 origin 의 ⋯ 단추로 돌려준다', async () => {
      const handleRef = { current: null as Handle | null }
      const { row, more } = makeRow()
      const { rerender } = render(<Harness open={false} handleRef={handleRef} />)
      q('input2').focus()
      rerender(<Harness open handleRef={handleRef} origin={row} />)
      // 닫힘 재렌더에서는 호출부 상태가 비어 origin 이 undefined 가 된다.
      rerender(<Harness open={false} handleRef={handleRef} />)
      ;(document.activeElement as HTMLElement | null)?.blur()
      handleRef.current!.onCloseAutoFocus(new Event('x', { cancelable: true }))
      await nextFrame()
      expect(document.activeElement).toBe(more)
      row.remove()
    })

    it('초점을 못 받는 origin(div, tabIndex 없음)이면 안의 초점 가능한 자식으로 돌려준다', async () => {
      const handleRef = { current: null as Handle | null }
      const row = document.createElement('div')
      const link = document.createElement('a')
      link.href = '#x'
      row.appendChild(link)
      document.body.appendChild(row)
      const { rerender } = render(<Harness open={false} handleRef={handleRef} origin={row} />)
      q('input2').focus()
      rerender(<Harness open handleRef={handleRef} origin={row} />)
      rerender(<Harness open={false} handleRef={handleRef} origin={row} />)
      ;(document.activeElement as HTMLElement | null)?.blur()
      handleRef.current!.onCloseAutoFocus(new Event('x', { cancelable: true }))
      await nextFrame()
      expect(document.activeElement).toBe(link)
      row.remove()
    })

    it('초점을 받을 곳이 origin 에 전혀 없으면 기억한 요소로 돌려준다', async () => {
      const handleRef = { current: null as Handle | null }
      const row = document.createElement('div')
      document.body.appendChild(row)
      const { rerender } = render(<Harness open={false} handleRef={handleRef} origin={row} />)
      q('input2').focus()
      rerender(<Harness open handleRef={handleRef} origin={row} />)
      rerender(<Harness open={false} handleRef={handleRef} origin={row} />)
      ;(document.activeElement as HTMLElement | null)?.blur()
      handleRef.current!.onCloseAutoFocus(new Event('x', { cancelable: true }))
      await nextFrame()
      expect(document.activeElement).toBe(q('input2'))
      row.remove()
    })
  })
})

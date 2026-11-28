import { render, renderHook, screen, within } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it } from 'vitest'

import { createPortalNode, InPortal, OutPortal, usePortalNodes } from './portalSlot'

/** mount 횟수를 세는 탐침 — 다시 만들어지면 카운터가 늘어난다. */
function makeProbe() {
  const counter = { mounts: 0 }
  function Probe() {
    useEffect(() => {
      counter.mounts += 1
    }, [])
    return <span data-testid="probe">p</span>
  }
  return { counter, Probe }
}

describe('portalSlot', () => {
  it('InPortal 안 컴포넌트는 OutPortal 이 다른 자리로 바뀌어도 다시 mount 되지 않는다', () => {
    const { counter, Probe } = makeProbe()
    const node = createPortalNode()
    function View({ mode }: { mode: 'a' | 'b' }) {
      return (
        <>
          <InPortal node={node}>
            <Probe />
          </InPortal>
          {mode === 'a' ? (
            <section data-testid="a">
              <OutPortal node={node} />
            </section>
          ) : (
            <article data-testid="b">
              <OutPortal node={node} />
            </article>
          )}
        </>
      )
    }
    const { rerender } = render(<View mode="a" />)
    const first = within(screen.getByTestId('a')).getByTestId('probe')
    rerender(<View mode="b" />)
    expect(within(screen.getByTestId('b')).getByTestId('probe')).toBe(first)
    rerender(<View mode="a" />)
    expect(counter.mounts).toBe(1)
    expect(within(screen.getByTestId('a')).getByTestId('probe')).toBe(first)
  })

  it('슬롯이 없으면 노드는 문서 밖이고, 슬롯이 생기면 붙는다', () => {
    const { counter, Probe } = makeProbe()
    const node = createPortalNode()
    function View({ withSlot }: { withSlot: boolean }) {
      return (
        <>
          <InPortal node={node}>
            <Probe />
          </InPortal>
          {withSlot && <OutPortal node={node} />}
        </>
      )
    }
    const { rerender } = render(<View withSlot={false} />)
    expect(screen.queryByTestId('probe')).toBeNull()
    expect(counter.mounts).toBe(1)
    rerender(<View withSlot />)
    expect(screen.getByTestId('probe')).toBeTruthy()
    expect(counter.mounts).toBe(1)
  })

  it('새 슬롯이 먼저 붙고 옛 슬롯이 나중에 정리돼도 노드는 새 슬롯에 남는다', () => {
    const node = createPortalNode()
    function View({ both }: { both: boolean }) {
      return (
        <>
          <InPortal node={node}>
            <span data-testid="probe">p</span>
          </InPortal>
          {/* 같은 노드의 슬롯 둘 — 뒤 슬롯이 노드를 가져간다(앞 슬롯은 이미 빈 상태). */}
          {both && (
            <div data-testid="slot-old">
              <OutPortal node={node} />
            </div>
          )}
          <div data-testid="slot-new">
            <OutPortal node={node} />
          </div>
        </>
      )
    }
    const { rerender } = render(<View both />)
    expect(node.element.parentElement?.parentElement).toBe(screen.getByTestId('slot-new'))
    // 옛 슬롯 정리가 남의 노드를 떼려 하면 removeChild 가 던진다 — parentNode 가드가 막는다.
    expect(() => rerender(<View both={false} />)).not.toThrow()
    expect(node.element.parentElement?.parentElement).toBe(screen.getByTestId('slot-new'))
    expect(screen.getByTestId('probe')).toBeTruthy()
  })

  it('usePortalNodes 는 같은 id 에 같은 노드를, 빠진 id 는 지운다', () => {
    const { result, rerender } = renderHook(({ ids }) => usePortalNodes(ids), {
      initialProps: { ids: ['a', 'b'] as readonly string[] },
    })
    const a1 = result.current('a')
    expect(result.current('a')).toBe(a1)
    const b1 = result.current('b')
    rerender({ ids: ['b'] })
    expect(result.current('a')).not.toBe(a1)
    expect(result.current('b')).toBe(b1)
  })
})

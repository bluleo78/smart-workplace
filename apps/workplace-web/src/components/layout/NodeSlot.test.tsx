// src/components/layout/NodeSlot.test.tsx
// WP-1468: 슬롯이 바뀌어도 PageHost 안 컴포넌트가 다시 마운트되지 않는지 검증.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { NodeSlot, PageHost } from './NodeSlot'
import { useNodeBridge } from './useNodeBridge'

/** 상태를 가진 페이지 대역 — 다시 마운트되면 값이 0 으로 돌아간다. */
function Counter() {
  const [n, setN] = useState(0)
  return (
    <div>
      <span data-testid="value">{n}</span>
      <div data-scroller />
      <button onClick={() => setN((v) => v + 1)}>+1</button>
    </div>
  )
}

/** AppLayout 과 같은 구조 — 셸 분기 뒤 형제 자리에 PageHost. showPage=false 는 ResponsiveModuleLayout 모바일 목록처럼 페이지를 내린 경우. */
function Harness({ mobile = false, showPage = true }: { mobile?: boolean; showPage?: boolean }) {
  const bridge = useNodeBridge()
  return (
    <>
      {mobile ? (
        <section data-testid="m"><NodeSlot bridge={bridge} /></section>
      ) : (
        <aside data-testid="d"><NodeSlot bridge={bridge} /></aside>
      )}
      {showPage && <PageHost bridge={bridge}><Counter /></PageHost>}
    </>
  )
}

/** 브라우저처럼 노드를 옮길 때 하위 스크롤 오프셋을 0 으로 잃게 하는 appendChild 대역(happy-dom 은 잃지 않는다). */
const realAppendChild = Node.prototype.appendChild
beforeEach(() => {
  Node.prototype.appendChild = function <T extends Node>(this: Node, child: T): T {
    if (child instanceof Element) {
      child.querySelectorAll('[data-scroller]').forEach((el) => { el.scrollTop = 0 })
    }
    return realAppendChild.call(this, child) as T
  }
})
afterEach(() => {
  Node.prototype.appendChild = realAppendChild
})

/** 커밋 뒤 마이크로태스크(스크롤 복원)가 돌도록 한 틱 기다린다. */
const flush = () => act(async () => { await Promise.resolve() })

/** 안쪽 셸 — ResponsiveModuleLayout 처럼 페이지 안에서 같은 mobile 값으로 셸을 바꾸고 그 안에 스크롤 요소를 둔다. */
function InnerShell({ mobile }: { mobile: boolean }) {
  const bridge = useNodeBridge()
  return (
    <>
      {mobile ? <section><NodeSlot bridge={bridge} /></section> : <aside><NodeSlot bridge={bridge} /></aside>}
      <PageHost bridge={bridge}><div data-scroller /></PageHost>
    </>
  )
}

/** 바깥 셸 PageHost 안에 안쪽 셸이 든 구조 — 한 커밋에 두 브리지가 함께 전환된다. */
function Nested({ mobile = false }: { mobile?: boolean }) {
  const bridge = useNodeBridge()
  return (
    <>
      {mobile ? <section><NodeSlot bridge={bridge} /></section> : <aside><NodeSlot bridge={bridge} /></aside>}
      <PageHost bridge={bridge}><InnerShell mobile={mobile} /></PageHost>
    </>
  )
}

const scroller = () => document.querySelector('[data-scroller]') as HTMLElement
const plusButton = () => screen.getByRole('button', { name: '+1' })

describe('NodeSlot', () => {
  it('셸이 바뀌어도 상태가 남고 새 슬롯 안에서 클릭이 동작한다', () => {
    const { rerender } = render(<Harness />)
    expect(screen.getByTestId('d')).toContainElement(plusButton())
    fireEvent.click(plusButton())

    rerender(<Harness mobile />)
    expect(screen.getByTestId('value')).toHaveTextContent('1')
    expect(screen.getByTestId('m')).toContainElement(plusButton())
    expect(screen.queryByTestId('d')).toBeNull()

    fireEvent.click(plusButton())
    expect(screen.getByTestId('value')).toHaveTextContent('2')
  })

  it('StrictMode 에서도 셸이 바뀌면 상태가 남고 슬롯 안에 있다', () => {
    const { rerender } = render(<StrictMode><Harness /></StrictMode>)
    fireEvent.click(plusButton())
    rerender(<StrictMode><Harness mobile /></StrictMode>)
    expect(screen.getByTestId('value')).toHaveTextContent('1')
    expect(screen.getByTestId('m')).toContainElement(plusButton())
  })

  it('PageHost 가 내려가면 슬롯으로 옮긴 호스트 DOM 도 치워진다', () => {
    const { rerender } = render(<Harness />)
    rerender(<Harness showPage={false} />)
    expect(screen.queryByRole('button', { name: '+1' })).toBeNull()
    expect(screen.getByTestId('d').querySelector('[data-page-host]')).toBeNull()

    // 다시 올리면 새로 마운트돼 슬롯 안에 들어간다(상태는 처음부터).
    rerender(<Harness />)
    expect(screen.getByTestId('d')).toContainElement(plusButton())
    expect(screen.getByTestId('value')).toHaveTextContent('0')
  })

  // WP-1488: 브라우저는 노드를 옮길 때 하위 스크롤 오프셋을 잃으므로 옮기기 전후로 저장·복원한다. 복원은 커밋 뒤 마이크로태스크에서 한다.
  it('셸이 바뀌어도 페이지 안 스크롤 위치가 남는다', async () => {
    const { rerender } = render(<Harness />)
    scroller().scrollTop = 382

    rerender(<Harness mobile />)
    await flush()
    expect(scroller().scrollTop).toBe(382)

    rerender(<Harness />)
    await flush()
    expect(scroller().scrollTop).toBe(382)
  })

  it('StrictMode 에서도 셸이 바뀌면 스크롤 위치가 남는다', async () => {
    const { rerender } = render(<StrictMode><Harness /></StrictMode>)
    scroller().scrollTop = 382
    rerender(<StrictMode><Harness mobile /></StrictMode>)
    await flush()
    expect(scroller().scrollTop).toBe(382)
  })

  it('PageHost 가 내려갔다 다시 올라오면 이전 스크롤을 복원하지 않는다', async () => {
    const { rerender } = render(<Harness />)
    scroller().scrollTop = 382

    // 셸 전환과 페이지 내림이 한 커밋에 겹친다 — 옛 슬롯 해제 때 스냅샷이 잡힌 채 호스트가 치워진다.
    rerender(<Harness mobile showPage={false} />)
    await flush()
    rerender(<Harness mobile />)
    await flush()
    expect(scroller().scrollTop).toBe(0)
  })

  it('중첩 브리지(페이지 안의 또 다른 셸)도 같은 커밋에서 안쪽 스크롤이 남는다', async () => {
    const { rerender } = render(<Nested />)
    scroller().scrollTop = 382

    rerender(<Nested mobile />)
    await flush()
    expect(scroller().scrollTop).toBe(382)

    rerender(<Nested />)
    await flush()
    expect(scroller().scrollTop).toBe(382)
  })
})

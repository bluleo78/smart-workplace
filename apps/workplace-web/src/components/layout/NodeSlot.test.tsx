// src/components/layout/NodeSlot.test.tsx
// WP-1468: 슬롯이 바뀌어도 PageHost 안 컴포넌트가 다시 마운트되지 않는지 검증.
import { fireEvent, render, screen } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { describe, expect, it } from 'vitest'

import { NodeSlot, PageHost } from './NodeSlot'
import { useNodeBridge } from './useNodeBridge'

/** 상태를 가진 페이지 대역 — 다시 마운트되면 값이 0 으로 돌아간다. */
function Counter() {
  const [n, setN] = useState(0)
  return (
    <div>
      <span data-testid="value">{n}</span>
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
})

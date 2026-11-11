// src/components/mobile/MobileSidebarSheet.test.tsx
// WP-1472: 폭이 lg 경계를 넘어(데스크톱 ↔ 모바일) 분기가 바뀌어도 본문(children)이 다시 마운트되지 않는지,
// 그리고 컨텍스트 의미(데스크톱 null = ☰ 없음, 모바일 = 시트 열기)가 그대로인지 검증한다.
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MobileSidebarSheet } from './MobileSidebarSheet'
import { MobileSidebarSheetCtx, useMobileSidebarSheet } from './MobileSidebarSheetContext'

// 분기를 테스트에서 바꾸려고 useIsMobile 을 가변 값으로 대신한다(jsdom 의 matchMedia 로는 폭 전환을 일으킬 수 없다).
const mobile = vi.hoisted(() => ({ value: false }))
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mobile.value }))

/** 본문 대역 — 입력값을 상태로 들고, 컨텍스트가 있으면(모바일) ☰ 대역 버튼을 그린다. 다시 마운트되면 값이 사라진다. */
function Body() {
  const [text, setText] = useState('')
  const sheet = useMobileSidebarSheet()
  return (
    <div>
      <input aria-label="본문 입력" value={text} onChange={(e) => setText(e.target.value)} />
      {sheet && <button onClick={sheet.openSheet}>목록 열기</button>}
    </div>
  )
}

function Harness() {
  return (
    <MobileSidebarSheet title="메일" sidebar={<nav>사이드바 목록</nav>} widthKey="test-wp1472">
      <Body />
    </MobileSidebarSheet>
  )
}

const input = () => screen.getByRole('textbox', { name: '본문 입력' }) as HTMLInputElement

describe('MobileSidebarSheet (WP-1472)', () => {
  beforeEach(() => {
    mobile.value = false
    localStorage.clear()
  })

  it('데스크톱 → 모바일 → 데스크톱으로 바뀌어도 본문 입력값이 남는다', () => {
    const { rerender } = render(<Harness />)
    fireEvent.change(input(), { target: { value: '쓰던 글' } })

    mobile.value = true
    rerender(<Harness />)
    expect(input().value).toBe('쓰던 글')

    mobile.value = false
    rerender(<Harness />)
    expect(input().value).toBe('쓰던 글')
  })

  it('데스크톱은 ☰ 컨텍스트가 없고 사이드바를 옆에 그린다, 모바일은 ☰ 로 시트를 연다', () => {
    const { rerender } = render(<Harness />)
    expect(screen.queryByRole('button', { name: '목록 열기' })).toBeNull()
    expect(screen.getByText('사이드바 목록')).toBeInTheDocument()

    mobile.value = true
    rerender(<Harness />)
    // 모바일: 시트가 닫혀 있으니 사이드바는 보이지 않고 ☰ 가 생긴다.
    expect(screen.queryByText('사이드바 목록')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '목록 열기' }))
    expect(screen.getByTestId('mobile-sidebar-sheet')).toHaveTextContent('사이드바 목록')
  })

  it('데스크톱은 바깥 공급자 값을 그대로 넘긴다(공급자가 없던 예전과 같다)', () => {
    const outerOpen = vi.fn()
    render(
      <MobileSidebarSheetCtx.Provider value={{ openSheet: outerOpen, closeSheet: () => {} }}>
        <Harness />
      </MobileSidebarSheetCtx.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '목록 열기' }))
    expect(outerOpen).toHaveBeenCalledTimes(1)
  })

  it('시트를 연 채 데스크톱으로 갔다 돌아오면 시트는 닫혀 있다', () => {
    mobile.value = true
    const { rerender } = render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '목록 열기' }))
    expect(screen.getByTestId('mobile-sidebar-sheet')).toBeInTheDocument()

    mobile.value = false
    rerender(<Harness />)
    expect(screen.queryByTestId('mobile-sidebar-sheet')).toBeNull()

    mobile.value = true
    rerender(<Harness />)
    expect(screen.queryByTestId('mobile-sidebar-sheet')).toBeNull()
  })
})

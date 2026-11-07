// RawSheetContent(WP-1432) — 원시 전체 화면 시트가 닫히면 연 요소로 포커스를 돌려주되, 다른 대화상자가 포커스를 가진 경우는 빼앗지 않는다.
// 실제 키보드로 열고 닫는 통합 검색·새 이슈 시트의 복귀는 E2E(@input, e2e/pages/mobile/*)가 본다. 여기서는 jsdom 으로 판정되는 분기만 —
// 폭 전환(휴대폰 시트 → 데스크톱 대화상자)으로 언마운트될 때와, 다른 대화상자 안에서 연 시트를 닫을 때.
// Radix 는 닫힘 포커스 처리를 setTimeout(0) 으로 미루므로 가짜 타이머로 그 타이머만 확정적으로 흘린다(고정 대기 없음).
import { act, render, screen } from '@testing-library/react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

import { RawSheetContent } from './RawSheetContent'

/** Radix 가 미뤄 둔 닫힘 포커스 처리(setTimeout 0)를 흘린다. */
const flushRadixFocus = () => act(() => vi.runOnlyPendingTimers())

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

/** 전체 화면 시트 — 입력 칸 autoFocus(검색 시트와 같다), 닫기 단추. */
function Sheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <RawSheetContent aria-describedby={undefined} data-testid="sheet">
          <DialogPrimitive.Title>시트</DialogPrimitive.Title>
          <input autoFocus aria-label="입력" />
          <button onClick={onClose}>닫기</button>
        </RawSheetContent>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

describe('RawSheetContent — 닫히면 연 요소로 포커스를 돌려준다', () => {
  test('상태로 연(DialogTrigger 없는) 시트를 닫으면 연 단추로 돌아온다', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>열기</button>
          <Sheet open={open} onClose={() => setOpen(false)} />
        </>
      )
    }
    render(<Harness />)
    const opener = screen.getByRole('button', { name: '열기' })
    opener.focus()
    act(() => opener.click())
    expect(screen.getByLabelText('입력')).toHaveFocus()

    act(() => screen.getByRole('button', { name: '닫기' }).click())
    await flushRadixFocus()
    expect(opener).toHaveFocus()
  })

  test('폭 전환으로 데스크톱 대화상자로 바뀌며 언마운트되면 옛 단추로 끌어오지 않는다', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      const [mobile, setMobile] = useState(true)
      return (
        <>
          <button onClick={() => setOpen(true)}>열기</button>
          {open && mobile && <Sheet open onClose={() => setOpen(false)} />}
          {open && !mobile && (
            <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
              <DialogContent aria-describedby={undefined} onOpenAutoFocus={(e) => e.preventDefault()}>
                <DialogTitle>데스크톱</DialogTitle>
                <input aria-label="데스크톱 입력" />
              </DialogContent>
            </Dialog>
          )}
          {/* 폭 전환 흉내 — 시트 밖 단추라 포커스를 옮기지 않으려 클릭 이벤트만 보낸다. */}
          <button data-testid="to-desktop" onClick={() => setMobile(false)} />
        </>
      )
    }
    render(<Harness />)
    const opener = screen.getByRole('button', { name: '열기' })
    opener.focus()
    act(() => opener.click())
    expect(screen.getByLabelText('입력')).toHaveFocus()

    act(() => screen.getByTestId('to-desktop').click())
    await flushRadixFocus()
    expect(screen.getByLabelText('데스크톱 입력')).toBeInTheDocument()
    expect(opener).not.toHaveFocus()
  })

  test('다른 대화상자 안에서 연 시트를 닫으면 그 안의 연 단추로 돌아온다', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <Dialog open>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>바깥</DialogTitle>
            <button onClick={() => setOpen(true)}>시트 열기</button>
            <Sheet open={open} onClose={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      )
    }
    render(<Harness />)
    await flushRadixFocus()
    const opener = screen.getByRole('button', { name: '시트 열기' })
    opener.focus()
    act(() => opener.click())
    expect(screen.getByLabelText('입력')).toHaveFocus()

    act(() => screen.getByRole('button', { name: '닫기' }).click())
    await flushRadixFocus()
    expect(opener).toHaveFocus()
  })
})

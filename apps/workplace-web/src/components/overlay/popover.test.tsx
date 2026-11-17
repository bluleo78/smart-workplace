// 공용 Popover — 토스트 단추를 눌러도 열린 팝오버가 닫히지 않는다(WP-1689).
// 알림 창(팝오버)에서 「읽은 알림 보관」 뒤 토스트 「되돌리기」를 누르면 창이 닫혀 돌아온 알림이 보이지 않았다.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { Popover, PopoverContent, PopoverTrigger } from './popover'

function Harness() {
  const [open, setOpen] = useState(true)
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger>열기</PopoverTrigger>
        <PopoverContent aria-label="팝오버">내용</PopoverContent>
      </Popover>
      {/* Sonner 토스터 흉내 — 실제 토스터처럼 팝오버 포털 밖에 그린다. */}
      <section data-sonner-toaster="">
        <button type="button">되돌리기</button>
      </section>
      <button type="button">바깥</button>
    </>
  )
}

/** Radix 는 열린 뒤 다음 틱에 바깥 누름 감시를 건다 — 그 틱을 넘긴다. */
async function renderOpen() {
  render(<Harness />)
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
}

describe('공용 Popover 바깥 클릭', () => {
  it('토스트 단추를 눌러도 닫히지 않는다', async () => {
    await renderOpen()
    fireEvent.pointerDown(screen.getByRole('button', { name: '되돌리기' }))
    expect(screen.getByText('내용')).toBeInTheDocument()
  })

  it('그 밖의 바깥 클릭은 지금처럼 닫는다', async () => {
    await renderOpen()
    fireEvent.pointerDown(screen.getByRole('button', { name: '바깥' }))
    expect(screen.queryByText('내용')).toBeNull()
  })
})

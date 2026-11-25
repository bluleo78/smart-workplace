// 공용 Popover — 토스트 단추를 눌러도 열린 팝오버가 닫히지 않는다(WP-1689).
// 알림 창(팝오버)에서 「읽은 알림 보관」 뒤 토스트 「되돌리기」를 누르면 창이 닫혀 돌아온 알림이 보이지 않았다.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { Popover, PopoverContent, PopoverTrigger } from './popover'

/**
 * 타입 고정용 — 렌더하지 않는다. 이름(aria-label/aria-labelledby) 없는 PopoverContent 는 tsc 가 막아야 한다(WP-2075).
 * 막지 못하면 「Unused '@ts-expect-error' directive」 로 typecheck 가 실패한다.
 */
function _nameRequired() {
  return (
    <Popover open>
      {/* @ts-expect-error — 이름 없는 팝오버는 막는다(WP-2075) */}
      <PopoverContent>내용</PopoverContent>
      {/* 긍정 사례 — @ts-expect-error 는 그 줄의 모든 오류를 덮으므로, 이름을 준 호출은 따로 컴파일돼야 함을 고정한다.
          유니언이 잘못 좁혀져 aria-label·aria-labelledby 만 준 호출까지 막히면 여기서 typecheck 가 실패한다. */}
      <PopoverContent aria-label="이름">내용</PopoverContent>
      <PopoverContent aria-labelledby="제목-id">내용</PopoverContent>
    </Popover>
  )
}
void _nameRequired

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

describe('공용 PopoverContent 접근 이름(WP-2075)', () => {
  it('aria-labelledby 로 준 이름도 대화상자 이름이 된다', async () => {
    render(
      <Popover open>
        <PopoverContent aria-labelledby="t">
          <h2 id="t">기간 선택</h2>
        </PopoverContent>
      </Popover>,
    )
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(screen.getByRole('dialog', { name: '기간 선택' })).toBeInTheDocument()
  })
})

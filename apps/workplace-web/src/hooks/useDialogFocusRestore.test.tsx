// useDialogFocusRestore 테스트 (WP-1856) — 다이얼로그가 열린 사이 트리거가 막혀도(처리 중)
// 닫힐 때 초점이 body 로 떨어지지 않고 이유 감싸개로 돌아가는지 확인한다.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip'

/** mode: wrapped = 늘 감싼 구조(reason 만 바뀜), plain = 표지 없는 일반 부모, bare = 막힌 버튼만. 다이얼로그가 열리면 트리거를 막는다. */
function Harness({ mode }: { mode: 'wrapped' | 'plain' | 'bare' }) {
  const [open, setOpen] = useState(false)
  // 처리 중 — 열린 뒤 닫혀도 계속 막혀 있다(삭제 요청이 아직 끝나지 않은 상황).
  const [busy, setBusy] = useState(false)
  const btn = (
    <button data-testid="trigger" disabled={busy} onClick={() => { setOpen(true); setBusy(true) }}>
      삭제
    </button>
  )
  return (
    <div>
      {mode === 'plain' ? (
        // 표지 없는 일반 tabindex 0 부모 — 복원이 여기로 초점을 옮기면 안 된다.
        <span tabIndex={0} data-testid="plain-parent">
          {btn}
        </span>
      ) : mode === 'wrapped' ? (
        <DisabledReasonTooltip reason={busy ? '삭제하는 중이에요' : null} data-testid="wrap">
          {btn}
        </DisabledReasonTooltip>
      ) : (
        btn
      )}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>제목</AlertDialogTitle>
            <AlertDialogDescription>설명</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogCancel>취소</AlertDialogCancel>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** :focus-visible 판정을 고정한다 — false 면 마우스로, true 면 키보드로 연 상황(jsdom 은 이 선택자를 모른다). */
function mockFocusVisible(visible: boolean) {
  const original = Element.prototype.matches
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, sel: string) {
    if (sel === ':focus-visible') return visible
    return original.call(this, sel)
  })
}

afterEach(() => vi.restoreAllMocks())

async function openAndEscape(keyboard: boolean) {
  mockFocusVisible(keyboard)
  const user = userEvent.setup()
  await user.click(screen.getByTestId('trigger'))
  await screen.findByRole('alertdialog')
  if (!keyboard) {
    // 포인터만 쓰는 사용자 — Esc 도 keydown 이라 키보드로 치므로 「취소」 클릭으로 닫는다.
    await user.click(screen.getByText('취소'))
  } else {
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
  }
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
}

describe('useDialogFocusRestore — 마지막 입력 수단', () => {
  it('마우스로 연 뒤 안에서 키보드를 쓰고 닫으면 감싸개로 돌려준다', async () => {
    render(<Harness mode="wrapped" />)
    mockFocusVisible(false)
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trigger'))
    await screen.findByRole('alertdialog')
    // 안에서 키보드를 한 번 쓴 뒤 닫는다(닫기는 프로그램 호출 — 마지막 입력 수단은 키보드로 남는다).
    await user.keyboard('{Tab}')
    fireEvent.click(screen.getByText('취소'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(document.activeElement).toBe(screen.getByTestId('wrap'))
  })

  it('키보드로 연 뒤 안에서 마우스를 쓰고 닫으면 body 에 남고 툴팁도 없다', async () => {
    render(<Harness mode="wrapped" />)
    const user = userEvent.setup()
    // 감싸개(DisabledReasonTooltip)는 초점 받을 때 키보드 여부를 재므로, 그때는 마우스로 두고 연 순간(훅 캡처)만 키보드로 만든다.
    mockFocusVisible(false)
    screen.getByTestId('trigger').focus()
    vi.restoreAllMocks()
    mockFocusVisible(true)
    fireEvent.click(screen.getByTestId('trigger'))
    await screen.findByRole('alertdialog')
    await user.click(screen.getByText('취소'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(document.activeElement).toBe(document.body)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('이유 감싸개가 아닌 tabindex 0 부모에는 초점을 옮기지 않는다', async () => {
    render(<Harness mode="plain" />)
    await openAndEscape(true)
    expect(document.activeElement).not.toBe(screen.getByTestId('plain-parent'))
  })
})

describe('useDialogFocusRestore — 막힌 트리거', () => {
  it('키보드로 연 뒤 트리거가 막혀 있으면 이유 감싸개로 초점을 돌려준다', async () => {
    render(<Harness mode="wrapped" />)
    await openAndEscape(true)
    expect(document.activeElement).toBe(screen.getByTestId('wrap'))
  })

  it('마우스로 연 뒤 트리거가 막혀 있으면 감싸개에 초점을 주지 않아 툴팁이 뜨지 않는다', async () => {
    render(<Harness mode="wrapped" />)
    await openAndEscape(false)
    expect(document.activeElement).toBe(document.body)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('감싸개 없이 막힌 버튼만이면 지금처럼 body 에 남는다', async () => {
    render(<Harness mode="bare" />)
    await openAndEscape(true)
    expect(document.activeElement).toBe(document.body)
  })
})

// MobileSheetShell(WP-2057) — 휴대폰 바텀시트가 열리면 초점이 시트 안으로 들어가고, 닫히면 연 요소로 돌아온다.
// 예전엔 autoFocus=false 가 Radix 의 열림 초점을 막아 초점이 aria-hidden 배경에 남고 포커스 트랩이 걸리지 않았다.
// Radix 는 닫힘 포커스 처리를 setTimeout(0) 으로 미루므로 RawSheetContent.test 처럼 가짜 타이머로 흘린다.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

import { MobileActionSheet } from './MobileActionSheet'
import { MobileSheetShell } from './MobileSheetShell'

/** Radix 가 미뤄 둔 닫힘 포커스 처리(setTimeout 0)를 흘린다. */
const flushRadixFocus = () => act(() => vi.runOnlyPendingTimers())

/** 연 단추로 시트를 연다 — 초점을 단추에 둔 채 눌러 열림 초점 처리까지 흘린다. */
async function openFrom(opener: HTMLElement) {
  opener.focus()
  act(() => opener.click())
  await flushRadixFocus()
}

/**
 * Esc 로 닫는다. 닫기 전에 초점이 시트 안에 있는지부터 본다 — 옛 코드는 초점이 연 단추에 그대로 남아
 * 닫힘 복원 검증이 거짓으로 통과했다(WP-2057).
 */
async function closeByEscape() {
  expect(screen.getByTestId('sheet')).toHaveFocus()
  fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
  await flushRadixFocus()
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

/** 시트 하니스 — 「열기」 단추로 연다. */
function Sheet({ open, onClose, autoFocus }: { open: boolean; onClose: () => void; autoFocus?: boolean }) {
  return (
    <MobileSheetShell open={open} onClose={onClose} title="속성" description="속성 선택" testId="sheet" autoFocus={autoFocus}>
      {autoFocus && <input aria-label="검색" />}
      <button>분류</button>
      <button>마감</button>
    </MobileSheetShell>
  )
}

function Harness({ autoFocus, hideOpenerOnClose }: { autoFocus?: boolean; hideOpenerOnClose?: boolean }) {
  const [open, setOpen] = useState(false)
  const [showOpener, setShowOpener] = useState(true)
  return (
    <>
      {showOpener && <button onClick={() => setOpen(true)}>열기</button>}
      <Sheet
        open={open}
        autoFocus={autoFocus}
        onClose={() => {
          if (hideOpenerOnClose) setShowOpener(false)
          setOpen(false)
        }}
      />
    </>
  )
}

describe('MobileSheetShell — 열림·닫힘 초점', () => {
  test('열면 초점이 시트 컨텐츠로 들어간다', async () => {
    render(<Harness />)
    const opener = screen.getByRole('button', { name: '열기' })
    await openFrom(opener)
    expect(screen.getByTestId('sheet')).toHaveFocus()
    expect(document.activeElement?.closest('[role=dialog]')).not.toBeNull()
  })

  test('닫으면 연 단추로 돌아온다', async () => {
    render(<Harness />)
    const opener = screen.getByRole('button', { name: '열기' })
    await openFrom(opener)
    await closeByEscape()
    expect(opener).toHaveFocus()
  })

  test('autoFocus 시트는 첫 입력 칸이 초점을 받는다', async () => {
    render(<Harness autoFocus />)
    const opener = screen.getByRole('button', { name: '열기' })
    await openFrom(opener)
    expect(screen.getByLabelText('검색')).toHaveFocus()
  })

  test('연 단추가 사라지면 오류 없이 넘어간다', async () => {
    render(<Harness hideOpenerOnClose />)
    const opener = screen.getByRole('button', { name: '열기' })
    await openFrom(opener)
    // 닫힘 처리에서 던지면 act 가 그대로 던져 테스트가 실패한다. 사라진 단추로는 초점을 돌려주지 않는다.
    await closeByEscape()
    expect(opener.isConnected).toBe(false)
    expect(opener).not.toHaveFocus()
    expect(screen.queryByTestId('sheet')).toBeNull()
  })

  test('다른 대화상자 안에서 연 시트를 닫으면 그 안의 연 단추로 돌아온다', async () => {
    function Nested() {
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
    render(<Nested />)
    await flushRadixFocus()
    const opener = screen.getByRole('button', { name: '시트 열기' })
    await openFrom(opener)
    await closeByEscape()
    expect(opener).toHaveFocus()
  })

  test('편집 칸(contentEditable)에서 연 시트를 닫으면 그 칸으로 초점을 돌리지 않는다 — 모바일 키보드 방지', async () => {
    function EditableHarness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <div contentEditable suppressContentEditableWarning tabIndex={0} data-testid="editor" />
          <button onClick={() => setOpen(true)}>열기</button>
          <Sheet open={open} onClose={() => setOpen(false)} />
        </>
      )
    }
    render(<EditableHarness />)
    const editor = screen.getByTestId('editor')
    // jsdom 은 contentEditable 의 isContentEditable 을 구현하지 않아 직접 알린다.
    Object.defineProperty(editor, 'isContentEditable', { value: true })
    editor.focus()
    act(() => screen.getByRole('button', { name: '열기' }).click())
    await flushRadixFocus()
    await closeByEscape()
    expect(screen.queryByTestId('sheet')).toBeNull()
    expect(editor).not.toHaveFocus()
  })

  test('텍스트 입력 칸에서 연 시트를 닫아도 그 칸으로 초점을 돌리지 않는다', async () => {
    function InputHarness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <input aria-label="메모" onFocus={() => setOpen(true)} />
          <Sheet open={open} onClose={() => setOpen(false)} />
        </>
      )
    }
    render(<InputHarness />)
    const input = screen.getByLabelText('메모')
    act(() => input.focus())
    await flushRadixFocus()
    await closeByEscape()
    expect(screen.queryByTestId('sheet')).toBeNull()
    expect(input).not.toHaveFocus()
  })

  test('시트가 닫힐 때 다른 대화상자가 열려 있으면 연 단추로 초점을 끌어오지 않는다', async () => {
    function Covered() {
      const [open, setOpen] = useState(false)
      const [dialog, setDialog] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>열기</button>
          <Sheet
            open={open}
            onClose={() => {
              // 시트가 닫히면서 연 단추 밖의 다른 대화상자가 뜬다.
              setDialog(true)
              setOpen(false)
            }}
          />
          <Dialog open={dialog}>
            <DialogContent aria-describedby={undefined}>
              <DialogTitle>다른 대화상자</DialogTitle>
              <button>확인</button>
            </DialogContent>
          </Dialog>
        </>
      )
    }
    render(<Covered />)
    const opener = screen.getByRole('button', { name: '열기' })
    await openFrom(opener)
    await closeByEscape()
    expect(screen.getByRole('dialog', { name: '다른 대화상자' })).toBeInTheDocument()
    expect(opener).not.toHaveFocus()
  })

  test('닫으면서 사용처가 초점을 다른 곳으로 옮겼으면 연 단추로 빼앗아 오지 않는다', async () => {
    function MovesFocus() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>열기</button>
          <button>다음 칸</button>
          <Sheet
            open={open}
            onClose={() => {
              setOpen(false)
              // 위키 링크 적용처럼 닫은 뒤 사용처가 초점을 직접 옮긴다(Radix 의 닫힘 처리 타이머보다 먼저 걸린다).
              setTimeout(() => screen.getByRole('button', { name: '다음 칸' }).focus(), 0)
            }}
          />
        </>
      )
    }
    render(<MovesFocus />)
    const opener = screen.getByRole('button', { name: '열기' })
    await openFrom(opener)
    await closeByEscape()
    expect(screen.getByRole('button', { name: '다음 칸' })).toHaveFocus()
  })

  test('연 단추로 돌려줄 때 스크롤하지 않는다(preventScroll)', async () => {
    render(<Harness />)
    const opener = screen.getByRole('button', { name: '열기' })
    await openFrom(opener)
    const focusSpy = vi.spyOn(opener, 'focus')
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    await flushRadixFocus()
    expect(opener).toHaveFocus()
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true })
  })

  // 연쇄 시트(WP-2057) — 액션 시트 항목이 다른 시트를 열면, 두 번째가 닫힐 때 사라진 항목 대신 액션 시트를 연 단추로 돌아온다.
  test('액션 시트에서 연 시트를 Esc 로 닫으면 액션 시트를 연 단추로 돌아온다', async () => {
    function Chained() {
      const [actions, setActions] = useState(false)
      const [sheet, setSheet] = useState(false)
      return (
        <>
          <button onClick={() => setActions(true)}>더보기</button>
          <MobileActionSheet
            open={actions}
            onClose={() => setActions(false)}
            title="열"
            actions={[{ key: 'rename', label: '이름 변경', icon: null, onSelect: () => setSheet(true) }]}
          />
          <Sheet open={sheet} onClose={() => setSheet(false)} />
        </>
      )
    }
    render(<Chained />)
    const opener = screen.getByRole('button', { name: '더보기' })
    await openFrom(opener)
    act(() => screen.getByTestId('mobile-action-rename').click())
    await flushRadixFocus()
    await closeByEscape()
    expect(screen.queryByTestId('sheet')).toBeNull()
    expect(opener).toHaveFocus()
  })

  // 터치로 연 시트는 돌려주지 않는다(WP-2057) — 연 요소가 툴팁 트리거면 프로그램 포커스가 툴팁을 남긴다.
  async function pointerOpenClose(keyboardOnly: boolean) {
    function PointerHarness({ keyboardOnly }: { keyboardOnly: boolean }) {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>열기</button>
          <MobileSheetShell open={open} onClose={() => setOpen(false)} title="속성" description="설명" testId="sheet" restoreFocusForKeyboardOnly={keyboardOnly}>
            <button onClick={() => setOpen(false)}>닫기</button>
          </MobileSheetShell>
        </>
      )
    }
    render(<PointerHarness keyboardOnly={keyboardOnly} />)
    const opener = screen.getByRole('button', { name: '열기' })
    // 실제 클릭처럼 초점이 먼저 단추에 간 뒤 눌린다(fireEvent 는 초점을 옮기지 않는다).
    opener.focus()
    fireEvent.pointerDown(opener)
    act(() => opener.click())
    await flushRadixFocus()
    const close = screen.getByRole('button', { name: '닫기' })
    fireEvent.pointerDown(close)
    act(() => close.click())
    await flushRadixFocus()
    expect(screen.queryByTestId('sheet')).toBeNull()
    return opener
  }
  test('restoreFocusForKeyboardOnly 시트를 포인터로 열고 닫으면 연 단추로 초점을 돌리지 않는다', async () => {
    expect(await pointerOpenClose(true)).not.toHaveFocus()
  })

  // 스크린리더 터치(VoiceOver·TalkBack)는 포인터 이벤트로 열어도 복원이 필요하다 — 기본 시트는 입력 수단과 무관하게 돌려준다.
  test('기본 시트는 포인터로 열고 닫아도 연 단추로 초점을 돌려준다', async () => {
    expect(await pointerOpenClose(false)).toHaveFocus()
  })

  // 연쇄 복원은 모바일 시트 전용 — 액션 시트 항목이 연 ui Dialog 는 예전처럼 연쇄 연 요소를 받지 않는다.
  test('액션 시트 항목이 연 데스크톱 Dialog 를 닫아도 연쇄 연 요소로 돌리지 않는다', async () => {
    function ChainedDialog() {
      const [actions, setActions] = useState(false)
      const [dialog, setDialog] = useState(false)
      return (
        <>
          <button onClick={() => setActions(true)}>더보기</button>
          <MobileActionSheet
            open={actions}
            onClose={() => setActions(false)}
            title="열"
            actions={[{ key: 'rename', label: '이름 변경', icon: null, onSelect: () => setDialog(true) }]}
          />
          <Dialog open={dialog} onOpenChange={setDialog}>
            <DialogContent aria-describedby={undefined}>
              <DialogTitle>이름</DialogTitle>
              <button>확인</button>
            </DialogContent>
          </Dialog>
        </>
      )
    }
    render(<ChainedDialog />)
    const opener = screen.getByRole('button', { name: '더보기' })
    await openFrom(opener)
    act(() => screen.getByTestId('mobile-action-rename').click())
    await flushRadixFocus()
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    await flushRadixFocus()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(opener).not.toHaveFocus()
  })
})

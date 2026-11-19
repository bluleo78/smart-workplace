// 모달로 연 대화상자·시트·확인창의 aria-modal 속성(WP-1771).
// 왜: Radix Dialog 는 모달이어도 aria-modal 을 달지 않고 바깥에 aria-hidden 만 건다. 우리 래퍼가 모달일 때만 직접 단다.
// non-modal(AI side 패널 모드 등)은 바깥을 숨기면 안 되므로 속성 자체가 없어야 한다(false 도 렌더하지 않는다).
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAiPanelAwareDialog } from '@/components/ai/useAiPanelAwareDialog'
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'


// AI 패널 모드를 테스트마다 바꾼다 — hook 이 읽는 useOptionalAssistant 를 가짜로 대체.
const aiMode = vi.hoisted(() => ({ value: 'side' as 'side' | 'closed' }))
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false, getIsMobile: () => false }))
vi.mock('@/components/ai/AIAssistantContext', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useOptionalAssistant: () => ({ mode: aiMode.value, close: () => {} }),
}))

// 공유 aiMode 가 앞선 테스트에 끌려가지 않게 기본값(side)으로 되돌린다.
beforeEach(() => {
  aiMode.value = 'side'
})

function Plain({ modal, contentProps }: { modal?: boolean; contentProps?: Record<string, unknown> }) {
  return (
    <Dialog open modal={modal}>
      <DialogContent {...contentProps}>
        <DialogTitle>t</DialogTitle>
        <DialogDescription>d</DialogDescription>
      </DialogContent>
    </Dialog>
  )
}

function AiAware() {
  const { modal } = useAiPanelAwareDialog({ open: true, size: 'default' })
  return <Plain modal={modal} />
}

describe('aria-modal', () => {
  it('기본(modal) Dialog 의 role=dialog 에 aria-modal="true"', () => {
    render(<Plain />)
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true')
  })

  it('modal={false} Dialog 에는 aria-modal 이 없다', () => {
    render(<Plain modal={false} />)
    expect(screen.getByRole('dialog').hasAttribute('aria-modal')).toBe(false)
  })

  it('modal 이 바뀌면 aria-modal 도 따라 바뀐다', () => {
    const { rerender } = render(<Plain modal />)
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true')
    rerender(<Plain modal={false} />)
    expect(screen.getByRole('dialog').hasAttribute('aria-modal')).toBe(false)
    rerender(<Plain modal />)
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true')
  })

  it('호출부 aria-modal prop 이 이긴다', () => {
    render(<Plain modal={false} contentProps={{ 'aria-modal': true }} />)
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true')
  })

  it.each([
    ['Sheet 기본은 aria-modal="true"', undefined, 'true'],
    ['Sheet modal={false} 면 aria-modal 이 없다', false, null],
  ])('%s', (_name, modal, expected) => {
    render(
      <Sheet open modal={modal}>
        <SheetContent>
          <SheetTitle>t</SheetTitle>
          <SheetDescription>d</SheetDescription>
        </SheetContent>
      </Sheet>
    )
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe(expected)
  })

  it('AlertDialog 는 늘 aria-modal="true"', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>t</AlertDialogTitle>
          <AlertDialogDescription>d</AlertDialogDescription>
        </AlertDialogContent>
      </AlertDialog>
    )
    expect(screen.getByRole('alertdialog').getAttribute('aria-modal')).toBe('true')
  })

  it('side 모드 non-modal 창에는 aria-modal 이 없다', () => {
    aiMode.value = 'side'
    render(<AiAware />)
    expect(screen.getByRole('dialog').hasAttribute('aria-modal')).toBe(false)
  })

  it('closed 모드 창에는 aria-modal="true"', () => {
    aiMode.value = 'closed'
    render(<AiAware />)
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true')
  })
})

// 모바일 하단 액션 바(ViewerActionBar) — ☁ 드라이브 칸의 「조회 중」 비활성은 포커스를 지키는 aria-disabled 로 둔다(WP-1525 라이브 결함).
// disabled 를 달면 방금 누른 칸에서 브라우저가 포커스를 body 로 떨어뜨려 폴더 창이 닫힐 때 칸으로 돌아오지 못한다.
// 공유 칸의 비활성(받는 중·불가)은 누르기 전부터의 상태라 그대로 disabled 다.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import type { ActionSlot } from './viewerActions'
import { ViewerActionBar } from './ViewerMobileBars'

describe('ViewerActionBar 비활성 칸', () => {
  test('드라이브 칸은 조회 중에도 포커스를 유지하는 aria-disabled 이고 눌러도 동작하지 않는다 — 공유 칸은 disabled', () => {
    const onAction = vi.fn()
    const slots: ActionSlot[] = [
      { id: 'save', state: 'enabled' },
      { id: 'share', state: 'disabled' },
      { id: 'drive', state: 'disabled' },
      { id: 'summary', state: 'empty' },
    ]
    render(<ViewerActionBar slots={slots} share="loading" summaryOpen={false} hidden={false} onAction={onAction} />)
    const drive = screen.getByTestId('viewer-slot-drive')
    // 포커스를 받은 채 막힌다 — disabled 가 아니므로 포커스가 body 로 빠지지 않는다.
    drive.focus()
    expect(drive).not.toBeDisabled()
    expect(drive).toHaveAttribute('aria-disabled', 'true')
    expect(document.activeElement).toBe(drive)
    fireEvent.click(drive)
    expect(onAction).not.toHaveBeenCalled()
    // 공유 칸은 예전처럼 disabled.
    expect(screen.getByTestId('viewer-slot-share')).toBeDisabled()
  })

  test('조회가 끝나 드라이브 칸이 enabled 면 aria-disabled 없이 누름을 넘긴다', () => {
    const onAction = vi.fn()
    const slots: ActionSlot[] = [
      { id: 'save', state: 'enabled' },
      { id: 'share', state: 'empty' },
      { id: 'drive', state: 'enabled' },
      { id: 'summary', state: 'empty' },
    ]
    render(<ViewerActionBar slots={slots} share="none" summaryOpen={false} hidden={false} onAction={onAction} />)
    const drive = screen.getByTestId('viewer-slot-drive')
    expect(drive).not.toHaveAttribute('aria-disabled')
    fireEvent.click(drive)
    expect(onAction).toHaveBeenCalledWith('drive')
  })
})

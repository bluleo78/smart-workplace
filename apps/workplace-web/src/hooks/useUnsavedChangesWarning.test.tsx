// useUnsavedChangesWarning — 미저장 입력이 있을 때만 beforeunload 를 막는지(#620·#823).
// 켜짐 조건(제목/본문·draft 비교)은 lib/issueDraft.test.ts 가, 리스너 등록·해제는 이 파일이 지킨다(WP-413).
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useUnsavedChangesWarning } from './useUnsavedChangesWarning'

/** 실제 확인창은 띄울 수 없으므로 이벤트를 직접 보내 리스너가 preventDefault 했는지로 판정한다. */
function dispatchBeforeUnload(): boolean {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

describe('useUnsavedChangesWarning', () => {
  it('미저장 입력이 없으면 beforeunload 를 막지 않는다', () => {
    renderHook(() => useUnsavedChangesWarning(false))
    expect(dispatchBeforeUnload()).toBe(false)
  })

  it('미저장 입력이 있으면 beforeunload 를 막는다', () => {
    renderHook(() => useUnsavedChangesWarning(true))
    expect(dispatchBeforeUnload()).toBe(true)
  })

  it('입력이 사라지면(저장·취소·모달 닫힘) 경고를 해제한다', () => {
    const { rerender } = renderHook(({ dirty }) => useUnsavedChangesWarning(dirty), {
      initialProps: { dirty: true },
    })
    expect(dispatchBeforeUnload()).toBe(true)
    rerender({ dirty: false })
    expect(dispatchBeforeUnload()).toBe(false)
  })

  it('언마운트(화면 이탈)하면 리스너가 남지 않는다', () => {
    const { unmount } = renderHook(() => useUnsavedChangesWarning(true))
    unmount()
    expect(dispatchBeforeUnload()).toBe(false)
  })
})

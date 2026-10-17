// useWhatsNew — 다른 탭에서 새 소식을 읽으면(storage 이벤트) 이 탭의 안 읽음 점도 꺼지는지(WP-439).
// 번들 노트 로더는 모의로 대체해 릴리스 파일 유무와 무관하게 현재 노트(0.9.0)가 있는 상태로 검증한다.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WHATS_NEW_STORAGE_KEY } from '@/lib/releaseNotes'

vi.mock('@/lib/releaseNotesBundle', () => ({
  loadBundledNotes: () => [{ version: '0.9.0', date: '2026-10-20', body: '본문', hidden: false }],
}))

import { useWhatsNew } from './useWhatsNew'

/** 다른 탭이 저장소를 바꾼 것처럼 storage 이벤트를 보낸다(jsdom 은 같은 문서의 setItem 으로는 이벤트를 내지 않는다). */
function fireStorage(key: string | null) {
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key }))
  })
}

/** 인메모리 localStorage — Node 의 실험적 전역 localStorage 가 jsdom 것을 가려 테스트 환경에서 비어 있어, 직접 세운다. */
function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  }
}

describe('useWhatsNew storage 동기화', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))
  afterEach(() => vi.unstubAllGlobals())

  it('기록이 없으면 안 읽음이고, 다른 탭이 읽음 기록을 남기면 점이 꺼진다', () => {
    const { result } = renderHook(() => useWhatsNew())
    expect(result.current.unread).toBe(true)

    localStorage.setItem(WHATS_NEW_STORAGE_KEY, '0.9.0')
    fireStorage(WHATS_NEW_STORAGE_KEY)
    expect(result.current.unread).toBe(false)
  })

  it('다른 키의 storage 이벤트는 무시한다', () => {
    const { result } = renderHook(() => useWhatsNew())
    localStorage.setItem(WHATS_NEW_STORAGE_KEY, '0.9.0')
    fireStorage('other.key')
    expect(result.current.unread).toBe(true)
  })

  it('저장소 전체 삭제(key null)도 다시 계산한다', () => {
    localStorage.setItem(WHATS_NEW_STORAGE_KEY, '0.9.0')
    const { result } = renderHook(() => useWhatsNew())
    expect(result.current.unread).toBe(false)

    localStorage.clear()
    fireStorage(null)
    expect(result.current.unread).toBe(true)
  })

  it('언마운트하면 리스너를 해제한다', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useWhatsNew())
    unmount()
    expect(remove).toHaveBeenCalledWith('storage', expect.any(Function))
    remove.mockRestore()
  })

  it('창을 열면 확인 기록을 남기고 점을 끈다', () => {
    const { result } = renderHook(() => useWhatsNew())
    act(() => result.current.setOpen(true))
    expect(result.current.unread).toBe(false)
    expect(localStorage.getItem(WHATS_NEW_STORAGE_KEY)).toBe('0.9.0')
  })
})

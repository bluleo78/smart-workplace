// @vitest-environment jsdom
// storageWithFallback(WP-1035) — 화면 설정 기억이 같이 쓰는 저장소 읽기·쓰기.
// 무엇을: 평소엔 localStorage 에 쓰고 읽음·막힌 저장소에선 이 탭 메모리로 기억(지움 포함)·다시 쓸 수 있으면 메모리를 비움.
// 왜: 사생활 보호 모드에서 열 설정만 기억되고 필터는 기억되지 않던 차이를 없애려 한곳에 모았다.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { memoryStorage } from '@/test/memoryStorage'

import { readStored, writeStored } from './storageWithFallback'

/** 읽기는 되지만 쓰기가 던지는 저장소 — 사생활 보호 모드의 쿼터 0 과 같은 모양. */
function blockedStorage(): Storage {
  const s = memoryStorage()
  s.setItem = () => {
    throw new Error('QuotaExceededError')
  }
  s.removeItem = () => {
    throw new Error('QuotaExceededError')
  }
  return s
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('storageWithFallback', () => {
  it('평소엔 localStorage 에 쓰고 읽고, null 이면 지운다', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    writeStored('k1', 'a')
    expect(localStorage.getItem('k1')).toBe('a')
    expect(readStored('k1')).toBe('a')
    writeStored('k1', null)
    expect(readStored('k1')).toBeNull()
  })

  it('저장소가 막히면 이 탭 메모리로 기억하고, 다시 쓸 수 있게 되면 저장소로 돌아간다', () => {
    vi.stubGlobal('localStorage', blockedStorage())
    writeStored('k2', 'b')
    expect(readStored('k2')).toBe('b')
    writeStored('k2', null)
    expect(readStored('k2')).toBeNull()

    vi.stubGlobal('localStorage', memoryStorage())
    writeStored('k2', 'c')
    expect(readStored('k2')).toBe('c')
    expect(localStorage.getItem('k2')).toBe('c')
  })
})

// @vitest-environment jsdom
// copyText — Clipboard API 성공·거부·부재, execCommand 대체 경로 성공·실패를 판정한다(C3).
import { afterEach, describe, expect, it, vi } from 'vitest'

import { copyText } from './copyText'

/** navigator.clipboard 를 바꿔 끼운다(jsdom 엔 기본으로 없다). */
function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => value })
}

afterEach(() => {
  setClipboard(undefined)
  vi.restoreAllMocks()
})

describe('copyText', () => {
  it('Clipboard API 가 성공하면 true 이고 대체 경로를 쓰지 않는다', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText })
    document.execCommand = vi.fn(() => true)
    await expect(copyText('안녕')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('안녕')
    expect(document.execCommand).not.toHaveBeenCalled()
  })

  it('Clipboard API 가 없으면 execCommand 로 복사하고, 임시 textarea 는 남기지 않는다', async () => {
    setClipboard(undefined)
    document.execCommand = vi.fn(() => true)
    await expect(copyText('본문')).resolves.toBe(true)
    expect(document.execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('writeText 가 거부되고 execCommand 도 실패하면 false', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) })
    document.execCommand = vi.fn(() => false)
    await expect(copyText('x')).resolves.toBe(false)
  })

  it('execCommand 가 던져도 false(예외를 밖으로 내보내지 않는다)', async () => {
    setClipboard(undefined)
    document.execCommand = vi.fn(() => {
      throw new Error('unsupported')
    })
    await expect(copyText('x')).resolves.toBe(false)
  })
})

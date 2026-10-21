// copyToClipboard — 복사 결과에 맞는 토스트(성공/실패)를 띄우고 결과를 돌려준다.
import { afterEach, describe, expect, it, vi } from 'vitest'

const { success, error, copyText } = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  copyText: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success, error } }))
vi.mock('./copyText', () => ({ copyText }))

import { copyToClipboard } from './copyToClipboard'

const messages = { success: '복사했습니다', failure: '복사에 실패했습니다' }

afterEach(() => vi.clearAllMocks())

describe('copyToClipboard', () => {
  it('복사가 되면 성공 토스트를 띄우고 true', async () => {
    copyText.mockResolvedValue(true)
    await expect(copyToClipboard('주소', messages)).resolves.toBe(true)
    expect(copyText).toHaveBeenCalledWith('주소')
    expect(success).toHaveBeenCalledWith('복사했습니다')
    expect(error).not.toHaveBeenCalled()
  })

  it('복사가 안 되면 실패 토스트를 띄우고 false', async () => {
    copyText.mockResolvedValue(false)
    await expect(copyToClipboard('주소', messages)).resolves.toBe(false)
    expect(error).toHaveBeenCalledWith('복사에 실패했습니다')
    expect(success).not.toHaveBeenCalled()
  })
})

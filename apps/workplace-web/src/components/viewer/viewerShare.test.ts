// 공유 시트 호출 결과별 토스트 규칙(WP-278) — 취소·이미 열린 시트 재탭은 조용히, 그 외 실패만 오류 토스트.
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { shareFile } from './viewerShare'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

/** navigator.share 가 주어진 이름의 DOMException 으로 거절되게 한다. */
function rejectWith(name: string) {
  vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(new DOMException('x', name)), canShare: () => true })
}

describe('shareFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.mocked(toast.error).mockReset()
  })
  const file = new File(['a'], 'a.txt', { type: 'text/plain' })

  it('사용자가 시트를 닫은 취소(AbortError)는 토스트 없음', async () => {
    rejectWith('AbortError')
    await shareFile(file)
    expect(toast.error).not.toHaveBeenCalled()
  })
  it('시트가 열린 채 다시 탭(InvalidStateError)도 토스트 없음 — 먼저 연 시트가 그대로 동작', async () => {
    rejectWith('InvalidStateError')
    await shareFile(file)
    expect(toast.error).not.toHaveBeenCalled()
  })
  it('그 외 실패(NotAllowedError 등)는 오류 토스트', async () => {
    rejectWith('NotAllowedError')
    await shareFile(file)
    expect(toast.error).toHaveBeenCalledWith('공유하지 못했습니다')
  })
})

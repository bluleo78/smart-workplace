// 공유 시트 호출 결과별 토스트 규칙(WP-278) — 취소·이미 열린 시트 재탭은 조용히, 그 외 실패만 오류 토스트.
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { canShareFiles, shareFile } from './viewerShare'

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

// 파일 공유 지원 판정(WP-278) — 거짓이면 하단 공유 칸을 비활성이 아니라 빈칸으로 둔다(WP-408 에서 E2E 반복 케이스를 옮김).
describe('canShareFiles', () => {
  afterEach(() => vi.unstubAllGlobals())
  const share = async () => {}

  it('share·canShare 가 있고 시험 파일을 받아들이면 true', () => {
    vi.stubGlobal('navigator', { share, canShare: () => true })
    expect(canShareFiles()).toBe(true)
  })
  it('canShare 가 없으면(데스크톱 Firefox 등) false', () => {
    vi.stubGlobal('navigator', { share, canShare: undefined })
    expect(canShareFiles()).toBe(false)
  })
  it('canShare 가 파일 공유를 거부하면(데스크톱 Chrome 등) false', () => {
    vi.stubGlobal('navigator', { share, canShare: () => false })
    expect(canShareFiles()).toBe(false)
  })
  it('canShare 가 던지면 false(예외를 밖으로 내보내지 않는다)', () => {
    vi.stubGlobal('navigator', {
      share,
      canShare: () => {
        throw new TypeError('x')
      },
    })
    expect(canShareFiles()).toBe(false)
  })
})

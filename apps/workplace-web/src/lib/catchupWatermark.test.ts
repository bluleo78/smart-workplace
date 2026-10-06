import { describe, expect, it } from 'vitest'

import { catchupWatermark } from './catchupWatermark'

describe('catchupWatermark', () => {
  it('상세 미로드면 null — 로딩 중엔 캐치업 판단을 미룬다', () => {
    expect(catchupWatermark(undefined)).toBeNull()
  })

  it('비멤버면 기준점과 무관하게 null — 캐치업 API 가 403', () => {
    expect(catchupWatermark({ member: false, lastReadMessageId: null })).toBeNull()
    expect(catchupWatermark({ member: false, lastReadMessageId: 10 })).toBeNull()
  })

  it('멤버인데 기준점 null(빈 채널 가입·새 DM)이면 0 — 서버 coalesce 와 일치', () => {
    expect(catchupWatermark({ member: true, lastReadMessageId: null })).toBe(0)
  })

  it('멤버이고 기준점이 있으면 그대로', () => {
    expect(catchupWatermark({ member: true, lastReadMessageId: 42 })).toBe(42)
  })
})

// AI 분류 제안 적용 결과 토스트 — 실패한 변경을 성공으로 알리지 않는다(WP-503).
import { describe, expect, it } from 'vitest'

import { aiClassifyApplyToast } from './aiClassifyResult'

const ok = (value: unknown = undefined): PromiseSettledResult<unknown> => ({ status: 'fulfilled', value })
const fail: PromiseSettledResult<unknown> = { status: 'rejected', reason: new Error('403') }

describe('aiClassifyApplyToast', () => {
  it('모두 적용되면 「적용했습니다」', () => {
    expect(aiClassifyApplyToast([ok(true), ok(), ok()])).toBe('AI 제안을 적용했습니다')
  })

  it('일부만 적용되면 「일부만 적용했습니다」 — 이슈 PATCH 의 false 도 실패로 센다', () => {
    expect(aiClassifyApplyToast([ok(false), ok(), fail])).toBe('AI 제안 일부만 적용했습니다')
  })

  it('하나도 적용되지 않으면 성공 토스트를 띄우지 않는다', () => {
    expect(aiClassifyApplyToast([ok(false), fail, fail])).toBeNull()
  })
})

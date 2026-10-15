// deviceParams(WP-412) — 홈 레이아웃 조회·저장의 기기 쿼리 규칙 단위 테스트(홈 E2E 에서 이관).
import { describe, expect, it } from 'vitest'

import { deviceParams } from './dashboard'

describe('deviceParams (WP-142)', () => {
  it('모바일만 ?device=mobile 을 붙이고 데스크톱은 쿼리를 생략한다', () => {
    expect(deviceParams('mobile')).toEqual({ device: 'mobile' })
    expect(deviceParams('desktop')).toBeUndefined()
  })
})

// @vitest-environment jsdom
// 대기 푸시 목적지 보관소 — peek 은 지우지 않고 take 는 지운다(WP-2116).
import { beforeEach, describe, expect, it } from 'vitest'

import { peekPendingPushTarget, savePendingPushTarget, takePendingPushTarget } from './openTarget'

describe('대기 푸시 목적지', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('peek 은 지우지 않아 뒤의 take 가 같은 값을 받는다', () => {
    savePendingPushTarget({ tenantId: 1, url: '/projects/WP/issues/3' })
    expect(peekPendingPushTarget()).toEqual({ tenantId: 1, url: '/projects/WP/issues/3' })
    expect(takePendingPushTarget()).toEqual({ tenantId: 1, url: '/projects/WP/issues/3' })
    expect(takePendingPushTarget()).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'

import { RUN_STATUS_TONE } from './workflow'

/** 실행 상태 색 매핑 — 같은 상태는 모든 화면에서 같은 색(WP-2049). 상태마다 색이 있는지는 Record<RunStatus> 타입이 지킨다. */
describe('RUN_STATUS_TONE', () => {
  it('runStatusTone_waitingIsWarning', () => {
    expect(RUN_STATUS_TONE.WAITING.split(' ')).toEqual(expect.arrayContaining(['bg-warning-subtle', 'text-warning-text']))
    expect(RUN_STATUS_TONE.WAITING).not.toMatch(/info/)
  })
})

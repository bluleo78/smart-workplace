import { describe, expect, it } from 'vitest'

import { CATCHUP_TOP_ANCHOR_ID, chatEntryAnchor, UNREAD_DIVIDER_ANCHOR_ID } from './chatEntryAnchor'

describe('chatEntryAnchor', () => {
  it('구분선이 있으면 캐치업 여부와 무관하게 구분선 가운데', () => {
    expect(chatEntryAnchor(10, true)).toEqual({ id: UNREAD_DIVIDER_ANCHOR_ID, align: 'center' })
    expect(chatEntryAnchor(10, false)).toEqual({ id: UNREAD_DIVIDER_ANCHOR_ID, align: 'center' })
  })

  it('구분선 없이 상단 캐치업 슬롯이 있으면 슬롯 윗변', () => {
    expect(chatEntryAnchor(null, true)).toEqual({ id: CATCHUP_TOP_ANCHOR_ID, align: 'start' })
  })

  it('둘 다 없으면 앵커 없음(바닥 고정)', () => {
    expect(chatEntryAnchor(null, false)).toBeUndefined()
  })
})

import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import { messagingKeys } from './queries/messagingKeys'
import { handleMessagingEvent } from './useMessageStream'

// WP-135: 목록 행이 마지막 메시지 미리보기를 보여 주므로, 수정·삭제도 채널·DM 목록을 다시 불러와야 한다.
describe('handleMessagingEvent — 목록 미리보기 갱신', () => {
  for (const ev of ['messaging.message.updated', 'messaging.message.deleted']) {
    it(`${ev} 는 채널·DM 목록을 invalidate 한다`, () => {
      const qc = new QueryClient()
      const spy = vi.spyOn(qc, 'invalidateQueries')
      handleMessagingEvent(qc, ev, { channelId: 1, id: 5, body: 'x', mentions: [], editedAt: null }, 1)
      const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
      expect(keys).toContain(JSON.stringify(messagingKeys.channels()))
      expect(keys).toContain(JSON.stringify(messagingKeys.dms()))
    })
  }
})

import type { ChannelCatchupResponse } from '../types/messaging'
import { client } from './client'

/** 채널 캐치업 요약 조회. since = 진입-고정 watermark(lastReadMessageId). */
export const channelCatchupApi = {
  get: (channelId: number, since: number) =>
    client
      .get<ChannelCatchupResponse>(`/messaging/channels/${channelId}/catchup`, {
        params: { since },
      })
      .then((r) => r.data),
}

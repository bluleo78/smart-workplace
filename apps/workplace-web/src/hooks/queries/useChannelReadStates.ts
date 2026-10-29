// DM 읽음 표시(WP-1176) — 대화 상대들이 어디까지·언제 읽었는지. 처음 열 때 한 번 받고, 이후는 실시간 read 이벤트
// (useMessageStream 의 handleMessagingEvent)가 캐시를 고친다 — 그래서 창 포커스·다시 열기마다 다시 받지 않게 1분은 신선하다고 본다.
import { useQuery } from '@tanstack/react-query'

import { messagingApi } from '../../api/messaging'
import { messagingKeys } from './messagingKeys'

export function useChannelReadStates(channelId: number) {
  return useQuery({
    queryKey: messagingKeys.readStates(channelId),
    queryFn: () => messagingApi.getReadStates(channelId).then((r) => r.data),
    enabled: channelId > 0,
    staleTime: 60_000,
  })
}

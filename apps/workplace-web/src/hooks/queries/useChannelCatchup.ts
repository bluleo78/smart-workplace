import { useQuery } from '@tanstack/react-query'

import { channelCatchupApi } from '../../api/channelCatchup'
import { messagingKeys } from './messagingKeys'

/**
 * 채널 캐치업 요약. enabled 일 때만 호출(자동 임계 충족 또는 수동 트리거).
 * 같은 (channelId, since) 는 캐시 — 재진입 시 재호출 안 함.
 */
export function useChannelCatchup(
  channelId: number | undefined,
  since: number | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey:
      channelId && since != null
        ? messagingKeys.catchup(channelId, since)
        : ['messaging', 'catchup', 'idle'],
    enabled: !!channelId && since != null && enabled,
    queryFn: () => channelCatchupApi.get(channelId as number, since as number),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
}

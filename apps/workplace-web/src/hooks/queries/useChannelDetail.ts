// 채널 상세(헤더·권한 판정용). channelId 없으면 호출 안 함. 404 등 에러는 호출처에서 분기.
import { useQuery } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import type { ChannelResponse } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

export function useChannelDetail(channelId?: number) {
  return useQuery<ChannelResponse>({
    queryKey: messagingKeys.detail(channelId ?? 0),
    queryFn: () => messagingApi.getChannel(channelId as number).then((r) => r.data),
    enabled: Number.isFinite(channelId),
    retry: false, // 404(비공개 비멤버)를 즉시 노출 — 재시도 불필요
  });
}

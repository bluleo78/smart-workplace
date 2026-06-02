// 채널 멤버 목록. 멤버 패널 열림 동안에만 호출.
import { useQuery } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import type { ChannelMemberResponse } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

export function useChannelMembers(channelId?: number, enabled = true) {
  return useQuery<ChannelMemberResponse[]>({
    queryKey: messagingKeys.members(channelId ?? 0),
    queryFn: () => messagingApi.listMembers(channelId as number).then((r) => r.data),
    enabled: Number.isFinite(channelId) && enabled,
  });
}

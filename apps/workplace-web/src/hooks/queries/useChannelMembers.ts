// 채널 멤버 목록. 멤버 패널 열림 동안에만 호출.
// WP-1058 — 목록은 실효 멤버(직접 초대 + 멤버 부서로 들어온 사람, 중복 제외)다. 비공개 채널의 멤버 부서는 useChannelMemberGroups 로 따로 받는다.
import { useQuery } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import type { ChannelMemberGroup, ChannelMemberResponse } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

export function useChannelMembers(channelId?: number, enabled = true) {
  return useQuery<ChannelMemberResponse[]>({
    queryKey: messagingKeys.members(channelId ?? 0),
    queryFn: () => messagingApi.listMembers(channelId as number).then((r) => r.data),
    enabled: Number.isFinite(channelId) && enabled,
  });
}

/** 비공개 채널 멤버로 둔 조직도 부서(WP-1058) — 공개 채널·DM 은 부서를 둘 수 없어(서버 400) 부르지 않는다(enabled). */
export function useChannelMemberGroups(channelId: number, enabled = true) {
  return useQuery<ChannelMemberGroup[]>({
    queryKey: messagingKeys.memberGroups(channelId),
    queryFn: () => messagingApi.listMemberGroups(channelId).then((r) => r.data),
    enabled: Number.isFinite(channelId) && enabled,
  });
}

// 멤버 단위 mutation 모음. 성공 시 멤버 목록·채널 상세(memberCount) 무효화.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { messagingApi } from '../../api/messaging';
import { handleApiError } from '../../lib/api-error';
import type { ChannelRole } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

export function useAddMember(channelId: number) {
  const qc = useQueryClient();
  return useMutation<void, unknown, number>({
    mutationFn: (userId) => messagingApi.addMember(channelId, userId).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: messagingKeys.members(channelId) });
      qc.invalidateQueries({ queryKey: messagingKeys.detail(channelId) });
    },
    onError: (err) => handleApiError(err, '멤버 추가에 실패했습니다'),
  });
}

export function useRemoveMember(channelId: number) {
  const qc = useQueryClient();
  return useMutation<void, unknown, number>({
    mutationFn: (userId) =>
      messagingApi.removeMember(channelId, userId).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: messagingKeys.members(channelId) });
      qc.invalidateQueries({ queryKey: messagingKeys.detail(channelId) });
      toast.success('멤버를 제거했습니다');
    },
    onError: (err) => handleApiError(err, '멤버 제거에 실패했습니다'),
  });
}

// 역할 변경(OWNER 만). role:OWNER 지정 시 서버가 본인을 ADMIN 으로 강등(소유권 이전).
export function useUpdateMemberRole(channelId: number) {
  const qc = useQueryClient();
  return useMutation<void, unknown, { userId: number; role: ChannelRole }>({
    mutationFn: ({ userId, role }) =>
      messagingApi.updateMemberRole(channelId, userId, role).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: messagingKeys.members(channelId) });
      qc.invalidateQueries({ queryKey: messagingKeys.detail(channelId) });
    },
    onError: (err) => handleApiError(err, '역할 변경에 실패했습니다'),
  });
}

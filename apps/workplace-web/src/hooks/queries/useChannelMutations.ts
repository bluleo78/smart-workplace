// 채널 단위 mutation 모음. 성공 시 채널 목록/상세 무효화, 실패 시 토스트.
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import { handleApiError } from '../../lib/api-error';
import type { ChannelResponse, CreateChannelRequest } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

// 채널 생성 → 생성자 OWNER 합류. 성공 시 새 ChannelResponse 반환(호출처가 라우팅).
export function useCreateChannel() {
  const qc = useQueryClient();
  return useMutation<ChannelResponse, unknown, CreateChannelRequest>({
    mutationFn: (payload) => messagingApi.createChannel(payload).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: messagingKeys.channels() }),
    onError: (err) => handleApiError(err, '채널 생성에 실패했어요'),
  });
}

export function useRenameChannel(channelId: number) {
  const qc = useQueryClient();
  return useMutation<ChannelResponse, unknown, string>({
    mutationFn: (name) => messagingApi.renameChannel(channelId, name).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: messagingKeys.detail(channelId) });
      qc.invalidateQueries({ queryKey: messagingKeys.channels() });
    },
    onError: (err) => handleApiError(err, '채널 이름 변경에 실패했어요'),
  });
}

export function useArchiveChannel(channelId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => messagingApi.archiveChannel(channelId).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: messagingKeys.detail(channelId) });
      qc.invalidateQueries({ queryKey: messagingKeys.channels() });
    },
    onError: (err) => handleApiError(err, '채널 보관에 실패했어요'),
  });
}

export function useUnarchiveChannel(channelId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => messagingApi.unarchiveChannel(channelId).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: messagingKeys.detail(channelId) });
      qc.invalidateQueries({ queryKey: messagingKeys.channels() });
    },
    onError: (err) => handleApiError(err, '채널 보관 해제에 실패했어요'),
  });
}

// 하드 삭제(시스템 ADMIN). 성공 시 목록 무효화 — 호출처가 /chat 로 라우팅.
export function useDeleteChannel() {
  const qc = useQueryClient();
  return useMutation<void, unknown, number>({
    mutationFn: (channelId) => messagingApi.deleteChannel(channelId).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: messagingKeys.channels() }),
    onError: (err) => handleApiError(err, '채널 삭제에 실패했어요'),
  });
}

// 채널 나가기. OWNER 가 멤버 남긴 채 호출하면 서버 409 → 토스트.
export function useLeaveChannel() {
  const qc = useQueryClient();
  return useMutation<void, unknown, number>({
    mutationFn: (channelId) => messagingApi.leaveChannel(channelId).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: messagingKeys.channels() }),
    onError: (err) =>
      handleApiError(err, '먼저 소유권을 다른 멤버에게 넘긴 뒤 나갈 수 있어요'),
  });
}

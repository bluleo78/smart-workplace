// 채널 단위 mutation 모음. 성공 시 채널 목록/상세 무효화, 실패 시 토스트.
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import { extractApiErrorCode, handleApiError } from '../../lib/api-error';
import type { ChannelResponse, CreateChannelRequest } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

// 채널 생성 → 생성자 OWNER 합류. 성공 시 새 ChannelResponse 반환(호출처가 라우팅).
export function useCreateChannel() {
  const qc = useQueryClient();
  return useMutation<ChannelResponse, unknown, CreateChannelRequest>({
    mutationFn: (payload) => messagingApi.createChannel(payload).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: messagingKeys.channels() }),
    onError: (err) => handleApiError(err, '채널 생성에 실패했습니다'),
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
    // 실패는 이름 변경 대화창(RenameChannelModal)이 입력칸 아래에 보인다 — 토스트까지 띄우면 같은 문구가 두 번 보인다(WP-1150).
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
    onError: (err) => handleApiError(err, '채널 보관에 실패했습니다'),
  });
}

/** 보관 해제가 이름 겹침으로 거절됐을 때 서버가 싣는 사유 코드(409, ErrorResponse.errors.code — WP-1084). */
const CHANNEL_NAME_TAKEN = 'CHANNEL_NAME_TAKEN';

/**
 * 보관 해제. 변수로 새 이름을 주면 그 이름으로 바꾸며 해제한다(WP-1084).
 * 같은 이름의 채널이 있어 거절되면(CHANNEL_NAME_TAKEN) onNameTaken 이 있을 때 토스트 대신 그것을 부른다 — 새 이름 대화창을 여는 자리.
 * 새 이름으로 보낸 요청의 실패는 그 대화창이 인라인으로 보이므로 토스트를 띄우지 않는다.
 */
export function useUnarchiveChannel(channelId: number, { onNameTaken }: { onNameTaken?: () => void } = {}) {
  const qc = useQueryClient();
  return useMutation<void, unknown, string | undefined>({
    mutationFn: (name) => messagingApi.unarchiveChannel(channelId, name).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: messagingKeys.detail(channelId) });
      qc.invalidateQueries({ queryKey: messagingKeys.channels() });
    },
    onError: (err, name) => {
      if (name !== undefined) return;
      if (onNameTaken && extractApiErrorCode(err) === CHANNEL_NAME_TAKEN) return onNameTaken();
      handleApiError(err, '채널 보관 해제에 실패했습니다');
    },
  });
}

// 하드 삭제(시스템 ADMIN). 성공 시 목록 무효화 — 호출처가 /chat 로 라우팅.
export function useDeleteChannel() {
  const qc = useQueryClient();
  return useMutation<void, unknown, number>({
    mutationFn: (channelId) => messagingApi.deleteChannel(channelId).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: messagingKeys.channels() }),
    onError: (err) => handleApiError(err, '채널 삭제에 실패했습니다'),
  });
}

// 채널 나가기. OWNER 가 멤버 남긴 채 호출하면 서버 409 → 토스트.
export function useLeaveChannel() {
  const qc = useQueryClient();
  return useMutation<void, unknown, number>({
    mutationFn: (channelId) => messagingApi.leaveChannel(channelId).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: messagingKeys.channels() }),
    onError: (err) =>
      handleApiError(err, '먼저 소유권을 다른 멤버에게 넘긴 뒤 나갈 수 있습니다'),
  });
}

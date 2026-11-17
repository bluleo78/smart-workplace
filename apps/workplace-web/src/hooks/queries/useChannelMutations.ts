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
// 404 는 「이미 나갔거나 볼 수 없는 채널」 — 비공개 채널 비멤버의 나가기는 존재 은닉을 위해 서버가 404 를 돌린다(WP-1402).
// 사용자 입장에선 멱등이어야 하므로 성공으로 처리해 목록만 갱신한다(소유권 토스트를 띄우지 않는다).
// awaitRefetch(기본 true): 채널 목록 재조회를 기다린 뒤 호출처 onSuccess·mutateAsync 가 끝난다 — 채널 멤버 창은 갱신된 목록을 본 뒤 /chat 으로 간다.
// 그룹 DM 나가기(WP-1677, DmHeader)는 false 로 부른다: 기다리는 사이 나간 DM 이 빠진 DM 목록이 먼저 오면 DM 화면이 /chat 으로 옮기기 전에
// 「대화를 찾을 수 없습니다」로 잠깐 바뀐다(useHideDm 과 같은 이유).
export function useLeaveChannel({ awaitRefetch = true }: { awaitRefetch?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation<void, unknown, number>({
    // 떠나는 DM 표시 — DmPage 가 이 키로 「나가는 중/나감」을 알아 /chat 이동 전 「대화 없음」을 그리지 않는다(WP-1677).
    // 채널 나가기도 같은 키를 쓰지만 DmPage 는 자기 DM id 와 같은 변수만 보므로 영향이 없다.
    mutationKey: [...messagingKeys.dmDeparture(), 'leave'],
    mutationFn: async (channelId) => {
      try {
        await messagingApi.leaveChannel(channelId);
      } catch (e: unknown) {
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status === 404) return;
        throw e;
      }
    },
    onSuccess: () => {
      // 그룹 DM 나가기도 이 훅을 쓴다 — DM 목록·안 읽음 요약도 다시 받는다. 이 둘은 기다리지 않는다(위 awaitRefetch 설명과 같은 이유).
      qc.invalidateQueries({ queryKey: messagingKeys.dms() });
      qc.invalidateQueries({ queryKey: ['messaging-summary'], exact: true });
      const channels = qc.invalidateQueries({ queryKey: messagingKeys.channels() });
      if (awaitRefetch) return channels;
    },
    onError: (err) =>
      handleApiError(err, '먼저 소유권을 다른 멤버에게 넘긴 뒤 나갈 수 있습니다'),
  });
}

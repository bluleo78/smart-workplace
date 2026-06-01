// 공개 채널 참여 mutation → 채널 목록 무효화.
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import { handleApiError } from '../../lib/api-error';
import { messagingKeys } from './messagingKeys';

export function useJoinChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channelId: number) => messagingApi.joinChannel(channelId).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: messagingKeys.channels() }),
    onError: (err) => handleApiError(err, '채널 참여에 실패했어요'),
  });
}

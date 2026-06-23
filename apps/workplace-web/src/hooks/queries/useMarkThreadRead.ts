// 스레드 패널을 열 때 1회 호출 — 서버에 읽음 표시 + 부모 메시지의 unreadReplyCount 를 0 으로,
// 채널 사이드바(hasUnreadThreads)는 재조회로 동기화.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { messagingApi } from '../../api/messaging';
import { messagingKeys } from './messagingKeys';
import { bumpUnreadReplyCount } from './useCreateReply';

export function useMarkThreadRead(channelId: number) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (rootId: number) => messagingApi.markThreadRead(rootId),
  });

  return useCallback(
    (rootId: number, currentUnread: number) => {
      if (currentUnread <= 0) return; // 미읽음 없으면 호출 생략.
      bumpUnreadReplyCount(qc, channelId, rootId, -currentUnread);
      mutation.mutate(rootId, {
        // 사이드바 미읽음 스레드 점 + 인박스 목록/뱃지 동기화.
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: messagingKeys.channels() });
          qc.invalidateQueries({ queryKey: messagingKeys.threadsInbox() });
          qc.invalidateQueries({ queryKey: messagingKeys.threadsInboxUnreadCount() });
          // 스레드 읽음 처리 후 홈 어텐션/KPI 신선도 유지를 위해 messaging-summary 캐시 무효화.
          qc.invalidateQueries({ queryKey: ['messaging-summary'], exact: true });
        },
      });
    },
    [qc, channelId],
  );
}

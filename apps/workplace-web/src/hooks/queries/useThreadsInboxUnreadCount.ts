// #65 2단계: 미읽음 스레드 개수(사이드바 진입 뱃지). notify useUnreadCount 패턴 미러.
import { useQuery } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import { messagingKeys } from './messagingKeys';

export function useThreadsInboxUnreadCount() {
  return useQuery({
    queryKey: messagingKeys.threadsInboxUnreadCount(),
    queryFn: () => messagingApi.threadsInboxUnreadCount(),
  });
}

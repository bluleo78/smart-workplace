// 이슈 chat thread getter.
// 백엔드가 thread 가 없으면 자동 생성하므로 GET 한 번으로 끝남.
// staleTime 30s — thread 자체는 거의 안 변하지만 멤버 변경(자동 add)이 있을 수 있어 적당히 짧게.

import { useQuery } from '@tanstack/react-query';

import { chatApi } from '../../api/chat';
import { chatKeys } from './chatKeys';

export function useChatThread(projectKey: string, issueNumber: number) {
  return useQuery({
    queryKey: chatKeys.thread(projectKey, issueNumber),
    queryFn: () => chatApi.getThread(projectKey, issueNumber).then((r) => r.data),
    enabled: !!projectKey && Number.isFinite(issueNumber),
    staleTime: 30_000,
  });
}

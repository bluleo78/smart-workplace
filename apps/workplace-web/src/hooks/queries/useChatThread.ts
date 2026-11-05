// 이슈 chat thread getter.
// 백엔드가 thread 가 없으면 자동 생성하므로 GET 한 번으로 끝남.
// staleTime 30s — thread 자체는 거의 안 변하지만 멤버 변경(자동 add)이 있을 수 있어 적당히 짧게.

import { useQuery } from '@tanstack/react-query';

import { chatApi } from '../../api/chat';
import { chatKeys } from './chatKeys';

/** 스레드 조회 옵션 — useChatThread 와 조회 끝남 구독(useChatThreadSettled)이 같은 키·조회를 쓰게 한 곳에 둔다. */
function chatThreadQuery(projectKey: string, issueNumber: number) {
  return {
    queryKey: chatKeys.thread(projectKey, issueNumber),
    queryFn: () => chatApi.getThread(projectKey, issueNumber).then((r) => r.data),
    enabled: !!projectKey && Number.isFinite(issueNumber),
    staleTime: 30_000,
  };
}

export function useChatThread(projectKey: string, issueNumber: number) {
  return useQuery(chatThreadQuery(projectKey, issueNumber));
}

/**
 * 스레드 조회가 끝났는가(성공·실패) — 같은 캐시를 보되 상태(status)가 바뀔 때만 다시 그린다(WP-1372).
 * 스레드 응답(멤버 읽음 워터마크 등)이 바뀔 때마다 큰 화면(개인 작업 상세)이 다시 그려지지 않게 data 는 고정값으로 고른다.
 */
export function useChatThreadSettled(projectKey: string, issueNumber: number): boolean {
  const q = useQuery({ ...chatThreadQuery(projectKey, issueNumber), select: () => true, notifyOnChangeProps: ['status'] });
  return q.status !== 'pending';
}

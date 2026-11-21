// TanStack Query 키 네임스페이스.
// thread 는 issue 좌표(projectKey, issueNumber) 로 식별,
// messages 는 threadId 로 식별 (thread 응답을 받은 뒤에야 키가 결정됨).

export const chatKeys = {
  all: ['chat'] as const,
  // 모든 이슈의 스레드 쿼리 접두 — 이벤트는 threadId 만 실어 와 스레드 캐시를 이 접두로 찾는다(WP-1914).
  threads: () => [...chatKeys.all, 'thread'] as const,
  thread: (projectKey: string, issueNumber: number) =>
    [...chatKeys.all, 'thread', projectKey, issueNumber] as const,
  messages: (threadId: number) =>
    [...chatKeys.all, 'messages', threadId] as const,
};

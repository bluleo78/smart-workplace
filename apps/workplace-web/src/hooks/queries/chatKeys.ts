// TanStack Query 키 네임스페이스.
// thread 는 issue 좌표(projectKey, issueNumber) 로 식별,
// messages 는 threadId 로 식별 (thread 응답을 받은 뒤에야 키가 결정됨).

export const chatKeys = {
  all: ['chat'] as const,
  thread: (projectKey: string, issueNumber: number) =>
    [...chatKeys.all, 'thread', projectKey, issueNumber] as const,
  messages: (threadId: number) =>
    [...chatKeys.all, 'messages', threadId] as const,
};

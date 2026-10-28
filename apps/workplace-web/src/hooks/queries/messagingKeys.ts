// messaging TanStack Query 키 네임스페이스.
export const messagingKeys = {
  all: ['messaging'] as const,
  channels: () => [...messagingKeys.all, 'channels'] as const,
  /** 탐색 결과 전체 prefix(검색어 무관) — 무효화용. */
  discoverAll: () => [...messagingKeys.all, 'discover'] as const,
  discover: (q: string) => [...messagingKeys.all, 'discover', q] as const,
  detail: (channelId: number) => [...messagingKeys.all, 'detail', channelId] as const,
  members: (channelId: number) => [...messagingKeys.all, 'members', channelId] as const,
  /** 비공개 채널 멤버로 둔 조직도 부서(WP-1058) — members 아래라 멤버 목록 무효화(변경·실시간 channel 이벤트)가 함께 덮는다. */
  memberGroups: (channelId: number) => [...messagingKeys.members(channelId), 'groups'] as const,
  messages: (channelId: number) => [...messagingKeys.all, 'messages', channelId] as const,
  threads: () => [...messagingKeys.all, 'thread'] as const,
  thread: (parentMessageId: number) => [...messagingKeys.all, 'thread', parentMessageId] as const,
  dms: () => [...messagingKeys.all, 'dms'] as const,
  threadsInbox: () => [...messagingKeys.all, 'threads-inbox'] as const,
  threadsInboxUnreadCount: () => [...messagingKeys.all, 'threads-inbox-unread'] as const,
  /** 메시지의 반응자 캐시 전체 prefix — 반응 변경 시 무효화용. 'thread' 접두와 겹치지 않게 별도 네임스페이스. */
  reactorsOf: (messageId: number) => [...messagingKeys.all, 'reactors', messageId] as const,
  reactors: (messageId: number, emoji: string) =>
    [...messagingKeys.reactorsOf(messageId), emoji] as const,
  catchup: (channelId: number, since: number) =>
    [...messagingKeys.all, 'catchup', channelId, since] as const,
};

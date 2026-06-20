// messaging TanStack Query 키 네임스페이스.
export const messagingKeys = {
  all: ['messaging'] as const,
  channels: () => [...messagingKeys.all, 'channels'] as const,
  discover: (q: string) => [...messagingKeys.all, 'discover', q] as const,
  detail: (channelId: number) => [...messagingKeys.all, 'detail', channelId] as const,
  members: (channelId: number) => [...messagingKeys.all, 'members', channelId] as const,
  messages: (channelId: number) => [...messagingKeys.all, 'messages', channelId] as const,
  threads: () => [...messagingKeys.all, 'thread'] as const,
  thread: (parentMessageId: number) => [...messagingKeys.all, 'thread', parentMessageId] as const,
  dms: () => [...messagingKeys.all, 'dms'] as const,
  threadsInbox: () => [...messagingKeys.all, 'threads-inbox'] as const,
  threadsInboxUnreadCount: () => [...messagingKeys.all, 'threads-inbox-unread'] as const,
};

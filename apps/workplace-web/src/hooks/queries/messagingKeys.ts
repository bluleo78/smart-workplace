// messaging TanStack Query 키 네임스페이스.
export const messagingKeys = {
  all: ['messaging'] as const,
  channels: () => [...messagingKeys.all, 'channels'] as const,
  messages: (channelId: number) =>
    [...messagingKeys.all, 'messages', channelId] as const,
};

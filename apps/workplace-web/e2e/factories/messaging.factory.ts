// messaging E2E 테스트용 factory.
// 단일 사용 패턴: createChannel() / createMessage() 호출 시 sensible defaults + spread overrides.

import type {
  ChannelResponse,
  ChannelMemberResponse,
  MessageResponse,
} from '../../src/types/messaging';

export function createChannel(overrides: Partial<ChannelResponse> = {}): ChannelResponse {
  return {
    id: 1,
    kind: 'CHANNEL',
    name: '일반',
    visibility: 'PUBLIC',
    member: true,
    role: 'MEMBER',
    archived: false,
    memberCount: 1,
    createdAt: new Date('2026-06-01T00:00:00Z').toISOString(),
    ...overrides,
  };
}

export function createChannelMember(
  overrides: Partial<ChannelMemberResponse> = {},
): ChannelMemberResponse {
  return {
    userId: 1,
    name: '테스트 사용자',
    kind: 'HUMAN',
    role: 'MEMBER',
    joinedAt: new Date('2026-06-01T00:00:00Z').toISOString(),
    ...overrides,
  };
}

export function createMessage(overrides: Partial<MessageResponse> = {}): MessageResponse {
  return {
    id: 1,
    channelId: 1,
    authorId: 1,
    authorName: '테스트 사용자',
    authorKind: 'HUMAN',
    body: '안녕하세요',
    createdAt: new Date('2026-06-01T00:00:00Z').toISOString(),
    editedAt: null,
    deleted: false,
    ...overrides,
  };
}

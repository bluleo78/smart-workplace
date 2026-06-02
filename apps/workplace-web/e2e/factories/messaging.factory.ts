// messaging E2E 테스트용 factory.
// 단일 사용 패턴: createChannel() / createMessage() 호출 시 sensible defaults + spread overrides.

import type {
  ChannelResponse,
  ChannelMemberResponse,
  DmParticipant,
  DmResponse,
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
    unreadCount: 0,
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

export function createDmParticipant(
  overrides: Partial<DmParticipant> = {},
): DmParticipant {
  return { userId: 1, name: '테스트 사용자', kind: 'HUMAN', ...overrides };
}

export function createDm(overrides: Partial<DmResponse> = {}): DmResponse {
  return {
    id: 100,
    participants: [
      createDmParticipant({ userId: 1, name: '나' }),
      createDmParticipant({ userId: 2, name: '밥' }),
    ],
    lastMessageAt: null,
    unreadCount: 0,
    createdAt: new Date('2026-06-01T00:00:00Z').toISOString(),
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
    mentions: [],
    parentMessageId: null, // Phase 5: 스레드 답글이면 부모 id
    replyCount: 0, // Phase 5: 이 메시지에 달린 답글 수
    reactions: [], // Phase 5: 이모지별 집계
    createdAt: new Date('2026-06-01T00:00:00Z').toISOString(),
    editedAt: null,
    deleted: false,
    ...overrides,
  };
}

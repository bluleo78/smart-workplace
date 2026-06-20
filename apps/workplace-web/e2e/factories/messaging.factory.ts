// messaging E2E 테스트용 factory.
// 단일 사용 패턴: createChannel() / createMessage() 호출 시 sensible defaults + spread overrides.

import type {
  ChannelDriveSpaceResponse,
  ChannelResponse,
  ChannelMemberResponse,
  DmParticipant,
  DmResponse,
  MessageResponse,
  ReactionResponse,
  ThreadInboxItem,
} from '../../src/types/messaging';

// #76: 채널 연동 드라이브 공간 ensure 응답 팩토리.
export function createChannelDriveSpace(
  overrides: Partial<ChannelDriveSpaceResponse> = {},
): ChannelDriveSpaceResponse {
  return { spaceId: 8800, archived: false, ...overrides }
}

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
    hasUnreadThreads: false,
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

/** Phase 5: 이모지 리액션 집계 팩토리. */
export function createReaction(overrides: Partial<ReactionResponse> = {}): ReactionResponse {
  return { emoji: '👍', count: 1, reacted: false, ...overrides };
}

/** #65 2단계: 스레드 인박스 아이템 팩토리. */
export function createThreadInboxItem(
  overrides: Omit<Partial<ThreadInboxItem>, 'rootMessage'> & { rootMessage?: Partial<MessageResponse> } = {},
): ThreadInboxItem {
  const { rootMessage: rootOverrides, ...rest } = overrides;
  return {
    rootMessage: createMessage({ unreadReplyCount: 1, followed: true, ...rootOverrides }),
    channelName: '일반',
    lastReplyAt: new Date('2026-06-02T00:00:00Z').toISOString(),
    ...rest,
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
    unreadReplyCount: 0, // #65: 미읽음 답글 수(팔로우 중인 스레드)
    followed: false, // #65: 이 스레드 팔로우 여부
    reactions: [], // Phase 5: 이모지별 집계
    attachments: [], // Phase 6: 첨부 파일 목록(기본 없음 — 첨부 테스트에서 override)
    createdAt: new Date('2026-06-01T00:00:00Z').toISOString(),
    editedAt: null,
    deleted: false,
    ...overrides,
  };
}

// chat E2E 테스트용 factory.
// 단일 사용 패턴: createChatThread() / createChatMessage() 호출 시 sensible defaults + spread overrides.

import type {
  ChatMemberResponse,
  ChatMentionResponse,
  ChatMessagePage,
  ChatMessageResponse,
  ChatThreadResponse,
} from '../../src/types/chat';

const now = () => new Date().toISOString();

export function createChatMember(
  overrides: Partial<ChatMemberResponse> = {},
): ChatMemberResponse {
  return {
    userId: 1,
    username: 'testuser',
    name: '테스트 사용자',
    kind: 'HUMAN',
    lastReadMessageId: null,
    joinedAt: now(),
    ...overrides,
  };
}

export function createChatMention(
  overrides: Partial<ChatMentionResponse> = {},
): ChatMentionResponse {
  return {
    id: 1,
    username: 'testuser',
    name: '테스트 사용자',
    kind: 'HUMAN',
    ...overrides,
  };
}

export function createChatMessage(
  overrides: Partial<ChatMessageResponse> = {},
): ChatMessageResponse {
  return {
    id: 1,
    threadId: 100,
    authorId: 1,
    authorName: '테스트 사용자',
    authorKind: 'HUMAN',
    body: '안녕하세요',
    mentions: [],
    attachments: [], // #358
    driveLinks: [], // #358
    createdAt: now(),
    editedAt: null,
    deleted: false,
    ...overrides,
  };
}

export function createChatThread(
  overrides: Partial<ChatThreadResponse> = {},
): ChatThreadResponse {
  return {
    threadId: 100,
    issueId: 1,
    archivedAt: null,
    members: [createChatMember()],
    recentMessages: [],
    ...overrides,
  };
}

export function createChatMessagePage(
  items: ChatMessageResponse[] = [],
  nextCursor: string | null = null,
): ChatMessagePage {
  return { items, nextCursor, hasMore: nextCursor !== null };
}

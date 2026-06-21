// 6a 백엔드 ChatThread/Message/Member/Mention DTO 와 1:1 매칭.
// 모든 시간 필드는 ISO 8601 string. nullable 은 `... | null`.

import type { DriveLink } from './drive';
import type { MessageAttachment } from './messaging';

export type UserKind = 'HUMAN' | 'AGENT';

export interface ChatMentionResponse {
  id: number;
  username: string;
  name: string;
  kind: UserKind;
}

export interface ChatMemberResponse {
  userId: number;
  username: string;
  name: string;
  kind: UserKind;
  lastReadMessageId: number | null;
  joinedAt: string;
}

export interface ChatMessageResponse {
  id: number;
  threadId: number;
  authorId: number;
  authorName: string;
  authorKind: UserKind;
  body: string;
  mentions: ChatMentionResponse[];
  attachments: MessageAttachment[]; // #358: 첨부 파일 목록
  driveLinks: DriveLink[]; // #358: 드라이브 연결 파일 링크 목록
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
}

export interface ChatThreadResponse {
  threadId: number;
  issueId: number;
  archivedAt: string | null;
  members: ChatMemberResponse[];
  recentMessages: ChatMessageResponse[];
}

export interface ChatMessagePage {
  items: ChatMessageResponse[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CreateChatMessageRequest {
  body: string;
  fileIds?: number[]; // #358: 사전 업로드된 첨부 파일 id 목록
  driveFileIds?: number[]; // #358: 드라이브 연결 파일 id 목록
}

export interface UpdateChatMessageRequest {
  body: string;
}

export interface MarkChatReadRequest {
  uptoMessageId: number;
}

export interface AddChatMemberRequest {
  userId: number;
}

// optimistic UI 용 — 음수 id 로 식별, 'pending' 동안에는 toolbar 미노출.
export interface OptimisticChatMessage extends ChatMessageResponse {
  status: 'pending' | 'sent' | 'error';
}

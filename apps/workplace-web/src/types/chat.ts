// 6a 백엔드 ChatThread/Message/Member/Mention DTO 와 1:1 매칭.
// 모든 시간 필드는 ISO 8601 string. nullable 은 `... | null`.

import type { DriveLink } from './drive';
import type { MessageAttachment } from './messaging';
import type { UserSummary } from './user';

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
  // WP-373: AI 가 사람의 답을 기다리는 질문 글 여부(삭제되면 false). 보내는 중인 낙관적 메시지·구 API 응답엔 없다.
  question?: boolean;
  // WP-373: 작성자 로그인 id(외부 AI 식별용). 구 API 응답엔 없을 수 있다.
  authorUsername?: string;
}

export interface ChatThreadResponse {
  threadId: number;
  issueId: number;
  archivedAt: string | null;
  members: ChatMemberResponse[];
  recentMessages: ChatMessageResponse[];
  // WP-365: recentMessages 다음(더 오래된) 페이지 정보. 롤링 배포 중 구 API 응답엔 없을 수 있어 optional.
  recentNextCursor?: string | null;
  recentHasMore?: boolean;
  // WP-213: 내가 이 대화에 쓸 수 있는지(댓글 작성 권한과 동일 — 보내면 자동 참여). false 면 입력창 대신 안내.
  // 롤링 배포 중 구 API 응답엔 없을 수 있어 optional — 없으면 쓸 수 있는 것으로 본다.
  canPost?: boolean;
  // WP-373: 외부 실행 AI(담당 AI 중 첫 번째)가 있으면 그 구성원, 없으면 null — 작성창 안내에 이름을 쓴다. 구 API 응답엔 없을 수 있다.
  externalAgent?: UserSummary | null;
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

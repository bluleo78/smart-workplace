// messaging 백엔드 DTO 와 1:1 매칭. 시간 필드는 ISO 8601 string, nullable 은 `... | null`.

export type UserKind = 'HUMAN' | 'AGENT';
export type ChannelVisibility = 'PUBLIC' | 'PRIVATE';
export type ChannelRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface ChannelResponse {
  id: number;
  kind: string; // 'CHANNEL'
  name: string;
  visibility: ChannelVisibility;
  member: boolean; // caller 가 멤버인지
  role: ChannelRole | null; // 비멤버면 null
  archived: boolean;
  memberCount: number;
  unreadCount: number; // 읽지 않은 메시지 수
  createdAt: string;
}

export interface ChannelMemberResponse {
  userId: number;
  name: string;
  kind: UserKind;
  role: ChannelRole;
  joinedAt: string;
}

/** 메시지 내 멘션된 사용자 정보. */
export interface MentionResponse {
  id: number;
  username: string;
  name: string;
  kind: string;
}

export interface MessageResponse {
  id: number;
  channelId: number;
  authorId: number;
  authorName: string;
  authorKind: UserKind;
  body: string;
  mentions: MentionResponse[]; // 메시지 내 @멘션 목록
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
}

export interface MessagePage {
  items: MessageResponse[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CreateChannelRequest {
  name: string;
  visibility: ChannelVisibility;
}

export interface RenameChannelRequest {
  name: string;
}

export interface AddMemberRequest {
  userId: number;
}

export interface UpdateRoleRequest {
  role: ChannelRole;
}

export interface CreateMessageRequest {
  body: string;
}

/** DM 참여자(본인 포함). */
export interface DmParticipant {
  userId: number;
  name: string;
  kind: UserKind;
}

/** DM 1건 — name 이 없으므로 참여자에서 표시명 파생. */
export interface DmResponse {
  id: number;
  participants: DmParticipant[];
  lastMessageAt: string | null;
  unreadCount: number; // 읽지 않은 메시지 수
  createdAt: string;
}

/** DM 생성 요청 — 본인 제외 타겟. */
export interface CreateDmRequest {
  userIds: number[];
}

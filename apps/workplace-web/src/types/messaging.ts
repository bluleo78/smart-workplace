// messaging 백엔드 DTO 와 1:1 매칭. 시간 필드는 ISO 8601 string, nullable 은 `... | null`.

import type { DriveLink } from './drive'

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
  hasUnreadThreads: boolean; // 내가 팔로우하는 미읽음 스레드 존재 여부
  lastReadMessageId: number | null; // 내 읽음 워터마크(이보다 id 큰 메시지가 미읽음). 비멤버 null
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
  kind: UserKind;
}

/** 메시지의 이모지별 리액션 집계. reacted = 내가 누른 여부. */
export interface ReactionResponse {
  emoji: string;
  count: number;
  reacted: boolean;
}

/** 메시지에 첨부된 파일 1건. content 는 별도 인증 엔드포인트로 blob 다운로드. */
export interface MessageAttachment {
  fileId: number;
  messageId: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  attachedById: number;
  attachedByName: string;
  attachedAt: string;
}

/** L3 위임 확인 제안. AI 가 이슈 또는 일정 생성을 제안할 때 메시지에 첨부되는 객체. */
export interface MessageProposal {
  id: number;
  proposedByUserId: number; // 위임 요청자(이 userId 만 승인/거부 가능)
  actionType: string; // 'CREATE_ISSUE' | 'calendar.create_event'
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED';
  title: string | null; // 생성할 이슈/일정 제목
  priority: string | null; // 우선순위(선택 — 이슈 전용)
  projectName: string | null; // 대상 프로젝트명(선택 — 이슈 전용)
  projectKey: string | null; // 대상 프로젝트 키(선택 — 이슈 전용)
  candidates: { key: string; name: string }[]; // 위임 가능한 프로젝트 후보 목록(이슈 전용)
  resultIssueKey: string | null; // 이슈=이슈키, 일정="event:{id}" (CONFIRMED 일 때만)
  // --- 일정(calendar.create_event) 전용 필드 ---
  startsAt: string | null; // 시작 일시(OffsetDateTime ISO 문자열)
  endsAt: string | null; // 종료 일시(OffsetDateTime ISO 문자열)
  location: string | null; // 장소(선택)
  allDay: boolean | null; // 하루종일 여부
  conflicts: { id: number; title: string; startsAt: string; endsAt: string }[] | null; // 서버 계산 충돌 일정 목록
}

export interface MessageResponse {
  id: number;
  channelId: number;
  authorId: number;
  authorName: string;
  authorKind: UserKind;
  body: string;
  mentions: MentionResponse[]; // 메시지 내 @멘션 목록
  parentMessageId: number | null; // 스레드 답글이면 부모 id
  replyCount: number; // 이 메시지에 달린 답글 수
  unreadReplyCount: number; // 내가 팔로우하는 스레드면 미읽음 답글 수, 아니면 0
  followed: boolean; // 이 스레드(부모) 팔로우 여부
  reactions: ReactionResponse[]; // 이모지별 집계
  attachments: MessageAttachment[]; // 첨부 파일 목록
  driveLinks: DriveLink[]; // 드라이브 연결 파일 링크 목록 (#80)
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  proposal?: MessageProposal | null; // L3 위임 제안(제안 없는 메시지엔 null/undefined)
}

export interface MessagePage {
  items: MessageResponse[];
  nextCursor: string | null;
  hasMore: boolean;
}

// #65 2단계: 크로스채널 스레드 인박스 카드.
export interface ThreadInboxItem {
  rootMessage: MessageResponse; // 스레드 루트(unreadReplyCount/followed 채워짐)
  channelName: string;
  lastReplyAt: string; // ISO, 최근 답글 시각
}

export interface ThreadInboxPage {
  items: ThreadInboxItem[];
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
  parentMessageId?: number | null; // 스레드 답글 작성 시
  fileIds?: number[]; // 사전 업로드된 첨부 파일 id 목록
  driveFileIds?: number[]; // 드라이브 연결 파일 id 목록 (#80)
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

// #76: 채널 연동 드라이브 공간 ensure 응답.
export interface ChannelDriveSpaceResponse {
  spaceId: number
  archived: boolean
}

export interface CatchupGroup {
  text: string
  sourceMessageIds: number[]
}

export interface CatchupMention {
  messageId: number
  authorName: string
  snippet: string
}

export interface ChannelCatchupResponse {
  unreadCount: number
  decisions: CatchupGroup[]
  yourTurn: CatchupMention[]
  discussion: CatchupGroup[]
}

// src/tool-client.ts — 공유 도메인 도구가 호출하는 구조적 클라이언트 인터페이스(#846).
//
// 두 앱(workplace-mcp = PAT 신원, workplace-ai-agent = X-On-Behalf-Of 에이전트 신원)은 같은 REST 경로를 부르고
// 인증 방식만 다르다. 그래서 클라이언트는 "경로 호출 + 응답 래퍼 벗기기"까지만 맡고 **raw 를 그대로 반환**한다.
// LLM 에 보여줄 형태로 가공(식별자 이름 바꾸기·필드 고르기)은 공유 도구 핸들러가 한 곳에서 한다 —
// 가공이 앱마다 클라이언트에 흩어져 있던 것이 드리프트의 원인이었다(연락처 id→userId 를 한쪽만 하던 식).
import type { CurrentUserClient, ProjectMetaClient } from './resolve.js';

/** 구성원 디렉터리 행(GET /members). 핸들러가 username·userId·name 을 읽으므로 그 필드만 타입으로 고정한다. */
export interface MemberRow {
  userId: number;
  username: string;
  name: string;
  kind?: string;
  active?: boolean;
  [key: string]: unknown;
}

/** 구성원 검색 파라미터 — GET /members 쿼리와 1:1. */
export interface MemberSearchParams {
  search?: string;
  kind: 'HUMAN' | 'AGENT' | 'ALL';
  includeInactive?: boolean;
  page: number;
  size: number;
}

/** 연락처 목록 파라미터 — GET /contacts 쿼리와 1:1. */
export interface ContactListParams {
  search?: string;
  type?: 'MEMBER' | 'EXTERNAL';
  organization?: string;
  title?: string;
  favorite?: boolean;
  cursor?: string;
  limit: number;
}

/** 일정 행(GET /calendar/events) — 제안 카드 충돌 표시가 읽는 필드만 고정한다. */
export interface EventRow {
  id: number;
  title: string;
  startsAt: string;
  endsAt: string;
  [key: string]: unknown;
}

/** 이슈 목록 행(GET /me/issues) — toIssueListItem 이 읽는 필드만 고정한다(서버 IssueResponse 부분집합). */
export interface IssueRow {
  id?: number;
  issueKey?: string;
  projectKey?: string;
  number?: number;
  title?: string;
  status?: string;
  priority?: string;
  assignees?: { username?: string; name?: string; kind?: string; [key: string]: unknown }[] | null;
  dueDate?: string | null;
  type?: string | null;
  blocked?: boolean;
  [key: string]: unknown;
}

/** 이슈 목록 쿼리 — GET /me/issues 에 그대로 실리는 문자열화 가능한 값만. */
export type IssueListQuery = Record<string, string | number | boolean>;

/** 이슈 도구 — issueKey(WP-12) 기준. 코멘트 API 의 숫자 issue id 해석은 구현(rest-client)이 흡수한다. */
export interface IssueToolClient extends ProjectMetaClient, CurrentUserClient {
  /** 이슈 상세 — 백엔드 raw JSON 반환(정규화는 도구 핸들러가 normalizeIssueDetail 로 수행). */
  getIssueDetail(issueKey: string): Promise<unknown>;
  /** 이슈 생성 — 생성 응답 raw 반환. */
  createIssue(projectKey: string, body: Record<string, unknown>): Promise<unknown>;
  /** 내용/상태/우선순위/날짜 PATCH. */
  updateIssueContent(issueKey: string, body: Record<string, unknown>): Promise<unknown>;
  setIssueType(issueKey: string, typeId: number): Promise<void>;
  setIssueParent(issueKey: string, parentNumber: number | null): Promise<void>;
  replaceIssueAssignees(issueKey: string, assigneeIds: number[]): Promise<unknown>;
  replaceIssueLabels(issueKey: string, labelIds: number[]): Promise<unknown>;
  addComment(issueKey: string, body: string): Promise<void>;
  editComment(issueKey: string, commentId: number, body: string): Promise<void>;
  /** 갱신된 상세 raw 반환. */
  addIssueDependency(issueKey: string, otherNumber: number, direction: 'blocks' | 'blockedBy'): Promise<unknown>;
  removeIssueDependency(issueKey: string, otherNumber: number, direction: 'blocks' | 'blockedBy'): Promise<void>;
  /** PUT .../cycles — 사이클 집합 교체(빈 배열=전부 해제). */
  replaceIssueCycles(issueKey: string, cycleIds: number[]): Promise<unknown>;
  /** POST/DELETE .../watch — 멱등(이미 워치 중이면 no-op). */
  watchIssue(issueKey: string): Promise<void>;
  unwatchIssue(issueKey: string): Promise<void>;
}

/** 노트 페이지 요약 행(GET /wiki/spaces/{id}/pages) — 트리 조립에 쓰는 필드만 고정한다. */
export interface WikiPageRow {
  id: number;
  parentId: number | null;
  title: string;
  position: number;
  [key: string]: unknown;
}

export interface WikiToolClient {
  listWikiSpaces(): Promise<unknown>;
  searchWikiPages(query: string): Promise<unknown>;
  getWikiPage(pageId: number): Promise<unknown>;
  createWikiPage(spaceId: number, body: { parentId: number | null; title: string }): Promise<unknown>;
  /** 부분 수정 — title/body 생략 시 서버가 현재 값을 유지한다(version 만 필수, 불일치면 409). */
  updateWikiPage(pageId: number, body: { version: number; title?: string; body?: string }): Promise<unknown>;
  /** GET /wiki/spaces/{id}/pages — 평면 목록(parentId·position). 트리 조립은 핸들러(#850). */
  listWikiPages(spaceId: number): Promise<WikiPageRow[]>;
  /** GET /wiki/pages/{id}/backlinks — 래퍼 { items } 를 벗긴 배열. */
  getWikiBacklinks(pageId: number): Promise<unknown>;
  /** PATCH /wiki/pages/{id}/move — parentId null=루트, position 은 서버가 0..형제수로 자른다. */
  moveWikiPage(pageId: number, body: { parentId: number | null; position: number }): Promise<void>;
}

export interface CalendarToolClient {
  listEvents(from: string, to: string): Promise<EventRow[]>;
  getEvent(eventId: number): Promise<unknown>;
  /** PATCH /calendar/events/{id}/rsvp — 내가 초대받은 일정에만 응답한다(아니면 404). */
  rsvpEvent(eventId: number, status: 'ACCEPTED' | 'DECLINED' | 'TENTATIVE'): Promise<void>;
}

export interface MailToolClient {
  listMailAccounts(): Promise<unknown>;
  listMail(
    accountId: number,
    params: { folder: string; limit: number; query?: string; unread?: boolean },
  ): Promise<unknown>;
  getMail(messageId: number): Promise<unknown>;
  /** GET .../summary — 없으면 생성해 캐시한다(메일 원문은 바꾸지 않음). */
  getMailSummary(messageId: number): Promise<unknown>;
  /** POST .../reply-draft — 초안 본문만 돌려준다(저장·발송 없음). */
  draftMailReply(messageId: number): Promise<unknown>;
  /** POST .../issue-draft — 이슈 초안·후보 프로젝트만 돌려준다(저장 없음). */
  draftIssueFromMail(messageId: number): Promise<unknown>;
  /** GET .../linked-issue — 이 메일로 만든 이슈. 없으면 null. */
  getMailLinkedIssue(messageId: number): Promise<{ issueKey: string } | null>;
  /** POST .../issue — 메일을 이슈로 만들고 백레퍼런스를 남긴다. 이미 만든 메일이면 서버가 409(#859). */
  promoteMailToIssue(
    messageId: number,
    body: { projectKey: string; title: string; body?: string; priority?: string; assigneeIds?: number[] },
  ): Promise<{ issueKey: string }>;
  /** POST/DELETE .../needs-reply-done — 회신필요 처리완료 표시/해제. */
  setMailNeedsReplyDone(accountId: number, messageId: number, done: boolean): Promise<void>;
}

export interface MemberToolClient {
  searchMembers(params: MemberSearchParams): Promise<MemberRow[]>;
  getMemberContact(userId: number): Promise<unknown>;
  /** 응답 래퍼 { items, nextCursor } 를 그대로 반환(가공은 핸들러). */
  listContacts(params: ContactListParams): Promise<unknown>;
  getExternalContact(externalId: number): Promise<unknown>;
}

/** 연락처 대상(즐겨찾기·그룹 멤버) — MEMBER=user.id, EXTERNAL=contact_entry.id. 서버 FavoriteRequest/AddMemberRequest 와 1:1. */
export interface ContactTarget {
  targetType: 'MEMBER' | 'EXTERNAL';
  targetId: number;
}

/** 그룹 상세 멤버 행(UserGroupMemberSummary) — 뷰 가공(숫자 id → username/externalId)이 읽는 필드만 고정한다. */
export interface UserGroupMemberRow {
  targetType: 'MEMBER' | 'EXTERNAL';
  targetId: number;
  name: string;
  email?: string | null;
  title?: string | null;
  organization?: string | null;
  /** MEMBER 만(#839). EXTERNAL 은 null. */
  username?: string | null;
}

/** 그룹 트리 노드·상세 공통 필드(UserGroupNode/UserGroupDetail). */
interface UserGroupRowBase {
  id: number;
  code?: string | null;
  name: string;
  parentId?: number | null;
  ownerId?: number | null;
  visibility: 'SHARED' | 'PERSONAL';
  sortOrder?: number;
}

/** 그룹 트리 노드(UserGroupNode). */
export interface UserGroupNodeRow extends UserGroupRowBase {
  children?: UserGroupNodeRow[];
}

/** 그룹 상세(UserGroupDetail) — 직속 멤버 포함. */
export interface UserGroupDetailRow extends UserGroupRowBase {
  members?: UserGroupMemberRow[];
}

/**
 * 연락처 부가 기능(#839) — 즐겨찾기·필터 facets·사용자 그룹. 권한은 서버가 강제한다(그룹: SHARED=user-group:manage,
 * PERSONAL=소유자).
 */
export interface ContactToolClient {
  /** GET /contacts/facets — { organizations, titles } 원형. */
  getContactFacets(): Promise<unknown>;
  /** POST/DELETE /contacts/favorites — 멱등. */
  addContactFavorite(target: ContactTarget): Promise<void>;
  removeContactFavorite(target: ContactTarget): Promise<void>;
  /** GET /user-groups — { shared, personal } 트리 원형. */
  listUserGroups(): Promise<{ shared?: UserGroupNodeRow[]; personal?: UserGroupNodeRow[] }>;
  getUserGroup(groupId: number): Promise<UserGroupDetailRow>;
  createUserGroup(body: {
    name: string;
    parentId?: number;
    visibility: 'SHARED' | 'PERSONAL';
    code?: string;
    sortOrder?: number;
  }): Promise<UserGroupDetailRow>;
  /** PATCH /user-groups/{id} — 부분 수정(생략=유지). 최상위 이동은 moveToRoot, 코드 비우기는 clearCode 플래그. */
  updateUserGroup(
    groupId: number,
    body: {
      name?: string;
      parentId?: number;
      moveToRoot?: boolean;
      code?: string;
      clearCode?: boolean;
      sortOrder?: number;
    },
  ): Promise<UserGroupDetailRow>;
  addUserGroupMember(groupId: number, target: ContactTarget): Promise<UserGroupDetailRow>;
  removeUserGroupMember(groupId: number, target: ContactTarget): Promise<void>;
}

export interface MessagingToolClient {
  listChannels(): Promise<unknown>;
  getChannelMessages(channelId: number, limit: number): Promise<unknown>;
  /** parentMessageId 가 있으면 그 스레드에 답한다. */
  addChannelMessage(channelId: number, body: string, parentMessageId?: number): Promise<unknown>;
  /**
   * GET /messaging/messages/{id}/replies — 오래된 순 커서 페이지 원형(#850).
   * 래퍼를 벗기지 않는다: hasMore 를 버리면 긴 스레드의 최신 답글이 잘린 걸 모른 채 요약하게 된다.
   */
  getThreadReplies(messageId: number, params: { limit: number; cursor?: string }): Promise<ThreadReplyPage>;
  /** GET /messaging/channels/{id} — 나가기 전 공개 여부 확인용. */
  getChannel(channelId: number): Promise<{ id: number; name?: string; visibility?: string; kind?: string }>;
  /** POST /messaging/channels — 생성자가 OWNER 가 된다. 이름 중복은 409. */
  createChannel(body: { name: string; visibility: 'PUBLIC' | 'PRIVATE' }): Promise<unknown>;
  /** POST /messaging/dms — 같은 참여자 DM 이 있으면 그것을 돌려준다(find-or-create). */
  openDm(userIds: number[]): Promise<{ id: number; participants?: { name: string; [key: string]: unknown }[] }>;
  /** POST /messaging/channels/{id}/leave — 이미 비멤버면 no-op, OWNER 는 409. */
  leaveChannel(channelId: number): Promise<void>;
}

export interface DriveToolClient {
  listDriveSpaces(): Promise<unknown>;
  /** 응답 { folders, files } 원형 — 파일 행 식별자 가공은 toDriveItemsView(핸들러). */
  listDriveItems(spaceId: number, parentId?: number): Promise<unknown>;
  searchDrive(spaceId: number, q: string): Promise<unknown>;
  /** GET /drive/files/{id}/summary — { summary, status, reason } 원형(#850). */
  getDriveFileSummary(driveFileId: number): Promise<unknown>;
  /** GET /drive/search — 추출 텍스트 내용 검색. 응답 { hits, semantic } 원형(hit 의 core fileId 제거는 핸들러). */
  searchDriveContent(params: { q: string; spaceId?: number; limit: number }): Promise<DriveContentSearchResult>;
  /** GET /drive/spaces/{id}/trash — 휴지통 루트 항목(래퍼 { items } 를 벗긴 배열). */
  listDriveTrash(spaceId: number): Promise<DriveTrashRow[]>;
  /** POST /drive/files|folders/{id}/restore — 같은 삭제 묶음이 함께 복원된다. */
  restoreDriveFile(driveFileId: number): Promise<void>;
  restoreDriveFolder(folderId: number): Promise<void>;
}

/** 휴지통 항목 — type 에 따라 id 가 drive_file.id(FILE) 또는 폴더 id(FOLDER)다. 뷰가 이름을 나눠 붙이므로 그 필드를 고정한다. */
export interface DriveTrashRow {
  type: 'FILE' | 'FOLDER';
  id: number;
  [key: string]: unknown;
}

/** 스레드 답글 한 페이지 — 핸들러가 nextCursor 를 따라 모으고 행을 줄이므로 그 필드만 고정한다. */
export interface ThreadReplyPage {
  items: Record<string, unknown>[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** 드라이브 내용 검색 응답 — hit 의 core fileId 를 핸들러가 지우므로 그 필드를 타입으로 고정한다(#840). */
export interface DriveContentSearchResult {
  hits: { fileId: number; [key: string]: unknown }[];
  [key: string]: unknown;
}

/** 알림 행(GET /notifications) — 뷰 가공(숫자 id 제거·이슈키 조립)이 읽는 필드만 고정한다. */
export interface NotificationRow {
  id: number;
  read: boolean;
  actorId?: number | null;
  issueId?: number | null;
  commentId?: number | null;
  projectKey?: string | null;
  issueNumber?: number | null;
  [key: string]: unknown;
}

/** 알림 도구 — 호출자 본인의 알림만 다룬다(서버가 recipientId=callerId 로 격리). */
export interface NotificationToolClient {
  /** 최신순 페이지. offset 으로 이어 읽는다(서버에 안 읽음 필터가 없어 unreadOnly 는 핸들러가 넘겨 가며 모은다). */
  listNotifications(params: { limit: number; offset: number }): Promise<NotificationRow[]>;
  countUnreadNotifications(): Promise<number>;
  /** 멱등 — 이미 읽었거나 남의 알림이면 서버가 0행 처리한다. */
  markNotificationRead(notificationId: number): Promise<void>;
  markAllNotificationsRead(): Promise<void>;
}

export interface ProjectToolClient extends ProjectMetaClient {
  listProjects(page: number, size: number): Promise<unknown>;
  getProject(projectKey: string): Promise<Record<string, unknown>>;
  /** PATCH /projects/{key} — 부분 수정(#858). 생략(undefined) 필드는 유지, 설명 비우기는 clearDescription. */
  updateProject(
    projectKey: string,
    body: { name?: string; description?: string; clearDescription?: boolean },
  ): Promise<unknown>;
  /** GET /me/issues — 응답 래퍼 { items } 를 벗긴 이슈 행 배열(가공은 핸들러). */
  listIssues(query: IssueListQuery): Promise<IssueRow[]>;
}

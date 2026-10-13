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

/**
 * 번호 페이지(Spring Page) 응답을 벗긴 결과 — GET /projects·/members 가 준다(WP-352).
 * 서버 PageResponse 는 { content, page, size, totalElements, totalPages } 라 "마지막 페이지 여부" 필드가 없어 totalPages 로 가른다.
 * 핸들러가 이 값으로 { items, total, hasMore?, nextPage? } 를 만들어 잘림을 LLM 에 알린다.
 */
export interface PageResult<T> {
  items: T[];
  /** 전체 건수(서버 totalElements). 서버가 안 주는 bare 배열 응답이면 undefined. */
  total?: number;
  /** 다음 페이지가 더 있는가 — page + 1 < totalPages. */
  hasMore: boolean;
  /** 이 응답의 페이지 번호(0 기준). */
  page: number;
}

/** 커서 페이지 응답 — GET /me/issues·/messaging/channels/{id}/messages 가 { items, nextCursor, hasMore } 로 준다(WP-352). */
export interface CursorPage<T> {
  items: T[];
  /** 다음 페이지를 읽을 커서. 더 없으면 서버가 null — 핸들러가 출력에서 생략한다. */
  nextCursor?: string | null;
  hasMore?: boolean;
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
  startDate?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  closedAt?: string | null;
  /** 서버는 유형 요약 객체({id,name,...})를 준다 — 뷰가 이름만 뽑는다. */
  type?: { name?: string; [key: string]: unknown } | null;
  labels?: { name?: string; [key: string]: unknown }[] | null;
  milestoneName?: string | null;
  parent?: { number?: number; title?: string; status?: string; [key: string]: unknown } | null;
  childCount?: number;
  childDoneCount?: number;
  blocked?: boolean;
  /** AI 작업 진행(WP-377) — 없으면 키 자체가 없다. */
  agentWork?: Record<string, unknown>[] | null;
  [key: string]: unknown;
}

/** 이슈 목록 쿼리 — GET /me/issues 에 그대로 실리는 문자열화 가능한 값만. */
export type IssueListQuery = Record<string, string | number | boolean>;

/**
 * AI 작업 보고 입력 상태 목록(WP-377, A2A 1.0 어휘) — 단일 정의. zod 스키마(`schemas.ts`)와 아래 타입이 모두 여기서 나온다.
 * 뒤 네 값(COMPLETED·FAILED·CANCELED·REJECTED)은 종료 상태라 보고하면 작업 기록이 끝난다.
 * 조회 뷰에는 진행 중 상태 7종(여기 입력의 앞 6종 + SUBMITTED=시작 전)만 나온다.
 */
export const AGENT_WORK_STATE_INPUTS = [
  'WORKING',
  'INPUT_REQUIRED',
  'AUTH_REQUIRED',
  'BLOCKED',
  'PAUSED',
  'REVIEW',
  'COMPLETED',
  'FAILED',
  'CANCELED',
  'REJECTED',
] as const;

/** AI 작업 보고 입력 상태 — {@link AGENT_WORK_STATE_INPUTS} 의 원소. */
export type AgentWorkStateInput = (typeof AGENT_WORK_STATE_INPUTS)[number];

/** PUT .../agent-work 본문 — 준 필드만 서버로 간다. */
export interface ReportAgentWorkBody {
  state?: AgentWorkStateInput;
  note?: string;
  progress?: number;
  stepsDone?: number;
  stepsTotal?: number;
  message?: string;
}

/** PUT .../agent-work 응답 — work 는 raw AgentWorkView(끝났으면 null), ended 는 이번 보고로 기록이 끝났는지. */
export interface AgentWorkReport {
  work: Record<string, unknown> | null;
  ended: boolean;
}

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
  /** PUT .../agent-work — 담당 이슈에 대한 AI 작업 보고(WP-377). message 가 있으면 호출마다 이슈 챗에 글이 올라가 재시도는 중복 글을 만든다(멱등 아님). */
  reportAgentWork(issueKey: string, body: ReportAgentWorkBody): Promise<AgentWorkReport>;
  /** 갱신된 상세 raw 반환. */
  addIssueDependency(issueKey: string, otherNumber: number, direction: 'blocks' | 'blockedBy'): Promise<unknown>;
  removeIssueDependency(issueKey: string, otherNumber: number, direction: 'blocks' | 'blockedBy'): Promise<void>;
  /** PUT .../cycles — 사이클 집합 교체(빈 배열=전부 해제). */
  replaceIssueCycles(issueKey: string, cycleIds: number[]): Promise<unknown>;
  /** GET .../cycles — 이슈에 연결된 사이클 요약(id·name·status). get_issue_detail 동봉용(WP-176). */
  getIssueCycles(issueKey: string): Promise<{ id: number; name: string; status: string }[]>;
  /** POST/DELETE .../watch — 멱등(이미 워치 중이면 no-op). */
  watchIssue(issueKey: string): Promise<void>;
  unwatchIssue(issueKey: string): Promise<void>;
  /** GET .../watchers — 워처 목록(WatcherResponse: userId·username·name). get_issue_detail 동봉용(WP-356). */
  getIssueWatchers(issueKey: string): Promise<{ username: string; name?: string; [key: string]: unknown }[]>;
  /** GET .../drive-links — 연결된 드라이브 파일(DriveLinkResponse raw). get_issue_detail 동봉용(WP-356). */
  getIssueDriveLinks(issueKey: string): Promise<Record<string, unknown>[]>;
  /** PUT .../fields — 준 필드만 바꾼다(value null = 비우기). 응답은 갱신된 상세(WP-356). */
  updateIssueFields(issueKey: string, values: { defId: number; value: unknown }[]): Promise<unknown>;
  /** POST .../drive-links — 이미 연결돼 있으면 서버가 무시한다(멱등). 드라이브 스페이스 VIEWER 이상 필요(WP-356). */
  addIssueDriveLink(issueKey: string, driveFileId: number): Promise<void>;
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
  /** GET /wiki/search — 서버가 최근 수정순 최대 50건으로 자른다(상한을 알리는 일은 핸들러). 배열 원형. spaceId 가 있으면 그 스페이스만(WP-357). */
  searchWikiPages(query: string, spaceId?: number): Promise<unknown>;
  getWikiPage(pageId: number): Promise<unknown>;
  /** GET /wiki/pages/{id}/summary — 저장된 AI 요약과 상태만 읽는다(WP-357). 생성은 POST 라 부르지 않는다(AI 호출 없음). */
  getWikiPageSummary(pageId: number): Promise<unknown>;
  /** GET /wiki/pages/{id}/revisions — 현재 판 + 저장된 판 최신순(서버 상한 200). 원형 그대로(가공은 핸들러, WP-357). */
  listWikiRevisions(pageId: number): Promise<unknown>;
  /** POST /wiki/pages/{id}/revisions/{version}/restore — 그 판의 본문으로 복원(제목 유지). 응답은 저장과 같은 페이지 상세(WP-357). */
  restoreWikiRevision(pageId: number, version: number): Promise<unknown>;
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

/**
 * 일정 생성·수정 본문 — 서버 CalendarEventRequest 와 1:1(WP-348). 수정(PATCH)도 전체 교체라 같은 모양이다:
 * null·생략한 선택 필드는 서버에서 비워진다(reminderMinutes 생략=리마인더 제거, recurrenceRule 생략=단일 일정).
 * calendarId 는 싣지 않는다 — 생성은 기본 캘린더(항상 로컬), 수정은 소속 캘린더를 유지한다.
 */
export interface CalendarEventBody {
  title: string;
  description?: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location?: string | null;
  color?: string | null;
  reminderMinutes?: number | null;
  recurrenceRule?: string | null;
  /** 초대할 참석자 user id(생성 전용). 수정에 실으면 서버가 400 으로 거절한다 — 참석자 변경은 참석자 API 로. */
  attendeeUserIds?: number[];
}

/** 반복 일정 수정 범위 — 서버 EditScope 와 같은 값. */
export type EventEditScope = 'THIS' | 'THIS_AND_FOLLOWING' | 'ALL';

export interface CalendarToolClient {
  listEvents(from: string, to: string): Promise<EventRow[]>;
  getEvent(eventId: number): Promise<unknown>;
  /** PATCH /calendar/events/{id}/rsvp — 내가 초대받은 일정에만 응답한다(아니면 404). */
  rsvpEvent(eventId: number, status: 'ACCEPTED' | 'DECLINED' | 'TENTATIVE'): Promise<void>;
  /** POST /calendar/events?notify= — 생성된 일정(CalendarEventResponse). notify=false 면 초대 알림을 보내지 않는다(WP-348). */
  createEvent(body: CalendarEventBody, opts: { notify: boolean }): Promise<unknown>;
  /** PATCH /calendar/events/{id}?scope=&occurrenceDate= — 전체 교체. 수정된 일정을 돌려준다. */
  updateEvent(
    eventId: number,
    body: CalendarEventBody,
    opts: { scope: EventEditScope; occurrenceDate?: string },
  ): Promise<unknown>;
  /** POST /calendar/events/{id}/attendees?notify= — 주최자만. notify=false 면 초대 알림을 보내지 않는다. */
  addEventAttendees(eventId: number, userIds: number[], opts: { notify: boolean }): Promise<void>;
  /** DELETE /calendar/events/{id}/attendees/{userId} — 주최자만. */
  removeEventAttendee(eventId: number, userId: number): Promise<void>;
}

export interface MailToolClient {
  listMailAccounts(): Promise<unknown>;
  listMail(
    accountId: number,
    params: { folder: string; limit: number; query?: string; unread?: boolean; category?: string; needsReply?: boolean },
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
    body: {
      projectKey: string;
      title: string;
      body?: string;
      priority?: string;
      assigneeIds?: number[];
      /** WP-356: 유형·라벨(이름은 핸들러가 id 로 해석). 서버가 이슈 생성과 같은 트랜잭션에서 붙인다. */
      typeId?: number;
      labelIds?: number[];
    },
  ): Promise<{ issueKey: string }>;
  /** POST /mail/messages/{id}/read — 명시적 읽음 처리(WP-146). 사용자가 요청할 때만 쓴다. */
  markMailRead(messageId: number): Promise<void>;
  /** POST /mail/messages/{id}/unread — 안 읽음으로 되돌린다(WP-187 서버 API, WP-357). 읽음 처리와 같이 원본 메일 서버로 역동기화된다. */
  markMailUnread(messageId: number): Promise<void>;
  /** POST /mail/accounts/{id}/sync — INBOX 증분 동기화(원본 메일 서버에 접속). 소유 계정만(아니면 404), 이미 진행 중이면 서버가 빈 결과. */
  syncMail(accountId: number): Promise<unknown>;
  /** GET /mail/accounts/{id}/sync-status — 진행 중 여부(phase LIST/BODIES/IDLE). 서버는 이미 진행 중이면 sync 를 빈 결과로 돌려주므로 구분용(WP-353). */
  getMailSyncStatus(accountId: number): Promise<{ phase: string; total: number; done: number; running: boolean }>;
}

export interface MemberToolClient {
  /** 행 배열만 — 담당자·멘션·참석자 해석처럼 한 건을 찾는 내부 용도(페이지 정보가 필요 없다). */
  searchMembers(params: MemberSearchParams): Promise<MemberRow[]>;
  /** search_members 도구용 — 전체 건수·다음 페이지 여부를 함께 돌려준다(WP-352). */
  searchMembersPage(params: MemberSearchParams): Promise<PageResult<MemberRow>>;
  getMemberContact(userId: number): Promise<unknown>;
  /** 응답 래퍼 { items, nextCursor } 를 그대로 반환(가공은 핸들러). */
  listContacts(params: ContactListParams): Promise<unknown>;
  getExternalContact(externalId: number): Promise<unknown>;
  /**
   * GET /messaging/channels/{id}/members — 채널 멤버 전체(페이지 없음, 채널 멤버만 403). search_members 의 channelId 옵션이 쓴다(WP-355).
   * 행에는 숫자 userId 와 함께 username 이 있다(서버가 싣는다) — 뷰 가공(userId 제거)은 핸들러.
   */
  listChannelMembers(channelId: number): Promise<ChannelMemberRow[]>;
}

/** 채널 멤버 행(ChannelMemberResponse) — 핸들러가 읽는 필드만 고정한다. */
export interface ChannelMemberRow {
  userId: number;
  username: string;
  name: string;
  kind?: string;
  role?: string;
  [key: string]: unknown;
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
  /**
   * POST /contacts/external — 외부 연락처 생성(owner=호출자). 이름+이메일이 겹치면 서버가 409 경고를 주고 force=true 면 강행한다(#790).
   * force 는 쿼리 파라미터이며 미지정/false 면 붙이지 않는다.
   */
  createExternalContact(body: ExternalContactBody, force?: boolean): Promise<unknown>;
  /** PATCH /contacts/external/{id} — 부분 수정(생략=유지, 빈 문자열=비우기). force 의미는 생성과 같다. */
  updateExternalContact(externalId: number, body: Partial<ExternalContactBody>, force?: boolean): Promise<unknown>;
}

/** 외부 연락처 본문 — 서버 ExternalContactRequest 와 1:1. */
export interface ExternalContactBody {
  name: string;
  email?: string;
  phone?: string;
  organization?: string;
  title?: string;
  notes?: string;
  visibility: 'SHARED' | 'PERSONAL';
}

export interface MessagingToolClient {
  /** GET /messaging/channels — 서버가 내 채널 전체를 한 번에 준다(페이지 없음 — 자르는 일은 핸들러). */
  listChannels(): Promise<unknown>;
  /** GET /messaging/channels/{id}/messages — 최신순 커서 페이지. cursor 는 이전 응답의 nextCursor(WP-352). */
  listChannelMessages(channelId: number, params: { limit: number; cursor?: string }): Promise<CursorPage<unknown>>;
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
  /**
   * POST /messaging/channels/{id}/members — MEMBER 로 추가(WP-349). 이미 멤버면 no-op(역할 유지, ON CONFLICT DO NOTHING).
   * 채널 OWNER·ADMIN 또는 시스템 ADMIN 만, DM 은 거부.
   */
  addChannelMember(channelId: number, userId: number): Promise<void>;
  /** POST /messaging/channels/{id}/join — 공개 채널만(비공개 403), 이미 멤버면 no-op(WP-355). */
  joinChannel(channelId: number): Promise<void>;
  /** POST /messaging/messages/{id}/reactions — 이미 눌렀으면 no-op(멱등), 채널 멤버만. emoji 1~32자(WP-355). */
  addReaction(messageId: number, emoji: string): Promise<void>;
  /** DELETE /messaging/messages/{id}/reactions?emoji= — 누른 적 없으면 no-op(멱등)(WP-355). */
  removeReaction(messageId: number, emoji: string): Promise<void>;
  /** PATCH /messaging/messages/{id} — 작성자만(403), 본문 4000자 이하. 저장된 메시지 행(MessageResponse) 원형을 돌려준다(WP-355). */
  updateChannelMessage(messageId: number, body: string): Promise<unknown>;
  /** POST /messaging/channels/{id}/read — 채널 멤버만. 읽음 위치를 max(기존, uptoMessageId) 로 올린다(WP-355). */
  markChannelRead(channelId: number, uptoMessageId: number): Promise<void>;
  /** GET /messaging/channels/discover — 공개·비아카이브 채널을 이름·키워드로 검색한 배열(비배열 응답은 빈 배열). */
  discoverChannels(q: string): Promise<unknown[]>;
}

export interface DriveToolClient {
  listDriveSpaces(): Promise<unknown>;
  /**
   * 응답 { folders, files } 원형 — 파일 행 식별자 가공은 toDriveItemsView(핸들러). page 를 주면 서버가 폴더 먼저·파일 다음 순서에서
   * offset 부터 limit 개만 돌려주고(WP-352), 생략하면 전체다.
   */
  listDriveItems(spaceId: number, parentId?: number, page?: { limit: number; offset: number }): Promise<unknown>;
  /** GET /drive/spaces/{id}/search — 서버가 폴더·파일 각각 최대 200건으로 자른다(상한을 알리는 일은 핸들러). */
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
  /** POST /drive/spaces/{id}/folders — parentId null=스페이스 루트. 같은 위치에 같은 이름이 있으면 서버가 409. 생성된 폴더 반환. */
  createDriveFolder(spaceId: number, parentId: number | null, name: string): Promise<unknown>;
  /** PATCH /drive/folders/{id} — 이름 변경. 변경된 폴더 반환. */
  renameDriveFolder(folderId: number, name: string): Promise<unknown>;
  /** PATCH /drive/folders/{id}/move — targetParentId null=스페이스 루트. 같은 공간 안에서만, 자신·하위로는 거부. 204. */
  moveDriveFolder(folderId: number, targetParentId: number | null): Promise<void>;
  /** PATCH /drive/files/{id}/move — targetFolderId null=스페이스 루트. 같은 이름 충돌이면 409. 204. */
  moveDriveFile(driveFileId: number, targetFolderId: number | null): Promise<void>;
  /** PATCH /drive/files/{id} — 파일 이름 변경(WP-335). 같은 폴더에 같은 이름의 활성 파일이 있으면 409. 변경된 파일 행 반환. */
  renameDriveFile(driveFileId: number, name: string): Promise<unknown>;
  /** POST /drive/files/{id}/copy — 같은 스페이스의 targetFolderId(null=루트)로 복사. 같은 이름이 있으면 409. 새 파일 행 반환. */
  copyDriveFile(driveFileId: number, targetFolderId: number | null): Promise<unknown>;
  /** POST /drive/folders/{id}/copy — 폴더와 하위 전부를 같은 스페이스의 targetParentId(null=루트) 밑으로 복사. 새 폴더 행 반환. */
  copyDriveFolder(folderId: number, targetParentId: number | null): Promise<unknown>;
  /** GET /drive/files/{id}/versions — 최신 버전이 먼저 온다(version_no DESC). read_file 의 이미지 크기 확인과 같은 호출. */
  listDriveFileVersions(driveFileId: number): Promise<DriveFileVersionRow[]>;
  /** GET /drive/files/{id}/backlinks — 파일을 링크한 이슈·메시지 중 호출자가 볼 수 있는 것만. */
  listDriveFileBacklinks(driveFileId: number): Promise<DriveBacklinkRow[]>;
  /** POST /drive/spaces/{id}[/folders/{folderId}]/import-attachment — 이슈·채팅 첨부(core file id)를 드라이브 파일로 가져온다. 생성된 파일 행 반환. */
  importAttachmentToDrive(spaceId: number, folderId: number | null, fileId: number): Promise<unknown>;
  /**
   * POST /drive/files/{id}/download-link — VIEWER 이상. 로그인 없이 한 번만 받을 수 있는 10분짜리 서명 링크를 만든다(WP-369).
   * 공개 GET 은 전송 전에 링크를 소비하고 Range 를 무시한다 — 끊기면 새 링크가 필요하다.
   */
  createDriveDownloadLink(driveFileId: number): Promise<DriveDownloadLink>;
  /**
   * POST /drive/spaces/{id}/upload-link — EDITOR 이상, folderId null=루트(폴더는 같은 공간). 한 번만 쓸 수 있는 10분짜리 PUT 링크(WP-369).
   * name 은 서버가 정리해 링크에 묶는다(응답 name 이 실제 저장 이름). 같은 이름이 있으면 PUT 이 새 버전을 만든다.
   */
  createDriveUploadLink(spaceId: number, folderId: number | null, name: string): Promise<DriveUploadLink>;
  /**
   * POST /drive/spaces/{id}/files/text — EDITOR 이상. content(UTF-8, 10MB 이하)로 텍스트 파일을 만든다(WP-369).
   * MIME 은 서버가 이름으로 정한다(md·txt·csv·json, 그 밖은 text/plain). 같은 이름이 있으면 새 버전 — 그때는 updateDriveTextFile 과 같은 규칙(텍스트가
   * 아니거나 읽은 텍스트가 원문과 다르면 409, MIME 은 지금 형식 유지)이다. DriveFileResponse 원형 반환.
   */
  createDriveTextFile(spaceId: number, folderId: number | null, name: string, content: string): Promise<unknown>;
  /**
   * POST /drive/files/{id}/text — EDITOR 이상. 기존 드라이브 파일에 content 로 새 버전을 올린다(WP-369 Task 3). 200, DriveFileResponse 원형
   * (id·이름·폴더 그대로, versionCount+1). 현재 버전이 텍스트가 아니면(pdf·docx 등), 또는 읽은 텍스트가 원문과 다르면(html 계열·UTF-8 아님·추출 잘림)
   * 서버가 409(업로드 링크로 올리라는 안내). mimeType 은 보내지 않는다 — 서버가 지금 형식을 유지한다(xml 계열과 octet-stream 만 이름의 확장자로 다시 정한다).
   */
  updateDriveTextFile(driveFileId: number, content: string): Promise<unknown>;
  /**
   * POST /drive/files/{id}/upload-link — EDITOR 이상, 본문 없음. 그 파일에 묶인 일회용 10분 PUT 링크(201, 업로드 링크와 같은 모양).
   * PUT 은 이름 검색 없이 그 파일의 새 버전이 되고, 이름·폴더는 그대로다(발급 뒤 이름이 바뀌어도 같은 파일).
   */
  createDriveVersionUploadLink(driveFileId: number): Promise<DriveUploadLink>;
}

/** 다운로드 링크 발급 응답(WP-369 서버 계약). 사용자 id 는 없다. */
export interface DriveDownloadLink {
  url: string;
  expiresAt: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  singleUse: boolean;
}

/** 업로드 링크 발급 응답(WP-369 서버 계약). maxBytes 는 이름의 범주 상한과 25MB 중 작은 값, name 은 서버가 정리한 실제 저장 이름. */
export interface DriveUploadLink {
  url: string;
  method: 'PUT';
  expiresAt: string;
  maxBytes: number;
  name: string;
  singleUse: boolean;
}

/**
 * 추출 텍스트 구간 읽기 응답(WP-242 서버 계약 ExtractedTextSlice) — 이슈 첨부·드라이브 파일(WP-346)·챗 첨부가 같은 모양이다.
 * status 가 READY 가 아니면 text·totalChars·nextOffset 은 null 이고 reasonCode·reason 만 채운다.
 * fileId 는 core file.id 다 — 드라이브 표면에는 내보내지 않는다(#840, 핸들러가 driveFileId 로 바꾼다).
 */
export type ExtractionStatus = 'PENDING' | 'READY' | 'SKIPPED' | 'FAILED' | 'NONE';
export interface ExtractedTextSlice {
  fileId: number;
  status: ExtractionStatus;
  offset: number;
  totalChars: number | null;
  /** 서버가 null 을 줄 수 있다 — 소비자는 false 로 취급한다. */
  truncated: boolean | null;
  nextOffset: number | null;
  text: string | null;
  /** SKIPPED·FAILED 사유 코드(ExtractionReasons.Code). 이미지는 'IMAGE'. */
  reasonCode: string | null;
  reason: string | null;
}

/** 구간 읽기 범위 — 생략한 값은 쿼리에 싣지 않아 서버 기본값(offset 0, limit 32000)을 따른다. */
export interface TextRange {
  offset?: number;
  limit?: number;
}

/** 파일 원본 바이트 + 응답 Content-Type(파라미터 포함 원문 — 비교 전에 잘라 쓴다). */
export interface FileBytes {
  data: Uint8Array;
  mimeType: string;
}

/** 이슈 첨부 목록 행(IssueAttachmentResponse) — 이미지 판정·안내에 쓰는 필드만 고정한다. */
export interface IssueAttachmentRow {
  fileId: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  [key: string]: unknown;
}

/** 드라이브 파일 버전 행(DriveFileVersionResponse) — 현재 버전 크기로 이미지 크기 상한을 내려받기 전에 확인한다. */
export interface DriveFileVersionRow {
  versionNo: number;
  sizeBytes: number;
  current: boolean;
  [key: string]: unknown;
}

/** 드라이브 파일 백링크 행(BacklinkResponse) — sourceType 은 ISSUE·MESSAGE 등. */
export interface DriveBacklinkRow {
  sourceType: string;
  label: string;
  deepLink: string;
  [key: string]: unknown;
}

/**
 * 첨부·파일 내용 읽기(WP-346) — read_file 이 쓴다. 텍스트는 서버가 추출해 둔 구간을 읽고, 이미지만 원본을 받는다
 * (이미지 블록으로 모델에 넘기려고). 권한은 서버가 강제한다(이슈: 프로젝트 멤버, 드라이브: 스페이스 VIEWER).
 */
export interface AttachmentToolClient {
  /** GET /projects/{key}/issues/{n}/attachments/{fileId}/text. */
  readIssueAttachmentText(issueKey: string, fileId: number, range: TextRange): Promise<ExtractedTextSlice>;
  /** GET /projects/{key}/issues/{n}/attachments — 이미지 형식·크기 확인용. */
  listIssueAttachments(issueKey: string): Promise<IssueAttachmentRow[]>;
  /** GET /projects/{key}/issues/{n}/attachments/{fileId}/content — 원본 바이트. */
  downloadIssueAttachment(issueKey: string, fileId: number): Promise<FileBytes>;
  /** GET /drive/files/{id}/text. */
  readDriveFileText(driveFileId: number, range: TextRange): Promise<ExtractedTextSlice>;
  /** GET /drive/files/{id}/versions — 최신 버전이 먼저 온다(version_no DESC). */
  listDriveFileVersions(driveFileId: number): Promise<DriveFileVersionRow[]>;
  /** GET /drive/files/{id}/content — 원본 바이트(인라인 미리보기와 같은 게이트). */
  downloadDriveFile(driveFileId: number): Promise<FileBytes>;
  /** GET /wiki/pages/{pageId}/attachments/{fileId}/text(WP-358) — 공간 VIEWER 이상, 비멤버는 404. */
  readWikiAttachmentText(pageId: number, fileId: number, range: TextRange): Promise<ExtractedTextSlice>;
  /** GET /wiki/pages/{pageId}/attachments/{fileId}/content — 원본 바이트(노트 첨부는 이미지만 올라간다). */
  downloadWikiAttachment(pageId: number, fileId: number): Promise<FileBytes>;
  /** GET /messaging/channels/{id}/messages/{msgId}/attachments/{fileId}/text(WP-358) — 채널 멤버만(비멤버 403). */
  readMessageAttachmentText(channelId: number, messageId: number, fileId: number, range: TextRange): Promise<ExtractedTextSlice>;
  /** GET /messaging/channels/{id}/messages/{msgId}/attachments/{fileId}/content — 원본 바이트. */
  downloadMessageAttachment(channelId: number, messageId: number, fileId: number): Promise<FileBytes>;
  /** GET /mail/attachments/{attachmentId}/text(WP-358) — 본인 소유 첨부만(아니면 404). 응답 fileId 는 요청한 attachmentId 다. 첫 호출은 PENDING. */
  readMailAttachmentText(attachmentId: number, range: TextRange): Promise<ExtractedTextSlice>;
  /** GET /mail/attachments/{attachmentId}/content — 원본 바이트(IMAP·Graph 에서 가져온다). */
  downloadMailAttachment(attachmentId: number): Promise<FileBytes>;
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

/**
 * 홈 개요(get_home_overview, WP-357)가 읽는 서버 엔드포인트 — 모두 읽기 전용이고 AI 를 새로 호출하지 않는다(저장된 값·집계).
 * 원형을 그대로 돌려주고 뷰 가공(숫자 ID 제거·이름 바꾸기)은 핸들러가 한다.
 */
export interface HomeToolClient {
  /** GET /me/activity — { items, nextCursor }. 내가 담당·워치하는 이슈의 최근 이력. size 는 서버가 1..50 으로 자른다. */
  getHomeActivity(params: { cursor?: string; size: number }): Promise<unknown>;
  /** GET /me/priority-items — 저장된 AI 우선순위 배치 결과(점수 내림차순) 의 items 배열. */
  getPriorityItems(): Promise<unknown>;
  /** GET /me/mail-summary — { unreadCount, needsReplyCount, classificationActive, recent }. recent 는 안 읽은 메일 최대 5건. */
  getHomeMailSummary(): Promise<unknown>;
  /** GET /me/messaging-summary — { unreadConversationCount, needsReplyCount, aiAttentionCount, attentionCount, recent }. recent 는 최대 5건. */
  getMessagingSummary(): Promise<unknown>;
  /** GET /messaging/threads/inbox — { items:[{rootMessage, channelName, lastReplyAt}], nextCursor, hasMore }(keyset). */
  getThreadInbox(params: { cursor?: string; limit: number }): Promise<unknown>;
}

export interface ProjectToolClient extends ProjectMetaClient {
  /** GET /projects — Spring 페이지를 PageResult 로 벗긴다(WP-352). */
  listProjects(page: number, size: number): Promise<PageResult<unknown>>;
  getProject(projectKey: string): Promise<Record<string, unknown>>;
  /** PATCH /projects/{key} — 부분 수정(#858). 생략(undefined) 필드는 유지, 설명 비우기는 clearDescription. */
  updateProject(
    projectKey: string,
    body: { name?: string; description?: string; clearDescription?: boolean },
  ): Promise<unknown>;
  /** GET /me/issues — { items, nextCursor, hasMore } 를 그대로 돌려준다(WP-352, 가공은 핸들러). */
  listIssues(query: IssueListQuery): Promise<CursorPage<IssueRow>>;
  /** POST /projects — 생성자가 OWNER 가 된다(WP-349). key 중복·지원하지 않는 유형은 409. */
  createProject(body: CreateProjectBody): Promise<unknown>;
  /** POST /projects/{key}/members — 프로젝트 OWNER 만(WP-349). 이미 멤버·비활성·개인 프로젝트에 사람 추가는 409. */
  addProjectMember(
    projectKey: string,
    body: { userId: number; role: 'OWNER' | 'MEMBER' },
  ): Promise<{ userId: number; username: string; name?: string; role?: string; [key: string]: unknown }>;
  /** POST /projects/{key}/{labels|milestones|cycles} — 라벨·마일스톤·사이클 생성(WP-356). 이름 중복은 409. */
  createProjectMeta(projectKey: string, kind: ProjectMetaKind, body: Record<string, unknown>): Promise<unknown>;
  /** PATCH /projects/{key}/{kind}/{id} — 서버는 본문 전체로 덮어쓴다(생략=비움). 병합은 핸들러가 한다(WP-356). */
  updateProjectMeta(projectKey: string, kind: ProjectMetaKind, id: number, body: Record<string, unknown>): Promise<unknown>;
}

/** 프로젝트 메타 종류(WP-356) — create_project_meta·update_project_meta 의 kind. */
export type ProjectMetaKind = 'label' | 'milestone' | 'cycle';

/** 프로젝트 생성 요청 본문 — 서버 CreateProjectRequest 와 1:1(key 는 PERSONAL 이면 서버가 무시하고 자동 생성). */
export interface CreateProjectBody {
  key: string;
  name: string;
  description?: string;
  type?: string;
}

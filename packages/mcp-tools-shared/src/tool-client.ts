// src/tool-client.ts — 공유 도메인 도구가 호출하는 구조적 클라이언트 인터페이스(#846).
//
// 두 앱(workplace-mcp = PAT 신원, workplace-ai-agent = X-On-Behalf-Of 에이전트 신원)은 같은 REST 경로를 부르고
// 인증 방식만 다르다. 그래서 클라이언트는 "경로 호출 + 응답 래퍼 벗기기"까지만 맡고 **raw 를 그대로 반환**한다.
// LLM 에 보여줄 형태로 가공(식별자 이름 바꾸기·필드 고르기)은 공유 도구 핸들러가 한 곳에서 한다 —
// 가공이 앱마다 클라이언트에 흩어져 있던 것이 드리프트의 원인이었다(연락처 id→userId 를 한쪽만 하던 식).
import type { ProjectMetaClient } from './resolve.js';

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
export interface IssueToolClient extends ProjectMetaClient {
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
}

export interface WikiToolClient {
  listWikiSpaces(): Promise<unknown>;
  searchWikiPages(query: string): Promise<unknown>;
  getWikiPage(pageId: number): Promise<unknown>;
  createWikiPage(spaceId: number, body: { parentId: number | null; title: string }): Promise<unknown>;
  /** 부분 수정 — title/body 생략 시 서버가 현재 값을 유지한다(version 만 필수, 불일치면 409). */
  updateWikiPage(pageId: number, body: { version: number; title?: string; body?: string }): Promise<unknown>;
}

export interface CalendarToolClient {
  listEvents(from: string, to: string): Promise<EventRow[]>;
  getEvent(eventId: number): Promise<unknown>;
}

export interface MailToolClient {
  listMailAccounts(): Promise<unknown>;
  listMail(
    accountId: number,
    params: { folder: string; limit: number; query?: string; unread?: boolean },
  ): Promise<unknown>;
  getMail(messageId: number): Promise<unknown>;
}

export interface MemberToolClient {
  searchMembers(params: MemberSearchParams): Promise<MemberRow[]>;
  getMemberContact(userId: number): Promise<unknown>;
  /** 응답 래퍼 { items, nextCursor } 를 그대로 반환(가공은 핸들러). */
  listContacts(params: ContactListParams): Promise<unknown>;
  getExternalContact(externalId: number): Promise<unknown>;
}

export interface MessagingToolClient {
  listChannels(): Promise<unknown>;
  getChannelMessages(channelId: number, limit: number): Promise<unknown>;
  /** parentMessageId 가 있으면 그 스레드에 답한다. */
  addChannelMessage(channelId: number, body: string, parentMessageId?: number): Promise<unknown>;
}

export interface DriveToolClient {
  listDriveSpaces(): Promise<unknown>;
  /** 응답 { folders, files } 원형 — 파일 행 식별자 가공은 toDriveItemsView(핸들러). */
  listDriveItems(spaceId: number, parentId?: number): Promise<unknown>;
  searchDrive(spaceId: number, q: string): Promise<unknown>;
}

export interface ProjectToolClient extends ProjectMetaClient {
  listProjects(page: number, size: number): Promise<unknown>;
  getProject(projectKey: string): Promise<unknown>;
  /** GET /me/issues — 응답 래퍼 { items } 를 벗긴 이슈 행 배열(가공은 핸들러). */
  listIssues(query: IssueListQuery): Promise<IssueRow[]>;
}

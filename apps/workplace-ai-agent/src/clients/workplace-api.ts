// workplace-api 호출 client — INTERNAL_SERVICE_TOKEN 인증 + X-On-Behalf-Of 헤더 (#34).
// 매 메서드의 첫 인자 agentId 는 workplace-api 가 SecurityContext 의 principal 로 설정할
// AGENT user id. 누락 시 TypeScript 가 빌드 차단.
import axios, { AxiosInstance } from 'axios';

import { DEFAULT_API_BASE_URL } from '../constants.js';
import type { ProviderCredential } from '../agent/agent-runner.js';
import { parseIssueKey } from '@smart-workplace/issue-tools-shared';

// 6c: chat thread 메시지 (LLM 노출용 경량 형태).
export interface ChatMessageItem {
  id: number;
  authorName: string;
  authorKind: 'HUMAN' | 'AGENT';
  body: string;
  createdAt: string;
  deleted: boolean;
}

// #350: 채널 목록/탐색 응답 단건 — 채널 이름 → channelId 해석에 사용.
export interface ChannelItem {
  id: number;
  kind: string;
  name: string;
  visibility: string;
  member: boolean;
  role: string | null;
  archived: boolean;
  memberCount: number;
  unreadCount: number;
}

// 7: 채널 메시지 (LLM 노출용 경량 형태).
export interface ChannelMessageItem {
  id: number;
  authorName: string;
  authorKind: 'HUMAN' | 'AGENT';
  body: string;
  createdAt: string;
  deleted: boolean;
}

// #333 M3: 연락처 단건(읽기 그라운딩 + 내부 쓰기).
export interface ContactItem {
  id: number;
  kind: 'MEMBER' | 'EXTERNAL';
  name: string;
  email: string | null;
  organization: string | null;
}

// #333 M3: 프로젝트 단건(읽기 그라운딩).
export interface ProjectItem {
  key: string;
  name: string;
  description: string | null;
  type: string | null;
}

// #333 M3: 프로젝트 멤버 단건(읽기 그라운딩).
export interface ProjectMemberItem {
  userId: number;
  username: string;
  name: string;
  role: string;
}

// #333 M3: 드라이브 스페이스 단건(읽기 그라운딩).
export interface DriveSpaceItem { id: number; name: string; role: string; }

// #333 M3: 드라이브 폴더 단건(listSpaceItems / searchDrive 응답).
export interface DriveFolderNode { id: number; parentId: number | null; name: string; createdAt: string; }

// #333 M3: 드라이브 파일 단건(listSpaceItems / searchDrive 응답).
export interface DriveFileNode { id: number; folderId: number | null; fileId: number; name: string; mimeType: string; sizeBytes: number; category: string; createdAt: string; }

// #333 M3: 드라이브 items/search API 응답 래퍼 — folders + files 묶음.
// #376: 기존 DriveNode(단건 배열)는 API 실제 응답({folders,files})과 불일치 — 수정.
export interface DriveItemsResponse { folders: DriveFolderNode[]; files: DriveFileNode[]; }

// #376 하위호환: DriveNode alias(외부 참조가 있으면 타입 에러 방지).
export type DriveNode = DriveItemsResponse;

// #333 M4: 드라이브 폴더 생성/이름변경 응답 단건.
export interface DriveFolderItem { id: number; parentId: number | null; name: string; createdAt: string; }

// #333 M3: 외부연락처 생성/수정 입력 (선택 필드는 undefined 시 JSON 에서 생략).
export interface ExternalContactInput {
  name: string;
  email?: string;
  phone?: string;
  organization?: string;
  title?: string;
  notes?: string;
  visibility: 'SHARED' | 'PERSONAL';
}

// #333 M4: 메일 계정 단건 — accountId 확보용(list_mail/propose_send_mail 의 accountId 인자 해석).
export interface MailAccountItem {
  id: number;
  emailAddress: string;
  displayName: string;
  aiEnabled: boolean;
}

// #333 M3: 메일 메시지 목록 단건(읽기 그라운딩).
export interface MailMessageItem {
  id: number;
  subject: string | null;
  fromAddress: string | null;
  snippet: string | null;
  receivedAt: string;
  seen: boolean;
}

// #333 M3: 메일 메시지 상세 — 본문(text/html) + 수신자 목록 포함.
export interface MailMessageDetail extends MailMessageItem {
  bodyText: string | null;
  bodyHtml: string | null;
  toAddresses: string[];
}

// #333 M2: 캘린더 이벤트 단건(읽기 그라운딩).
export interface CalendarEventItem {
  id: number;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location: string | null;
  recurrenceRule: string | null;
}

// S2: 위키 검색 결과 한 건(읽기 그라운딩).
export interface WikiSearchItem {
  id: number;
  spaceId: number;
  spaceName: string;
  title: string;
  snippet: string;
  updatedAt: string;
}

// S2: 위키 페이지 본문 전체.
export interface WikiPageContent {
  id: number;
  spaceId: number;
  parentId: number | null;
  title: string;
  body: string;
  version: number;
  updatedAt: string;
}

// #724: 내가 접근 가능한 노트 스페이스 한 건 — 스페이스 이름/타입 → spaceId 해석에 사용.
export interface WikiSpaceItem {
  id: number;
  type: string; // PERSONAL | TEAM | OPEN 등. 개인 노트("내 노트")는 PERSONAL.
  name: string;
  role: string; // 내 역할(OWNER/EDITOR/VIEWER)
}

// 6c: 이슈 첨부 메타.
export interface AttachmentMeta {
  fileId: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

// A2: 진행 상태 단계.
export interface ProgressStepDto {
  label: string;
  status: 'running' | 'done';
}
// A2: 진행 상태 전체 payload.
export interface ProgressPayload {
  streamId: string;
  phase: 'started' | 'tool' | 'done' | 'error';
  steps: ProgressStepDto[];
}

// #371: 이슈 목록 조회 필터 — GET /me/issues 의 쿼리 파라미터 부분 집합.
// 전부 선택. assignee 미지정 시 호출자(principal) 기준 'me' 로 조회한다.
export interface IssueListParams {
  projectKey?: string;
  status?: string;
  priority?: string[]; // LOW/MID/HIGH — CSV 로 직렬화
  label?: string;
  type?: string;
  dueFrom?: string;
  dueTo?: string;
  q?: string;
  blocked?: boolean;
  topLevel?: boolean;
  assignee?: string; // 'me'(기본) | '<userId>'
  reporter?: string; // 'me' | '<userId>'
  size?: number;
}

// #371: 이슈 목록 한 건(LLM 노출용 경량 형태). issueKey 로 get_issue_detail 호출 가능.
export interface IssueListItem {
  issueKey: string;
  title: string;
  status: string;
  priority: string;
  assignees: { id: number; name: string; kind: 'HUMAN' | 'AGENT' }[];
  dueDate: string | null;
  type: string | null;
  blocked: boolean;
}

export interface WorkplaceApiClient {
  addIssueComment(agentId: number, issueKey: string, body: string): Promise<void>;
  // 이슈 생성 — mcp 의 create_issue 와 동일 필드(단 labels 없음, create 엔드포인트가 지원 안 함).
  createIssue(
    agentId: number,
    projectKey: string,
    body: {
      title: string;
      body?: string;
      priority?: string;
      dueDate?: string;
      startDate?: string;
      assigneeIds?: number[];
      typeId?: number;
      parentNumber?: number;
    },
  ): Promise<unknown>;
  // 코멘트 수정 — issueKey 로 받아 내부에서 숫자 issueId 조회(addIssueComment 와 동일 패턴).
  editIssueComment(agentId: number, issueKey: string, commentId: number, body: string): Promise<void>;
  // update_issue 도구 팬아웃용 — 필드별 독립 엔드포인트(mcp 와 동일 패턴).
  updateIssueContent(agentId: number, issueKey: string, body: Record<string, unknown>): Promise<unknown>;
  setIssueType(agentId: number, issueKey: string, typeId: number): Promise<void>;
  setIssueParent(agentId: number, issueKey: string, parentNumber: number | null): Promise<void>;
  replaceIssueAssignees(agentId: number, issueKey: string, userIds: number[]): Promise<unknown>;
  replaceIssueLabels(agentId: number, issueKey: string, labelIds: number[]): Promise<unknown>;
  addIssueDependency(
    agentId: number,
    issueKey: string,
    otherNumber: number,
    direction: 'blocks' | 'blockedBy',
  ): Promise<unknown>;
  removeIssueDependency(
    agentId: number,
    issueKey: string,
    otherNumber: number,
    direction: 'blocks' | 'blockedBy',
  ): Promise<void>;
  updateIssueStatus(agentId: number, issueKey: string, statusKey: string): Promise<void>;
  // Task 6: 정규화는 공유 도구 핸들러(normalizeIssueDetail)가 수행 — 여기선 raw 를 그대로 반환.
  getIssueDetail(agentId: number, issueKey: string): Promise<unknown>;
  // #371: 이슈 목록 조회 — GET /me/issues. assignee 기본 'me'(서버가 principal 로 해석).
  listIssues(agentId: number, params: IssueListParams): Promise<IssueListItem[]>;
  unassignSelf(agentId: number, issueKey: string): Promise<void>;
  // Task 7: getOAuthToken → getProviderCredential 일반화. GET /users/me/provider-credential.
  // anthropic(OAuth 토큰)·opencode(공급자 설정 payload) 양쪽을 ProviderCredential 유니온으로 반환.
  getProviderCredential(agentId: number): Promise<ProviderCredential>;
  // 6c: chat
  getChatMessages(agentId: number, threadId: number, limit: number): Promise<ChatMessageItem[]>;
  addChatMessage(agentId: number, threadId: number, body: string): Promise<void>;
  // A2: chat 진행 상태 전송
  postChatProgress(agentId: number, threadId: number, payload: ProgressPayload): Promise<void>;
  // 7: 채널 메시지 조회/작성
  getChannelMessages(
    agentId: number,
    channelId: number,
    limit: number,
  ): Promise<ChannelMessageItem[]>;
  addChannelMessage(
    agentId: number,
    channelId: number,
    body: string,
    parentMessageId?: number,
  ): Promise<void>;
  // A2: 메시징 진행 상태 전송
  postMessagingProgress(agentId: number, channelId: number, payload: ProgressPayload): Promise<void>;
  // #350: 채널 목록/탐색 — 채널 이름 → channelId 해석 전용 읽기 도구.
  listChannels(agentId: number): Promise<ChannelItem[]>;
  discoverChannels(agentId: number, q: string): Promise<ChannelItem[]>;
  // S2: 위키 읽기 그라운딩
  listWikiSpaces(agentId: number): Promise<WikiSpaceItem[]>;
  searchWikiPages(agentId: number, query: string): Promise<WikiSearchItem[]>;
  getWikiPage(agentId: number, pageId: number): Promise<WikiPageContent>;
  // #333 M3: 위키 페이지 쓰기 — 스페이스 멤버십 가드는 서버가 강제하므로 propose/confirm 없이 직접 노출.
  createWikiPage(agentId: number, spaceId: number, title: string, parentId?: number): Promise<WikiPageContent>;
  updateWikiPage(agentId: number, pageId: number, version: number, title?: string, body?: string): Promise<WikiPageContent>;
  // #333 M2: 캘린더 읽기 — list/get. 쓰기(생성)는 서버측 confirm 실행기가 수행(에이전트는 propose 만).
  listEvents(agentId: number, from: string, to: string): Promise<CalendarEventItem[]>;
  getEvent(agentId: number, id: number): Promise<CalendarEventItem>;
  // #333 M3: 메일 읽기 — list/get. 발송은 confirm 실행기가 수행(에이전트는 propose 만).
  listMail(agentId: number, accountId: number, folder: string, query: string | undefined, unreadOnly: boolean | undefined, limit: number): Promise<MailMessageItem[]>;
  getMail(agentId: number, messageId: number): Promise<MailMessageDetail>;
  // #333 M4: 메일 계정 목록 + 수동 동기화 — accountId 확보 경로.
  listMailAccounts(agentId: number): Promise<MailAccountItem[]>;
  syncMail(agentId: number, accountId: number): Promise<unknown>;
  // #333 M3: 프로젝트 읽기. 쓰기(생성/소프트삭제/멤버추가)는 confirm 실행기가 수행(에이전트는 propose 만).
  listProjects(agentId: number, page: number, size: number): Promise<ProjectItem[]>;
  getProject(agentId: number, key: string): Promise<ProjectItem>;
  listProjectMembers(agentId: number, key: string): Promise<ProjectMemberItem[]>;
  // 이슈 생성/수정 리졸브용 — mcp 의 동명 메서드와 동일 엔드포인트.
  getProjectTypes(agentId: number, key: string): Promise<{ id: number; name: string }[]>;
  getProjectLabels(agentId: number, key: string): Promise<{ id: number; name: string }[]>;
  // #333 M3: 연락처 읽기 + 외부연락처 내부 쓰기(생성/수정). 삭제는 confirm 실행기(propose).
  listContacts(agentId: number, search: string | undefined, type: string | undefined, limit: number): Promise<ContactItem[]>;
  getExternalContact(agentId: number, id: number): Promise<ContactItem>;
  createExternalContact(agentId: number, input: ExternalContactInput): Promise<ContactItem>;
  updateExternalContact(agentId: number, id: number, input: ExternalContactInput): Promise<ContactItem>;
  // #333 M3: 드라이브 읽기 전용(v1 — 쓰기 연기). list/items/search.
  listMySpaces(agentId: number): Promise<DriveSpaceItem[]>;
  listSpaceItems(agentId: number, spaceId: number, parentId?: number): Promise<DriveItemsResponse>;
  searchDrive(agentId: number, spaceId: number, q: string): Promise<DriveItemsResponse>;
  // #333 M4: 드라이브 폴더/파일 쓰기 — 이동은 204(void).
  createFolder(agentId: number, spaceId: number, parentId: number | null, name: string): Promise<DriveFolderItem>;
  renameFolder(agentId: number, folderId: number, name: string): Promise<DriveFolderItem>;
  moveFolder(agentId: number, folderId: number, targetParentId: number | null): Promise<void>;
  moveFile(agentId: number, fileId: number, targetFolderId: number | null): Promise<void>;
  // L3 위임: AI 제안 카드 생성(on-behalf AGENT). proposedByUserId=위임자, parentMessageId=스레드 미러.
  // projectKey: AI 가 후보 목록에서 추론해 고른 프로젝트 키. 없으면 백엔드 개인 작업 폴백.
  proposeCreateIssue(
    agentId: number,
    channelId: number,
    req: { title: string; body?: string; priority?: string; proposedByUserId: number; parentMessageId?: number; projectKey?: string },
  ): Promise<void>;
  // L3 위임(일정): AI 일정 제안 카드 생성(on-behalf AGENT). actionType='calendar.create_event'.
  proposeCreateEvent(
    agentId: number,
    channelId: number,
    req: {
      title: string;
      startsAt: string;
      endsAt: string;
      allDay?: boolean;
      location?: string;
      reminderMinutes?: number;
      recurrenceRule?: string;
      conflicts?: { id: number; title: string; startsAt: string; endsAt: string }[];
      proposedByUserId: number;
      parentMessageId?: number;
    },
  ): Promise<void>;
  // L3 위임: 위임자(delegatorId)가 참여 중인 프로젝트 목록 — AI 가 이슈 라우팅 projectKey 를 고를 소스.
  listDelegationCandidates(agentId: number, delegatorId: number): Promise<{ key: string; name: string }[]>;
  // 6c: 이슈 첨부
  listIssueAttachments(agentId: number, issueKey: string): Promise<AttachmentMeta[]>;
  downloadIssueAttachment(
    agentId: number,
    issueKey: string,
    fileId: number,
  ): Promise<{ data: Buffer; mimeType: string }>;
  // #719: 요청자의 active-tenant 를 X-On-Behalf-Of-Tenant 로 싣는 스코프 클라이언트를 반환한다.
  // 인-프로세스 MCP 서버는 이 인스턴스를 서브에이전트까지 공유하므로, run 당 1회 스코프하면
  // 위임 도구 호출까지 전부 동일하게 적용된다(다중/무 멤버십 요청자의 AgentTenantResolver
  // fail-closed 방지).
  withOnBehalfOfTenant(tenantId: number): WorkplaceApiClient;
}

export function createWorkplaceApiClient(opts: {
  baseURL?: string;
  internalToken: string;
  // #719: 설정 시 모든 대리 호출에 X-On-Behalf-Of-Tenant 를 동봉 — withOnBehalfOfTenant 가 채운다.
  onBehalfOfTenantId?: number;
}): WorkplaceApiClient {
  const http: AxiosInstance = axios.create({
    baseURL: opts.baseURL ?? DEFAULT_API_BASE_URL,
    headers: { Authorization: `Internal ${opts.internalToken}` },
  });

  const onBehalfOf = (agentId: number) => ({
    headers: {
      'X-On-Behalf-Of': String(agentId),
      ...(opts.onBehalfOfTenantId
        ? { 'X-On-Behalf-Of-Tenant': String(opts.onBehalfOfTenantId) }
        : {}),
    },
  });

  return {
    withOnBehalfOfTenant(tenantId: number) {
      return createWorkplaceApiClient({ ...opts, onBehalfOfTenantId: tenantId });
    },
    async addIssueComment(agentId, issueKey, body) {
      const { projectKey, number } = parseIssueKey(issueKey);
      // 코멘트 endpoint 는 issueId 기반 (workplace-api 컨벤션) — issue 상세에서 id 추출.
      const r = await http.get(
        `/projects/${projectKey}/issues/${number}`,
        onBehalfOf(agentId),
      );
      const issueId = r.data?.summary?.id ?? r.data?.id;
      if (!issueId) throw new Error(`issueId 조회 실패: ${issueKey}`);
      await http.post(
        `/issues/${issueId}/comments`,
        { body },
        onBehalfOf(agentId),
      );
    },

    async createIssue(agentId, projectKey, body) {
      return (await http.post(`/projects/${projectKey}/issues`, body, onBehalfOf(agentId))).data;
    },

    async editIssueComment(agentId, issueKey, commentId, body) {
      const { projectKey, number } = parseIssueKey(issueKey);
      // 코멘트 endpoint 는 issueId 기반 — addIssueComment 와 동일하게 이슈 상세에서 id 추출.
      const r = await http.get(
        `/projects/${projectKey}/issues/${number}`,
        onBehalfOf(agentId),
      );
      const issueId = r.data?.summary?.id ?? r.data?.id;
      if (!issueId) throw new Error(`issueId 조회 실패: ${issueKey}`);
      await http.patch(
        `/issues/${issueId}/comments/${commentId}`,
        { body },
        onBehalfOf(agentId),
      );
    },

    async updateIssueContent(agentId, issueKey, body) {
      const { projectKey, number } = parseIssueKey(issueKey);
      return (
        await http.patch(`/projects/${projectKey}/issues/${number}`, body, onBehalfOf(agentId))
      ).data;
    },
    async setIssueType(agentId, issueKey, typeId) {
      const { projectKey, number } = parseIssueKey(issueKey);
      await http.patch(
        `/projects/${projectKey}/issues/${number}/type`,
        { typeId },
        onBehalfOf(agentId),
      );
    },
    async setIssueParent(agentId, issueKey, parentNumber) {
      const { projectKey, number } = parseIssueKey(issueKey);
      await http.patch(
        `/projects/${projectKey}/issues/${number}/parent`,
        { parentNumber },
        onBehalfOf(agentId),
      );
    },
    async replaceIssueAssignees(agentId, issueKey, userIds) {
      const { projectKey, number } = parseIssueKey(issueKey);
      return (
        await http.put(
          `/projects/${projectKey}/issues/${number}/assignees`,
          { userIds },
          onBehalfOf(agentId),
        )
      ).data;
    },
    async replaceIssueLabels(agentId, issueKey, labelIds) {
      const { projectKey, number } = parseIssueKey(issueKey);
      return (
        await http.put(
          `/projects/${projectKey}/issues/${number}/labels`,
          { labelIds },
          onBehalfOf(agentId),
        )
      ).data;
    },
    async addIssueDependency(agentId, issueKey, otherNumber, direction) {
      const { projectKey, number } = parseIssueKey(issueKey);
      return (
        await http.post(
          `/projects/${projectKey}/issues/${number}/dependencies`,
          { otherNumber, direction },
          onBehalfOf(agentId),
        )
      ).data;
    },
    async removeIssueDependency(agentId, issueKey, otherNumber, direction) {
      const { projectKey, number } = parseIssueKey(issueKey);
      await http.delete(`/projects/${projectKey}/issues/${number}/dependencies`, {
        params: { otherNumber, direction },
        ...onBehalfOf(agentId),
      });
    },
    async updateIssueStatus(agentId, issueKey, statusKey) {
      const { projectKey, number } = parseIssueKey(issueKey);
      await http.patch(
        `/projects/${projectKey}/issues/${number}/status`,
        { status: statusKey },
        onBehalfOf(agentId),
      );
    },

    async getIssueDetail(agentId, issueKey) {
      const { projectKey, number } = parseIssueKey(issueKey);
      const r = await http.get(`/projects/${projectKey}/issues/${number}`, onBehalfOf(agentId));
      // 정규화는 공유 도구 핸들러(normalizeIssueDetail)가 수행 — 여기선 raw 를 그대로 반환.
      // run-ai-chat 의 filterIssueDetailWidgets 는 존재확인(throw/no-throw)만 쓰므로 형태 변화 무영향.
      return r.data ?? {};
    },

    // #371: 이슈 목록 조회 — GET /me/issues(프로젝트 횡단 "내 이슈"). assignee 미지정 시 'me'.
    // 서버가 'me' 를 X-On-Behalf-Of principal 로 해석하므로 numeric id 를 몰라도 "내 담당" 조회 가능.
    async listIssues(agentId, params) {
      const qs = new URLSearchParams();
      qs.set('assignee', params.assignee ?? 'me');
      if (params.projectKey) qs.set('projectKey', params.projectKey);
      if (params.status) qs.set('status', params.status);
      if (params.priority?.length) qs.set('priority', params.priority.join(','));
      if (params.label) qs.set('label', params.label);
      if (params.type) qs.set('type', params.type);
      if (params.dueFrom) qs.set('dueFrom', params.dueFrom);
      if (params.dueTo) qs.set('dueTo', params.dueTo);
      if (params.q) qs.set('q', params.q);
      if (params.blocked !== undefined) qs.set('blocked', String(params.blocked));
      if (params.topLevel !== undefined) qs.set('topLevel', String(params.topLevel));
      qs.set('size', String(params.size ?? 30));
      const r = await http.get(`/me/issues?${qs.toString()}`, onBehalfOf(agentId));
      // 응답 래퍼: { items: IssueResponse[], nextCursor, hasMore }. 방어적으로 bare 배열도 허용.
      const items: Record<string, unknown>[] = Array.isArray(r.data?.items)
        ? r.data.items
        : Array.isArray(r.data)
          ? r.data
          : [];
      return items.map((it) => {
        const projectKey = it.projectKey as string | undefined;
        const number = it.number as number | undefined;
        const rawAssignees = Array.isArray(it.assignees) ? (it.assignees as Record<string, unknown>[]) : [];
        return {
          issueKey:
            (it.issueKey as string | undefined) ??
            (projectKey && number != null ? `${projectKey}-${number}` : String(it.id ?? '')),
          title: (it.title as string | undefined) ?? '',
          status: (it.status as string | undefined) ?? '',
          priority: (it.priority as string | undefined) ?? '',
          assignees: rawAssignees.map((a) => ({
            id: a.id as number,
            name: (a.name as string | undefined) ?? (a.username as string | undefined) ?? '',
            kind: (a.kind as 'HUMAN' | 'AGENT' | undefined) ?? 'HUMAN',
          })),
          dueDate: (it.dueDate as string | undefined) ?? null,
          type: (it.type as string | undefined) ?? null,
          blocked: Boolean(it.blocked),
        };
      });
    },

    async unassignSelf(agentId, issueKey) {
      const { projectKey, number } = parseIssueKey(issueKey);
      // /assignees GET 엔드포인트 없음(405) — 이슈 상세에서 .summary.assignees 읽기.
      const r = await http.get(
        `/projects/${projectKey}/issues/${number}`,
        onBehalfOf(agentId),
      );
      const current: { id: number }[] = Array.isArray(r.data?.summary?.assignees) ? r.data.summary.assignees : [];
      // #415: 담당자로 등록되어 있지 않으면 오류로 처리한다.
      // 확인 없이 PUT 하면 API 가 멱등(현재=[] → 필터 후=[] → PUT 성공)이어서
      // 실제 해제 없이 성공을 환각한 것처럼 보이는 허위 성공 응답으로 이어진다.
      if (!current.some((u) => u.id === agentId)) {
        throw new Error(`담당자로 등록되어 있지 않아 해제할 수 없습니다. (${issueKey})`);
      }
      const next = current.filter((u) => u.id !== agentId).map((u) => u.id);
      await http.put(
        `/projects/${projectKey}/issues/${number}/assignees`,
        { userIds: next },
        onBehalfOf(agentId),
      );
    },

    // Task 7: redeem 일반화 — provider 별로 payload 형태가 다르므로 응답의 provider 필드로 분기.
    // model 은 assistant_config.model(DB 설정) — 이벤트 경로 모델 결정 폴백에 사용(모델 결정 이원화 해소).
    async getProviderCredential(agentId) {
      const r = await http.get('/users/me/provider-credential', onBehalfOf(agentId));
      const model = r.data?.model ?? null;
      return r.data?.provider === 'opencode'
        ? { provider: 'opencode', payload: JSON.parse(String(r.data.payload)), model }
        : { provider: 'anthropic', token: String(r.data?.token ?? ''), model };
    },

    async getChatMessages(agentId, threadId, limit) {
      const r = await http.get(
        `/chat/threads/${threadId}/messages?limit=${limit}`,
        onBehalfOf(agentId),
      );
      const items: ChatMessageItem[] = Array.isArray(r.data?.items) ? r.data.items : [];
      return items;
    },

    async addChatMessage(agentId, threadId, body) {
      await http.post(`/chat/threads/${threadId}/messages`, { body }, onBehalfOf(agentId));
    },

    async postChatProgress(agentId, threadId, payload) {
      await http.post(`/chat/threads/${threadId}/progress`, payload, onBehalfOf(agentId));
    },

    async getChannelMessages(agentId, channelId, limit) {
      const r = await http.get(
        `/messaging/channels/${channelId}/messages?limit=${limit}`,
        onBehalfOf(agentId),
      );
      const items: ChannelMessageItem[] = Array.isArray(r.data?.items) ? r.data.items : [];
      return items;
    },
    async addChannelMessage(agentId, channelId, body, parentMessageId) {
      await http.post(
        `/messaging/channels/${channelId}/messages`,
        // parentMessageId 가 있으면 그 스레드에 답(mirror). 없으면 채널 인라인.
        parentMessageId != null ? { body, parentMessageId } : { body },
        onBehalfOf(agentId),
      );
    },

    // L3 위임: 이슈 생성 제안 카드. actionType='CREATE_ISSUE' + 위임 컨텍스트를 담아 proposals API 호출.
    async proposeCreateIssue(agentId, channelId, req) {
      await http.post(
        `/messaging/channels/${channelId}/proposals`,
        { actionType: 'CREATE_ISSUE', ...req },
        onBehalfOf(agentId),
      );
    },

    // L3 위임(일정): 일정 생성 제안 카드. actionType='calendar.create_event' + 일정 컨텍스트를 담아 proposals API 호출.
    async proposeCreateEvent(agentId, channelId, req) {
      await http.post(
        `/messaging/channels/${channelId}/proposals`,
        { actionType: 'calendar.create_event', ...req },
        onBehalfOf(agentId),
      );
    },

    // L3 위임: 후보 프로젝트 목록(AI 가 맥락으로 고를 소스).
    // delegatorId 가 참여 중인 프로젝트 key+name 배열 반환. 비-배열 응답은 빈 배열로 방어.
    async listDelegationCandidates(agentId, delegatorId) {
      const r = await http.get(
        `/messaging/delegation-candidates?delegatorId=${delegatorId}`,
        onBehalfOf(agentId),
      );
      return Array.isArray(r.data) ? (r.data as { key: string; name: string }[]) : [];
    },

    async postMessagingProgress(agentId, channelId, payload) {
      await http.post(`/messaging/channels/${channelId}/progress`, payload, onBehalfOf(agentId));
    },

    // #350: 채널 목록 — agentId 가 속한 채널/DM 목록. 채널 이름 → channelId 해석에 사용.
    async listChannels(agentId) {
      const r = await http.get(`/messaging/channels`, onBehalfOf(agentId));
      return Array.isArray(r.data) ? (r.data as ChannelItem[]) : [];
    },
    // #350: 채널 탐색 — 공개 채널을 이름/키워드로 검색. 채널 이름 → channelId 해석에 사용.
    async discoverChannels(agentId, q) {
      const r = await http.get(`/messaging/channels/discover?q=${encodeURIComponent(q)}`, onBehalfOf(agentId));
      return Array.isArray(r.data) ? (r.data as ChannelItem[]) : [];
    },

    // #333 M3: 위키 페이지 생성/수정 — 내부 쓰기(스페이스 멤버십 가드는 서버가 강제).
    async createWikiPage(agentId, spaceId, title, parentId) {
      const r = await http.post(
        `/wiki/spaces/${spaceId}/pages`,
        { parentId: parentId ?? null, title },
        onBehalfOf(agentId),
      );
      return r.data as WikiPageContent;
    },
    async updateWikiPage(agentId, pageId, version, title, body) {
      // SavePageRequest{title, body, version, snapshot} — 낙관적 동시성. 409 는 호출자(도구)가 처리.
      const r = await http.put(
        `/wiki/pages/${pageId}`,
        { title, body, version, snapshot: false },
        onBehalfOf(agentId),
      );
      return r.data as WikiPageContent;
    },

    // #724: 내 노트 스페이스 목록 — 스페이스 이름/타입 → spaceId 해석에 사용(GET /wiki/spaces).
    async listWikiSpaces(agentId) {
      const r = await http.get(`/wiki/spaces`, onBehalfOf(agentId));
      return Array.isArray(r.data) ? (r.data as WikiSpaceItem[]) : [];
    },
    // S2: 위키 검색 — 백엔드는 bare JSON 배열(List<WikiSearchResult>)을 반환.
    async searchWikiPages(agentId, query) {
      const r = await http.get(
        `/wiki/search?q=${encodeURIComponent(query)}`,
        onBehalfOf(agentId),
      );
      return Array.isArray(r.data) ? (r.data as WikiSearchItem[]) : [];
    },
    // S2: 위키 페이지 본문 — 페이지 객체를 그대로 반환.
    async getWikiPage(agentId, pageId) {
      const r = await http.get(`/wiki/pages/${pageId}`, onBehalfOf(agentId));
      return r.data as WikiPageContent;
    },

    async listIssueAttachments(agentId, issueKey) {
      const { projectKey, number } = parseIssueKey(issueKey);
      const r = await http.get(
        `/projects/${projectKey}/issues/${number}/attachments`,
        onBehalfOf(agentId),
      );
      const list: AttachmentMeta[] = Array.isArray(r.data) ? r.data : [];
      return list;
    },

    // #333 M2: 캘린더 읽기 — list/get. 쓰기(생성)는 서버측 confirm 실행기가 수행(에이전트는 propose 만).
    async listEvents(agentId, from, to) {
      const r = await http.get(
        `/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        onBehalfOf(agentId),
      );
      return Array.isArray(r.data) ? (r.data as CalendarEventItem[]) : [];
    },
    async getEvent(agentId, id) {
      const r = await http.get(`/calendar/events/${id}`, onBehalfOf(agentId));
      return r.data as CalendarEventItem;
    },

    // #333 M3: 메일 읽기 — list/get. 발송은 서버측 confirm 실행기가 수행(에이전트는 propose 만).
    async listMail(agentId, accountId, folder, query, unreadOnly, limit) {
      const qs = new URLSearchParams({ folder, limit: String(limit) });
      if (query) qs.set('query', query);
      // #466: 안 읽은 메일만 — API 의 unread 필터 파라미터로 전달.
      if (unreadOnly) qs.set('unread', 'true');
      const r = await http.get(`/mail/accounts/${accountId}/messages?${qs.toString()}`, onBehalfOf(agentId));
      return Array.isArray(r.data) ? (r.data as MailMessageItem[]) : [];
    },
    async getMail(agentId, messageId) {
      const r = await http.get(`/mail/messages/${messageId}`, onBehalfOf(agentId));
      return r.data as MailMessageDetail;
    },

    // #333 M4: 메일 계정 목록 — GET /mail/accounts. 발신 accountId 확보 및 계정 존재 확인용.
    async listMailAccounts(agentId) {
      const r = await http.get('/mail/accounts', onBehalfOf(agentId));
      return Array.isArray(r.data) ? (r.data as MailAccountItem[]) : [];
    },
    // #333 M4: 수동 동기화 — POST /mail/accounts/{accountId}/sync. 소유권은 서버가 검증.
    async syncMail(agentId, accountId) {
      const r = await http.post(`/mail/accounts/${accountId}/sync`, {}, onBehalfOf(agentId));
      return r.data;
    },

    // #333 M3: 프로젝트 읽기. 쓰기(생성/삭제/멤버)는 confirm 실행기(propose).
    async listProjects(agentId, page, size) {
      const r = await http.get(`/projects?page=${page}&size=${size}`, onBehalfOf(agentId));
      return Array.isArray(r.data) ? (r.data as ProjectItem[]) : (r.data?.content ?? []);
    },
    async getProject(agentId, key) {
      const r = await http.get(`/projects/${key}`, onBehalfOf(agentId));
      return r.data as ProjectItem;
    },
    async listProjectMembers(agentId, key) {
      const r = await http.get(`/projects/${key}/members`, onBehalfOf(agentId));
      return Array.isArray(r.data) ? (r.data as ProjectMemberItem[]) : [];
    },
    async getProjectTypes(agentId, key) {
      const r = await http.get(`/projects/${key}/types`, onBehalfOf(agentId));
      return Array.isArray(r.data) ? r.data : [];
    },
    async getProjectLabels(agentId, key) {
      const r = await http.get(`/projects/${key}/labels`, onBehalfOf(agentId));
      return Array.isArray(r.data) ? r.data : [];
    },

    // #333 M3: 연락처 읽기 + 외부연락처 내부 쓰기(생성/수정). 삭제는 confirm 실행기(propose).
    async listContacts(agentId, search, type, limit) {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (search) qs.set('search', search);
      if (type) qs.set('type', type);
      const r = await http.get(`/contacts?${qs.toString()}`, onBehalfOf(agentId));
      // #384: API 응답이 페이지네이션 형식 { items: [...] } 이므로 .items 를 추출한다.
      // Array.isArray(r.data) 체크만 하면 객체 응답 시 빈 배열을 반환하는 버그가 발생한다.
      const data = r.data as { items?: ContactItem[] } | ContactItem[];
      return Array.isArray(data) ? data : (data?.items ?? []);
    },
    async getExternalContact(agentId, id) {
      const r = await http.get(`/contacts/external/${id}`, onBehalfOf(agentId));
      return r.data as ContactItem;
    },
    async createExternalContact(agentId, input) {
      const r = await http.post(`/contacts/external`, input, onBehalfOf(agentId));
      return r.data as ContactItem;
    },
    async updateExternalContact(agentId, id, input) {
      const r = await http.patch(`/contacts/external/${id}`, input, onBehalfOf(agentId));
      return r.data as ContactItem;
    },

    // #333 M3: 드라이브 읽기 전용(v1 — 쓰기 연기). list/items/search.
    async listMySpaces(agentId) {
      const r = await http.get(`/drive/spaces`, onBehalfOf(agentId));
      return Array.isArray(r.data) ? (r.data as DriveSpaceItem[]) : [];
    },
    async listSpaceItems(agentId, spaceId, parentId) {
      const qs = parentId ? `?parentId=${parentId}` : '';
      const r = await http.get(`/drive/spaces/${spaceId}/items${qs}`, onBehalfOf(agentId));
      // #376: API 응답은 { folders: [], files: [] } 객체. 기존 Array.isArray 가드는 항상 false.
      const d = r.data as Record<string, unknown>;
      return {
        folders: Array.isArray(d.folders) ? (d.folders as DriveFolderNode[]) : [],
        files: Array.isArray(d.files) ? (d.files as DriveFileNode[]) : [],
      };
    },
    async searchDrive(agentId, spaceId, q) {
      const r = await http.get(`/drive/spaces/${spaceId}/search?q=${encodeURIComponent(q)}`, onBehalfOf(agentId));
      // #376: API 응답은 { folders: [], files: [] } 객체.
      const d = r.data as Record<string, unknown>;
      return {
        folders: Array.isArray(d.folders) ? (d.folders as DriveFolderNode[]) : [],
        files: Array.isArray(d.files) ? (d.files as DriveFileNode[]) : [],
      };
    },

    // #333 M4: 드라이브 폴더/파일 쓰기 — 이동은 204(void).
    async createFolder(agentId, spaceId, parentId, name) {
      const r = await http.post(`/drive/spaces/${spaceId}/folders`, { parentId: parentId ?? null, name }, onBehalfOf(agentId));
      return r.data as DriveFolderItem;
    },
    async renameFolder(agentId, folderId, name) {
      const r = await http.patch(`/drive/folders/${folderId}`, { name }, onBehalfOf(agentId));
      return r.data as DriveFolderItem;
    },
    async moveFolder(agentId, folderId, targetParentId) {
      await http.patch(`/drive/folders/${folderId}/move`, { targetParentId: targetParentId ?? null }, onBehalfOf(agentId));
    },
    async moveFile(agentId, fileId, targetFolderId) {
      await http.patch(`/drive/files/${fileId}/move`, { targetFolderId: targetFolderId ?? null }, onBehalfOf(agentId));
    },

    async downloadIssueAttachment(agentId, issueKey, fileId) {
      const { projectKey, number } = parseIssueKey(issueKey);
      const r = await http.get(
        `/projects/${projectKey}/issues/${number}/attachments/${fileId}/content`,
        { ...onBehalfOf(agentId), responseType: 'arraybuffer' },
      );
      const mimeType = String(r.headers['content-type'] ?? 'application/octet-stream');
      return { data: Buffer.from(r.data as ArrayBuffer), mimeType };
    },
  };
}

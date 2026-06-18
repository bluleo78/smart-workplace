// workplace-api 호출 client — INTERNAL_SERVICE_TOKEN 인증 + X-On-Behalf-Of 헤더 (#34).
// 매 메서드의 첫 인자 agentId 는 workplace-api 가 SecurityContext 의 principal 로 설정할
// AGENT user id. 누락 시 TypeScript 가 빌드 차단.
import axios, { AxiosInstance } from 'axios';

import { DEFAULT_API_BASE_URL } from '../constants.js';
import { IssueDetail, issueDetail } from '../types/workplace-api.js';

// 6c: chat thread 메시지 (LLM 노출용 경량 형태).
export interface ChatMessageItem {
  id: number;
  authorName: string;
  authorKind: 'HUMAN' | 'AGENT';
  body: string;
  createdAt: string;
  deleted: boolean;
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

export interface WorkplaceApiClient {
  addIssueComment(agentId: number, issueKey: string, body: string): Promise<void>;
  updateIssueStatus(agentId: number, issueKey: string, statusKey: string): Promise<void>;
  getIssueDetail(agentId: number, issueKey: string): Promise<IssueDetail>;
  unassignSelf(agentId: number, issueKey: string): Promise<void>;
  getOAuthToken(agentId: number): Promise<{ token: string; label: string | null }>;
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
  addChannelMessage(agentId: number, channelId: number, body: string): Promise<void>;
  // A2: 메시징 진행 상태 전송
  postMessagingProgress(agentId: number, channelId: number, payload: ProgressPayload): Promise<void>;
  // S2: 위키 읽기 그라운딩
  searchWikiPages(agentId: number, query: string): Promise<WikiSearchItem[]>;
  getWikiPage(agentId: number, pageId: number): Promise<WikiPageContent>;
  // #333 M2: 캘린더 읽기 — list/get. 쓰기(생성)는 서버측 confirm 실행기가 수행(에이전트는 propose 만).
  listEvents(agentId: number, from: string, to: string): Promise<CalendarEventItem[]>;
  getEvent(agentId: number, id: number): Promise<CalendarEventItem>;
  // 6c: 이슈 첨부
  listIssueAttachments(agentId: number, issueKey: string): Promise<AttachmentMeta[]>;
  downloadIssueAttachment(
    agentId: number,
    issueKey: string,
    fileId: number,
  ): Promise<{ data: Buffer; mimeType: string }>;
}

export function parseIssueKey(issueKey: string): {
  projectKey: string;
  number: number;
} {
  const idx = issueKey.lastIndexOf('-');
  return {
    projectKey: issueKey.slice(0, idx),
    number: Number(issueKey.slice(idx + 1)),
  };
}

export function createWorkplaceApiClient(opts: {
  baseURL?: string;
  internalToken: string;
}): WorkplaceApiClient {
  const http: AxiosInstance = axios.create({
    baseURL: opts.baseURL ?? DEFAULT_API_BASE_URL,
    headers: { Authorization: `Internal ${opts.internalToken}` },
  });

  const onBehalfOf = (agentId: number) => ({
    headers: { 'X-On-Behalf-Of': String(agentId) },
  });

  return {
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
      const raw = r.data ?? {};
      // workplace-api 응답: {summary:{title,status,priority,assignees}, body, comments}.
      // LLM 노출용으로 flatten + issueKey 명시.
      const summary = raw.summary ?? {};
      const normalized = {
        issueKey: raw.issueKey ?? raw.key ?? issueKey,
        title: summary.title ?? raw.title ?? '',
        body: raw.body ?? summary.body ?? null,
        status: summary.status ?? raw.status ?? '',
        priority: summary.priority ?? raw.priority ?? '',
        assignees: summary.assignees ?? raw.assignees ?? [],
        comments: raw.comments ?? [],
      };
      return issueDetail.parse(normalized);
    },

    async unassignSelf(agentId, issueKey) {
      const { projectKey, number } = parseIssueKey(issueKey);
      const r = await http.get(
        `/projects/${projectKey}/issues/${number}/assignees`,
        onBehalfOf(agentId),
      );
      const current: { id: number }[] = Array.isArray(r.data) ? r.data : [];
      const next = current.filter((u) => u.id !== agentId).map((u) => u.id);
      await http.put(
        `/projects/${projectKey}/issues/${number}/assignees`,
        { userIds: next },
        onBehalfOf(agentId),
      );
    },

    async getOAuthToken(agentId) {
      const r = await http.get('/users/me/oauth-token', onBehalfOf(agentId));
      return {
        token: String(r.data?.token ?? ''),
        label: r.data?.label ?? null,
      };
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
    async addChannelMessage(agentId, channelId, body) {
      await http.post(
        `/messaging/channels/${channelId}/messages`,
        { body },
        onBehalfOf(agentId),
      );
    },

    async postMessagingProgress(agentId, channelId, payload) {
      await http.post(`/messaging/channels/${channelId}/progress`, payload, onBehalfOf(agentId));
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

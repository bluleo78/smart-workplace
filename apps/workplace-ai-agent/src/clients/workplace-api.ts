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

// 6c: 이슈 첨부 메타.
export interface AttachmentMeta {
  fileId: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
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
  // 7: 채널 메시지 조회/작성
  getChannelMessages(
    agentId: number,
    channelId: number,
    limit: number,
  ): Promise<ChannelMessageItem[]>;
  addChannelMessage(agentId: number, channelId: number, body: string): Promise<void>;
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

    async listIssueAttachments(agentId, issueKey) {
      const { projectKey, number } = parseIssueKey(issueKey);
      const r = await http.get(
        `/projects/${projectKey}/issues/${number}/attachments`,
        onBehalfOf(agentId),
      );
      const list: AttachmentMeta[] = Array.isArray(r.data) ? r.data : [];
      return list;
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

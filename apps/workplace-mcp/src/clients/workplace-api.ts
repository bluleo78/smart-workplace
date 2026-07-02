// src/clients/workplace-api.ts — PAT 패스스루 REST 클라이언트.
// ai-agent 의 workplace-api.ts 와 같은 REST 표면을 사용하되, Internal 토큰 + X-On-Behalf-Of 대신
// 사용자 PAT 를 Bearer 로 그대로 전달한다(신원·테넌트는 서버 필터가 토큰에서 해석).
import axios, { type AxiosInstance } from 'axios';

export interface PatApiClient {
  getMe(): Promise<{ id: number; username: string; name: string; kind: string }>;
  listProjects(): Promise<unknown[]>;
  getProject(key: string): Promise<unknown>;
  listMyIssues(
    params: Record<string, string | number | boolean | undefined>,
  ): Promise<unknown[]>;
  getIssueDetail(
    projectKey: string,
    number: number,
  ): Promise<{ summary: { id: number }; [k: string]: unknown }>;
  createIssue(
    projectKey: string,
    body: { title: string; body?: string; priority?: string; dueDate?: string },
  ): Promise<{ number: number; [k: string]: unknown }>;
  addIssueComment(issueId: number, body: string): Promise<void>;
  updateIssueStatus(projectKey: string, number: number, status: string): Promise<void>;
  // Task 7: 위키 — 검색/조회/생성/수정(낙관적 동시성, 409 는 호출자에 그대로 전파).
  searchWikiPages(q: string): Promise<unknown[]>;
  getWikiPage(pageId: number): Promise<unknown>;
  createWikiPage(spaceId: number, body: { parentId: number | null; title: string }): Promise<unknown>;
  updateWikiPage(
    pageId: number,
    body: { title: string; body: string; version: number },
  ): Promise<unknown>;
  // Task 7: 메시징 — 채널 목록/메시지 조회/작성.
  listChannels(): Promise<unknown[]>;
  getChannelMessages(channelId: number, limit: number): Promise<unknown[]>;
  addChannelMessage(channelId: number, body: string): Promise<void>;
  // Task 7: 캘린더 — 읽기 전용(쓰기는 후속 태스크).
  listEvents(from: string, to: string): Promise<unknown[]>;
  getEvent(id: number): Promise<unknown>;
  // Task 7: 드라이브 — 읽기 전용(쓰기는 후속 태스크).
  listDriveSpaces(): Promise<unknown[]>;
  listDriveItems(spaceId: number, parentId?: number): Promise<unknown>;
  searchDrive(spaceId: number, q: string): Promise<unknown>;
  // Task 7: 메일 — 읽기 전용(발송은 후속 태스크).
  listMailAccounts(): Promise<unknown[]>;
  listMail(
    accountId: number,
    params: { folder: string; limit: number; query?: string; unread?: boolean },
  ): Promise<unknown[]>;
  getMail(messageId: number): Promise<unknown>;
}

/** PAT 토큰을 Authorization: Bearer 헤더로 부착하는 axios 기반 REST 클라이언트를 생성한다. */
export function createPatApiClient(opts: { baseURL: string; token: string }): PatApiClient {
  const http: AxiosInstance = axios.create({
    baseURL: opts.baseURL,
    headers: { Authorization: `Bearer ${opts.token}` },
  });
  return {
    async getMe() {
      return (await http.get('/auth/me')).data;
    },
    async listProjects() {
      return (await http.get('/projects', { params: { page: 0, size: 50 } })).data.content ?? [];
    },
    async getProject(key) {
      return (await http.get(`/projects/${encodeURIComponent(key)}`)).data;
    },
    async listMyIssues(params) {
      return (await http.get('/me/issues', { params })).data.items ?? [];
    },
    async getIssueDetail(projectKey, number) {
      return (
        await http.get(`/projects/${encodeURIComponent(projectKey)}/issues/${number}`)
      ).data;
    },
    async createIssue(projectKey, body) {
      return (await http.post(`/projects/${encodeURIComponent(projectKey)}/issues`, body)).data;
    },
    async addIssueComment(issueId, body) {
      await http.post(`/issues/${issueId}/comments`, { body });
    },
    async updateIssueStatus(projectKey, number, status) {
      await http.patch(
        `/projects/${encodeURIComponent(projectKey)}/issues/${number}/status`,
        { status },
      );
    },
    async searchWikiPages(q) {
      return (await http.get('/wiki/search', { params: { q } })).data ?? [];
    },
    async getWikiPage(pageId) {
      return (await http.get(`/wiki/pages/${pageId}`)).data;
    },
    async createWikiPage(spaceId, body) {
      return (await http.post(`/wiki/spaces/${spaceId}/pages`, body)).data;
    },
    async updateWikiPage(pageId, body) {
      // 낙관적 동시성 — 409(버전 충돌)는 호출자(도구)에 그대로 전파한다.
      return (
        await http.put(`/wiki/pages/${pageId}`, { ...body, snapshot: false })
      ).data;
    },
    async listChannels() {
      return (await http.get('/messaging/channels')).data ?? [];
    },
    async getChannelMessages(channelId, limit) {
      return (await http.get(`/messaging/channels/${channelId}/messages`, { params: { limit } }))
        .data?.items ?? [];
    },
    async addChannelMessage(channelId, body) {
      await http.post(`/messaging/channels/${channelId}/messages`, { body });
    },
    async listEvents(from, to) {
      return (await http.get('/calendar/events', { params: { from, to } })).data ?? [];
    },
    async getEvent(id) {
      return (await http.get(`/calendar/events/${id}`)).data;
    },
    async listDriveSpaces() {
      return (await http.get('/drive/spaces')).data ?? [];
    },
    async listDriveItems(spaceId, parentId) {
      return (
        await http.get(`/drive/spaces/${spaceId}/items`, {
          params: parentId != null ? { parentId } : undefined,
        })
      ).data;
    },
    async searchDrive(spaceId, q) {
      return (await http.get(`/drive/spaces/${spaceId}/search`, { params: { q } })).data;
    },
    async listMailAccounts() {
      return (await http.get('/mail/accounts')).data ?? [];
    },
    async listMail(accountId, params) {
      return (
        await http.get(`/mail/accounts/${accountId}/messages`, {
          params: {
            folder: params.folder,
            limit: params.limit,
            ...(params.query ? { query: params.query } : {}),
            ...(params.unread ? { unread: true } : {}),
          },
        })
      ).data ?? [];
    },
    async getMail(messageId) {
      return (await http.get(`/mail/messages/${messageId}`)).data;
    },
  };
}

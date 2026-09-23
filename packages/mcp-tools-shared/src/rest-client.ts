// src/rest-client.ts — 공유 도구용 REST 클라이언트 구현(#846). 두 앱이 인증 헤더만 다른 HTTP 인스턴스를 넘겨 같이 쓴다.
//
// 이전에는 workplace-mcp(PAT)와 ai-agent(Internal + X-On-Behalf-Of)가 같은 경로를 각자 매핑했고, 응답 가공도 각자 해서
// 파라미터 이름·기본값·가공 규칙이 조금씩 어긋났다. 경로 매핑을 여기 한 곳에 두고, 각 앱은 인증이 붙은 HTTP 인스턴스만 준다.
// 이 클라이언트는 경로 호출과 응답 래퍼 벗기기까지만 하고 LLM 용 가공은 공유 도구 핸들러가 맡는다.
import { parseIssueKey } from './parse.js';
import type { SharedToolClient } from './shared-tools.js';

/** 요청 설정 — 쿼리 파라미터만 쓴다(인증 헤더는 HTTP 인스턴스가 붙인다). */
export interface HttpRequestConfig {
  params?: unknown;
}

/** 응답 본문 — 서버 DTO 마다 모양이 달라 여기서 좁히지 않는다(해석은 도구 핸들러). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ResponseBody = any;

/** axios 인스턴스가 그대로 만족하는 최소 HTTP 인터페이스. 공유 패키지가 axios 에 의존하지 않도록 구조적으로 정의한다. */
export interface HttpLike {
  get(url: string, config?: HttpRequestConfig): Promise<{ data: ResponseBody }>;
  post(url: string, data?: unknown, config?: HttpRequestConfig): Promise<{ data: ResponseBody }>;
  put(url: string, data?: unknown, config?: HttpRequestConfig): Promise<{ data: ResponseBody }>;
  patch(url: string, data?: unknown, config?: HttpRequestConfig): Promise<{ data: ResponseBody }>;
  delete(url: string, config?: HttpRequestConfig): Promise<{ data: ResponseBody }>;
}

/** Spring 페이지 응답({ content })과 bare 배열을 모두 행 배열로 벗긴다. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const unwrapPage = (data: any) => (Array.isArray(data) ? data : (data?.content ?? []));

/** 인증된 HTTP 인스턴스로 공유 도구 클라이언트를 만든다. */
export function createSharedToolClient(http: HttpLike): SharedToolClient {
  /** 프로젝트 키는 경로 세그먼트라 인코딩한다. */
  const project = (key: string) => `/projects/${encodeURIComponent(key)}`;
  /** issueKey(WP-12) → 이슈 경로. */
  const issue = (issueKey: string) => {
    const { projectKey, number } = parseIssueKey(issueKey);
    return `${project(projectKey)}/issues/${number}`;
  };
  /** 코멘트 API 는 숫자 issue id 경로를 쓴다 — 상세에서 summary.id 를 얻는다. */
  const issueId = async (issueKey: string): Promise<number> =>
    ((await http.get(issue(issueKey))).data as { summary: { id: number } }).summary.id;

  return {
    // ── 프로젝트·이슈 ──
    async listProjects(page, size) {
      return unwrapPage((await http.get('/projects', { params: { page, size } })).data);
    },
    async getProject(key) {
      return (await http.get(project(key))).data;
    },
    async getProjectTypes(key) {
      return (await http.get(`${project(key)}/types`)).data ?? [];
    },
    async getProjectLabels(key) {
      return (await http.get(`${project(key)}/labels`)).data ?? [];
    },
    async getProjectMembers(key) {
      return (await http.get(`${project(key)}/members`)).data ?? [];
    },
    async listIssues(query) {
      return (await http.get('/me/issues', { params: query })).data?.items ?? [];
    },
    async getIssueDetail(issueKey) {
      return (await http.get(issue(issueKey))).data;
    },
    async createIssue(projectKey, body) {
      return (await http.post(`${project(projectKey)}/issues`, body)).data;
    },
    async updateIssueContent(issueKey, body) {
      return (await http.patch(issue(issueKey), body)).data;
    },
    async setIssueType(issueKey, typeId) {
      await http.patch(`${issue(issueKey)}/type`, { typeId });
    },
    async setIssueParent(issueKey, parentNumber) {
      await http.patch(`${issue(issueKey)}/parent`, { parentNumber });
    },
    async replaceIssueAssignees(issueKey, userIds) {
      return (await http.put(`${issue(issueKey)}/assignees`, { userIds })).data;
    },
    async replaceIssueLabels(issueKey, labelIds) {
      return (await http.put(`${issue(issueKey)}/labels`, { labelIds })).data;
    },
    async addComment(issueKey, body) {
      await http.post(`/issues/${await issueId(issueKey)}/comments`, { body });
    },
    async editComment(issueKey, commentId, body) {
      await http.patch(`/issues/${await issueId(issueKey)}/comments/${commentId}`, { body });
    },
    async addIssueDependency(issueKey, otherNumber, direction) {
      return (await http.post(`${issue(issueKey)}/dependencies`, { otherNumber, direction })).data;
    },
    async removeIssueDependency(issueKey, otherNumber, direction) {
      await http.delete(`${issue(issueKey)}/dependencies`, { params: { otherNumber, direction } });
    },

    // ── 노트 ──
    async listWikiSpaces() {
      return (await http.get('/wiki/spaces')).data ?? [];
    },
    async searchWikiPages(query) {
      return (await http.get('/wiki/search', { params: { q: query } })).data ?? [];
    },
    async getWikiPage(pageId) {
      return (await http.get(`/wiki/pages/${pageId}`)).data;
    },
    async createWikiPage(spaceId, body) {
      return (await http.post(`/wiki/spaces/${spaceId}/pages`, body)).data;
    },
    async updateWikiPage(pageId, body) {
      // 낙관적 동시성 — 409(버전 충돌)는 호출자(도구)에 그대로 전파한다. 도구 저장은 스냅샷을 남기지 않는다.
      return (await http.put(`/wiki/pages/${pageId}`, { ...body, snapshot: false })).data;
    },

    // ── 캘린더 ──
    async listEvents(from, to) {
      return (await http.get('/calendar/events', { params: { from, to } })).data ?? [];
    },
    async getEvent(eventId) {
      return (await http.get(`/calendar/events/${eventId}`)).data;
    },

    // ── 메일 ──
    async listMailAccounts() {
      return (await http.get('/mail/accounts')).data ?? [];
    },
    async listMail(accountId, { folder, limit, query, unread }) {
      const params = { folder, limit, ...(query ? { query } : {}), ...(unread ? { unread: true } : {}) };
      return (await http.get(`/mail/accounts/${accountId}/messages`, { params })).data ?? [];
    },
    async getMail(messageId) {
      return (await http.get(`/mail/messages/${messageId}`)).data;
    },

    // ── 구성원·연락처 ──
    async searchMembers(params) {
      // 계정 관리 API(/users, ADMIN 전용)가 아니라 구성원 디렉터리(/members, member:read)를 쓴다 —
      // 일반 구성원의 PAT 로도 사람을 찾을 수 있어야 하기 때문.
      return unwrapPage((await http.get('/members', { params })).data);
    },
    async getMemberContact(userId) {
      return (await http.get(`/contacts/members/${userId}`)).data;
    },
    async listContacts(params) {
      return (await http.get('/contacts', { params })).data;
    },
    async getExternalContact(externalId) {
      return (await http.get(`/contacts/external/${externalId}`)).data;
    },

    // ── 메시징 ──
    async listChannels() {
      return (await http.get('/messaging/channels')).data ?? [];
    },
    async getChannelMessages(channelId, limit) {
      return (await http.get(`/messaging/channels/${channelId}/messages`, { params: { limit } })).data?.items ?? [];
    },
    async addChannelMessage(channelId, body, parentMessageId) {
      await http.post(`/messaging/channels/${channelId}/messages`, { body, parentMessageId });
    },

    // ── 드라이브 ──
    async listDriveSpaces() {
      return (await http.get('/drive/spaces')).data ?? [];
    },
    async listDriveItems(spaceId, parentId) {
      return (await http.get(`/drive/spaces/${spaceId}/items`, { params: parentId != null ? { parentId } : undefined }))
        .data;
    },
    async searchDrive(spaceId, q) {
      return (await http.get(`/drive/spaces/${spaceId}/search`, { params: { q } })).data;
    },
  };
}

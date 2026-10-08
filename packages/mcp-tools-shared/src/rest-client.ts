// src/rest-client.ts — 공유 도구용 REST 클라이언트 구현(#846). 두 앱이 인증 헤더만 다른 HTTP 인스턴스를 넘겨 같이 쓴다.
//
// 이전에는 workplace-mcp(PAT)와 ai-agent(Internal + X-On-Behalf-Of)가 같은 경로를 각자 매핑했고, 응답 가공도 각자 해서
// 파라미터 이름·기본값·가공 규칙이 조금씩 어긋났다. 경로 매핑을 여기 한 곳에 두고, 각 앱은 인증이 붙은 HTTP 인스턴스만 준다.
// 이 클라이언트는 경로 호출과 응답 래퍼 벗기기까지만 하고 LLM 용 가공은 공유 도구 핸들러가 맡는다.
import { parseIssueKey } from './parse.js';
import type { SharedToolClient } from './shared-tools.js';

/** 요청 설정 — 쿼리 파라미터와 DELETE 본문만 쓴다(인증 헤더는 HTTP 인스턴스가 붙인다). */
export interface HttpRequestConfig {
  params?: unknown;
  /** DELETE 요청 본문(axios config.data) — 서버가 @RequestBody 로 받는 DELETE(즐겨찾기 해제)에 쓴다(#839). */
  data?: unknown;
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
    async getProjectMilestones(key) {
      return (await http.get(`${project(key)}/milestones`)).data ?? [];
    },
    async getProjectCycles(key) {
      return (await http.get(`${project(key)}/cycles`)).data ?? [];
    },
    async getMe() {
      // 호출자 신원 — PAT 는 소유자, Internal+X-On-Behalf-Of 는 대리 대상이 된다(담당자 "me" 치환·토큰 검증).
      return (await http.get('/auth/me')).data;
    },
    async updateProject(key, body) {
      return (await http.patch(project(key), body)).data;
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
    async replaceIssueCycles(issueKey, cycleIds) {
      return (await http.put(`${issue(issueKey)}/cycles`, { cycleIds })).data;
    },
    async getIssueCycles(issueKey) {
      return (await http.get(`${issue(issueKey)}/cycles`)).data ?? [];
    },
    async watchIssue(issueKey) {
      await http.post(`${issue(issueKey)}/watch`);
    },
    async unwatchIssue(issueKey) {
      await http.delete(`${issue(issueKey)}/watch`);
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
      // version = 병합 기준(읽은 판). 409(기준본 만료)는 호출자(도구)에 그대로 전파한다. 직전 판 스냅샷은 동기화 서버가 AI 적용 때 남기므로 요청하지 않는다(WP-289).
      return (await http.put(`/wiki/pages/${pageId}`, { ...body, snapshot: false })).data;
    },
    async listWikiPages(spaceId) {
      return (await http.get(`/wiki/spaces/${spaceId}/pages`)).data ?? [];
    },
    async getWikiBacklinks(pageId) {
      return (await http.get(`/wiki/pages/${pageId}/backlinks`)).data?.items ?? [];
    },
    async moveWikiPage(pageId, body) {
      await http.patch(`/wiki/pages/${pageId}/move`, body);
    },

    // ── 캘린더 ──
    async listEvents(from, to) {
      return (await http.get('/calendar/events', { params: { from, to } })).data ?? [];
    },
    async getEvent(eventId) {
      return (await http.get(`/calendar/events/${eventId}`)).data;
    },
    async rsvpEvent(eventId, status) {
      await http.patch(`/calendar/events/${eventId}/rsvp`, { status });
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
      // WP-147: AI 조회는 사용자가 읽은 것이 아니다 — 읽음 처리·역동기화를 하지 않도록 markSeen=false.
      return (await http.get(`/mail/messages/${messageId}`, { params: { markSeen: false } })).data;
    },
    async getMailSummary(messageId) {
      return (await http.get(`/mail/messages/${messageId}/summary`)).data;
    },
    async draftMailReply(messageId) {
      return (await http.post(`/mail/messages/${messageId}/reply-draft`)).data;
    },
    async draftIssueFromMail(messageId) {
      return (await http.post(`/mail/messages/${messageId}/issue-draft`)).data;
    },
    async getMailLinkedIssue(messageId) {
      // 연결 이슈가 없으면 서버는 { issueKey: null } 을 준다.
      const data = (await http.get(`/mail/messages/${messageId}/linked-issue`)).data;
      return data?.issueKey ? data : null;
    },
    async promoteMailToIssue(messageId, body) {
      return (await http.post(`/mail/messages/${messageId}/issue`, body)).data;
    },
    async markMailRead(messageId) {
      await http.post(`/mail/messages/${messageId}/read`);
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

    // ── 연락처 부가 기능(#839) ──
    async getContactFacets() {
      return (await http.get('/contacts/facets')).data;
    },
    async addContactFavorite(target) {
      await http.post('/contacts/favorites', target);
    },
    async removeContactFavorite(target) {
      // 서버가 DELETE 본문(@RequestBody)으로 대상을 받는다.
      await http.delete('/contacts/favorites', { data: target });
    },
    async listUserGroups() {
      return (await http.get('/user-groups')).data ?? {};
    },
    async getUserGroup(groupId) {
      return (await http.get(`/user-groups/${groupId}`)).data;
    },
    async createUserGroup(body) {
      return (await http.post('/user-groups', body)).data;
    },
    async updateUserGroup(groupId, body) {
      return (await http.patch(`/user-groups/${groupId}`, body)).data;
    },
    async addUserGroupMember(groupId, target) {
      return (await http.post(`/user-groups/${groupId}/members`, target)).data;
    },
    async removeUserGroupMember(groupId, { targetType, targetId }) {
      await http.delete(`/user-groups/${groupId}/members/${targetType}/${targetId}`);
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
    async getThreadReplies(messageId, params) {
      return (await http.get(`/messaging/messages/${messageId}/replies`, { params })).data;
    },
    async getChannel(channelId) {
      return (await http.get(`/messaging/channels/${channelId}`)).data;
    },
    async createChannel(body) {
      return (await http.post('/messaging/channels', body)).data;
    },
    async openDm(userIds) {
      return (await http.post('/messaging/dms', { userIds })).data;
    },
    async leaveChannel(channelId) {
      await http.post(`/messaging/channels/${channelId}/leave`);
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
    async getDriveFileSummary(driveFileId) {
      return (await http.get(`/drive/files/${driveFileId}/summary`)).data;
    },
    async searchDriveContent(params) {
      return (await http.get('/drive/search', { params })).data ?? { hits: [] };
    },
    async listDriveTrash(spaceId) {
      return (await http.get(`/drive/spaces/${spaceId}/trash`)).data?.items ?? [];
    },
    async restoreDriveFile(driveFileId) {
      await http.post(`/drive/files/${driveFileId}/restore`);
    },
    async restoreDriveFolder(folderId) {
      await http.post(`/drive/folders/${folderId}/restore`);
    },

    // ── 알림 ── 서버가 호출자 본인 알림으로 격리한다(recipientId=callerId).
    async listNotifications(params) {
      return (await http.get('/notifications', { params })).data ?? [];
    },
    async countUnreadNotifications() {
      return (await http.get('/notifications/unread-count')).data?.count ?? 0;
    },
    async markNotificationRead(notificationId) {
      await http.post(`/notifications/${notificationId}/read`);
    },
    async markAllNotificationsRead() {
      await http.post('/notifications/read-all');
    },
  };
}

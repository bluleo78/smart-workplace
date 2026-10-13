// src/rest-client.ts — 공유 도구용 REST 클라이언트 구현(#846). 두 앱이 인증 헤더만 다른 HTTP 인스턴스를 넘겨 같이 쓴다.
//
// 이전에는 workplace-mcp(PAT)와 ai-agent(Internal + X-On-Behalf-Of)가 같은 경로를 각자 매핑했고, 응답 가공도 각자 해서
// 파라미터 이름·기본값·가공 규칙이 조금씩 어긋났다. 경로 매핑을 여기 한 곳에 두고, 각 앱은 인증이 붙은 HTTP 인스턴스만 준다.
// 이 클라이언트는 경로 호출과 응답 래퍼 벗기기까지만 하고 LLM 용 가공은 공유 도구 핸들러가 맡는다.
import { FileTooLargeError, IMAGE_MAX_BYTES } from './attachment-read.js';
import { parseIssueKey } from './parse.js';
import type { SharedToolClient } from './shared-tools.js';
import type { FileBytes, PageResult, ProjectMetaKind, TextRange } from './tool-client.js';

/** 요청 설정 — 쿼리 파라미터·DELETE 본문·바이너리 응답만 쓴다(인증 헤더는 HTTP 인스턴스가 붙인다). */
export interface HttpRequestConfig {
  params?: unknown;
  /** DELETE 요청 본문(axios config.data) — 서버가 @RequestBody 로 받는 DELETE(즐겨찾기 해제)에 쓴다(#839). */
  data?: unknown;
  /** 원본 바이트를 받을 때(axios config.responseType) — read_file 의 이미지 원본(WP-346). */
  responseType?: 'arraybuffer';
  /** 응답 본문 상한(바이트, axios config.maxContentLength) — 넘으면 받는 도중 중단한다. */
  maxContentLength?: number;
  /** 요청 본문 상한(axios config.maxBodyLength) — 리다이렉트 시 같이 적용된다. */
  maxBodyLength?: number;
}

/** 응답 본문 — 서버 DTO 마다 모양이 달라 여기서 좁히지 않는다(해석은 도구 핸들러). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ResponseBody = any;

/** axios 인스턴스가 그대로 만족하는 최소 HTTP 인터페이스. 공유 패키지가 axios 에 의존하지 않도록 구조적으로 정의한다. */
export interface HttpLike {
  /** headers 는 바이너리 응답의 Content-Type 을 읽을 때만 쓴다(axios 응답이 그대로 만족한다). */
  get(url: string, config?: HttpRequestConfig): Promise<{ data: ResponseBody; headers?: Record<string, unknown> }>;
  post(url: string, data?: unknown, config?: HttpRequestConfig): Promise<{ data: ResponseBody }>;
  put(url: string, data?: unknown, config?: HttpRequestConfig): Promise<{ data: ResponseBody }>;
  patch(url: string, data?: unknown, config?: HttpRequestConfig): Promise<{ data: ResponseBody }>;
  delete(url: string, config?: HttpRequestConfig): Promise<{ data: ResponseBody }>;
}

/**
 * Spring 페이지 응답({ content, page, totalElements, totalPages })과 bare 배열을 PageResult 로 벗긴다(WP-352).
 * 예전에는 content 만 남겨 전체 건수·다음 페이지 여부를 버렸다 — 잘린 목록을 전부로 오해하게 만든 원인이다.
 * 서버 PageResponse 에 last 필드가 없어 다음 페이지 여부는 page + 1 < totalPages 로 계산한다. bare 배열은 페이지 정보가 없어 마지막으로 본다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toPageResult = (data: any): PageResult<any> => {
  if (Array.isArray(data)) return { items: data, hasMore: false, page: 0 };
  const page = typeof data?.page === 'number' ? data.page : 0;
  const totalPages = typeof data?.totalPages === 'number' ? data.totalPages : undefined;
  return {
    items: data?.content ?? [],
    total: typeof data?.totalElements === 'number' ? data.totalElements : undefined,
    hasMore: totalPages !== undefined && page + 1 < totalPages,
    page,
  };
};

/** 구간 읽기 쿼리 — 생략한 값은 싣지 않아 서버 기본값(offset 0, limit 32000)을 따른다. */
const rangeParams = (r: TextRange) => ({
  params: { ...(r.offset !== undefined && { offset: r.offset }), ...(r.limit !== undefined && { limit: r.limit }) },
});

/** axios 가 maxContentLength 초과로 던지는 오류인지 — axios 에 의존하지 않으려고 code·메시지로 구조적으로 본다. */
const isMaxLengthExceeded = (e: unknown) =>
  typeof e === 'object' && e !== null && /maxContentLength|maxBodyLength/.test(String((e as { message?: unknown }).message ?? ''));

/**
 * 바이너리 GET → 원본 바이트 + Content-Type. Node 의 axios 는 arraybuffer 를 Buffer(=Uint8Array)로 준다 — ArrayBuffer 로 오면 감싼다.
 * 크기 메타 없이 받는 경우(드라이브 파일 등)에도 이미지 상한을 넘는 다운로드를 막으려고 maxContentLength 를 건다 —
 * 초과하면 FileTooLargeError 로 바꿔 던져 도구가 "크기 초과" 안내로 잇게 한다. 지금 원본 받기는 이미지 전용이다.
 */
async function getBytes(http: HttpLike, url: string): Promise<FileBytes> {
  let r;
  try {
    r = await http.get(url, { responseType: 'arraybuffer', maxContentLength: IMAGE_MAX_BYTES, maxBodyLength: IMAGE_MAX_BYTES });
  } catch (e) {
    if (isMaxLengthExceeded(e)) throw new FileTooLargeError();
    throw e;
  }
  const data = r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data as ArrayBuffer);
  return { data, mimeType: String(r.headers?.['content-type'] ?? 'application/octet-stream') };
}

/** 외부 연락처 force 쿼리 — 서버 기본값이 false 라 true 일 때만 붙인다(미지정과 같은 요청이 되도록). */
const forceParams = (force?: boolean) => (force ? { params: { force } } : undefined);

/** 프로젝트 메타 종류 → REST 경로 조각(WP-356). 서버 컨트롤러 /projects/{key}/labels·milestones·cycles. */
const META_PATH: Record<ProjectMetaKind, string> = { label: 'labels', milestone: 'milestones', cycle: 'cycles' };

/** 인증된 HTTP 인스턴스로 공유 도구 클라이언트를 만든다. */
export function createSharedToolClient(http: HttpLike): SharedToolClient {
  /** 프로젝트 키는 경로 세그먼트라 인코딩한다. */
  const project = (key: string) => `/projects/${encodeURIComponent(key)}`;
  // 계정 관리 API(/users, ADMIN 전용)가 아니라 구성원 디렉터리(/members, member:read)를 쓴다 —
  // 일반 구성원의 PAT 로도 사람을 찾을 수 있어야 하기 때문. searchMembers(행만)와 같은 경로라 한 번만 매핑한다.
  const searchMembersPage: SharedToolClient['searchMembersPage'] = async (params) =>
    toPageResult((await http.get('/members', { params })).data);
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
      return toPageResult((await http.get('/projects', { params: { page, size } })).data);
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
    async getProjectFields(key) {
      return (await http.get(`${project(key)}/fields`)).data ?? [];
    },
    async createProjectMeta(key, kind, body) {
      return (await http.post(`${project(key)}/${META_PATH[kind]}`, body)).data;
    },
    async updateProjectMeta(key, kind, id, body) {
      return (await http.patch(`${project(key)}/${META_PATH[kind]}/${id}`, body)).data;
    },
    async getMe() {
      // 호출자 신원 — PAT 는 소유자, Internal+X-On-Behalf-Of 는 대리 대상이 된다(담당자 "me" 치환·토큰 검증).
      return (await http.get('/auth/me')).data;
    },
    async updateProject(key, body) {
      return (await http.patch(project(key), body)).data;
    },
    async createProject(body) {
      return (await http.post('/projects', body)).data;
    },
    async addProjectMember(key, body) {
      return (await http.post(`${project(key)}/members`, body)).data;
    },
    async listIssues(query) {
      // 래퍼({ items, nextCursor, hasMore })를 그대로 둔다 — 서버 기본 size 30 에서 잘린 사실을 핸들러가 알려야 한다(WP-352).
      const data = (await http.get('/me/issues', { params: query })).data;
      return { items: data?.items ?? [], nextCursor: data?.nextCursor, hasMore: data?.hasMore };
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
    async getIssueWatchers(issueKey) {
      return (await http.get(`${issue(issueKey)}/watchers`)).data ?? [];
    },
    async getIssueDriveLinks(issueKey) {
      return (await http.get(`${issue(issueKey)}/drive-links`)).data ?? [];
    },
    async updateIssueFields(issueKey, values) {
      return (await http.put(`${issue(issueKey)}/fields`, { values })).data;
    },
    async addIssueDriveLink(issueKey, driveFileId) {
      await http.post(`${issue(issueKey)}/drive-links`, { driveFileId });
    },

    // ── 노트 ──
    async listWikiSpaces() {
      return (await http.get('/wiki/spaces')).data ?? [];
    },
    async searchWikiPages(query, spaceId) {
      return (await http.get('/wiki/search', { params: { q: query, ...(spaceId !== undefined && { spaceId }) } })).data ?? [];
    },
    async getWikiPage(pageId) {
      return (await http.get(`/wiki/pages/${pageId}`)).data;
    },
    async getWikiPageSummary(pageId) {
      return (await http.get(`/wiki/pages/${pageId}/summary`)).data;
    },
    async listWikiRevisions(pageId) {
      return (await http.get(`/wiki/pages/${pageId}/revisions`)).data;
    },
    async restoreWikiRevision(pageId, version) {
      return (await http.post(`/wiki/pages/${pageId}/revisions/${version}/restore`)).data;
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
    async createEvent(body, { notify }) {
      return (await http.post('/calendar/events', body, { params: { notify } })).data;
    },
    async updateEvent(eventId, body, { scope, occurrenceDate }) {
      // occurrenceDate 는 반복 일정의 THIS·THIS_AND_FOLLOWING 에서만 의미가 있다 — 없으면 싣지 않는다.
      const params = { scope, ...(occurrenceDate !== undefined && { occurrenceDate }) };
      return (await http.patch(`/calendar/events/${eventId}`, body, { params })).data;
    },
    async addEventAttendees(eventId, userIds, { notify }) {
      await http.post(`/calendar/events/${eventId}/attendees`, { userIds }, { params: { notify } });
    },
    async removeEventAttendee(eventId, userId) {
      await http.delete(`/calendar/events/${eventId}/attendees/${userId}`);
    },

    // ── 홈 개요(WP-357) ──
    async getHomeActivity({ cursor, size }) {
      return (await http.get('/me/activity', { params: { size, ...(cursor && { cursor }) } })).data;
    },
    async getPriorityItems() {
      return (await http.get('/me/priority-items')).data?.items ?? [];
    },
    async getHomeMailSummary() {
      return (await http.get('/me/mail-summary')).data;
    },
    async getMessagingSummary() {
      return (await http.get('/me/messaging-summary')).data;
    },
    async getThreadInbox({ cursor, limit }) {
      return (await http.get('/messaging/threads/inbox', { params: { limit, ...(cursor && { cursor }) } })).data;
    },

    // ── 메일 ──
    async listMailAccounts() {
      return (await http.get('/mail/accounts')).data ?? [];
    },
    async listMail(accountId, { folder, limit, query, unread, category, needsReply }) {
      const params = {
        folder,
        limit,
        ...(query ? { query } : {}),
        ...(unread ? { unread: true } : {}),
        ...(category ? { category } : {}),
        ...(needsReply ? { needsReply: true } : {}),
      };
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
    async markMailUnread(messageId) {
      await http.post(`/mail/messages/${messageId}/unread`);
    },
    async syncMail(accountId) {
      // 소유권은 서버가 검증한다(남의 계정이면 404). 본문은 빈 객체 — 서버가 요청 본문을 읽지 않는다.
      return (await http.post(`/mail/accounts/${accountId}/sync`, {})).data;
    },
    async getMailSyncStatus(accountId) {
      return (await http.get(`/mail/accounts/${accountId}/sync-status`)).data;
    },

    // ── 구성원·연락처 ──
    async searchMembers(params) {
      return (await searchMembersPage(params)).items;
    },
    searchMembersPage,
    async getMemberContact(userId) {
      return (await http.get(`/contacts/members/${userId}`)).data;
    },
    async listContacts(params) {
      return (await http.get('/contacts', { params })).data;
    },
    async getExternalContact(externalId) {
      return (await http.get(`/contacts/external/${externalId}`)).data;
    },
    async listChannelMembers(channelId) {
      const data = (await http.get(`/messaging/channels/${channelId}/members`)).data;
      return Array.isArray(data) ? data : [];
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
    async createExternalContact(body, force) {
      return (await http.post('/contacts/external', body, forceParams(force))).data;
    },
    async updateExternalContact(externalId, body, force) {
      return (await http.patch(`/contacts/external/${externalId}`, body, forceParams(force))).data;
    },

    // ── 메시징 ──
    async listChannels() {
      return (await http.get('/messaging/channels')).data ?? [];
    },
    async listChannelMessages(channelId, { limit, cursor }) {
      // MessagePage { items, nextCursor, hasMore } — 커서를 버리면 오래된 메시지로 이어 갈 수 없다(WP-352). cursor 는 생략하면 싣지 않는다.
      const data = (await http.get(`/messaging/channels/${channelId}/messages`, { params: { limit, ...(cursor && { cursor }) } })).data;
      return { items: data?.items ?? [], nextCursor: data?.nextCursor, hasMore: data?.hasMore };
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
    async addChannelMember(channelId, userId) {
      await http.post(`/messaging/channels/${channelId}/members`, { userId });
    },
    async joinChannel(channelId) {
      await http.post(`/messaging/channels/${channelId}/join`);
    },
    async addReaction(messageId, emoji) {
      await http.post(`/messaging/messages/${messageId}/reactions`, { emoji });
    },
    async removeReaction(messageId, emoji) {
      // 서버가 이모지를 쿼리 파라미터로 받는다(DELETE 본문 없음) — axios 가 인코딩한다.
      await http.delete(`/messaging/messages/${messageId}/reactions`, { params: { emoji } });
    },
    async updateChannelMessage(messageId, body) {
      return (await http.patch(`/messaging/messages/${messageId}`, { body })).data;
    },
    async markChannelRead(channelId, uptoMessageId) {
      await http.post(`/messaging/channels/${channelId}/read`, { uptoMessageId });
    },
    async discoverChannels(q) {
      const data = (await http.get('/messaging/channels/discover', { params: { q } })).data;
      return Array.isArray(data) ? data : [];
    },

    // ── 드라이브 ──
    async listDriveSpaces() {
      return (await http.get('/drive/spaces')).data ?? [];
    },
    async listDriveItems(spaceId, parentId, page) {
      // 파라미터는 있을 때만 싣는다 — 생략하면 서버가 전체를 돌려주는 기존 동작이다.
      const params = { ...(parentId != null && { parentId }), ...(page && { limit: page.limit, offset: page.offset }) };
      return (await http.get(`/drive/spaces/${spaceId}/items`, { params: Object.keys(params).length ? params : undefined })).data;
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
    async createDriveFolder(spaceId, parentId, name) {
      return (await http.post(`/drive/spaces/${spaceId}/folders`, { parentId, name })).data;
    },
    async renameDriveFolder(folderId, name) {
      return (await http.patch(`/drive/folders/${folderId}`, { name })).data;
    },
    async moveDriveFolder(folderId, targetParentId) {
      await http.patch(`/drive/folders/${folderId}/move`, { targetParentId });
    },
    async moveDriveFile(driveFileId, targetFolderId) {
      await http.patch(`/drive/files/${driveFileId}/move`, { targetFolderId });
    },
    async renameDriveFile(driveFileId, name) {
      return (await http.patch(`/drive/files/${driveFileId}`, { name })).data;
    },
    async copyDriveFile(driveFileId, targetFolderId) {
      return (await http.post(`/drive/files/${driveFileId}/copy`, { targetFolderId })).data;
    },
    async copyDriveFolder(folderId, targetParentId) {
      return (await http.post(`/drive/folders/${folderId}/copy`, { targetParentId })).data;
    },
    async listDriveFileBacklinks(driveFileId) {
      const data = (await http.get(`/drive/files/${driveFileId}/backlinks`)).data;
      return Array.isArray(data) ? data : [];
    },
    async importAttachmentToDrive(spaceId, folderId, fileId) {
      const base = `/drive/spaces/${spaceId}`;
      return (await http.post(folderId == null ? `${base}/import-attachment` : `${base}/folders/${folderId}/import-attachment`, { fileId })).data;
    },
    // ── 전송 링크·텍스트로 만들기(WP-369) ── 모두 JSON 이다. 바이트 전송은 MCP 가 아니라 링크를 받은 쪽(curl·브라우저)이 공개 경로로 한다.
    async createDriveDownloadLink(driveFileId) {
      return (await http.post(`/drive/files/${driveFileId}/download-link`)).data;
    },
    async createDriveUploadLink(spaceId, folderId, name) {
      return (await http.post(`/drive/spaces/${spaceId}/upload-link`, { folderId, name })).data;
    },
    async createDriveTextFile(spaceId, folderId, name, content) {
      return (await http.post(`/drive/spaces/${spaceId}/files/text`, { folderId, name, content })).data;
    },

    // ── 첨부·파일 내용 읽기(WP-346) ── 이슈 첨부는 프로젝트 멤버, 드라이브는 스페이스 VIEWER 를 서버가 확인한다.
    async readIssueAttachmentText(issueKey, fileId, range) {
      return (await http.get(`${issue(issueKey)}/attachments/${fileId}/text`, rangeParams(range))).data;
    },
    async listIssueAttachments(issueKey) {
      const data = (await http.get(`${issue(issueKey)}/attachments`)).data;
      return Array.isArray(data) ? data : [];
    },
    async downloadIssueAttachment(issueKey, fileId) {
      return getBytes(http, `${issue(issueKey)}/attachments/${fileId}/content`);
    },
    async readDriveFileText(driveFileId, range) {
      return (await http.get(`/drive/files/${driveFileId}/text`, rangeParams(range))).data;
    },
    async listDriveFileVersions(driveFileId) {
      const data = (await http.get(`/drive/files/${driveFileId}/versions`)).data;
      return Array.isArray(data) ? data : [];
    },
    async downloadDriveFile(driveFileId) {
      return getBytes(http, `/drive/files/${driveFileId}/content`);
    },
    async readWikiAttachmentText(pageId, fileId, range) {
      return (await http.get(`/wiki/pages/${pageId}/attachments/${fileId}/text`, rangeParams(range))).data;
    },
    async downloadWikiAttachment(pageId, fileId) {
      return getBytes(http, `/wiki/pages/${pageId}/attachments/${fileId}/content`);
    },
    async readMessageAttachmentText(channelId, messageId, fileId, range) {
      return (await http.get(`/messaging/channels/${channelId}/messages/${messageId}/attachments/${fileId}/text`, rangeParams(range))).data;
    },
    async downloadMessageAttachment(channelId, messageId, fileId) {
      return getBytes(http, `/messaging/channels/${channelId}/messages/${messageId}/attachments/${fileId}/content`);
    },
    async readMailAttachmentText(attachmentId, range) {
      return (await http.get(`/mail/attachments/${attachmentId}/text`, rangeParams(range))).data;
    },
    async downloadMailAttachment(attachmentId) {
      return getBytes(http, `/mail/attachments/${attachmentId}/content`);
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

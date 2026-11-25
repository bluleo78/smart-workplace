// src/rest-client.ts — 공유 도구용 REST 클라이언트 구현(#846). 두 앱이 인증 헤더만 다른 HTTP 인스턴스를 넘겨 같이 쓴다.
//
// 이전에는 workplace-mcp(PAT)와 ai-agent(Internal + X-On-Behalf-Of)가 같은 경로를 각자 매핑했고, 응답 가공도 각자 해서
// 파라미터 이름·기본값·가공 규칙이 조금씩 어긋났다. 경로 매핑을 여기 한 곳에 두고, 각 앱은 인증이 붙은 HTTP 인스턴스만 준다.
// 이 클라이언트는 경로 호출과 응답 래퍼 벗기기까지만 하고 LLM 용 가공은 공유 도구 핸들러가 맡는다.
import { FileTooLargeError, IMAGE_MAX_BYTES } from './attachment-read.js';
import { describeApiError, parseIssueKey } from './parse.js';
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
 * 바이너리 요청의 오류 본문을 푼다(WP-250) — responseType arraybuffer 면 서버 ErrorResponse JSON 도 바이트로 와서,
 * 그대로면 오류 요약이 "API 오류 400" 만 남고 한국어 사유(예: "이 PDF 는 6쪽입니다…")가 사라진다. 바이트를 JSON(안 되면 글)으로
 * 바꿔 response.data 에 되돌려 두고(workplace-mcp 서버 레이어와 ai-agent 의 /view 호출부가 response.data 로 요약한다), message 도 같은 요약으로 올린다.
 * ai-agent 는 자기 axios 인터셉터에서 이 함수를 먼저 불러 같은 처리를 한다.
 */
export function decodeErrorBody(e: unknown): void {
  const res = (e as { response?: { status?: number; data?: unknown } })?.response;
  if (!res) return;
  const raw = res.data;
  const bytes = raw instanceof Uint8Array ? raw : raw instanceof ArrayBuffer ? new Uint8Array(raw) : undefined;
  if (!bytes) return;
  const text = new TextDecoder().decode(bytes);
  try {
    res.data = JSON.parse(text);
  } catch {
    res.data = text;
  }
  if (e instanceof Error) e.message = describeApiError(res.status, res.data);
}

/**
 * 바이너리 GET → 원본 바이트 + Content-Type. Node 의 axios 는 arraybuffer 를 Buffer(=Uint8Array)로 준다 — ArrayBuffer 로 오면 감싼다.
 * 크기 메타 없이 받는 경우(드라이브 파일 등)에도 이미지 상한을 넘는 다운로드를 막으려고 maxContentLength 를 건다 —
 * 초과하면 FileTooLargeError 로 바꿔 던져 도구가 "크기 초과" 안내로 잇게 한다. 원본 받기·/view 변환본(WP-250) 모두 이미지 전용이다
 * (변환본은 서버가 긴 변 1568px·1MB 안팎으로 줄여 같은 상한에 넉넉히 든다). /view 의 X-Page-Count 는 pageCount 로 싣는다.
 * ai-agent 의 전용 첨부 도구(/view)도 이 함수를 쓴다 — 신원 헤더를 붙인 get 만 넘기면 된다(상한·오류 변환·쪽수 파싱을 한 곳에).
 */
export async function getBytes(http: Pick<HttpLike, 'get'>, url: string): Promise<FileBytes> {
  let r;
  try {
    r = await http.get(url, { responseType: 'arraybuffer', maxContentLength: IMAGE_MAX_BYTES, maxBodyLength: IMAGE_MAX_BYTES });
  } catch (e) {
    if (isMaxLengthExceeded(e)) throw new FileTooLargeError();
    decodeErrorBody(e);
    throw e;
  }
  const data = r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data as ArrayBuffer);
  const pageCount = Number(r.headers?.['x-page-count']);
  return {
    data,
    mimeType: String(r.headers?.['content-type'] ?? 'application/octet-stream'),
    ...(Number.isInteger(pageCount) && pageCount > 0 && { pageCount }),
  };
}

/** /view 경로 — page 는 PDF 쪽(1부터)이고 줄 때만 쿼리로 붙인다(이미지 변환본은 page 없이). */
export const viewUrl = (base: string, page?: number) => `${base}/view${page !== undefined ? `?page=${page}` : ''}`;

/** 외부 연락처 force 쿼리 — 서버 기본값이 false 라 true 일 때만 붙인다(미지정과 같은 요청이 되도록). */
const forceParams = (force?: boolean) => (force ? { params: { force } } : undefined);

/** 부모 지정 본문(WP-1038) — 같은 프로젝트 번호면 { parentNumber }, 다른 프로젝트 에픽 키면 { parentKey }. */
const parentBody = (parent: number | string) => (typeof parent === 'number' ? { parentNumber: parent } : { parentKey: parent });

/** 프로젝트 메타 종류 → REST 경로 조각(WP-356, 버전 WP-1005). 서버 컨트롤러 /projects/{key}/labels·milestones·cycles·versions. */
const META_PATH: Record<ProjectMetaKind, string> = { label: 'labels', milestone: 'milestones', cycle: 'cycles', version: 'versions' };

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

  /** 워크플로우 API 는 숫자 project id 경로를 쓴다 — 프로젝트 상세(GET /projects/{key})의 id. 캐시하지 않는다. */
  const projectId = async (projectKey: string): Promise<number> =>
    ((await http.get(project(projectKey))).data as { id: number }).id;

  /**
   * issueKey → 이슈 챗 threadId. 이슈의 챗 스레드 id 는 바뀌지 않으므로 클라이언트 인스턴스 안에서 캐시한다 — 첨부 읽기·받기마다 같은 GET 을
   * 되풀이하지 않게. 실패한 요청은 캐시에서 빼 다음 호출이 다시 시도한다.
   */
  const threadIds = new Map<string, Promise<number>>();
  /** GET .../chat/thread 한 번 — 받은 스레드 id 로 캐시를 채운다(실패한 요청은 캐시에서 빼 다음 호출이 다시 시도). 참여자(members)는 바뀌므로 캐시하지 않는다(WP-1009). */
  const fetchIssueChatThread = (issueKey: string) => {
    const req = http.get(`${issue(issueKey)}/chat/thread`).then((r) => r.data as { threadId: number; members?: Record<string, unknown>[] });
    // 스레드 id 는 바뀌지 않으므로 캐시가 비었을 때만 채운다 — 캐시된 id 를 대기 중인 요청으로 덮거나, 그 요청이 실패해 지우지 않게.
    if (!threadIds.has(issueKey)) {
      const id = req.then((d) => d.threadId);
      threadIds.set(issueKey, id);
      id.catch(() => threadIds.delete(issueKey));
    }
    return req;
  };
  const issueChatThreadId = (issueKey: string): Promise<number> =>
    threadIds.get(issueKey) ?? fetchIssueChatThread(issueKey).then((d) => d.threadId);

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
    async getProjectComponents(key) {
      return (await http.get(`${project(key)}/components`)).data ?? [];
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
    async getProjectStatuses(key) {
      return (await http.get(`${project(key)}/statuses`)).data ?? [];
    },
    async createProjectMeta(key, kind, body) {
      return (await http.post(`${project(key)}/${META_PATH[kind]}`, body)).data;
    },
    async updateProjectMeta(key, kind, id, body) {
      return (await http.patch(`${project(key)}/${META_PATH[kind]}/${id}`, body)).data;
    },
    async releaseProjectVersion(key, id) {
      return (await http.post(`${project(key)}/versions/${id}/release`, {})).data;
    },
    async unreleaseProjectVersion(key, id) {
      return (await http.post(`${project(key)}/versions/${id}/unrelease`, {})).data;
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
    async getIssueChatThreadId(issueKey) {
      return issueChatThreadId(issueKey);
    },
    async getIssueChatThread(issueKey) {
      const data = await fetchIssueChatThread(issueKey);
      return { threadId: data.threadId, members: data.members ?? [] };
    },
    async listIssueChatMessages(threadId, { after, limit }) {
      // after 가 없으면 서버가 내 마지막 글 기준(afterMine)으로 고른다 — 새 글과 직전 맥락을 한 번에 받는다(WP-373).
      const params = after !== undefined ? { after, limit } : { afterMine: true, limit };
      const data = (await http.get(`/chat/threads/${threadId}/messages`, { params })).data;
      return { items: data?.items ?? [], nextCursor: data?.nextCursor, hasMore: !!data?.hasMore, truncated: data?.truncated === true ? true : undefined };
    },
    async addIssueChatMessage(threadId, body, fileIds) {
      // WP-1816: fileIds 는 있을 때만 싣는다(없으면 기존 본문 모양 그대로).
      await http.post(`/chat/threads/${threadId}/messages`, fileIds?.length ? { body, fileIds } : { body });
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
    async setIssueType(issueKey, typeId, parent, opts) {
      // WP-2097: 옵션은 준 값(true/false) 그대로 본문에 싣고, 안 주면 아예 싣지 않는다 — 생략이 서버 기본(끄기)과 똑같은 요청이 되게.
      const relate = opts?.relateToReleasedParent === undefined ? {} : { relateToReleasedParent: opts.relateToReleasedParent };
      // WP-2098: 하위 태스크 함께 바꾸기 유형 id — 안 주면 본문에 키 자체를 싣지 않는다(서버는 키가 없으면 하위를 그대로 둔다).
      const convert = opts?.convertSubtasksToTypeId === undefined ? {} : { convertSubtasksToTypeId: opts.convertSubtasksToTypeId };
      // 유형 변경 응답(이슈 상세)에 실린 옛 상위 키를 그대로 돌려보낸다 — 서버는 이번 변경으로 상위가 바뀌었을 때만 싣는다(옵션과 무관).
      return (
        await http.patch(`${issue(issueKey)}/type`, parent === undefined ? { typeId, ...relate, ...convert } : { typeId, ...parentBody(parent), ...relate, ...convert })
      ).data;
    },
    async setIssueParent(issueKey, parent) {
      await http.patch(`${issue(issueKey)}/parent`, parent === null ? { parentNumber: null } : parentBody(parent));
    },
    async replaceIssueAssignees(issueKey, userIds) {
      return (await http.put(`${issue(issueKey)}/assignees`, { userIds })).data;
    },
    async changeIssueReporter(issueKey, userId) {
      await http.put(`${issue(issueKey)}/reporter`, { userId });
    },
    async getProjectVersions(key) {
      return (await http.get(`${project(key)}/versions`)).data ?? [];
    },
    async replaceIssueLabels(issueKey, labelIds, labelNames) {
      return (await http.put(`${issue(issueKey)}/labels`, { labelIds, labelNames })).data;
    },
    async replaceIssueComponents(issueKey, componentIds) {
      return (await http.put(`${issue(issueKey)}/components`, { componentIds })).data;
    },
    async replaceIssueVersions(issueKey, body) {
      return (await http.put(`${issue(issueKey)}/versions`, body)).data;
    },
    async addComment(issueKey, body) {
      await http.post(`/issues/${await issueId(issueKey)}/comments`, { body });
    },
    async editComment(issueKey, commentId, body) {
      await http.patch(`/issues/${await issueId(issueKey)}/comments/${commentId}`, { body });
    },
    async addCommentReaction(issueKey, commentId, emoji) {
      await http.post(`/issues/${await issueId(issueKey)}/comments/${commentId}/reactions`, { emoji });
    },
    async removeCommentReaction(issueKey, commentId, emoji) {
      // 서버가 이모지를 쿼리 파라미터로 받는다(DELETE 본문 없음) — 채팅 removeReaction 과 같다.
      await http.delete(`/issues/${await issueId(issueKey)}/comments/${commentId}/reactions`, { params: { emoji } });
    },
    async reportAgentWork(issueKey, body) {
      return (await http.put(`${issue(issueKey)}/agent-work`, body)).data;
    },
    async addIssueDependency(issueKey, otherNumber, direction) {
      return (await http.post(`${issue(issueKey)}/dependencies`, { otherNumber, direction })).data;
    },
    async removeIssueDependency(issueKey, otherNumber, direction) {
      await http.delete(`${issue(issueKey)}/dependencies`, { params: { otherNumber, direction } });
    },
    async addIssueRelation(issueKey, body) {
      return (await http.post(`${issue(issueKey)}/relations`, body)).data ?? [];
    },
    async removeIssueRelation(issueKey, relationId) {
      await http.delete(`${issue(issueKey)}/relations/${relationId}`);
    },
    async addIssueExternalLink(issueKey, body) {
      return (await http.post(`${issue(issueKey)}/external-links`, body)).data ?? [];
    },
    async removeIssueExternalLink(issueKey, linkId) {
      await http.delete(`${issue(issueKey)}/external-links/${linkId}`);
    },
    async listIssueRelationTypes() {
      return (await http.get('/issue-relation-types')).data ?? [];
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
    async claimIssueAttachments(issueKey, fileIds) {
      return (await http.post(`${issue(issueKey)}/attachments/claim`, { fileIds })).data;
    },
    async claimIssue(issueKey, queueLabel) {
      return (await http.post(`${issue(issueKey)}/claim`, { queueLabel })).data;
    },

    // ── 워크플로우(WP-1988) ── 서버 경로는 숫자 id 를 쓰므로 이슈·프로젝트 키는 기존 조회로 id 를 얻는다.
    async getIssueWorkflow(issueKey) {
      return (await http.get(`/issues/${await issueId(issueKey)}/workflow`)).data;
    },
    async startIssueWorkflow(issueKey, workflowId) {
      return (await http.post(`/issues/${await issueId(issueKey)}/workflow/start`, { workflowId })).data;
    },
    async moveIssueWorkflow(issueKey, body) {
      return (await http.post(`/issues/${await issueId(issueKey)}/workflow/move`, body)).data;
    },
    async listWorkflows(projectKey) {
      return (await http.get(`/projects/${await projectId(projectKey)}/workflows`)).data ?? [];
    },
    async getWorkflow(workflowId) {
      return (await http.get(`/workflows/${workflowId}`)).data;
    },
    async getWorkflowVersionYaml(workflowId, versionNo) {
      return ((await http.get(`/workflows/${workflowId}/versions/${versionNo}`)).data as { sourceYaml: string }).sourceYaml;
    },
    async createWorkflow(projectKey, name, yaml) {
      return (await http.post(`/projects/${await projectId(projectKey)}/workflows`, { name, yaml })).data;
    },
    async saveWorkflowDraft(workflowId, yaml, expectedDraftUpdatedAt) {
      // 초안 시각은 준 때만 싣는다 — 없으면 서버가 충돌 검사를 건너뛴다(웹 첫 저장과 같다).
      const body = { yaml, ...(expectedDraftUpdatedAt !== undefined && { expectedDraftUpdatedAt }) };
      return (await http.put(`/workflows/${workflowId}/draft`, body)).data;
    },
    async validateWorkflow(projectKey, yaml) {
      return (await http.post('/workflows/validate', { projectId: await projectId(projectKey), yaml })).data;
    },
    async publishWorkflow(workflowId, expectedDraftUpdatedAt) {
      // 초안 시각이 있을 때만 본문으로 보낸다(서버 ExpectedDraftRequest — 없으면 충돌 검사 생략).
      const body = expectedDraftUpdatedAt === undefined ? undefined : { expectedDraftUpdatedAt };
      return (await http.post(`/workflows/${workflowId}/publish`, body)).data;
    },

    // ── 도움말(제품 매뉴얼, WP-1510) ──
    async searchManual(query) {
      return (await http.get('/help/search', { params: { q: query } })).data ?? { results: [] };
    },
    // 대체 id(`<chapter>#<slug>`)의 `#` 이 그대로 가면 URL 조각으로 잘리고 `/` 는 경로를 나누므로 경로 조각 하나로 인코딩한다.
    async getManualSection(id) {
      return (await http.get(`/help/sections/${encodeURIComponent(id)}`)).data;
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
    async createWikiHtmlPage(spaceId, body) {
      return (await http.post(`/wiki/spaces/${spaceId}/html-pages`, body)).data;
    },
    async saveWikiHtml(pageId, body) {
      return (await http.put(`/wiki/pages/${pageId}/html`, body)).data;
    },
    async claimWikiImages(pageId, fileIds) {
      return (await http.post(`/wiki/pages/${pageId}/attachments/claim`, { fileIds })).data;
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
    // WP-1766: cursor 가 있을 때만 싣는다.
    async listRecentWikiPages(cursor) {
      const data = (await http.get('/wiki/recent', { params: cursor ? { cursor } : undefined })).data;
      return { items: data?.items ?? [], nextCursor: data?.nextCursor ?? null };
    },
    async listStarredWikiPages(cursor) {
      const data = (await http.get('/wiki/starred', { params: cursor ? { cursor } : undefined })).data;
      return { items: data?.items ?? [], nextCursor: data?.nextCursor ?? null };
    },

    // ── 캘린더 ──
    async listEvents(from, to) {
      return (await http.get('/calendar/events', { params: { from, to } })).data ?? [];
    },
    async getEvent(eventId, occurrenceDate) {
      // occurrenceDate 는 반복 일정 회차의 노트를 볼 때만 싣는다(WP-1704) — linkEventNote 와 같은 모양.
      const params = { ...(occurrenceDate !== undefined && { occurrenceDate }) };
      return (await http.get(`/calendar/events/${eventId}`, { params })).data;
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
    async linkEventNote(eventId, pageId, occurrenceDate) {
      // occurrenceDate 는 반복 일정 회차에만 — 없으면 싣지 않는다(updateEvent 와 같은 모양, WP-1704).
      const params = { ...(occurrenceDate !== undefined && { occurrenceDate }) };
      return (await http.put(`/calendar/events/${eventId}/note`, { pageId }, { params })).data ?? {};
    },
    async unlinkEventNote(eventId, occurrenceDate) {
      const params = { ...(occurrenceDate !== undefined && { occurrenceDate }) };
      await http.delete(`/calendar/events/${eventId}/note`, { params });
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
    async listMail(accountId, { folder, limit, query, unread, category, needsReply, flagged }) {
      const params = {
        folder,
        limit,
        ...(query ? { query } : {}),
        ...(unread ? { unread: true } : {}),
        ...(category ? { category } : {}),
        ...(needsReply ? { needsReply: true } : {}),
        // WP-1742: 별표 메일 모아 보기 — 있을 때만 싣는다(서버는 이때 folder·category·needsReply 를 무시하고 모든 메일함을 본다).
        ...(flagged ? { flagged: true } : {}),
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
    // WP-1741: 별표는 읽음과 달리 PUT + 본문 { flagged } — 서버가 flagged 누락을 400 으로 막는다(기본값으로 별표를 지우는 실수 방지).
    async setMailFlagged(messageId, flagged) {
      await http.put(`/mail/messages/${messageId}/flag`, { flagged });
    },
    // WP-1681: 휴지통 메일을 원래 메일함으로 — 이동 API 의 RESTORE 대상. 휴지통 밖 메일이 섞이면 서버가 400.
    async restoreMail(accountId, messageIds) {
      return (await http.post(`/mail/accounts/${accountId}/messages/move`, { messageIds, target: { kind: 'RESTORE' } })).data;
    },
    // WP-1341: null 도 본문에 그대로 싣는다 — 서버는 category:null 을 「직접 정한 분류 지우기」로 읽는다.
    async setMailCategory(messageId, category) {
      return (await http.put(`/mail/messages/${messageId}/category`, { category })).data;
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
    async getMember(userId) {
      return (await http.get(`/members/${userId}`)).data;
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
    async addChannelMessage(channelId, body, parentMessageId, attachments) {
      // 빈 배열은 싣지 않는다 — 서버가 null/빈 목록을 같게 보지만 요청 본문을 최소로 둔다(WP-423).
      await http.post(`/messaging/channels/${channelId}/messages`, {
        body,
        parentMessageId,
        ...(attachments?.fileIds?.length && { fileIds: attachments.fileIds }),
        ...(attachments?.driveFileIds?.length && { driveFileIds: attachments.driveFileIds }),
      });
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
    async hideDm(channelId) {
      await http.post(`/messaging/dms/${channelId}/hide`);
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
    async updateChannelMessage(messageId, body, keepFileIds) {
      // keepFileIds 가 없으면 키를 아예 빼고 보낸다 — 서버는 null 을 「첨부 그대로, 본문만 수정」 으로 본다(WP-1679). 빈 배열은 「첨부 모두 빼기」 라 그대로 보낸다.
      const payload = keepFileIds === undefined ? { body } : { body, keepFileIds };
      return (await http.patch(`/messaging/messages/${messageId}`, payload)).data;
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
    // WP-1400: 메일 첨부는 메일 쪽 경로 — 공간·폴더는 본문으로 넘긴다(폴더 없음 = 루트, null 그대로).
    async saveMailAttachmentToDrive(mailAttachmentId, spaceId, folderId) {
      return (await http.post(`/mail/attachments/${mailAttachmentId}/save-to-drive`, { spaceId, folderId })).data;
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
    // 기존 파일의 새 버전(WP-369 Task 3) — 파일 id 로 가리키므로 공간·폴더·이름을 보내지 않는다.
    async updateDriveTextFile(driveFileId, content) {
      return (await http.post(`/drive/files/${driveFileId}/text`, { content })).data;
    },
    async createDriveVersionUploadLink(driveFileId) {
      return (await http.post(`/drive/files/${driveFileId}/upload-link`)).data;
    },
    async listRecentDriveFiles({ limit, cursor }) {
      // 빈 cursor 는 첫 쪽과 같으므로 싣지 않는다 — 서버가 빈 문자열을 잘못된 위치로 읽지 않게.
      const params = { ...(limit != null && { limit }), ...(cursor && { cursor }) };
      const data = (await http.get('/drive/recent', { params: Object.keys(params).length ? params : undefined })).data;
      return { items: data?.items ?? [], nextCursor: data?.nextCursor ?? null };
    },
    async listStarredDriveItems(cursor) {
      const data = (await http.get('/drive/starred', { params: cursor ? { cursor } : undefined })).data;
      return { items: data?.items ?? [], nextCursor: data?.nextCursor ?? null };
    },
    async starDriveItem(target) {
      await http.put('/drive/stars', target);
    },
    async unstarDriveItem(target) {
      // 서버가 DELETE 본문(@RequestBody)으로 대상을 받는다(연락처 즐겨찾기 해제와 같다).
      await http.delete('/drive/stars', { data: target });
    },

    // ── 스테이징 업로드(WP-421) ── 첨부용 파일을 먼저 올려 두고 도메인 쓰기의 fileIds 로 붙인다. 링크 바이트는 MCP 가 아니라 curl 이 공개 경로로 보낸다.
    async createStagedTextFile(name, content) {
      return (await http.post('/staged-files/text', { name, content })).data;
    },
    async createStagedUploadLink(name) {
      return (await http.post('/staged-files/upload-link', { name })).data;
    },
    // WP-1705: 읽을 수 있는 첨부를 서버 안에서 복사해 스테이징한다. 요청을 그대로 본문으로 보낸다 — 이슈 챗도 서버가 issueKey 로 스레드를 찾는다.
    async copyToStagedFile(req) {
      return (await http.post('/staged-files/copy', req)).data;
    },

    // ── 첨부·파일 내용 읽기(WP-346) ── 이슈 첨부는 프로젝트 멤버, 드라이브는 스페이스 VIEWER 를 서버가 확인한다.
    async readIssueAttachmentText(issueKey, fileId, range) {
      return (await http.get(`${issue(issueKey)}/attachments/${fileId}/text`, rangeParams(range))).data;
    },
    async readIssueChatAttachmentText(issueKey, _messageId, fileId, range) {
      // 텍스트·변환본 API 는 스레드 단위(메시지 id 없음) — 서버가 스레드 멤버와 첨부의 스레드 소속을 확인한다(WP-373).
      const threadId = await issueChatThreadId(issueKey);
      return (await http.get(`/chat/threads/${threadId}/attachments/${fileId}/text`, rangeParams(range))).data;
    },
    async readDriveFileText(driveFileId, range) {
      return (await http.get(`/drive/files/${driveFileId}/text`, rangeParams(range))).data;
    },
    async listDriveFileVersions(driveFileId) {
      const data = (await http.get(`/drive/files/${driveFileId}/versions`)).data;
      return Array.isArray(data) ? data : [];
    },
    async readWikiAttachmentText(pageId, fileId, range) {
      return (await http.get(`/wiki/pages/${pageId}/attachments/${fileId}/text`, rangeParams(range))).data;
    },
    async readMessageAttachmentText(channelId, messageId, fileId, range) {
      return (await http.get(`/messaging/channels/${channelId}/messages/${messageId}/attachments/${fileId}/text`, rangeParams(range))).data;
    },
    async readMailAttachmentText(attachmentId, range) {
      return (await http.get(`/mail/attachments/${attachmentId}/text`, rangeParams(range))).data;
    },
    // WP-250: 모델 입력용 이미지(PDF 쪽·이미지 변환본). 권한 게이트는 /text 와 같다.
    // WP-388: 메일 첨부 — 서버가 요청마다 원본을 받아 그린다(본인 소유 아니면 404).
    async viewMailAttachment(attachmentId, page) {
      return getBytes(http, viewUrl(`/mail/attachments/${attachmentId}`, page));
    },
    async viewIssueAttachment(issueKey, fileId, page) {
      return getBytes(http, viewUrl(`${issue(issueKey)}/attachments/${fileId}`, page));
    },
    async viewDriveFile(driveFileId, page) {
      return getBytes(http, viewUrl(`/drive/files/${driveFileId}`, page));
    },
    async viewWikiAttachment(pageId, fileId, page) {
      return getBytes(http, viewUrl(`/wiki/pages/${pageId}/attachments/${fileId}`, page));
    },
    async viewMessageAttachment(channelId, messageId, fileId, page) {
      return getBytes(http, viewUrl(`/messaging/channels/${channelId}/messages/${messageId}/attachments/${fileId}`, page));
    },
    async viewIssueChatAttachment(issueKey, fileId, page) {
      const threadId = await issueChatThreadId(issueKey);
      return getBytes(http, viewUrl(`/chat/threads/${threadId}/attachments/${fileId}`, page));
    },

    // ── 알림 ── 서버가 호출자 본인 알림으로 격리한다(recipientId=callerId).
    async listNotifications(params) {
      return (await http.get('/notifications', { params })).data ?? [];
    },
    // 보관함 목록(WP-1690) — GET /notifications/archived, 최근 보관순.
    async listArchivedNotifications(params) {
      return (await http.get('/notifications/archived', { params })).data ?? [];
    },
    async countUnreadNotifications() {
      return (await http.get('/notifications/unread-count')).data?.count ?? 0;
    },
    async markNotificationRead(notificationId) {
      await http.post(`/notifications/${notificationId}/read`);
    },
    async markIssueNotificationsRead(issueKey) {
      await http.post(`/notifications/issues/${await issueId(issueKey)}/read`);
    },
    async markAllNotificationsRead() {
      await http.post('/notifications/read-all');
    },
    // 읽은 알림 모두 보관(WP-1689) — 서버가 실제로 보관한 id 목록을 돌려준다.
    async archiveReadNotifications() {
      return (await http.post('/notifications/archive-read')).data?.archivedIds ?? [];
    },
  };
}

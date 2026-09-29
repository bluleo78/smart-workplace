// workplace-api 호출 client — INTERNAL_SERVICE_TOKEN 인증 + X-On-Behalf-Of 헤더 (#34).
// 매 메서드의 첫 인자 agentId 는 workplace-api 가 SecurityContext 의 principal 로 설정할
// AGENT user id. 누락 시 TypeScript 가 빌드 차단.
import axios, { AxiosInstance } from 'axios';

import { DEFAULT_API_BASE_URL } from '../constants.js';
import type { ProviderCredential } from '../agent/agent-runner.js';
import {
  createSharedToolClient,
  describeApiError,
  parseIssueKey,
  type HttpRequestConfig,
  type SharedToolClient,
} from '@smart-workplace/mcp-tools-shared';

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
// #833: 필드명을 API 실제 응답(ContactSummary.type)에 맞춰 `kind` → `type` 으로 교정한다.
// 기존 `kind` 선언은 단순 캐스트라 컴파일은 통과했지만 런타임에는 늘 undefined 였다.
export interface ContactItem {
  // ⚠️ 네임스페이스가 타입별로 다르다 — MEMBER 면 user.id, EXTERNAL 이면 contact_entry.id.
  // 서로 호환되지 않으므로 도구 계층에서는 이 필드를 그대로 노출하지 말고 userId/externalId 로 분리한다.
  id: number;
  type: 'MEMBER' | 'EXTERNAL';
  name: string;
  email: string | null;
  title: string | null;
  organization: string | null;
  isFavorite: boolean;
}

// #333 M4: 드라이브 폴더 생성/이름변경 응답 단건.
export interface DriveFolderItem { id: number; parentId: number | null; name: string; createdAt: string; }

// #333 M3: 외부연락처 생성 입력 (선택 필드는 undefined 시 JSON 에서 생략).
export interface ExternalContactInput {
  name: string;
  email?: string;
  phone?: string;
  organization?: string;
  title?: string;
  notes?: string;
  visibility: 'SHARED' | 'PERSONAL';
}

// #839: 외부연락처 부분 수정 입력 — 생략(undefined) 필드는 서버가 현재 값을 유지하고, 빈 문자열은 비운다.
export type ExternalContactPatch = Partial<ExternalContactInput>;

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
  // #846: 공유 도구(이슈·프로젝트·노트·캘린더·메일·구성원·메시징·드라이브 읽기 등)용 클라이언트.
  //   경로 매핑은 공유 패키지(createSharedToolClient)에 있고, 여기서는 이 에이전트 신원 헤더가 붙은 HTTP 만 넘긴다.
  toolClient(agentId: number): SharedToolClient;
  // 아래는 ai-agent 전용 도구·흐름(상태 변경·담당 해제·chat·위임 제안·외부연락처/드라이브 쓰기 등)이 쓰는 메서드.
  updateIssueStatus(agentId: number, issueKey: string, statusKey: string): Promise<void>;
  unassignSelf(agentId: number, issueKey: string): Promise<void>;
  // Task 7: getOAuthToken → getProviderCredential 일반화. GET /users/me/provider-credential.
  // anthropic(OAuth 토큰)·opencode(공급자 설정 payload) 양쪽을 ProviderCredential 유니온으로 반환.
  getProviderCredential(agentId: number): Promise<ProviderCredential>;
  // 6c: chat
  getChatMessages(agentId: number, threadId: number, limit: number): Promise<ChatMessageItem[]>;
  addChatMessage(agentId: number, threadId: number, body: string): Promise<void>;
  // A2: chat 진행 상태 전송
  postChatProgress(agentId: number, threadId: number, payload: ProgressPayload): Promise<void>;
  // A2: 메시징 진행 상태 전송
  postMessagingProgress(agentId: number, channelId: number, payload: ProgressPayload): Promise<void>;
  // #350: 공개 채널 탐색 — 채널 이름 → channelId 해석.
  discoverChannels(agentId: number, q: string): Promise<ChannelItem[]>;
  // #333 M4: 메일 수동 동기화.
  syncMail(agentId: number, accountId: number): Promise<unknown>;
  // #333 M3: 외부연락처 내부 쓰기(생성/수정). 삭제는 confirm 실행기(propose).
  // #839: force=true 면 이름+이메일 중복 경고(409)를 무시하고 저장한다. 수정은 부분 수정.
  createExternalContact(agentId: number, input: ExternalContactInput, force?: boolean): Promise<ContactItem>;
  updateExternalContact(agentId: number, id: number, input: ExternalContactPatch, force?: boolean): Promise<ContactItem>;
  // #333 M4: 드라이브 폴더/파일 쓰기 — 이동은 204(void).
  createFolder(agentId: number, spaceId: number, parentId: number | null, name: string): Promise<DriveFolderItem>;
  renameFolder(agentId: number, folderId: number, name: string): Promise<DriveFolderItem>;
  moveFolder(agentId: number, folderId: number, targetParentId: number | null): Promise<void>;
  moveFile(agentId: number, fileId: number, targetFolderId: number | null): Promise<void>;
  // #842: 확인카드 사전검증(dry-run). 승인 시점과 같은 권한·매핑·도메인 검증만 서버에서 수행한다.
  //   실패는 AxiosError 로 던져지고 message 는 인터셉터가 서버 사유(describeApiError)로 채운다.
  validateAction(agentId: number, actionType: string, params: Record<string, unknown>): Promise<void>;
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
      attendeeUserIds?: number[]; // #852: 초대 참석자(username 을 해석한 user id)
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
  // #840: API 오류의 서버 메시지를 Error.message 로 끌어올린다(요약 규칙은 공유 describeApiError). axios 기본 메시지는
  // "Request failed with status code 400" 뿐이라, 도구 결과로 LLM 에 전달돼도 무엇이 틀렸는지 알 수 없어
  // 자가교정이 불가능했다. AxiosError 객체는 그대로 두고(status 판정 호출부 유지) message 만 보강한다.
  http.interceptors.response.use(undefined, (err: unknown) => {
    if (axios.isAxiosError(err) && err.response) {
      err.message = describeApiError(err.response.status, err.response.data);
    }
    return Promise.reject(err);
  });

  const onBehalfOf = (agentId: number) => ({
    headers: {
      'X-On-Behalf-Of': String(agentId),
      ...(opts.onBehalfOfTenantId
        ? { 'X-On-Behalf-Of-Tenant': String(opts.onBehalfOfTenantId) }
        : {}),
    },
  });

  // #839: 외부연락처 생성/수정 요청 설정 — force 는 쿼리 파라미터(서버 @RequestParam)라 신원 헤더 설정과 병합한다.
  // 미지정이면 붙이지 않는다(서버 기본 false).
  const withForce = (agentId: number, force?: boolean) => ({
    ...onBehalfOf(agentId),
    ...(force ? { params: { force } } : {}),
  });

  return {
    toolClient(agentId) {
      // 매 요청에 이 에이전트 신원 헤더를 얹는다. 인증·오류 메시지 보강 인터셉터는 같은 http 인스턴스에서 그대로 적용된다.
      const as = (config?: HttpRequestConfig) => ({ ...config, ...onBehalfOf(agentId) });
      return createSharedToolClient({
        get: (url, config) => http.get(url, as(config)),
        post: (url, data, config) => http.post(url, data, as(config)),
        put: (url, data, config) => http.put(url, data, as(config)),
        patch: (url, data, config) => http.patch(url, data, as(config)),
        delete: (url, config) => http.delete(url, as(config)),
      });
    },
    withOnBehalfOfTenant(tenantId: number) {
      return createWorkplaceApiClient({ ...opts, onBehalfOfTenantId: tenantId });
    },



    async updateIssueStatus(agentId, issueKey, statusKey) {
      const { projectKey, number } = parseIssueKey(issueKey);
      await http.patch(
        `/projects/${projectKey}/issues/${number}/status`,
        { status: statusKey },
        onBehalfOf(agentId),
      );
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

    // #842: 확인카드 사전검증 — 성공은 204(본문 없음), 실패는 승인 때와 동일한 4xx 로 사유가 내려온다.
    async validateAction(agentId, actionType, params) {
      await http.post('/actions/validate', { actionType, params }, onBehalfOf(agentId));
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

    // #350: 채널 탐색 — 공개 채널을 이름/키워드로 검색. 채널 이름 → channelId 해석에 사용.
    async discoverChannels(agentId, q) {
      const r = await http.get(`/messaging/channels/discover?q=${encodeURIComponent(q)}`, onBehalfOf(agentId));
      return Array.isArray(r.data) ? (r.data as ChannelItem[]) : [];
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



    // #333 M4: 수동 동기화 — POST /mail/accounts/{accountId}/sync. 소유권은 서버가 검증.
    async syncMail(agentId, accountId) {
      const r = await http.post(`/mail/accounts/${accountId}/sync`, {}, onBehalfOf(agentId));
      return r.data;
    },


    async createExternalContact(agentId, input, force) {
      const r = await http.post(`/contacts/external`, input, withForce(agentId, force));
      return r.data as ContactItem;
    },
    async updateExternalContact(agentId, id, input, force) {
      const r = await http.patch(`/contacts/external/${id}`, input, withForce(agentId, force));
      return r.data as ContactItem;
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

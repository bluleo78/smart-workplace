// workplace-api 호출 client — INTERNAL_SERVICE_TOKEN 인증 + X-On-Behalf-Of 헤더 (#34).
// 매 메서드의 첫 인자 agentId 는 workplace-api 가 SecurityContext 의 principal 로 설정할
// AGENT user id. 누락 시 TypeScript 가 빌드 차단.
import axios, { AxiosInstance } from 'axios';

import { DEFAULT_API_BASE_URL } from '../constants.js';
import type { ProviderCredential } from '../agent/agent-runner.js';
import type { MemoryKind, MemoryScope } from '../agent/memory-block.js';
import {
  createSharedToolClient,
  decodeErrorBody,
  describeApiError,
  getBytes,
  parseIssueKey,
  type ExtractedTextSlice,
  type ExtractionStatus,
  type FileBytes,
  type HttpRequestConfig,
  type SharedToolClient,
  viewUrl,
} from '@smart-workplace/mcp-tools-shared';

// WP-244: 첨부 추출 상태·구간 읽기 응답(WP-242 서버 계약 그대로). 구간 응답 타입은 공유 read_file 과 같은 정의를 쓴다(WP-346).

/** 반복 회차 결과 보고 한 번의 시간 상한 — API 는 행 하나를 잠그고 글 하나를 남길 뿐이라 이보다 오래 걸리면 걸린 연결로 본다. */
const RECURRING_REPORT_TIMEOUT_MS = 15_000;
export type { ExtractedTextSlice, ExtractionStatus };
export interface ExtractionInfo {
  status: ExtractionStatus;
  totalChars: number | null;
  truncated: boolean | null; // 서버가 null 을 줄 수 있음 — 소비자는 false 로 취급
  reasonCode: string | null;
  reason: string | null;
  // WP-250: PDF 전체 쪽수 — PDF 가 아니거나 이전 추출 행이면 null·생략(구 API 응답에는 필드가 없다).
  pageCount?: number | null;
}
// WP-244: 챗 메시지에 붙은 첨부 메타(추출 상태 포함).
export interface ChatAttachmentMeta {
  fileId: number;
  messageId: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  extraction?: ExtractionInfo;
}

// WP-234: 메인 AI 채팅 세션 첨부 메타(서버 HomeAttachment 계약 그대로). 세션 목록 응답은 extraction 을 항상 싣는다.
export interface HomeAttachmentMeta {
  fileId: number;
  messageId: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  extraction: ExtractionInfo;
}

/** WP-386 공용 메모리 직접 요청 결과(API SharedAiMemoryRequestResult). */
interface SharedMemoryRequestDto {
  changeId: number;
  memoryId: number;
  spaceType: 'PROJECT' | 'WIKI_SPACE';
  spaceId: number;
  spaceName: string;
  content: string;
}

// WP-55: 사용자 메모리 항목(API AiMemoryItem). previousContent·previousKind 는 PATCH 응답에만 온다(구 API 는 previousKind 없음).
export interface AiMemoryDto {
  id: number;
  kind: MemoryKind;
  content: string;
  source: 'AI' | 'USER';
  createdAt: string;
  updatedAt: string;
  previousContent?: string;
  previousKind?: MemoryKind;
  /** WP-379: 범위(공통 null). 구 API 는 키 자체가 없다. */
  scope?: MemoryScope | null;
  /** WP-379: 고치기 전 범위 — 앱 범위였을 때만 온다(공통이면 키 없음). */
  previousScope?: MemoryScope;
  /** WP-380: 기한(yyyy-MM-dd, 없으면 null). 구 API 는 키 자체가 없다. */
  expiresOn?: string | null;
  /** WP-380: 서버 오늘 기준 만료 여부. */
  expired?: boolean;
  /** WP-380: 고치기 전 기한 — 있었을 때만. */
  previousExpiresOn?: string;
}

// WP-383: 메모리 검색 결과(API AiMemorySearchResponse). items 는 블록 줄과 같은 모양이지만 도구가 parseMemoryItems 로 하나씩 거른다.
export interface AiMemorySearchDto {
  memoryEnabled: boolean;
  items: unknown[];
}
// WP-384: 지난 대화 검색 결과(API ConversationSearchResponse) — 대화마다 대표 턴 하나.
export interface ConversationHitDto {
  sessionId: string;
  title: string | null;
  lastMessageAt: string;
  question: string | null;
  answerExcerpt: string | null;
  link: string;
}
export interface ConversationSearchDto {
  memoryEnabled: boolean;
  items: ConversationHitDto[];
}

// 6c: chat thread 메시지 (LLM 노출용 경량 형태).
export interface ChatMessageItem {
  id: number;
  // 작성자 user id — 대체 답변 전 "이 에이전트가 이미 답했는지" 확인용(WP-244). 서버는 항상 주지만 구버전 응답 대비 선택.
  authorId?: number;
  authorName: string;
  authorKind: 'HUMAN' | 'AGENT';
  body: string;
  createdAt: string;
  deleted: boolean;
  // WP-244: 메시지 첨부(추출 상태 포함) — 없으면 생략.
  attachments?: ChatAttachmentMeta[];
}

// 7: 채널 메시지 (LLM 노출용 경량 형태).
export interface ChannelMessageItem {
  id: number;
  authorName: string;
  authorKind: 'HUMAN' | 'AGENT';
  body: string;
  createdAt: string;
  deleted: boolean;
  // 서버 MessageResponse.mentions — 본문의 `<@id>` 토큰을 이름으로 풀 사전(WP-353). 없으면(옛 서버) 토큰은 "알 수 없는 사용자" 로 가려진다.
  mentions?: { id: number; username?: string | null; name?: string | null; kind?: string }[];
}

// 6c: 이슈 첨부 메타.
export interface AttachmentMeta {
  fileId: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  // WP-244: 추출 상태(서버가 내려줄 때만).
  extraction?: ExtractionInfo;
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
  // 아래는 ai-agent 전용 도구·흐름(담당 해제·chat·위임 제안 등)이 쓰는 메서드.
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
  // WP-244: 이슈 챗 스레드 경유 이슈 첨부 — 멘션된 AGENT 는 프로젝트 멤버가 아니라 이슈 첨부 API 가 403 이므로
  // 스레드 열람 권한으로 그 스레드가 딸린 이슈의 첨부 목록(추출 상태 포함)·원본을 받는다.
  listThreadIssueAttachments(agentId: number, threadId: number): Promise<AttachmentMeta[]>;
  downloadThreadIssueAttachment(agentId: number, threadId: number, fileId: number): Promise<{ data: Buffer; mimeType: string }>;
  // WP-244: 첨부 추출 텍스트 구간 읽기(offset·limit 생략 시 서버 기본 0·32000) + 챗 첨부 원본 다운로드(Claude 로컬 Read 용).
  // readChatAttachmentText 는 스레드의 챗 첨부와 스레드가 딸린 이슈의 첨부를 모두 받는다.
  readChatAttachmentText(agentId: number, threadId: number, fileId: number, offset?: number, limit?: number): Promise<ExtractedTextSlice>;
  downloadChatAttachment(agentId: number, threadId: number, messageId: number, fileId: number): Promise<{ data: Buffer; mimeType: string }>;
  // WP-250: 스레드의 챗 첨부·스레드가 딸린 이슈 첨부의 모델 입력용 이미지(/text 와 같은 범위) — PDF 쪽(page, 1부터) 또는 이미지 변환본.
  viewChatAttachment(agentId: number, threadId: number, fileId: number, page?: number): Promise<FileBytes>;
  // WP-234: 메인 AI 채팅 세션 첨부 — 웹과 같은 /home/sessions/{sid}/attachments* 를 요청자(onBehalfOfId=userId) 대행으로 부른다.
  // 서버가 세션 소유자·세션 연결 여부를 확인하므로(타 세션 파일은 404) 여기서는 경로만 맞춘다.
  listHomeSessionAttachments(onBehalfOfId: number, sessionId: string): Promise<HomeAttachmentMeta[]>;
  readHomeAttachmentText(onBehalfOfId: number, sessionId: string, fileId: number, offset?: number, limit?: number): Promise<ExtractedTextSlice>;
  // WP-250: 모델 입력용 이미지 — PDF 는 page(1부터)쪽을 그린 이미지, 이미지 파일은 page 없이 변환본. 서버 오류는 ErrorResponse 의 한국어 message 로 던진다.
  viewHomeAttachment(onBehalfOfId: number, sessionId: string, fileId: number, page?: number): Promise<FileBytes>;
  // WP-55: 메모리 도구(라우터 전용) — 요청자(onBehalfOfId=userId) 대행. Internal 대행만 source:'AI'·sessionId 를 받고, 꺼짐이면 409 AI_MEMORY_DISABLED.
  createAiMemory(
    onBehalfOfId: number,
    body: { kind: MemoryKind; content: string; source: 'AI'; sessionId?: string; scope?: MemoryScope; expiresOn?: string },
  ): Promise<AiMemoryDto>;
  /** scope 키가 있으면 범위를 바꾼다(null = 공통으로) — API PATCH present-flag. */
  updateAiMemory(
    onBehalfOfId: number,
    memoryId: number,
    body: { content: string; kind?: MemoryKind; scope?: MemoryScope | null; expiresOn?: string; clearExpiry?: boolean },
  ): Promise<AiMemoryDto>;
  deleteAiMemory(onBehalfOfId: number, memoryId: number): Promise<AiMemoryDto>;
  // WP-383: search_memory — 요청자 대행 GET. 꺼짐이면 { memoryEnabled:false, items:[] }, 구 API 는 404·405(도구가 "쓸 수 없음"으로 바꾼다).
  searchAiMemories(onBehalfOfId: number, params: { q: string; scope?: string; limit?: number }): Promise<AiMemorySearchDto>;
  // WP-384: search_conversations — 요청자 대행 GET. excludeSessionId 는 도구가 묶은 지금 대화. 구 API 는 404·405.
  searchConversations(
    onBehalfOfId: number,
    params: { q: string; excludeSessionId?: string; limit?: number },
  ): Promise<ConversationSearchDto>;
  // WP-386: 공용 메모리 직접 요청 — 요청자(onBehalfOfId=userId) 대행. space 를 비우면 API 가 이 대화의 마지막 사용자 메시지 공간을 쓴다.
  // 오류(422 개인적 내용·503 검사 불가·400 공간 못 정함·403·409)는 AxiosError 로 던진다 — 도구가 코드를 읽어 안내로 바꾼다.
  requestSharedMemory(onBehalfOfId: number, body: { content: string; space?: string; sessionId?: string }): Promise<SharedMemoryRequestDto>;
  // WP-989: 반복 회차 결과 보고 — 실행한 AI(agentId) 대행. runId 는 이벤트가 준 값 그대로(같은 runId 두 번째 보고는 API 가 무시한다).
  reportRecurringRun(
    agentId: number,
    issueId: number,
    body: { runId: string; ok: boolean; message: string },
  ): Promise<void>;
  // WP-1219: 담당 지정·코멘트로 깨어난 이슈 실행의 시작·끝 보고 — 실행한 AI(agentId) 대행. API 가 그 AI 의 작업 기록(작업 중 → 검토 대기·막힘)을 남긴다.
  reportAgentRun(
    agentId: number,
    issueId: number,
    body: { phase: 'STARTED' | 'FINISHED'; ok: boolean; note?: string },
  ): Promise<void>;
  // #719: 요청자의 active-tenant 를 X-On-Behalf-Of-Tenant 로 싣는 스코프 클라이언트를 반환한다.
  // 인-프로세스 MCP 서버는 이 인스턴스를 서브에이전트까지 공유하므로, run 당 1회 스코프하면
  // 위임 도구 호출까지 전부 동일하게 적용된다(다중/무 멤버십 요청자의 AgentTenantResolver
  // fail-closed 방지).
  withOnBehalfOfTenant(tenantId: number): WorkplaceApiClient;
}

// WP-244: 구간 읽기 쿼리 — 생략한 값은 보내지 않아 서버 기본값(offset 0, limit 32000)을 따른다.
function rangeParams(offset?: number, limit?: number): Record<string, number> {
  const p: Record<string, number> = {};
  if (offset !== undefined) p.offset = offset;
  if (limit !== undefined) p.limit = limit;
  return p;
}

export function createWorkplaceApiClient(opts: {
  baseURL?: string;
  internalToken: string;
  // #719: 설정 시 모든 대리 호출에 X-On-Behalf-Of-Tenant 를 동봉 — withOnBehalfOfTenant 가 채운다.
  onBehalfOfTenantId?: number;
  // WP-1118: 반복 회차 결과 보고 한 번의 시간 상한 — 테스트가 짧게 바꾼다. 기본 RECURRING_REPORT_TIMEOUT_MS.
  recurringReportTimeoutMs?: number;
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
      // WP-250: arraybuffer 요청의 오류 본문(ErrorResponse JSON)을 먼저 풀어야 한국어 사유가 message·response.data 에 남는다.
      decodeErrorBody(err);
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

  // 공유 getBytes 에 넘길 GET — 대행 신원 헤더(X-On-Behalf-Of·테넌트)만 얹는다. 인증·오류 메시지 보강 인터셉터는 같은 http 인스턴스에서 적용된다.
  const asAgent = (agentId: number) => ({
    get: (url: string, config?: HttpRequestConfig) => http.get(url, { ...config, ...onBehalfOf(agentId) }),
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

    async listThreadIssueAttachments(agentId, threadId) {
      const r = await http.get(`/chat/threads/${threadId}/issue-attachments`, onBehalfOf(agentId));
      const list: AttachmentMeta[] = Array.isArray(r.data) ? r.data : [];
      return list;
    },


    async downloadThreadIssueAttachment(agentId, threadId, fileId) {
      const r = await http.get(`/chat/threads/${threadId}/issue-attachments/${fileId}/content`, {
        ...onBehalfOf(agentId),
        responseType: 'arraybuffer',
      });
      const mimeType = String(r.headers['content-type'] ?? 'application/octet-stream');
      return { data: Buffer.from(r.data as ArrayBuffer), mimeType };
    },

    async readChatAttachmentText(agentId, threadId, fileId, offset, limit) {
      const r = await http.get(`/chat/threads/${threadId}/attachments/${fileId}/text`, {
        ...onBehalfOf(agentId),
        params: rangeParams(offset, limit),
      });
      return r.data as ExtractedTextSlice;
    },

    async downloadChatAttachment(agentId, threadId, messageId, fileId) {
      const r = await http.get(`/chat/threads/${threadId}/messages/${messageId}/attachments/${fileId}/content`, {
        ...onBehalfOf(agentId),
        responseType: 'arraybuffer',
      });
      const mimeType = String(r.headers['content-type'] ?? 'application/octet-stream');
      return { data: Buffer.from(r.data as ArrayBuffer), mimeType };
    },

    // WP-234: 세션 id 는 UUID 라 그대로 써도 되지만, 경로 주입을 원천 차단하려고 인코딩한다.
    async listHomeSessionAttachments(onBehalfOfId, sessionId) {
      const r = await http.get(`/home/sessions/${encodeURIComponent(sessionId)}/attachments`, onBehalfOf(onBehalfOfId));
      return r.data as HomeAttachmentMeta[];
    },

    async readHomeAttachmentText(onBehalfOfId, sessionId, fileId, offset, limit) {
      const r = await http.get(`/home/sessions/${encodeURIComponent(sessionId)}/attachments/${fileId}/text`, {
        ...onBehalfOf(onBehalfOfId),
        params: rangeParams(offset, limit),
      });
      return r.data as ExtractedTextSlice;
    },

    // WP-250: /view 는 PDF 쪽(?page=N) 또는 이미지 변환본을 돌려준다. 받기는 공유 getBytes 하나로 — 이미지 상한(넘으면 FileTooLargeError),
    // 오류 본문 풀기, X-Page-Count(PDF 전체 쪽수) → pageCount 를 공유 read_file 과 같은 규칙으로 처리한다.
    async viewHomeAttachment(onBehalfOfId, sessionId, fileId, page) {
      return getBytes(asAgent(onBehalfOfId), viewUrl(`/home/sessions/${encodeURIComponent(sessionId)}/attachments/${fileId}`, page));
    },

    async viewChatAttachment(agentId, threadId, fileId, page) {
      return getBytes(asAgent(agentId), viewUrl(`/chat/threads/${threadId}/attachments/${fileId}`, page));
    },

    async createAiMemory(onBehalfOfId, body) {
      const r = await http.post('/users/me/ai-memories', body, onBehalfOf(onBehalfOfId));
      return r.data as AiMemoryDto;
    },

    async updateAiMemory(onBehalfOfId, memoryId, body) {
      const r = await http.patch(`/users/me/ai-memories/${memoryId}`, body, onBehalfOf(onBehalfOfId));
      return r.data as AiMemoryDto;
    },

    async deleteAiMemory(onBehalfOfId, memoryId) {
      const r = await http.delete(`/users/me/ai-memories/${memoryId}`, onBehalfOf(onBehalfOfId));
      return r.data as AiMemoryDto;
    },

    async searchAiMemories(onBehalfOfId, params) {
      const r = await http.get('/users/me/ai-memories/search', { ...onBehalfOf(onBehalfOfId), params });
      return r.data as AiMemorySearchDto;
    },

    async searchConversations(onBehalfOfId, params) {
      const r = await http.get('/home/sessions/search', { ...onBehalfOf(onBehalfOfId), params });
      return r.data as ConversationSearchDto;
    },
    async reportRecurringRun(agentId, issueId, body) {
      // 요청 시간 상한(WP-1118) — 응답 없이 걸린 연결은 끝나지 않아 다시 보내기가 돌지 못한다. 넘으면 응답 없는 오류로 끝나 다시 보낸다.
      await http.post(`/internal/issue-recurrence/${issueId}/runs`, body, {
        ...onBehalfOf(agentId),
        timeout: opts.recurringReportTimeoutMs ?? RECURRING_REPORT_TIMEOUT_MS,
      });
    },
    async reportAgentRun(agentId, issueId, body) {
      // 반복 결과 보고와 같은 요청 시간 상한 — 응답 없는 연결에 실행 마무리가 걸리지 않게.
      await http.post(`/internal/issues/${issueId}/agent-runs`, body, {
        ...onBehalfOf(agentId),
        timeout: opts.recurringReportTimeoutMs ?? RECURRING_REPORT_TIMEOUT_MS,
      });
    },
    async requestSharedMemory(onBehalfOfId, body) {
      const r = await http.post('/shared-ai-memories/requests', body, onBehalfOf(onBehalfOfId));
      return r.data as SharedMemoryRequestDto;
    },
  };
}

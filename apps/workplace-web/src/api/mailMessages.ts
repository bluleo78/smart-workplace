// 받은편지함/보낸편지함 동기화·읽기·발송 API. baseURL '/api/v1' 가 client 에 포함.
import type { AxiosProgressEvent } from 'axios';

import type { MailFolderSyncResult, MailMoveRequest, MailMoveResponse, MailServerFolder } from '../types/mailFolder';
import type {
  CalendarInvite,
  ComposeAttachmentUpload,
  ComposeDraftRequest,
  ComposeDraftResult,
  DraftCoachingRequest,
  EmailMessageDetail,
  EmailMessageSummary,
  InviteResponseRequest,
  MailAiSummary,
  MailDraftCoaching,
  MailFolder,
  MailIssueDraft,
  MailListCursor,
  MailOlderResult,
  MailSendRequest,
  MailSyncResult,
  MailSyncStatus,
  MailUnreadCounts,
  PromoteToIssuePayload,
  RecentRecipient,
  SendResult,
} from '../types/mailMessage';
import { fetchBlobByPath } from './blobContent';
import { client, getAccessToken } from './client';

/** 계정의 INBOX 를 증분 동기화(수동 트리거). */
export async function syncMailbox(accountId: number): Promise<MailSyncResult> {
  const { data } = await client.post<MailSyncResult>(
    `/mail/accounts/${accountId}/sync`,
  );
  return data;
}

/**
 * WP-962 메일 옮기기 — 보관·받은편지함·내 메일함으로 옮기기와 삭제(서버 휴지통). 메일 서버에도 반영된다.
 * 실행 취소는 호출 측이 토스트가 떠 있는 동안 이 요청을 미루는 방식이다(lib/mailMoveQueue).
 */
export async function moveMessages(accountId: number, body: MailMoveRequest): Promise<MailMoveResponse> {
  const { data } = await client.post<MailMoveResponse>(`/mail/accounts/${accountId}/messages/move`, body);
  return data;
}

/**
 * WP-962 페이지를 떠날 때(탭 닫기·새로고침) 미뤄 둔 옮기기를 보낸다 — axios 요청은 페이지가 내려가면 끊기므로 keepalive fetch 를 쓴다.
 * 응답은 받지 않는다(받을 페이지가 없다). 액세스 토큰이 없으면 보낼 수 없어 그냥 둔다(실행 취소한 것과 같아진다).
 */
export function moveMessagesOnUnload(accountId: number, body: MailMoveRequest): void {
  const token = getAccessToken();
  if (!token) return;
  try {
    void fetch(`/api/v1/mail/accounts/${accountId}/messages/move`, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }).catch(() => {
      /* 내려가는 페이지 — 알릴 곳이 없다 */
    });
  } catch {
    /* fetch 를 못 쓰는 환경 — 무시 */
  }
}

/** 계정 동기화 진행 상태(폴링용). */
export async function getSyncStatus(accountId: number): Promise<MailSyncStatus> {
  const { data } = await client.get<MailSyncStatus>(
    `/mail/accounts/${accountId}/sync-status`,
  );
  return data;
}

/** WP-961 계정의 서버 메일함(보관 먼저, 그다음 이름순) — 사이드바 트리용. 서버에 접속하지 않고 저장된 목록을 읽는다. */
export async function listMailFolders(accountId: number): Promise<MailServerFolder[]> {
  const { data } = await client.get<MailServerFolder[]>(`/mail/accounts/${accountId}/folders`);
  return data;
}

/**
 * WP-965 받은편지함(INBOX)·보낸편지함(SENT) 이전 메일 더 가져오기 — 가져온 경계 앞 90일을 서버에서 받는다.
 * 목록을 끝까지 내렸는데 로컬 메일이 바닥났을 때 부른다.
 */
export async function fetchOlderMail(accountId: number, folder: MailFolder): Promise<MailOlderResult> {
  const { data } = await client.post<MailOlderResult>(
    `/mail/accounts/${accountId}/messages/older`,
    null,
    { params: { folder } },
  );
  return data;
}

/** WP-961 서버 메일함 한 개 가져오기. older=true 면 이미 가져온 기간 앞의 90일을 더 받는다(false 도 명시해 보낸다). */
export async function syncMailFolder(accountId: number, folderId: number, older: boolean): Promise<MailFolderSyncResult> {
  const { data } = await client.post<MailFolderSyncResult>(
    `/mail/accounts/${accountId}/folders/${folderId}/sync`,
    null,
    { params: { older } },
  );
  return data;
}

/**
 * 계정의 메시지 목록(폴더 스코프, 최신순, 선택 검색어·unread·category·needsReply 필터).
 * limit 은 최신 N건만 받을 때(모바일 홈 타일 요약 등, WP-160) — 생략하면 서버 기본 건수.
 * folderId(WP-961)가 있으면 그 서버 메일함 — 서버가 folder·분류·회신필요를 무시하므로 아예 보내지 않는다.
 * before(WP-965)가 있으면 그 행 다음 페이지 — receivedAt 은 서버가 준 문자열을 그대로 넘긴다(마이크로초까지 맞아야 경계 행이 빠지지 않는다).
 */
export async function listMessages(
  accountId: number,
  folder: MailFolder,
  query?: string,
  unread?: boolean,
  category?: string,
  needsReply?: boolean,
  limit?: number,
  folderId?: number | null,
  before?: MailListCursor | null,
): Promise<EmailMessageSummary[]> {
  const scope = folderId != null
    ? { folderId }
    : {
        folder,
        // P2: AI 분류 필터.
        ...(category ? { category } : {}),
        // P2: 회신필요(미처리) 필터.
        ...(needsReply ? { needsReply: true } : {}),
      };
  const { data } = await client.get<EmailMessageSummary[]>(
    `/mail/accounts/${accountId}/messages`,
    {
      params: {
        ...scope,
        ...(query ? { query } : {}),
        // #469: unread=true 면 안 읽은 메일만.
        ...(unread ? { unread: true } : {}),
        ...(limit ? { limit } : {}),
        ...(before ? { beforeId: before.id, ...(before.receivedAt ? { beforeAt: before.receivedAt } : {}) } : {}),
      },
    },
  );
  return data;
}

/** WP-186 계정 안 읽은 수(분류 버킷·받은편지함·회신필요) + AI 분류 활성 여부. */
export async function getUnreadCounts(accountId: number): Promise<MailUnreadCounts> {
  const { data } = await client.get<MailUnreadCounts>(`/mail/accounts/${accountId}/unread-counts`);
  return data;
}

/** WP-186 모바일 탭 배지 — 모든 계정 업무 안 읽은 수 합. */
export async function getUnreadSummary(): Promise<number> {
  const { data } = await client.get<{ workUnread: number }>('/mail/unread-summary');
  return data.workUnread;
}

/** WP-187 한 통 읽음 처리(MCP mark_mail_read 와 같은 엔드포인트). */
export async function markMessageRead(messageId: number): Promise<void> {
  await client.post(`/mail/messages/${messageId}/read`);
}

/** WP-187 안읽음으로 표시. */
export async function markMessageUnread(messageId: number): Promise<void> {
  await client.post(`/mail/messages/${messageId}/unread`);
}

/** WP-187 보기 범위 필터 — 목록 API 와 같은 의미(category '' = 전체). folderId(WP-961)가 있으면 그 서버 메일함(분류·회신필요 무시). */
export interface MailViewScope {
  category: string;
  needsReply: boolean;
  query: string;
  folderId?: number | null;
}

/** WP-187 모두 읽음 확인용 건수 + 서버(DB 시계) 기준 시각. asOf 는 모두 읽음 요청에 그대로 되돌려 보낸다. */
export async function getViewUnreadCount(
  accountId: number,
  scope: MailViewScope,
): Promise<{ count: number; asOf: string }> {
  const { data } = await client.get<{ count: number; asOf: string }>(
    `/mail/accounts/${accountId}/messages/unread-count`,
    {
      params: {
        ...(scope.category ? { category: scope.category } : {}),
        ...(scope.needsReply ? { needsReply: true } : {}),
        ...(scope.query ? { query: scope.query } : {}),
        ...(scope.folderId != null ? { folderId: scope.folderId } : {}),
      },
    },
  );
  return data;
}

/** WP-187 모두 읽음 — 갱신 건수. asOf 이후에 들어온 메일은 서버가 제외한다. */
export async function markAllRead(accountId: number, body: MailViewScope & { asOf: string }): Promise<number> {
  const { data } = await client.post<{ updated: number }>(
    `/mail/accounts/${accountId}/messages/mark-all-read`,
    {
      category: body.category || null,
      needsReply: body.needsReply,
      query: body.query || null,
      asOf: body.asOf,
    },
    // WP-961: 서버 메일함은 본문이 아니라 쿼리 파라미터(백엔드 @RequestParam folderId).
    body.folderId != null ? { params: { folderId: body.folderId } } : undefined,
  );
  return data.updated;
}

/** 메시지 단건 상세(본문 + 첨부 메타). */
export async function getMessage(messageId: number): Promise<EmailMessageDetail> {
  // WP-214: 조회는 읽음 처리하지 않는다(markSeen=false) — 재조회마다 다시 읽음이 되지 않게, 첫 열람만 markMessageRead 로 따로 보낸다.
  const { data } = await client.get<EmailMessageDetail>(`/mail/messages/${messageId}`, {
    params: { markSeen: false },
  });
  return data;
}

/**
 * WP-986 일정 초대 메일에 응답(수락·미정·거절) — 서버가 주최자에게 응답을 보내고 내 캘린더 일정을 맞춘다.
 * 응답은 갱신된 초대 정보다. 응답할 수 없는 메일이면 409.
 */
export async function respondToInvite(
  messageId: number,
  response: InviteResponseRequest['response'],
): Promise<CalendarInvite> {
  const body: InviteResponseRequest = { response };
  const { data } = await client.post<CalendarInvite>(`/mail/messages/${messageId}/invite-response`, body);
  return data;
}

/** 메일 요약(캐시 우선, 미분석이면 서버가 즉시 생성). WP-149: status 로 카드·버튼·숨김을 고른다. */
export async function getMailSummary(messageId: number): Promise<MailAiSummary> {
  const { data } = await client.get<MailAiSummary>(`/mail/messages/${messageId}/summary`)
  return data
}

/** WP-149 "AI 요약" 버튼 — 요약 생략을 무시하고 강제 생성(서버가 결과를 캐시). */
export async function generateMailSummary(messageId: number): Promise<MailAiSummary> {
  const { data } = await client.post<MailAiSummary>(`/mail/messages/${messageId}/summary`)
  return data
}

/** AI 답장 초안 생성(미영속). */
export async function generateReplyDraft(messageId: number): Promise<{ draftBody: string }> {
  const { data } = await client.post<{ draftBody: string }>(`/mail/messages/${messageId}/reply-draft`)
  return data
}

/**
 * WP-576 새 메일 AI 초안 생성(미영속). signal 로 [중지] 시 요청을 끊는다.
 * 응답 body 는 평문 — 호출 측이 plainTextToMailHtml 로 escape·문단화해 에디터에 넣는다.
 */
export async function generateComposeDraft(
  accountId: number,
  req: ComposeDraftRequest,
  signal?: AbortSignal,
): Promise<ComposeDraftResult> {
  const { data } = await client.post<ComposeDraftResult>(`/mail/accounts/${accountId}/compose-draft`, req, { signal })
  return data
}

/** #520 AI 이슈 초안 생성(미영속). */
export async function generateIssueDraft(messageId: number): Promise<MailIssueDraft> {
  const { data } = await client.post<MailIssueDraft>(`/mail/messages/${messageId}/issue-draft`)
  return data
}

/** #520 메일→이슈 승격(생성). */
export async function promoteMailToIssue(
  messageId: number,
  payload: PromoteToIssuePayload,
): Promise<{ issueKey: string }> {
  const { data } = await client.post<{ issueKey: string }>(`/mail/messages/${messageId}/issue`, payload)
  return data
}

/** #520 메일에 연결된 이슈 키 조회(배지). */
export async function getLinkedIssue(messageId: number): Promise<{ issueKey: string | null }> {
  const { data } = await client.get<{ issueKey: string | null }>(`/mail/messages/${messageId}/linked-issue`)
  return data
}

/** 내 초안 코칭(미영속). */
export async function coachDraft(req: DraftCoachingRequest): Promise<MailDraftCoaching> {
  const { data } = await client.post<MailDraftCoaching>('/mail/draft-coaching', req)
  return data
}

/** 메일 발송(새 메일·답장·전달). inReplyToMessageId 가 있으면 답장. */
export async function sendMail(
  accountId: number,
  body: MailSendRequest,
): Promise<SendResult> {
  const { data } = await client.post<SendResult>(
    `/mail/accounts/${accountId}/send`,
    body,
  );
  return data;
}

/** 최근 수신인(WP-945) — 내가 최근 보낸 메일의 수신인을 마지막으로 보낸 순으로 limit 명(최대 200)까지. 거르기는 브라우저에서 한다. */
export async function fetchRecentRecipients(limit: number): Promise<RecentRecipient[]> {
  const { data } = await client.get<RecentRecipient[]>('/mail/recent-recipients', { params: { limit } });
  return data;
}

/**
 * 작성창 첨부 1개 업로드(WP-574) — multipart 필드명 `file`. 파일마다 따로 올려 칩마다 진행률·실패를 따로 보여 준다.
 * onProgress 는 0~100 정수(%). signal 로 업로드 중 「첨부 빼기」·작성창 닫기를 취소한다.
 */
export async function uploadComposeAttachment(
  file: File,
  opts: { onProgress?: (percent: number) => void; signal?: AbortSignal } = {},
): Promise<ComposeAttachmentUpload> {
  const fd = new FormData();
  fd.append('file', file);
  const { data } = await client.post<ComposeAttachmentUpload>('/mail/compose-attachments', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
    signal: opts.signal,
    onUploadProgress: (e: AxiosProgressEvent) => {
      // total 을 모르면(청크 전송 등) 진행률을 낼 수 없으니 건너뛴다 — 칩은 0% 에 머물다 완료로 바뀐다.
      if (!opts.onProgress || !e.total) return;
      opts.onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
    },
  });
  return data;
}

/**
 * 인라인 이미지 첨부를 data URI 로 조회 — 본문 cid: 치환용(WP-65).
 * sandbox iframe 은 opaque origin 이라 부모 origin 의 blob: URL 을 신뢰할 수 없으므로 data URI 를 쓴다.
 * 대상은 resolveCidTargets(lib/mailInlineImages) 가 image/* 로 한정하므로, 응답 헤더 대신 첨부 메타 contentType 으로 타입을 지정한다
 * (서버가 octet-stream 으로 응답해도 img 가 렌더되도록).
 */
export async function fetchMailAttachmentDataUri(
  attachmentId: number,
  contentType: string,
): Promise<string> {
  const blob = await fetchBlobByPath(`/mail/attachments/${attachmentId}/content`);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([blob], { type: contentType }));
  });
}

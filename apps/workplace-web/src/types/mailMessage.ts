// 받은편지함/보낸편지함 메시지 DTO — 백엔드 com.workplace.mail.dto 와 1:1 매칭.

/** 메일 목록 한 행(본문 제외, 미리보기 snippet 포함). */
export interface EmailMessageSummary {
  id: number;
  accountId: number;
  threadId: string;
  fromAddress: string | null;
  fromName: string | null;
  subject: string | null;
  snippet: string | null;
  receivedAt: string | null;
  seen: boolean;
  hasAttachment: boolean;
  aiCategory: string | null;
  aiNeedsReply: boolean | null;
  /** WP-186: 분류를 아직 시도하지 않음 → "분류 전" 배지 */
  categoryPending: boolean;
}

/** 첨부 메타(바이너리 미저장 — 다운로드는 후속). */
export interface EmailAttachmentMeta {
  id: number;
  filename: string | null;
  contentType: string | null;
  sizeBytes: number;
  contentId: string | null;
}

/** 메일 본문 단건(헤더 + text/html 본문 + 첨부 메타). */
export interface EmailMessageDetail {
  id: number;
  threadId: string;
  messageId: string | null;
  fromAddress: string | null;
  fromName: string | null;
  toAddresses: string | null;
  ccAddresses: string | null;
  bccAddresses: string | null;
  subject: string | null;
  sentAt: string | null;
  receivedAt: string | null;
  seen: boolean;
  bodyText: string | null;
  bodyHtml: string | null;
  attachments: EmailAttachmentMeta[];
}

/** 수동 동기화 1회 결과 요약. */
export interface MailSyncResult {
  fetched: number;
  saved: number;
}

/** 수동 동기화 진행 상태(폴링). phase: 'LIST' | 'BODIES' | 'IDLE'. */
export interface MailSyncStatus {
  phase: 'LIST' | 'BODIES' | 'IDLE';
  total: number;
  done: number;
  running: boolean;
}

/** 메일 폴더(받은편지함/보낸편지함). */
export type MailFolder = 'INBOX' | 'SENT';

/** AI 분류 5종 — ⚠️ 백엔드 CATEGORIES 와 값·순서 일치(WP-186). */
export const MAIL_CATEGORIES = ['업무', '개인', '알림', '프로모션', '뉴스레터'] as const;
export type MailCategory = (typeof MAIL_CATEGORIES)[number];

/** WP-186 사이드바 안 읽은 수 — byCategory.업무 는 미분류 포함. */
export interface MailUnreadCounts {
  classificationActive: boolean;
  inbox: number;
  byCategory: Record<MailCategory, number>;
  needsReply: number;
}

/** 메일 발송 요청(새 메일·답장·전달 공용). 백엔드 MailSendRequest 와 1:1. */
export interface MailSendRequest {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyHtml: string;
  bodyText: string;
  inReplyToMessageId: number | null;
  /** 인용문 cid 이미지 재첨부 대상(WP-69) — 생략하면 인라인 파트 없음. */
  inlineImages?: { attachmentId: number; contentId: string }[];
  /** 작성창에서 먼저 올린 첨부 id(WP-574, POST /mail/compose-attachments 응답 id). 생략·빈 목록이면 없음. */
  attachmentIds?: number[];
  /** 전달하며 함께 보낼 받은 메일 원본 첨부 id(WP-574, email_attachment.id). 생략·빈 목록이면 없음. */
  forwardAttachmentIds?: number[];
  /** 이 작성의 임시저장 id(WP-577) — 보내면 서버가 그 임시저장을 지운다. 저장된 적 없으면 생략. */
  draftId?: number;
}

/**
 * 작성창 첨부 업로드 응답(WP-574) — POST /mail/compose-attachments(201)가 파일 하나를 임시 보관하고 돌려주는 메타.
 * 발송 때 이 id 를 MailSendRequest.attachmentIds 로 넘긴다.
 */
export interface ComposeAttachmentUpload {
  id: number;
  name: string;
  size: number;
  mimeType: string;
  /** 이 시각(ISO-8601)까지 보내지 않으면 서버가 지운다(올린 뒤 24시간). */
  expiresAt: string;
}

/** 발송 결과. */
export interface SendResult {
  localMessageId: number;
  messageId: string;
}

/** 초안 코칭 노트 1건. */
export interface CoachingNote {
  dimension: 'TONE' | 'CLARITY' | 'COMPLETENESS'
  message: string
}

/** 초안 코칭 응답. */
export interface MailDraftCoaching {
  notes: CoachingNote[]
  improvedBodyHtml: string
}

/** 초안 코칭 요청. */
export interface DraftCoachingRequest {
  accountId: number
  bodyHtml: string
  bodyText: string
  inReplyToMessageId: number | null
}

/**
 * WP-576 새 메일 AI 초안 요청 — 사용자 지시 + 지금 작성창의 받는사람·참조·제목(모델이 참고).
 * instruction 은 필수·4000자 이하(어기면 서버가 400 오류). subject 가 비었거나 null 일 때만 서버가 제목을 만든다.
 */
export interface ComposeDraftRequest {
  instruction: string
  to: string[]
  cc: string[]
  subject: string | null
}

/**
 * WP-576 새 메일 AI 초안(미영속). body 는 평문.
 * subject 는 요청 제목이 비었을 때만 채워지고, 요청에 제목이 있었으면 null(사용자 제목을 덮지 않는다).
 */
export interface ComposeDraftResult {
  subject: string | null
  body: string
}

/** #520 메일→이슈 AI 초안(미영속). */
export interface MailIssueDraft {
  title: string
  body: string
  priority: 'LOW' | 'MID' | 'HIGH'
  suggestedProjectKey: string | null
  candidateProjects: { key: string; name: string }[]
}

/** #520 메일→이슈 승격 요청. */
export interface PromoteToIssuePayload {
  projectKey: string
  title: string
  body?: string
  priority?: 'LOW' | 'MID' | 'HIGH'
  assigneeIds?: number[]
}

/** WP-149 메일 AI 요약 표시 상태 — READY 카드 · SKIPPED "AI 요약" 버튼 · EMPTY 숨김. */
export type MailAiSummaryStatus = 'READY' | 'SKIPPED' | 'EMPTY'

/** GET/POST /mail/messages/{id}/summary 응답. status 는 WP-149 이전 응답 호환을 위해 선택. */
export interface MailAiSummary {
  summary: string | null
  status?: MailAiSummaryStatus
}

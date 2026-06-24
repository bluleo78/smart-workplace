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
  needsReplyDoneAt: string | null; // P2: 회신필요 처리완료 시각(null=미처리)
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

/** 메일 발송 요청(새 메일·답장·전달 공용). 백엔드 MailSendRequest 와 1:1. */
export interface MailSendRequest {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyHtml: string;
  bodyText: string;
  inReplyToMessageId: number | null;
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

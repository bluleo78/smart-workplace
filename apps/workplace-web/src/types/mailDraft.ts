// 메일 임시저장(WP-577) DTO — 백엔드 /api/v1/mail/drafts 계약과 1:1.
// 임시저장은 앱 서버에만 둔다(IMAP Drafts 폴더와 동기화하지 않는다). 그래서 MailFolder 가 아니라 별도 리소스다.

/**
 * 작성 종류 — 새 메일 / 회신 / 전달. 작성창 컨텍스트(MailComposeContext)도 이 타입을 그대로 쓴다.
 * 인용문·답장 대상만으로 추론하면 전달에서 인용문을 지운 순간 새 메일과 구분되지 않으므로(WP-576) 명시한다.
 */
export type ComposeMode = 'new' | 'reply' | 'forward';

/** 임시저장 첨부 출처 — upload = 작성창에서 올린 파일(compose-attachments id), forward = 전달 원본 메일 첨부(email_attachment id). */
export type MailDraftAttachmentSource = 'upload' | 'forward';

/** 임시보관함 목록 한 행(참조·숨은참조는 목록에 쓰지 않아 상세에만 있다). GET /mail/drafts?accountId= */
export interface MailDraftSummary {
  id: number;
  accountId: number;
  mode: ComposeMode;
  to: string[];
  subject: string;
  /** 본문 앞부분 평문(서버가 저장 요청의 bodyText 에서 앞 120자를 뽑는다). 비었으면 ''. */
  preview: string;
  attachmentCount: number;
  /** 마지막 저장 시각(ISO-8601 UTC). 목록은 이 값 내림차순. */
  updatedAt: string;
}

/** 임시저장 첨부 한 개. */
export interface MailDraftAttachment {
  id: number;
  name: string;
  size: number;
  mimeType: string;
  source: MailDraftAttachmentSource;
}

/** 임시저장 상세 — 작성창을 그 내용으로 다시 열 때 쓴다. GET /mail/drafts/{id} */
export interface MailDraftDetail {
  id: number;
  accountId: number;
  mode: ComposeMode;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  /** 에디터 본문만(인용문 제외) — 인용문은 sourceMessageId 로 원본을 받아 다시 만든다(같은 인용이 두 번 붙지 않게). */
  bodyHtml: string;
  /** 답장·전달의 원본 메일 id. 새 메일은 null. */
  sourceMessageId: number | null;
  /** 작성 중 인용문을 지웠는가 — 다시 열 때 인용문을 붙이지 않는다. */
  quoteRemoved: boolean;
  attachments: MailDraftAttachment[];
  /** 낙관적 잠금 버전 — PUT 에 그대로 실어 보낸다. 다르면 409 DRAFT_CONFLICT. */
  version: number;
  updatedAt: string;
}

/**
 * 저장 요청 본문(POST 생성·PUT 갱신 공용). PUT 은 version 을 반드시 싣는다.
 * 첨부는 출처별 id 목록만 보낸다 — 이름·크기는 서버가 이미 안다. 올리는 중·실패한 첨부는 싣지 않는다.
 */
export interface MailDraftSaveRequest {
  accountId: number;
  mode: ComposeMode;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyHtml: string;
  /** 본문 평문 앞부분(draftPreviewSource — 공백 정리 뒤 앞 1000자) — 서버는 저장하지 않고 임시보관함 목록 미리보기(앞 120자)만 만든다. */
  bodyText: string;
  sourceMessageId: number | null;
  quoteRemoved: boolean;
  /** 작성창에서 올린 파일 id(compose-attachments) — 저장할 때 임시저장에 묶이고, 빠진 것은 풀린다. */
  attachmentIds: number[];
  /** 전달 원본 메일 첨부 id(email_attachment). */
  forwardAttachmentIds: number[];
  version?: number;
}

/** POST /mail/drafts 응답. */
export interface MailDraftCreated {
  id: number;
  version: number;
  updatedAt: string;
}

/** PUT /mail/drafts/{id} 응답. */
export interface MailDraftUpdated {
  version: number;
  updatedAt: string;
  /** 서버가 정한 첨부 수(올린 파일 + 남은 전달 원본) — 남의·없어진 전달 원본은 서버가 버리므로 요청 값으로 세지 않는다. */
  attachmentCount: number;
}

/** 다른 기기·창에서 먼저 고쳐 버전이 어긋났을 때 서버가 주는 오류 코드(409, ErrorResponse.errors.code). */
export const DRAFT_CONFLICT = 'DRAFT_CONFLICT';

/**
 * 임시저장이 없을 때 서버가 주는 오류 코드(404, ErrorResponse.errors.code) — 다른 곳에서 보냈거나 버렸다.
 * 계정이 비활성인 404 등 다른 404 에는 없다(일반 저장 실패로 다룬다).
 */
export const DRAFT_NOT_FOUND = 'DRAFT_NOT_FOUND';

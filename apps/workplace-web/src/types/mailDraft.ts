// 메일 임시저장(WP-577) DTO — 백엔드 /api/v1/mail/drafts 계약과 1:1.
// 임시저장은 앱 서버에만 둔다(IMAP Drafts 폴더와 동기화하지 않는다). 그래서 MailFolder 가 아니라 별도 리소스다.
// WP-1786: 보내기 대기열도 같은 행이다 — 보내면 요청 전체가 이 행에 담겨 10초 뒤 서버가 보낸다(그동안 되돌릴 수 있다).
import type { MailInlineRef } from './mailMessage';

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

/** 예약 목록 한 행(WP-1787) — 임시보관함 행에 보낼 시각이 더해진다. GET /mail/drafts/scheduled?accountId= (보낼 시각 오름차순, 최대 100) */
export interface MailScheduledSummary extends MailDraftSummary {
  /** 보낼 시각(ISO-8601 UTC). */
  sendAt: string;
}

/** 임시저장 개수 응답 — count 배지, queued 보내기 대기 수(WP-1786), scheduled 예약 수(WP-1787). GET /mail/drafts/count */
export interface MailDraftCount {
  count: number;
  queued: number;
  scheduled: number;
  /** 가장 이른 예약 시각(ISO-8601, 예약이 없으면 null) — 그 시각 근처에서만 다시 받는다(WP-1787 코드 리뷰). 옛 응답엔 없을 수 있다. */
  nextSendAt?: string | null;
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
  /** 본문 평문(WP-1786) — 대기열이 보낼 때 평문 파트로 쓴다. 옛 응답엔 없을 수 있다. */
  bodyText?: string | null;
  /** 인용 원본 첨부의 cid 참조(WP-1786, 보내기 요청 inlineImages 와 같다). */
  inlineImages?: MailInlineRef[];
  /** 붙여 넣은 이미지 업로드 참조(WP-1786, 보내기 요청 inlineUploads 와 같다). */
  inlineUploads?: MailInlineRef[];
  /** 답장 원본 메일 id(WP-1786) — 스레딩 헤더용. */
  inReplyToMessageId?: number | null;
  /**
   * 보내기 상태(WP-1786) — null = 일반 임시보관, QUEUED·SENDING = 보내는 중(임시보관함에 보이지 않는다), FAILED = 보내지 못함.
   * QUEUED·SENDING·FAILED 행의 본문은 보내기 요청 그대로다(인용문이 붙고 붙여 넣은 이미지가 cid: 로 바뀐 형태) — composeFromDraft 가 되돌린다.
   */
  sendState?: 'QUEUED' | 'SENDING' | 'FAILED' | null;
  /** FAILED 의 사유(사용자 문구). */
  sendError?: string | null;
  /** 기밀 표시(WP-2029) — 다시 열면 작성창 토글이 켜진 채 열린다. 옛 응답엔 없을 수 있다(= false). */
  confidential?: boolean;
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
  /** 인용 원본 첨부의 cid 참조(WP-1786) — 보내기 요청과 같은 모양으로 담아, 대기열이 그 행만으로 보낼 수 있게 한다. */
  inlineImages?: MailInlineRef[];
  /** 본문에 붙여 넣은 이미지 업로드 참조(WP-1786). */
  inlineUploads?: MailInlineRef[];
  /** 답장 원본 메일 id(WP-1786) — 답장이 아니면 null. */
  inReplyToMessageId?: number | null;
  /** 기밀 표시(WP-2029) — 생략하면 false. */
  confidential?: boolean;
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

/**
 * 보내는 중(대기·발송 중)인 임시저장을 고치거나 지우려 할 때 서버가 주는 오류 코드(409, WP-1786).
 * 그 쓰기 창은 보내기로 이미 닫혔으므로(다른 탭에 남은 같은 임시저장 등) 자동 저장은 조용히 멈춘다.
 */
export const DRAFT_SENDING = 'DRAFT_SENDING';

/** 되돌리기가 늦었다 — 서버가 이미 보내는 중이다(409, WP-1786). 404(이미 보내고 지워짐)와 함께 「이미 보냄」으로 알린다. */
export const ALREADY_SENDING = 'ALREADY_SENDING';

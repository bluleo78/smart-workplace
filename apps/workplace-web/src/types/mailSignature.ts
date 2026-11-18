// 메일 서명(WP-1517) DTO — 서버 MailSignatureResponse·MailSignatureUpdateRequest·SignatureImageStaged 와 1:1.
// 서명은 사용자당 하나(메일 계정별이 아니다)이고, 설정 › 메일 계정 「서명」 카드와 작성창이 같은 값을 쓴다.

/** 내 서명. 아직 저장한 적이 없으면 html '' · autoNew true · autoReply false · pasted false · updatedAt null. */
export interface MailSignature {
  /** 서버가 정리한 서명 HTML — 이미지 src 는 `/api/v1/mail/signature/images/{id}`. 서명이 없으면 ''. */
  html: string;
  /** 새 메일에 서명을 자동으로 넣는가. */
  autoNew: boolean;
  /** 답장·전달에 서명을 자동으로 넣는가. */
  autoReply: boolean;
  /**
   * 붙여넣은 서명 「원본 그대로」 모드(WP-1726) — 설정 서명 카드가 편집기 대신 격리 미리 보기로 연다(표·클래스 서식을 편집기가 지우지 않게).
   * 빈 서명은 늘 false.
   */
  pasted: boolean;
  /** 마지막 저장 시각(서버 OffsetDateTime). 저장한 적이 없으면 null. */
  updatedAt: string | null;
  /** 이번 저장에서 가져오지 못해 뺀 이미지 수(file:·blob:·받기 실패·형식·크기·개수 초과). GET 은 늘 0. */
  droppedImageCount: number;
}

/** 서명 저장 요청 — html·autoNew·autoReply 는 필수(null 이면 서버가 400). pasted 는 빠지면 서버가 false 로 본다(옛 웹). */
export interface UpdateMailSignatureRequest {
  html: string;
  autoNew: boolean;
  autoReply: boolean;
  /** 「원본 그대로」 모드로 저장한다(WP-1726). 빈 html 이면 서버가 false 로 저장한다. */
  pasted: boolean;
}

/** 서명 이미지의 발송용 사본 — uploadId 는 24시간짜리 작성창 업로드라 attachmentIds·inlineUploads 에 그대로 쓴다. */
export interface SignatureImageStaged {
  imageId: number;
  uploadId: number;
}

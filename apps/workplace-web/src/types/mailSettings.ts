// 메일 사용자 설정(WP-1744) DTO — 백엔드 /api/v1/mail/settings 계약과 1:1. 지금은 작성 방식 기본값 하나다.

/**
 * 새 작성(새 메일·답장·전달·임시보관함 다시 열기)을 열 곳 — 읽기 창(PANE) / 우측 하단(DOCK) / 새 창(WINDOW).
 * 서버에 행이 없으면 DOCK(한 번도 고르지 않은 사람은 지금처럼 우측 하단).
 */
export type MailComposeDefault = 'PANE' | 'DOCK' | 'WINDOW';

/** 메일 사용자 설정 — GET 응답이자 PUT 요청·응답 몸체. */
export interface MailUserSettings {
  composeMode: MailComposeDefault;
}

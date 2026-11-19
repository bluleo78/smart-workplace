// 백엔드 com.workplace.mail.dto 와 1:1 대응. 비밀번호는 요청에만 존재, 응답엔 없음.
export type MailSecurity = 'NONE' | 'STARTTLS' | 'SSL_TLS';

/** 메일 계정 공급자 — IMAP(앱 비밀번호) 또는 M365 Graph(OAuth2) */
export type MailProvider = 'IMAP' | 'M365_GRAPH';

/** 새 메일 알림 범위(WP-1740) — ALL 모든 새 메일 / WORK 업무 메일만(기본) / OFF 끔. */
export type MailNotifyMode = 'ALL' | 'WORK' | 'OFF';

/** 알림 범위의 화면 문구(매뉴얼 12장과 같은 말) — 설정 라디오와 AI 화면 맥락이 함께 쓴다. */
export const MAIL_NOTIFY_MODE_LABEL: Record<MailNotifyMode, string> = {
  ALL: '모든 새 메일',
  WORK: '업무 메일만',
  OFF: '끔',
};

export interface MailAccountResponse {
  id: number;
  /** 계정 공급자 타입 — 백엔드 Task 1/5 에서 추가된 필드 */
  provider: MailProvider;
  emailAddress: string;
  displayName: string | null;
  imapHost: string;
  imapPort: number;
  imapSecurity: MailSecurity;
  imapUsername: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: MailSecurity;
  smtpUsername: string;
  /** AI 비서 기능 활성화 여부 */
  aiEnabled: boolean;
  /** 이 계정의 새 메일 알림 범위(WP-1740) */
  notifyMode: MailNotifyMode;
  /**
   * AI 분류 활성 여부(WP-1674) — 계정 목록 응답에만 있다(등록·수정 응답엔 없음). 안 읽은 수의 classificationActive 와 같은 판정이라
   * 메일함이 안 읽은 수 응답 전에도 첫 목록을 맞는 보기로 부른다(lib/mailView 의 mailClassificationActive).
   */
  classificationActive?: boolean;
  lastTestedAt: string | null;
  lastSyncedAt: string | null; // 마지막 성공 동기화 시각(미동기화면 null)
  createdAt: string;
  updatedAt: string;
}

export interface MailAccountRequest {
  emailAddress: string;
  displayName?: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: MailSecurity;
  imapUsername: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: MailSecurity;
  smtpUsername: string;
  /** AI 비서 기능 활성화 여부 */
  aiEnabled: boolean;
  /** 생성·테스트 시 필수. 수정 시 빈 문자열이면 기존 비밀번호 유지. */
  password?: string;
}

export interface ConnectionTestResult {
  imapOk: boolean;
  imapError: string | null;
  smtpOk: boolean;
  smtpError: string | null;
}

// 백엔드 com.workplace.mail.dto 와 1:1 대응. 비밀번호는 요청에만 존재, 응답엔 없음.
export type MailSecurity = 'NONE' | 'STARTTLS' | 'SSL_TLS';

export interface MailAccountResponse {
  id: number;
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

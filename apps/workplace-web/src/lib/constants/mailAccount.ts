import type { MailSecurity } from '../../types/mailAccount';

export const MAIL_SECURITY_OPTIONS: { value: MailSecurity; label: string }[] = [
  { value: 'SSL_TLS', label: 'SSL/TLS' },
  { value: 'STARTTLS', label: 'STARTTLS' },
  { value: 'NONE', label: '없음' },
];

export interface MailProviderPreset {
  name: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: MailSecurity;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: MailSecurity;
  appPasswordUrl?: string;
}

// '직접 입력' 은 프리셋 없이 사용자가 모두 채운다(드롭다운에서 별도 처리).
export const MAIL_PROVIDER_PRESETS: MailProviderPreset[] = [
  {
    name: 'Gmail',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecurity: 'SSL_TLS',
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    smtpSecurity: 'STARTTLS',
    appPasswordUrl: 'https://myaccount.google.com/apppasswords',
  },
  {
    name: 'Outlook',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecurity: 'SSL_TLS',
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecurity: 'STARTTLS',
    appPasswordUrl: 'https://account.microsoft.com/security',
  },
  {
    name: 'Naver',
    imapHost: 'imap.naver.com',
    imapPort: 993,
    imapSecurity: 'SSL_TLS',
    smtpHost: 'smtp.naver.com',
    smtpPort: 587,
    smtpSecurity: 'STARTTLS',
  },
];

import { z } from 'zod';

const securityEnum = z.enum(['NONE', 'STARTTLS', 'SSL_TLS']);
const port = z.coerce.number().int().min(1, '1~65535').max(65535, '1~65535');

// 생성/수정 공용. password 는 수정 시 빈 값 허용(기존 유지)이라 optional.
export const mailAccountSchema = z.object({
  emailAddress: z.string().min(1, '이메일을 입력하세요').email('유효한 이메일을 입력하세요'),
  displayName: z.string().max(120).optional().or(z.literal('')),
  imapHost: z.string().min(1, 'IMAP 호스트를 입력하세요'),
  imapPort: port,
  imapSecurity: securityEnum,
  imapUsername: z.string().min(1, 'IMAP 사용자명을 입력하세요'),
  smtpHost: z.string().min(1, 'SMTP 호스트를 입력하세요'),
  smtpPort: port,
  smtpSecurity: securityEnum,
  smtpUsername: z.string().min(1, 'SMTP 사용자명을 입력하세요'),
  password: z.string().optional().or(z.literal('')),
  // AI 비서 기능 활성화 여부 — 기본 꺼짐
  aiEnabled: z.boolean().default(false),
});

export type MailAccountFormData = z.infer<typeof mailAccountSchema>;
// z.coerce 로 input(string|number)·output(number) 타입이 달라서 RHF 3-제네릭에 필요
export type MailAccountFormInput = z.input<typeof mailAccountSchema>;

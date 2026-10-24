import { z } from 'zod';

const securityEnum = z.enum(['NONE', 'STARTTLS', 'SSL_TLS']);
// 포트 — 칸을 비우면 NaN, 소수면 정수 아님 오류가 나는데 문구를 지정하지 않아 zod 영어 원문(「Invalid input: expected number, received NaN」)이
// 그대로 보였다(WP-907). 경우마다 한국어로 무엇을 넣어야 하는지 알린다.
const PORT_RANGE_MESSAGE = '포트는 1~65535 사이의 숫자여야 합니다';
const port = z.coerce
  .number({ error: '포트를 입력하세요' })
  .int({ error: '포트는 소수점 없는 정수여야 합니다' })
  .min(1, PORT_RANGE_MESSAGE)
  .max(65535, PORT_RANGE_MESSAGE);

// 생성/수정 공용. password 는 수정 시 빈 값 허용(기존 유지)이라 optional.
export const mailAccountSchema = z.object({
  emailAddress: z.string().min(1, '이메일을 입력하세요').email({ message: '유효한 이메일을 입력하세요' }),
  displayName: z.string().max(120, '표시 이름은 120자 이하여야 합니다').optional().or(z.literal('')),
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

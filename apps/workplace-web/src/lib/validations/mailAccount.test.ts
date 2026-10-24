import { describe, expect, it } from 'vitest';

import { mailAccountSchema } from './mailAccount';

// WP-907 — 포트 칸 오류가 zod 영어 원문 대신 한국어로 무엇을 넣어야 하는지 알린다.
describe('mailAccountSchema 포트 (WP-907)', () => {
  const base = {
    emailAddress: 'me@example.com',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapSecurity: 'SSL_TLS' as const,
    imapUsername: 'me',
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpSecurity: 'STARTTLS' as const,
    smtpUsername: 'me',
  };
  const imapPortMessage = (imapPort: unknown) =>
    mailAccountSchema.safeParse({ ...base, imapPort }).error?.issues.find((i) => i.path[0] === 'imapPort')?.message;

  it('빈 칸(NaN)이면 「포트를 입력하세요」', () => {
    expect(imapPortMessage(Number.NaN)).toBe('포트를 입력하세요');
  });
  it('소수면 정수 안내', () => {
    expect(imapPortMessage(993.5)).toBe('포트는 소수점 없는 정수여야 합니다');
  });
  it('범위 밖이면 범위 안내', () => {
    expect(imapPortMessage(0)).toBe('포트는 1~65535 사이의 숫자여야 합니다');
    expect(imapPortMessage(65536)).toBe('포트는 1~65535 사이의 숫자여야 합니다');
  });
  it('범위 안 정수는 통과', () => {
    expect(mailAccountSchema.safeParse(base).success).toBe(true);
  });
});

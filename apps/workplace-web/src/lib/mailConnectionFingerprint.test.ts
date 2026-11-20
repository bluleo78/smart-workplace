import { describe, expect, test } from 'vitest';

import type { MailAccountFormInput } from '@/lib/validations/mailAccount';

import { MAIL_CONNECTION_FIELDS, mailConnectionFingerprint } from './mailConnectionFingerprint';

// 모든 칸을 채운 기준 값 — 칸 하나씩 바꿔 가며 지문 변화를 본다.
const base: MailAccountFormInput = {
  displayName: '내 메일',
  emailAddress: 'me@example.com',
  imapHost: 'imap.example.com',
  imapPort: 993,
  imapSecurity: 'SSL_TLS',
  imapUsername: 'me',
  smtpHost: 'smtp.example.com',
  smtpPort: 465,
  smtpSecurity: 'SSL_TLS',
  smtpUsername: 'me',
  password: 'secret',
  aiEnabled: false,
};

/** 다이얼로그처럼 연결 칸 목록 순서의 값 배열로 지문을 만든다. */
const fp = (values: Partial<MailAccountFormInput>) =>
  mailConnectionFingerprint(MAIL_CONNECTION_FIELDS.map((field) => values[field]));

describe('mailConnectionFingerprint (WP-1790)', () => {
  test('표시 이름·AI 토글은 지문에 영향이 없다', () => {
    expect(fp(base)).toBe(fp({ ...base, displayName: '다른 이름', aiEnabled: true }));
  });

  test.each(MAIL_CONNECTION_FIELDS)('연결 칸 %s 을 바꾸면 지문이 달라진다', (field) => {
    // 지문은 값을 글자로 맞춰 비교하므로 칸 종류와 상관없이 다른 값 하나면 충분하다
    expect(fp({ ...base, [field]: 'changed' })).not.toBe(fp(base));
  });

  test('비운 포트칸(NaN)은 늘 같은 지문이고 숫자 포트와는 다르다', () => {
    expect(fp({ ...base, imapPort: Number.NaN })).toBe(fp({ ...base, imapPort: Number.NaN }));
    expect(fp({ ...base, imapPort: Number.NaN })).not.toBe(fp(base));
  });

  test('없는 칸은 빈 문자열과 같은 값으로 본다', () => {
    expect(fp({})).toBe(fp(Object.fromEntries(MAIL_CONNECTION_FIELDS.map((f) => [f, '']))));
  });
});

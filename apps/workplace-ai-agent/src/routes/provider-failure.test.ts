// 비서 라우트 제공자 장애 응답 공통부 테스트 (WP-2108).
import { describe, expect, it } from 'vitest';

import { chatErrorData, providerFailureBody } from './provider-failure.js';

const now = new Date('2026-11-25T12:00:00Z');
const limitErr = new Error("Claude Code returned an error result: You've hit your limit · resets 3pm (UTC)");
const limitErrNoReset = new Error("Claude Code returned an error result: You've hit your limit");

describe('providerFailureBody', () => {
  it('한도 → reason·resetsAt', () => {
    expect(providerFailureBody('mail-x', limitErr, now)).toEqual({
      error: 'mail-x_unavailable',
      reason: 'PROVIDER_LIMIT',
      resetsAt: '2026-11-25T15:00:00.000Z',
    });
  });
  it('인증 오류 → resetsAt 키 없음', () => {
    const body = providerFailureBody('mail-x', new Error('Claude Code returned an error result: invalid api key'), now);
    expect(body).toEqual({ error: 'mail-x_unavailable', reason: 'PROVIDER_AUTH' });
    expect(body).not.toHaveProperty('resetsAt');
  });
  it('일반 오류 → null', () => {
    expect(providerFailureBody('mail-x', new Error('boom'), now)).toBeNull();
  });
});

describe('chatErrorData', () => {
  it('재설정 시각을 못 읽는 한도 → resetsAt 키 없음', () => {
    const d = chatErrorData(limitErrNoReset);
    expect(d).toEqual({ message: 'chat_failed', reason: 'PROVIDER_LIMIT' });
    expect(d).not.toHaveProperty('resetsAt');
  });
  it('한도 + 시각', () => {
    expect(chatErrorData(limitErr, now)).toEqual({ message: 'chat_failed', reason: 'PROVIDER_LIMIT', resetsAt: '2026-11-25T15:00:00.000Z' });
  });
  it('일반 오류 → message 만', () => {
    expect(chatErrorData(new Error('boom'))).toEqual({ message: 'chat_failed' });
  });
});

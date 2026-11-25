/**
 * 비서 라우트의 제공자 장애 응답 공통부 (WP-2108).
 *
 * 왜: 사용 한도 소진을 API 가 알아 비서 작업을 재설정 시각까지 미루려면, 모든 경로가 같은 계약
 * `503 {error, reason:'PROVIDER_LIMIT', resetsAt?}` 로 알려야 한다. resetsAt 은 못 읽으면 키를 생략한다.
 */
import type { Response } from 'express';

import { classifyProviderError, parseResetsAt, type ProviderErrorReason } from '../agent/provider-error.js';

/** 제공자 장애 503 본문. 장애가 아니면 null. 한도면 읽을 수 있을 때만 resetsAt 을 싣는다. */
export function providerFailureBody(
  tag: string,
  e: unknown,
  now?: Date,
): { error: string; reason: ProviderErrorReason; resetsAt?: string } | null {
  const reason = classifyProviderError(e);
  if (!reason) return null;
  const body: { error: string; reason: ProviderErrorReason; resetsAt?: string } = { error: `${tag}_unavailable`, reason };
  if (reason === 'PROVIDER_LIMIT') {
    const resetsAt = parseResetsAt(e, now);
    if (resetsAt) body.resetsAt = resetsAt;
  }
  return body;
}

/** 한도 실패일 때만 503 을 쓰고 true. 다른 장애는 false 로 돌려 호출 측이 지금처럼 502 로 처리한다. */
export function sendIfProviderLimit(res: Response, tag: string, e: unknown): boolean {
  if (classifyProviderError(e) !== 'PROVIDER_LIMIT') return false;
  const body = providerFailureBody(tag, e);
  if (!body) return false;
  console.warn(`[${tag}] 사용 한도 소진:`, e instanceof Error ? e.message : String(e));
  res.status(503).json(body);
  return true;
}

/** 채팅 SSE error 이벤트 data — 한도면 reason·resetsAt 을 함께 보낸다(아니면 지금처럼 message 만). */
export function chatErrorData(
  e: unknown,
  now?: Date,
): { message: 'chat_failed'; reason?: 'PROVIDER_LIMIT'; resetsAt?: string } {
  const data: { message: 'chat_failed'; reason?: 'PROVIDER_LIMIT'; resetsAt?: string } = { message: 'chat_failed' };
  if (classifyProviderError(e) === 'PROVIDER_LIMIT') {
    data.reason = 'PROVIDER_LIMIT';
    const resetsAt = parseResetsAt(e, now);
    if (resetsAt) data.resetsAt = resetsAt;
  }
  return data;
}

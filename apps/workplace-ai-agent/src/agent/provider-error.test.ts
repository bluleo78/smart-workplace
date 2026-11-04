/**
 * classifyProviderError 판정 표 테스트 (WP-1347).
 * 제공자 장애(한도·인증·속도·과부하)만 가려내고, 그 밖의 오류는 null 이어야 한다.
 */
import { describe, expect, it } from 'vitest';
import { classifyProviderError, ModelOutputError } from './provider-error.js';

/** opencode 오류 객체를 cause 로 가진 Error 를 만든다. */
const withCause = (cause: unknown) =>
  Object.assign(new Error('x opencode session.error'), { cause });

describe('classifyProviderError', () => {
  it.each([
    [
      "org monthly spend limit",
      new Error("Claude Code returned an error result: You've hit your org's monthly spend limit"),
      'PROVIDER_LIMIT',
    ],
    [
      '429 + spend limit 문구 우선',
      new Error(
        'Claude Code returned an error result: API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}} spend limit reached',
      ),
      'PROVIDER_LIMIT',
    ],
    [
      'credit balance',
      new Error('Claude Code returned an error result: Credit balance is too low'),
      'PROVIDER_LIMIT',
    ],
    ['exceeded your quota', new Error('API Error: 429 You exceeded your quota'), 'PROVIDER_LIMIT'],
    ['quota 단독은 장애 아님(건별 실패 오판 방지)', new Error('mailbox quota note in body'), null],
    [
      '401 authentication_error',
      new Error(
        'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
      ),
      'PROVIDER_AUTH',
    ],
    [
      'Invalid API key',
      new Error('Claude Code returned an error result: Invalid API key · Please run /login'),
      'PROVIDER_AUTH',
    ],
    ['Request rejected (429)', new Error('API Error: Request rejected (429) · rate limited'), 'PROVIDER_RATE'],
    [
      '529 overloaded',
      new Error('API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'),
      'PROVIDER_OVERLOADED',
    ],
    [
      'opencode ProviderAuthError',
      withCause({ name: 'ProviderAuthError', data: { message: 'bad key' } }),
      'PROVIDER_AUTH',
    ],
    [
      'opencode APIError 529',
      withCause({ name: 'APIError', data: { statusCode: 529, message: 'Overloaded' } }),
      'PROVIDER_OVERLOADED',
    ],
    [
      'opencode APIError 429',
      withCause({ name: 'APIError', data: { statusCode: 429, message: 'x' } }),
      'PROVIDER_RATE',
    ],
  ])('%s', (_label, err, expected) => {
    expect(classifyProviderError(err)).toBe(expected);
  });

  it.each([
    ['Prompt is too long', new Error('Claude Code returned an error result: Prompt is too long')],
    ['max_tokens', new Error('mail-classify-batch result is_error: max_tokens')],
    ['timeout', new Error('mail-classify-batch timeout after 60000ms')],
    ['SyntaxError', new SyntaxError('Unexpected token')],
    ['results 배열 없음', new Error('classify-batch: results 배열 없음')],
    ['string', 'string error'],
    ['undefined', undefined],
    ['400', new Error('API Error: 400 invalid_request_error')],
    ['500', new Error('API Error: 500 internal')],
    // 러너 문구가 없는 임의의 오류는 문구가 겹쳐도 장애가 아니다
    ['러너 문구 없는 overloaded', new Error('tool result: queue overloaded, retry later')],
    ['러너 문구 없는 rate limit', new Error('workplace-api: rate limit on search endpoint')],
    ['러너 문구 없는 spend limit', new Error('budget note: spend limit for team')],
  ])('null: %s', (_label, err) => {
    expect(classifyProviderError(err)).toBeNull();
  });

  it('ModelOutputError 는 본문에 한도·429 문구가 있어도 null', () => {
    const e = new ModelOutputError(
      "분석 JSON 없음: You've hit your org's monthly spend limit. API Error: 429 rate limit overloaded",
    );
    expect(classifyProviderError(e)).toBeNull();
  });

  it('JSON.parse SyntaxError 는 모델 출력에 한도·속도 문구가 있어도 null', () => {
    let err: unknown;
    try {
      JSON.parse('{"a": monthly spend limit rate limit overloaded}');
    } catch (e) {
      err = e;
    }
    expect(classifyProviderError(err)).toBeNull();
  });
});

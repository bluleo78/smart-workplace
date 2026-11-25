/**
 * classifyProviderError 판정 표 테스트 (WP-1347).
 * 제공자 장애(한도·인증·속도·과부하)만 가려내고, 그 밖의 오류는 null 이어야 한다.
 */
import { describe, expect, it } from 'vitest';
import { classifyProviderError, isModelNotFoundError, ModelOutputError, parseResetsAt } from './provider-error.js';

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
    // WP-1363: 제공자 5xx 와 opencode 세션 생성 실패
    [
      '502 Bad Gateway',
      new Error('Claude Code returned an error result: API Error: 502 Bad Gateway'),
      'PROVIDER_ERROR',
    ],
    ['503', new Error('API Error: 503 Service Unavailable'), 'PROVIDER_ERROR'],
    ['504 Gateway Timeout', new Error('result is_error: API Error: 504 Gateway Timeout'), 'PROVIDER_ERROR'],
    ['opencode APIError 503', withCause({ name: 'APIError', data: { statusCode: 503 } }), 'PROVIDER_ERROR'],
    [
      'opencode 세션 생성 실패',
      new Error('opencode session 생성 실패: {"name":"UnknownError"}'),
      'RUNNER_UNAVAILABLE',
    ],
    [
      '세션 생성 실패는 붙은 오류 JSON 의 한도·401 문구보다 우선',
      new Error('opencode session 생성 실패: {"data":{"message":"usage limit API Error: 401"}}'),
      'RUNNER_UNAVAILABLE',
    ],
    [
      '429 exceeded your current quota 는 한도',
      new Error('API Error: 429 You exceeded your current quota, please check your plan'),
      'PROVIDER_LIMIT',
    ],
    ['WP-2108: hit your limit · resets', new Error("Claude Code returned an error result: You've hit your limit · resets 3pm (UTC)"), 'PROVIDER_LIMIT'],
    ['WP-2108: 5-hour limit reached', new Error('Claude Code returned an error result: 5-hour limit reached ∙ resets 3pm'), 'PROVIDER_LIMIT'],
    ['WP-2108: weekly limit reached', new Error('Claude Code returned an error result: weekly limit reached'), 'PROVIDER_LIMIT'],
    ['WP-2108: 429 rate limit reached 는 여전히 속도', new Error('API Error: 429 rate limit reached'), 'PROVIDER_RATE'],
    ['WP-2137: 운영 주간 문구', new Error("Claude Code returned an error result: You've hit your weekly limit · resets 3pm (UTC)"), 'PROVIDER_LIMIT'],
    ['WP-2137: 운영 조직 지출 문구', new Error("Claude Code returned an error result: You've hit your org's monthly spend limit"), 'PROVIDER_LIMIT'],
    ['WP-2137: session limit', new Error("Claude Code returned an error result: You've hit your session limit · resets 5pm (Asia/Seoul)"), 'PROVIDER_LIMIT'],
    ['WP-2137: 5-hour limit', new Error("Claude Code returned an error result: You've hit your 5-hour limit · resets 3pm (UTC)"), 'PROVIDER_LIMIT'],
    ['WP-2137: Opus limit', new Error("Claude Code returned an error result: You've hit your Opus limit · resets 3pm (UTC)"), 'PROVIDER_LIMIT'],
    ['WP-2137: Sonnet limit', new Error("Claude Code returned an error result: You've hit your Sonnet limit · resets 3pm (UTC)"), 'PROVIDER_LIMIT'],
    ['WP-2137: Fable limit', new Error("Claude Code returned an error result: You've hit your Fable limit · resets 3pm (UTC)"), 'PROVIDER_LIMIT'],
    ['WP-2137: usage credit limit', new Error("Claude Code returned an error result: You've hit your usage credit limit · resets 3pm (UTC)"), 'PROVIDER_LIMIT'],
    ['WP-2137: monthly spend limit', new Error("Claude Code returned an error result: You've hit your monthly spend limit · resets 3pm (UTC)"), 'PROVIDER_LIMIT'],
    ['WP-2137: fast limit', new Error("Claude Code returned an error result: You've hit your fast limit · resets 3pm (UTC)"), 'PROVIDER_LIMIT'],
    ['WP-2137: 굽은 따옴표', new Error("Claude Code returned an error result: You’ve hit your weekly limit · resets 3pm (UTC)"), 'PROVIDER_LIMIT'],
    ['WP-2137: rate limit 은 속도', new Error("Claude Code returned an error result: You've hit your rate limit"), 'PROVIDER_RATE'],
    ['WP-2137: channel 월 지출 한도', new Error("Claude Code returned an error result: You've hit your channel's monthly spend limit."), 'PROVIDER_LIMIT'],
    ['WP-2137: 아포스트로피 없는 weekly limit', new Error('Claude Code returned an error result: Youve hit your weekly limit'), 'PROVIDER_LIMIT'],
    ['WP-2137: API rate limit 은 속도', new Error("Claude Code returned an error result: You've hit your API rate limit"), 'PROVIDER_RATE'],
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
    // WP-1363: 4xx(속도·인증 외)와 러너 문구 없는 5xx 는 장애가 아니다
    // WP-1363(AI 팀장 결정): 500 은 건별 원인과 장애를 가를 수 없어 건별 실패(502)로 둔다
    [
      '500 result is_error',
      new Error('result is_error: API Error: 500 {"type":"error","error":{"type":"api_error"}}'),
    ],
    ['API Error: 500 internal', new Error('API Error: 500 internal')],
    ['opencode APIError 500', withCause({ name: 'APIError', data: { statusCode: 500 } })],
    ['러너 문구 없는 500', new Error('workplace-api: request failed with status 500')],
    ['러너 문구 없는 502', new Error('tool result: upstream returned 502')],
    ['404', new Error('API Error: 404 not_found_error')],
    ['413', new Error('API Error: 413 request_too_large')],
    [
      'ModelOutputError 는 5xx·세션 생성 실패 문구가 있어도 null',
      new ModelOutputError('분석 JSON 없음: API Error: 500 opencode session 생성 실패'),
    ],
    // 러너 문구가 없는 임의의 오류는 문구가 겹쳐도 장애가 아니다
    ['러너 문구 없는 overloaded', new Error('tool result: queue overloaded, retry later')],
    ['러너 문구 없는 rate limit', new Error('workplace-api: rate limit on search endpoint')],
    ['러너 문구 없는 spend limit', new Error('budget note: spend limit for team')],
    ['WP-2137: 러너 표지 없는 weekly limit', new Error("tool result: You've hit your weekly limit")],
    ['WP-2137: 문맥 창 한도는 구독 한도 아님', new Error("Claude Code returned an error result: You've hit your context window limit")],
    ['WP-2137: 최대 출력 토큰 한도는 구독 한도 아님', new Error("Claude Code returned an error result: You've hit your max output token limit")],
    ['WP-2137: max_tokens 한도는 구독 한도 아님', new Error("Claude Code returned an error result: You've hit your max_tokens limit")],
    ['WP-2137: max-output-tokens 한도는 구독 한도 아님', new Error("Claude Code returned an error result: You've hit your max-output-tokens limit")],
    ['WP-2137: prompt length 한도는 구독 한도 아님', new Error("Claude Code returned an error result: You've hit your prompt length limit")],
    ['WP-2137: file size 한도는 구독 한도 아님', new Error("Claude Code returned an error result: You've hit your file size limit")],
    ['WP-2137: 낱말 4개 넘는 우연한 문장', new Error("Claude Code returned an error result: You've hit your head on the door and the limit")],
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

describe('isModelNotFoundError', () => {
  it('러너 표지가 있는 모델 없음 문구는 참', () => {
    expect(isModelNotFoundError(new Error('API Error: 404 model genia/x does not exist or is disabled'))).toBe(true);
  });

  it('opencode 404 오류 객체는 참', () => {
    const cause = { name: 'APIError', data: { statusCode: 404, message: 'channel x does not exist or is disabled' } };
    expect(isModelNotFoundError(Object.assign(new Error('opencode failed'), { cause }))).toBe(true);
  });

  it('러너 표지 없는 일반 문구는 거짓', () => {
    expect(isModelNotFoundError(new Error('channel X does not exist or is disabled'))).toBe(false);
  });

  it('모델 출력 파싱 오류는 거짓', () => {
    expect(isModelNotFoundError(new ModelOutputError('API Error: 404 does not exist or is disabled'))).toBe(false);
  });
});

describe('parseResetsAt (WP-2108)', () => {
  const now = new Date('2026-11-25T12:00:00Z');
  const e = (m: string) => new Error(m);
  it.each([
    ['epoch 초', 'Claude AI usage limit reached|1795618800', now, '2026-11-25T15:00:00.000Z'],
    ['3pm (UTC)', "Claude Code returned an error result: You've hit your limit · resets 3pm (UTC)", now, '2026-11-25T15:00:00.000Z'],
    ['지난 시각은 다음 날', '… resets 3pm (UTC)', new Date('2026-11-25T16:00:00Z'), '2026-11-26T15:00:00.000Z'],
    ['IANA 시간대', '… resets 3:30pm (Asia/Seoul)', new Date('2026-11-25T03:00:00Z'), '2026-11-25T06:30:00.000Z'],
    ['시간대 없으면 UTC', '… resets 3pm', now, '2026-11-25T15:00:00.000Z'],
    ['ISO', '… resets at 2026-11-25T15:00Z', now, '2026-11-25T15:00:00.000Z'],
    ['지난 ISO', '… resets at 2026-11-25T11:00Z', now, null],
    ['8일 초과', '… resets at 2026-12-05T11:00Z', now, null],
    ['모르는 시간대', '… resets 3pm (Mars/Base)', now, null],
    ['시각 없음', 'usage limit', now, null],
    // 주간 한도 — 날짜가 적힌 문구
    ['WP-2137: 운영 주간 문구(KST 아침, 오늘 15:00Z 지남 → 다음 날)', "Claude Code returned an error result: You've hit your weekly limit · resets 3pm (UTC)", new Date('2026-11-25T21:55:00Z'), '2026-11-26T15:00:00.000Z'],
    ['WP-2137: 날짜+시각 Asia/Seoul', "Claude Code returned an error result: You've hit your weekly limit · resets Nov 28, 3pm (Asia/Seoul)", now, '2026-11-28T06:00:00.000Z'],
    ['날짜+시각 (UTC)', '… resets Nov 28 at 3pm (UTC)', now, '2026-11-28T15:00:00.000Z'],
    ['날짜+시각 시간대', '… resets Nov 28 at 3pm (Asia/Seoul)', now, '2026-11-28T06:00:00.000Z'],
    ['날짜 쉼표 표기·시간대 없음', '… resets Nov 28, 3:30pm', now, '2026-11-28T15:30:00.000Z'],
    ['연말→연초 넘김', '… resets Jan 2 at 3pm (UTC)', new Date('2026-12-30T12:00:00Z'), '2027-01-02T15:00:00.000Z'],
    ['지난 날짜는 다음 해로 가 8일 초과 → null', '… resets Nov 20 at 3pm (UTC)', now, null],
    // 없는 날짜는 다음 달로 굴리지 않고 null
    ['없는 날짜 2/30', '… resets Feb 30 at 3pm (UTC)', new Date('2026-02-25T12:00:00Z'), null],
    ['없는 날짜 4/31', '… resets Apr 31 at 3pm (UTC)', new Date('2026-04-28T12:00:00Z'), null],
    ['평년 2/29', '… resets Feb 29 at 3pm (UTC)', new Date('2026-02-25T12:00:00Z'), null],
    ['윤년 2/29 는 유효', '… resets Feb 29 at 3pm (UTC)', new Date('2028-02-26T12:00:00Z'), '2028-02-29T15:00:00.000Z'],
    ['모르는 월 이름', '… resets Foo 28 at 3pm (UTC)', now, null],
    // DST — 오프셋은 "지금"이 아니라 재설정 시각에서 구한다
    [
      'DST 종료 넘김(날짜)',
      '… resets Nov 2 at 3pm (America/New_York)',
      new Date('2026-10-30T12:00:00Z'),
      '2026-11-02T20:00:00.000Z',
    ],
    [
      'DST 종료 넘김(시각만, 내일)',
      '… resets 3pm (America/New_York)',
      new Date('2026-10-31T20:00:00Z'),
      '2026-11-01T20:00:00.000Z',
    ],
    [
      'DST 시작 넘김(시각만, 내일)',
      '… resets 3pm (America/New_York)',
      new Date('2026-03-07T20:00:00Z'),
      '2026-03-08T19:00:00.000Z',
    ],
  ])('%s', (_l, msg, n, expected) => {
    expect(parseResetsAt(e(msg), n)).toBe(expected);
  });
});

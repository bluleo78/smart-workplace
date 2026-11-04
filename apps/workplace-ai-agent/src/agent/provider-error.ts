/**
 * 러너 오류에서 LLM 제공자 장애(한도·인증·속도·과부하)를 가려낸다 (WP-1347).
 *
 * 왜: 제공자 장애를 일반 실패(502)로 돌려주면 API 가 메일을 '분류 실패'로 표시한다.
 * 장애로 판정되면 라우트가 503 을 내려 API 가 메일을 건드리지 않게 한다.
 * 과매칭이 가장 큰 위험이라 알려진 신호만 매핑하고, 모르는 오류는 null 이다.
 */

export type ProviderErrorReason =
  | 'PROVIDER_LIMIT'
  | 'PROVIDER_AUTH'
  | 'PROVIDER_RATE'
  | 'PROVIDER_OVERLOADED';

/**
 * 한도 소진 문구(소문자 비교). 상태 코드(429 등)보다 우선한다.
 * 'quota' 단독은 메일 본문·사서함 용량 등 건별 실패까지 장애로 오판해 좁혔다(WP-1347).
 */
const LIMIT_PHRASES = ['spend limit', 'usage limit', 'credit balance', 'monthly limit', 'exceeded your quota', 'quota exceeded'];
const AUTH_PHRASES = ['invalid api key', 'authentication_error', 'oauth token'];
const RATE_PHRASES = ['rate limit', 'rate_limit_error'];
const OVERLOADED_PHRASES = ['overloaded'];

/** SDK 오류 문구의 HTTP 상태 코드(`API Error: 429` / `API Error: Request rejected (429)`). */
const API_ERROR_CODE = /API Error: (?:Request rejected \()?(\d{3})\b/;

/** 상태 코드 → 사유. 401/403 인증, 429 속도, 529 과부하만 장애로 본다. */
function reasonFromStatus(code: number): ProviderErrorReason | null {
  if (code === 401 || code === 403) return 'PROVIDER_AUTH';
  if (code === 429) return 'PROVIDER_RATE';
  if (code === 529) return 'PROVIDER_OVERLOADED';
  return null;
}

/** 값을 메시지 문자열로 — Error·문자열·{message}/{data:{message}} 객체를 다룬다. */
function messageOf(v: unknown): string {
  if (v instanceof Error) return v.message;
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const o = v as { message?: unknown; data?: { message?: unknown } };
    if (typeof o.message === 'string') return o.message;
    if (typeof o.data?.message === 'string') return o.data.message;
  }
  return '';
}

/** opencode 오류 객체 `{name, data?:{statusCode?}}` 판정. */
function reasonFromOpencode(v: unknown): ProviderErrorReason | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { name?: unknown; data?: { statusCode?: unknown } };
  if (o.name === 'ProviderAuthError') return 'PROVIDER_AUTH';
  if (o.name === 'APIError' && typeof o.data?.statusCode === 'number') {
    return reasonFromStatus(o.data.statusCode);
  }
  return null;
}

/**
 * 러너가 제공자 응답을 담아 던지는 오류임을 보여 주는 문구(소문자). Claude SDK·CLI 의 결과 오류, sdk-runner 의 결과 오류,
 * opencode 의 session.error, 제공자 HTTP 오류 줄. 이 중 하나도 없으면 제공자 장애로 보지 않는다(WP-1347).
 */
const RUNNER_MARKERS = [
  'claude code returned an error result',
  'result is_error',
  'opencode session.error',
  'api error:',
];

/**
 * 모델 출력 파싱 실패 오류 (WP-1347).
 * 메시지에 모델 출력 일부가 들어가 "spend limit"·"API Error: 429" 같은 문구를 우연히 담을 수 있다.
 * 이를 제공자 장애로 오판하면 건별 실패가 503 으로 바뀌어 분석 라운드가 멈추므로, 분류기가 항상 null 로 본다.
 */
export class ModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelOutputError';
  }
}

/** 러너 오류를 제공자 장애 사유로 분류한다. 장애가 아니면 null. */
export function classifyProviderError(e: unknown): ProviderErrorReason | null {
  // 모델 출력 파싱 실패는 문구·상태 코드 검사 전에 제외한다(본문 텍스트 오탐 방지).
  // JSON.parse 의 SyntaxError 도 메시지에 모델 출력 일부("... is not valid JSON")를 담으므로 같이 뺀다.
  if (e instanceof ModelOutputError || e instanceof SyntaxError) return null;
  const cause = e instanceof Error ? (e as { cause?: unknown }).cause : undefined;
  const raw = `${messageOf(e)}\n${messageOf(cause)}`;
  const text = raw.toLowerCase();
  // 문구 목록 중 하나라도 들어 있는지
  const has = (list: readonly string[]) => list.some((p) => text.includes(p));

  // (0) opencode 오류 객체가 아니면, 러너가 낸 오류 문구(RUNNER_MARKERS)가 있을 때만 문구·코드를 본다.
  //     임의의 오류(도구·클라이언트·파서)가 우연히 "overloaded"·"rate limit" 을 담아도 장애로 보지 않게 하려는 것이다(WP-1347).
  const fromObj = reasonFromOpencode(cause) ?? reasonFromOpencode(e);
  if (!fromObj && !has(RUNNER_MARKERS)) return null;

  // (1) 한도 문구 우선 — 한도 소진은 429 로 오기도 한다.
  if (has(LIMIT_PHRASES)) return 'PROVIDER_LIMIT';

  // (2) opencode 오류 객체(cause 우선, 없으면 자기 자신).
  if (fromObj) return fromObj;

  // (3) 메시지의 HTTP 상태 코드.
  const m = API_ERROR_CODE.exec(raw);
  if (m) {
    const r = reasonFromStatus(Number(m[1]));
    if (r) return r;
  }

  // (4) 문구 폴백.
  if (has(AUTH_PHRASES)) return 'PROVIDER_AUTH';
  if (has(RATE_PHRASES)) return 'PROVIDER_RATE';
  if (has(OVERLOADED_PHRASES)) return 'PROVIDER_OVERLOADED';
  return null;
}

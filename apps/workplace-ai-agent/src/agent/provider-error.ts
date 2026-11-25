/**
 * 러너 오류에서 LLM 제공자 장애(한도·인증·속도·과부하, 5xx·opencode 세션 생성 실패)를 가려낸다 (WP-1347, WP-1363).
 *
 * 왜: 제공자 장애를 일반 실패(502)로 돌려주면 API 가 메일을 '분류 실패'로 표시한다.
 * 장애로 판정되면 라우트가 503 을 내려 API 가 메일을 건드리지 않게 한다.
 * 과매칭이 가장 큰 위험이라 알려진 신호만 매핑하고, 모르는 오류는 null 이다.
 */

export type ProviderErrorReason =
  | 'PROVIDER_LIMIT'
  | 'PROVIDER_AUTH'
  | 'PROVIDER_RATE'
  | 'PROVIDER_OVERLOADED'
  // WP-1363: 제공자 게이트웨이·일시 불가(502·503·504)
  | 'PROVIDER_ERROR'
  // WP-1363: opencode 세션 생성 실패(러너 자체를 쓸 수 없음)
  | 'RUNNER_UNAVAILABLE';

/** opencode-runner openSession 이 던지는 세션 생성 실패 메시지 앞머리. 표식·판정이 같은 문구를 쓰게 상수로 둔다(WP-1363). */
export const OPENCODE_SESSION_CREATE_FAILED = 'opencode session 생성 실패';
/** 위 문구의 소문자 — 판정은 소문자로 비교한다. */
const SESSION_CREATE_FAILED_LC = OPENCODE_SESSION_CREATE_FAILED.toLowerCase();

/**
 * 한도 소진 문구(소문자 비교). 상태 코드(429 등)보다 우선한다.
 * 'quota' 단독은 메일 본문·사서함 용량 등 건별 실패까지 장애로 오판해 좁혔다(WP-1347).
 */
const LIMIT_PHRASES = ['spend limit', 'usage limit', 'credit balance', 'monthly limit', 'exceeded your quota', 'exceeded your current quota', 'quota exceeded',
  // WP-2108: Claude 구독 한도 문구. 'rate limit reached'(속도)와 갈리게 단독 'limit reached' 는 넣지 않는다.
  'hour limit reached', 'weekly limit reached'];
/**
 * Claude Code 구독 한도 문구 꼴(WP-2137): `You've hit your <이름> limit` (소문자, 따옴표 ' ’ 둘 다).
 * 이름은 Claude Code CLI 의 한도 이름 표(정규식 안의 목록)만 받는다 — 새 이름이 생기면 거기에 더한다.
 * 왜: 열린 낱말 패턴은 max_tokens·prompt length·file size 같은 요청 크기 한도까지 구독 한도로 오판해 API 가 비서를 멈추게 한다.
 * 과매칭이 가장 큰 위험이라 표만 받는다. 속도 제한(`rate limit`)은 표에 없어 PROVIDER_RATE 로 간다. 러너 표지 게이트는 앞에서 거른다.
 */
const CLAUDE_LIMIT_PATTERN = /you['’]?ve hit your (?:(?:org|channel)['’]s )?(?:(?:5-hour|weekly|session|opus|sonnet|fable|usage credit|monthly spend|fast) )?limit\b/;
const AUTH_PHRASES = ['invalid api key', 'authentication_error', 'oauth token'];
const RATE_PHRASES = ['rate limit', 'rate_limit_error'];
const OVERLOADED_PHRASES = ['overloaded'];

/** SDK 오류 문구의 HTTP 상태 코드(`API Error: 429` / `API Error: Request rejected (429)`). */
const API_ERROR_CODE = /API Error: (?:Request rejected \()?(\d{3})\b/;

/**
 * 상태 코드 → 사유. 401/403 인증, 429 속도, 529 과부하, 502·503·504 는 제공자 오류(WP-1363)로 본다.
 * 500 은 건별 원인(컨텍스트 초과·필터 등)과 장애가 섞여 가를 수 없어 건별 실패(null)로 둔다 — 장애로 보면 늘 500 이 나는 메일이
 * 분류 일괄을 회차마다 멈춰 세운다. 건별 실패는 1h·6h·24h 재시도로 약 31시간까지 흡수된다(WP-1363, AI 팀장 결정).
 */
function reasonFromStatus(code: number): ProviderErrorReason | null {
  if (code === 401 || code === 403) return 'PROVIDER_AUTH';
  if (code === 429) return 'PROVIDER_RATE';
  if (code === 529) return 'PROVIDER_OVERLOADED';
  if (code === 502 || code === 503 || code === 504) return 'PROVIDER_ERROR';
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
 * opencode 의 session.error, 제공자 HTTP 오류 줄, opencode 세션 생성 실패(WP-1363). 이 중 하나도 없으면 제공자 장애로 보지 않는다(WP-1347).
 */
const RUNNER_MARKERS = [
  'claude code returned an error result',
  'result is_error',
  'opencode session.error',
  'api error:',
  SESSION_CREATE_FAILED_LC,
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

  // (0.5) opencode 세션 생성 실패 — 러너를 쓸 수 없는 장애. 메시지에 붙은 오류 JSON 의 문구·코드로 사유가 바뀌지 않게 먼저 본다(WP-1363).
  if (text.includes(SESSION_CREATE_FAILED_LC)) return 'RUNNER_UNAVAILABLE';

  // (1) 한도 문구 우선 — 한도 소진은 429 로 오기도 한다.
  if (has(LIMIT_PHRASES) || CLAUDE_LIMIT_PATTERN.test(text)) return 'PROVIDER_LIMIT';

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

/** 모델이 없거나 비활성화됐다는 문구(소문자 비교) — 게이트웨이가 404 로 돌려준다(WP-2106). */
const MODEL_NOT_FOUND_PHRASE = 'does not exist or is disabled';

/**
 * 오류가 "모델 없음/비활성"인지 — 러너가 낸 오류(RUNNER_MARKERS 문구 또는 opencode 404 오류 객체)이고 문구가 맞을 때만 참이다.
 * 왜: 러너와 무관한 임의 오류(도구·클라이언트·파서)가 우연히 같은 문구를 담아도 모델 없음으로 보지 않게 한다(classifyProviderError 와 같은 게이트).
 * 모델 출력 파싱 오류는 제외한다.
 */
export function isModelNotFoundError(e: unknown): boolean {
  if (e instanceof ModelOutputError || e instanceof SyntaxError) return false;
  const cause = e instanceof Error ? (e as { cause?: unknown }).cause : undefined;
  const text = `${messageOf(e)}\n${messageOf(cause)}`.toLowerCase();
  if (!text.includes(MODEL_NOT_FOUND_PHRASE)) return false;
  // opencode 오류 객체: APIError + statusCode 404 면 러너 오류로 본다.
  const isOpencode404 = (v: unknown): boolean => {
    if (!v || typeof v !== 'object') return false;
    const o = v as { name?: unknown; data?: { statusCode?: unknown } };
    return o.name === 'APIError' && o.data?.statusCode === 404;
  };
  if (isOpencode404(cause) || isOpencode404(e)) return true;
  return RUNNER_MARKERS.some((p) => text.includes(p));
}

/** 재설정 시각으로 인정하는 최대 앞날(8일) — 이보다 먼 값은 오파싱으로 보고 버린다. */
const MAX_RESET_AHEAD_MS = 8 * 24 * 60 * 60 * 1000;

/** IANA 시간대 tz 의 시각 t(UTC ms) 에서의 UTC 오프셋(ms). 모르는 시간대면 RangeError. */
function tzOffsetMs(tz: string, t: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(t));
  const g = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return asUtc - Math.floor(t / 1000) * 1000;
}

/** 월 이름 앞 3글자 → 0 기반 월. */
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * tz 의 현지 시각(y-m-d h:min)을 UTC ms 로 바꾼다. 오프셋은 "지금"이 아니라 그 후보 시각에서 구한다(DST 경계 보정):
 * now 의 오프셋으로 1차 추정 → 추정 시각의 오프셋으로 재계산 → 한 번 더 수렴시킨다.
 */
function localToUtc(tz: string, y: number, m: number, d: number, h: number, min: number, nowMs: number): number {
  const wall = Date.UTC(y, m, d, h, min);
  let t = wall - tzOffsetMs(tz, nowMs);
  t = wall - tzOffsetMs(tz, t);
  t = wall - tzOffsetMs(tz, t);
  return t;
}

/**
 * 오류 문구에서 한도 재설정 시각을 읽어 ISO-8601(UTC) 로 돌려준다. 못 읽거나 과거·8일 초과면 null (WP-2108).
 * 왜: API 가 이 시각까지 비서 작업을 미뤄 두었다가 다시 돌린다. 순서: ① `usage limit reached|<epoch 초>` ② `resets [at] <ISO>` ③ `resets [at] 3pm [(tz)]`.
 */
export function parseResetsAt(e: unknown, now: Date = new Date()): string | null {
  const cause = e instanceof Error ? (e as { cause?: unknown }).cause : undefined;
  const raw = `${messageOf(e)}\n${messageOf(cause)}`;
  const nowMs = now.getTime();
  let at: number | null = null;

  // ③ `resets [at] [Nov 28 [at]] 3pm [(tz)]` — 날짜가 있으면 주간 한도(며칠 뒤), 없으면 오늘/내일 시각.
  const clock =
    /resets(?: at)? (?:([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,?(?: at)? )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?: \(([^)]+)\))?/i.exec(raw);
  const epoch = /usage limit reached\|(\d{10})\b/i.exec(raw);
  const iso = /resets(?: at)? (\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|[+-]\d{2}:?\d{2}))/i.exec(raw);
  if (epoch) {
    at = Number(epoch[1]) * 1000;
  } else if (iso) {
    const t = Date.parse(iso[1]);
    at = Number.isNaN(t) ? null : t;
  } else if (clock) {
    const h12 = Number(clock[3]);
    const min = clock[4] ? Number(clock[4]) : 0;
    if (h12 < 1 || h12 > 12 || min > 59) return null;
    const hour = (h12 % 12) + (clock[5].toLowerCase() === 'pm' ? 12 : 0);
    const tz = clock[6]?.trim() || 'UTC';
    try {
      // 그 지역의 "오늘" 날짜(now 기준)를 구한다.
      const nowLocal = new Date(nowMs + tzOffsetMs(tz, nowMs));
      const y = nowLocal.getUTCFullYear();
      const m = nowLocal.getUTCMonth();
      const d = nowLocal.getUTCDate();
      if (clock[1]) {
        // 날짜가 적힌 경우 — 월 이름(앞 3글자)과 일을 읽고, 이미 지난 날짜면 다음 해로 넘긴다(12월→1월 경계).
        const mon = MONTHS.indexOf(clock[1].slice(0, 3).toLowerCase());
        const day = Number(clock[2]);
        if (mon < 0 || day < 1 || day > 31) return null;
        // 올해 날짜가 이미 지났으면 다음 해로 넘긴다. 없는 날짜(2/30·4/31·평년 2/29)는 Date.UTC 가 다음 달로 굴려 버리므로 거른다.
        let year = y;
        let cand = localToUtc(tz, year, mon, day, hour, min, nowMs);
        if (cand <= nowMs) {
          year = y + 1;
          cand = localToUtc(tz, year, mon, day, hour, min, nowMs);
        }
        if (day > new Date(Date.UTC(year, mon + 1, 0)).getUTCDate()) return null;
        at = cand;
      } else {
        // 시각만 — 오늘 그 시각이 지났으면 내일(달력상 하루 뒤라 DST 날에도 시각이 맞는다).
        let cand = localToUtc(tz, y, m, d, hour, min, nowMs);
        if (cand <= nowMs) cand = localToUtc(tz, y, m, d + 1, hour, min, nowMs);
        at = cand;
      }
    } catch {
      return null;
    }
  }
  if (at === null || at <= nowMs || at > nowMs + MAX_RESET_AHEAD_MS) return null;
  return new Date(at).toISOString();
}

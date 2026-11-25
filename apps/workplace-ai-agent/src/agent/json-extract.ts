// 모델 응답에서 첫 JSON 배열·객체를 꺼낸다 — 머리말·코드펜스·문구 속 "[긴급]" 같은 괄호에 견딘다.
// WP-139 run-suggestions 의 배열 추출을 옮겨 객체에도 쓰게 했다(WP-385 메모리 정리, WP-386 공용 추출).

/** 파싱 대상 응답 상한 — 괄호 탐색이 최악 O(n²) 라 비정상적으로 긴 출력은 앞부분만 본다. */
export const PARSE_MAX_CHARS = 8_000;

/** 첫 JSON 배열 — 없거나 깨졌으면 null. */
export function firstJsonArray(text: string, maxChars: number = PARSE_MAX_CHARS): unknown[] | null {
  return firstJson(text, '[', ']', maxChars, (v): v is unknown[] => Array.isArray(v));
}

/** 첫 JSON 객체(배열 아님) — 없거나 깨졌으면 null. */
export function firstJsonObject(text: string, maxChars: number = PARSE_MAX_CHARS): Record<string, unknown> | null {
  return firstJson(
    text,
    '{',
    '}',
    maxChars,
    (v): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v),
  );
}

/**
 * bracketCandidates 의 후보(각 여는 괄호~짝 닫는 괄호)를 앞에서부터 한 번씩 JSON.parse 해 처음 accept 되는 값을 돌려준다.
 * 파싱이 안 되거나 원하는 모양이 아니면 다음 후보로 넘어간다(깨진 바깥 객체 안의 중첩 객체도 후보다). 여는 괄호 하나당 선형 스캔 + 파싱 한 번이라 최악 O(n²)(n ≤ maxChars),
 * 정상 응답(첫 괄호에서 시작)은 O(n).
 */
function firstJson<T>(text: string, open: string, close: string, maxChars: number, accept: (v: unknown) => v is T): T | null {
  for (const cand of bracketCandidates(text, open, close, maxChars)) {
    try {
      const v: unknown = JSON.parse(cand.text);
      if (accept(v)) return v;
    } catch {
      // 짝은 맞지만 JSON 이 아니다(예: "[긴급]") — 다음 여는 괄호에서 다시 찾는다.
    }
  }
  return null;
}

/** 후보 한 건 — 텍스트 안의 [start, end] 위치(양끝 포함)와 그 부분 문자열. */
interface BracketSpan {
  start: number;
  end: number;
  text: string;
}

/** 여는 괄호마다 짝 맞는 닫는 괄호까지 잘라 앞에서부터 하나씩 낸다(firstJson 공용). 제너레이터라 호출부가 첫 채택 후보에서 멈추면 나머지를 스캔하지 않는다. */
function* bracketCandidates(text: string, open: string, close: string, maxChars: number): Generator<BracketSpan> {
  const s = text.slice(0, maxChars).replace(/```(?:json)?/gi, '');
  for (let start = s.indexOf(open); start !== -1; start = s.indexOf(open, start + 1)) {
    const end = matchingBracket(s, start, open, close);
    if (end !== -1) yield { start, end, text: s.slice(start, end + 1) };
  }
}

/**
 * 최상위 JSON 객체 후보를 왼쪽에서 오른쪽으로 한 번만 훑으며 낸다(WP-2105).
 * 각 '{' 에서 짝 맞는 '}' 까지(문자열 안 중괄호는 무시)를 내고 그 끝 다음부터 이어 찾는다 — 후보 안의 중첩 객체는 따로 내지 않아 O(n) 이다.
 * 짝 없는 '{' 를 만나면 멈춘다: 출력이 잘린 것이라 그 안의 완결된 중첩 객체를 결과로 읽으면 안 된다.
 * 코드펜스는 걷지 않는다(호출부가 필요하면 바깥 펜스만 걷는다 — 문자열 값 안의 펜스는 본문이다).
 */
export function* topLevelJsonObjectSpans(s: string): Generator<{ start: number; end: number; text: string }> {
  let start = s.indexOf('{');
  while (start !== -1) {
    const end = matchingBracket(s, start, '{', '}');
    if (end === -1) return;
    yield { start, end, text: s.slice(start, end + 1) };
    start = s.indexOf('{', end + 1);
  }
}

/**
 * JSON.parse 하되 실패하면 문자열 리터럴 안의 날 제어문자(\n·\r·\t)를 이스케이프해 한 번 더 읽는다.
 * 모델이 문자열 안에 날 줄바꿈을 넣는 일이 잦아서다. 둘 다 실패하면 첫 파싱 오류를 던진다.
 */
export function parseJsonLenient(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (first) {
    try {
      return JSON.parse(escapeControlCharsInStrings(raw));
    } catch {
      throw first;
    }
  }
}

/** JSON 문자열 리터럴 안의 \n·\r·\t 만 이스케이프한다(바깥 공백은 그대로). */
function escapeControlCharsInStrings(s: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (const ch of s) {
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (escaped) {
      out += ch;
      escaped = false;
    } else if (ch === '\\') {
      out += ch;
      escaped = true;
    } else if (ch === '"') {
      out += ch;
      inString = false;
    } else if (ch === '\n') {
      out += '\\n';
    } else if (ch === '\r') {
      out += '\\r';
    } else if (ch === '\t') {
      out += '\\t';
    } else {
      out += ch;
    }
  }
  return out;
}

/** start 의 여는 괄호와 짝이 맞는 닫는 괄호 위치(문자열 리터럴 안은 무시). 닫히지 않으면 -1. */
function matchingBracket(s: string, start: number, open: string, close: string): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === '\\') i++; // 이스케이프 문자 다음 한 글자는 건너뛴다.
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return i;
  }
  return -1;
}

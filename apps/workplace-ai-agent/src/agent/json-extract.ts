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
 * 코드펜스를 걷고, 각 여는 괄호에서 문자열 리터럴(따옴표·이스케이프)을 건너뛰며 깊이를 세어 짝이 맞는 닫는 괄호에서 한 번만 JSON.parse 한다.
 * 파싱이 안 되거나 원하는 모양이 아니면 다음 여는 괄호로 넘어간다. 여는 괄호 하나당 선형 스캔 + 파싱 한 번이라 최악 O(n²)(n ≤ maxChars),
 * 정상 응답(첫 괄호에서 시작)은 O(n).
 */
function firstJson<T>(text: string, open: string, close: string, maxChars: number, accept: (v: unknown) => v is T): T | null {
  const s = text.slice(0, maxChars).replace(/```(?:json)?/gi, '');
  for (let start = s.indexOf(open); start !== -1; start = s.indexOf(open, start + 1)) {
    const end = matchingBracket(s, start, open, close);
    if (end === -1) continue;
    try {
      const v: unknown = JSON.parse(s.slice(start, end + 1));
      if (accept(v)) return v;
    } catch {
      // 짝은 맞지만 JSON 이 아니다(예: "[긴급]") — 다음 여는 괄호에서 다시 찾는다.
    }
  }
  return null;
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

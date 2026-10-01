// 7d·WP-149: 원본/개인 분석·코칭·이슈 초안 JSON 파싱 유틸.
// ⚠️ 과거 CLI stream-json 라인 → 최종 텍스트 추출은 `extractResultText` 가 맡았으나,
// collect 경로가 AgentRunner(Task 5)로 이관되며 provider-neutral `finalText`(runner-events.ts)
// 로 대체됐다(의미 동일: result.text 우선, 없으면 assistant_text join). 이 함수는 제거.

const CATEGORIES = ['업무', '개인', '알림', '프로모션', '뉴스레터'];

/** 코칭 평가 차원 화이트리스트. */
const COACHING_DIMENSIONS = ['TONE', 'CLARITY', 'COMPLETENESS'];

/**
 * 초안 코칭 JSON 파싱: {notes:[{dimension,message}], improvedBodyHtml}.
 * 알 수 없는 dimension 노트는 (유효 JSON 안에서만) 제외한다.
 * ⚠️ JSON 이 없거나 깨졌으면 throw — 빈 결과로 폴백하면 "고칠 곳 없어요"라는 거짓 신호가 되므로
 * 호출부(러너→라우트)가 502 로 전파하고 프론트는 에러 UI 를 띄운다.
 */
export function parseDraftCoachingJson(text: string): {
  notes: { dimension: string; message: string }[];
  improvedBodyHtml: string;
} {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`코칭 JSON 없음: ${text.slice(0, 120)}`);
  // JSON.parse 실패 시 그대로 throw (폴백 금지).
  const obj = JSON.parse(m[0]) as { notes?: unknown; improvedBodyHtml?: unknown };
  const rawNotes = Array.isArray(obj.notes) ? obj.notes : [];
  const notes = rawNotes
    .map((n) => n as { dimension?: unknown; message?: unknown })
    .filter(
      (n) =>
        typeof n.dimension === 'string' &&
        COACHING_DIMENSIONS.includes(n.dimension) &&
        typeof n.message === 'string' &&
        n.message.length > 0,
    )
    .map((n) => ({ dimension: n.dimension as string, message: n.message as string }));
  const improvedBodyHtml = typeof obj.improvedBodyHtml === 'string' ? obj.improvedBodyHtml : '';
  return { notes, improvedBodyHtml };
}

// #520 메일→이슈 초안 JSON 파싱. 코드펜스 제거 후 JSON.parse. 실패 시 throw(빈 폴백 금지 — 거짓 성공 신호 방지).
export function parseIssueDraftJson(text: string): {
  title: string;
  body: string;
  priority: string;
  projectKey?: string;
} {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const obj = JSON.parse(cleaned) as Record<string, unknown>;
  const title = String(obj.title ?? '').trim();
  const body = String(obj.body ?? '').trim();
  if (!title) throw new Error('issue-draft: title 누락');
  const rawPriority = String(obj.priority ?? 'MID').toUpperCase();
  const priority = ['LOW', 'MID', 'HIGH'].includes(rawPriority) ? rawPriority : 'MID';
  const projectKey =
    typeof obj.projectKey === 'string' && obj.projectKey.trim() ? obj.projectKey.trim() : undefined;
  return { title, body, priority, projectKey };
}

// ───────────────────────────── WP-149 원본/개인 분석 파서 ─────────────────────────────

/**
 * 모델 출력에서 JSON 객체 하나를 꺼낸다. 코드펜스·앞뒤 잡설을 걷고 첫 '{' ~ 마지막 '}' 를 읽는다(요약 안의 중괄호 허용).
 * 모델이 문자열 안에 날 줄바꿈을 넣으면 JSON.parse 가 실패하므로 문자열 안 제어문자만 이스케이프해 한 번 더 읽는다 —
 * 그렇지 않으면 같은 메일이 매 백필마다 실패·재시도된다.
 */
export function extractJsonObject(text: string): Record<string, unknown> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`분석 JSON 없음: ${text.slice(0, 120)}`);
  const raw = cleaned.slice(start, end + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = JSON.parse(escapeControlCharsInStrings(raw));
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`분석 JSON 이 객체가 아님: ${text.slice(0, 120)}`);
  }
  return parsed as Record<string, unknown>;
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

/** 허용 카테고리만(미지 값은 null — 예전 '업무' 폴백은 원본 분류를 오염시켰다). */
function pickCategory(v: unknown): string | null {
  return typeof v === 'string' && CATEGORIES.includes(v.trim()) ? v.trim() : null;
}

/** 공백 아닌 문자열만(공백·비문자열 → null). */
function pickText(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** ③ 응답 파싱. 요청하지 않은 항목은 null. */
export function parseContentAnalysisJson(
  text: string,
  flags: { includeCategory: boolean; includeSummary: boolean },
): { category: string | null; summary: string | null } {
  const obj = extractJsonObject(text);
  return {
    category: flags.includeCategory ? pickCategory(obj.category) : null,
    summary: flags.includeSummary ? pickText(obj.summary) : null,
  };
}

/**
 * ④ 응답 파싱. needsReply 를 요청했는데 boolean 이 아니면 throw(→ 502 → api 는 시도 기록 안 함, 다음 백필 재시도).
 * personalSummary 는 문자열(공백이면 null)·null 이면 유효, 그 외(누락·숫자 등)는 personalSummaryValid=false 로 알려
 * api 가 needsReply 만 저장하게 한다.
 */
export function parsePersonalAnalysisJson(
  text: string,
  flags: { includeNeedsReply: boolean; includePersonalSummary: boolean; includeCategory: boolean },
): { needsReply: boolean | null; personalSummary: string | null; personalSummaryValid: boolean; category: string | null } {
  const obj = extractJsonObject(text);
  let needsReply: boolean | null = null;
  if (flags.includeNeedsReply) {
    if (typeof obj.needsReply !== 'boolean') throw new Error(`needsReply 누락: ${text.slice(0, 120)}`);
    needsReply = obj.needsReply;
  }
  let personalSummary: string | null = null;
  let personalSummaryValid = false;
  if (flags.includePersonalSummary) {
    const v = obj.personalSummary;
    if (v === null) {
      personalSummaryValid = true;
    } else if (typeof v === 'string') {
      personalSummaryValid = true;
      personalSummary = v.trim() || null;
    }
  }
  return {
    needsReply,
    personalSummary,
    personalSummaryValid,
    category: flags.includeCategory ? pickCategory(obj.category) : null,
  };
}

// 7d·WP-149: 원본/개인 분석·코칭·이슈 초안 JSON 파싱 유틸.
// ⚠️ 과거 CLI stream-json 라인 → 최종 텍스트 추출은 `extractResultText` 가 맡았으나,
// collect 경로가 AgentRunner(Task 5)로 이관되며 provider-neutral `finalText`(runner-events.ts)
// 로 대체됐다(의미 동일: result.text 우선, 없으면 assistant_text join). 이 함수는 제거.

import { MAIL_CATEGORIES } from '@smart-workplace/mcp-tools-shared';

import { normalizePriority } from './issue-priority.js';
import { oneLine } from './memory-block.js';
import { ModelOutputError } from './provider-error.js';

/** 메일 분류 5종 — 공용 정의(mcp-tools-shared, API EmailMessageRepository.CATEGORIES 와 같은 순서) 하나를 쓴다(WP-1346). */
const CATEGORIES: readonly string[] = MAIL_CATEGORIES;

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
  if (!m) throw new ModelOutputError(`코칭 JSON 없음: ${text.slice(0, 120)}`);
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
  // 우선순위 5단계(WP-886)만 통과, 그 밖은 MID — 서버 @Pattern 에 걸려 승격이 400 나지 않게. trim+대문자는 분류 러너와 같은 규칙.
  const priority: string = normalizePriority(obj.priority);
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
  if (start < 0 || end <= start) throw new ModelOutputError(`분석 JSON 없음: ${text.slice(0, 120)}`);
  const raw = cleaned.slice(start, end + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = JSON.parse(escapeControlCharsInStrings(raw));
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ModelOutputError(`분석 JSON 이 객체가 아님: ${text.slice(0, 120)}`);
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

/**
 * 5종 밖 이름(근접어) → 분류(WP-1340, 설계 3.3). 모델이 "광고"처럼 허용 밖 이름을 내면 예전엔 null 로 버려져 그 메일이 업무 보기에 영구히 남았다.
 * 키는 소문자다 — pickCategory 가 소문자·trim 후 정확히 일치할 때만 찾는다(부분 일치는 "업무용"→업무 같은 오판을 만들어 쓰지 않는다).
 * 영문 이름은 모델이 영어로 답하는 경우를 위한 것이다.
 */
const CATEGORY_SYNONYMS: Record<string, string> = {
  광고: '프로모션',
  홍보: '프로모션',
  마케팅: '프로모션',
  할인: '프로모션',
  이벤트: '프로모션',
  promotion: '프로모션',
  promotions: '프로모션',
  ad: '프로모션',
  ads: '프로모션',
  advertisement: '프로모션',
  marketing: '프로모션',
  구독: '뉴스레터',
  소식지: '뉴스레터',
  뉴스: '뉴스레터',
  newsletter: '뉴스레터',
  newsletters: '뉴스레터',
  시스템: '알림',
  거래: '알림',
  영수증: '알림',
  notification: '알림',
  notifications: '알림',
  receipt: '알림',
  일: '업무',
  협업: '업무',
  work: '업무',
  지인: '개인',
  personal: '개인',
};

/** 허용 카테고리(+근접어)만. 맞출 수 없는 값은 null — 예전 '업무' 폴백은 원본 분류를 오염시켰다. */
function pickCategory(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (CATEGORIES.includes(t)) return t;
  return CATEGORY_SYNONYMS[t.toLowerCase()] ?? null;
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
 * 분류 일괄 응답 파싱 — {"results":[{"id":n,"category":"..."}]}.
 * 요청한 ids 순서대로 결과를 만든다: 응답에 없거나 허용 밖 값이면 null, 요청하지 않은 id 는 버린다
 * (다른 메일에 분류가 잘못 저장되지 않게). id 는 숫자 또는 정수 문자열("7")을 받는다.
 * results 배열이 없거나, 요청 id 가 하나도 응답에 없으면(전혀 다른 id 만 돌려준 경우) 형식 오류로 던진다 —
 * 그대로 두면 배치 전체가 null 로 기록돼 분류 대상에서 영구히 빠진다. 일부만 빠진 건 항목별 null 로 둔다.
 */
export function parseClassifyBatchJson(
  text: string,
  ids: number[],
): { id: number; category: string | null }[] {
  const obj = extractJsonObject(text);
  if (!Array.isArray(obj.results)) {
    throw new Error('classify-batch 응답에 results 배열이 없습니다');
  }
  const byId = new Map<number, string | null>();
  for (const r of obj.results as unknown[]) {
    if (r && typeof r === 'object') {
      const { id, category } = r as { id?: unknown; category?: unknown };
      // 모델이 id 를 "7" 처럼 숫자 문자열로 돌려주는 경우도 있어 정수 문자열은 숫자로 받아들인다
      // (거르면 그 배치 전체가 null 로 기록돼 다음 분류 대상에서 빠진다).
      const numericId = typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : id;
      if (typeof numericId === 'number') byId.set(numericId, pickCategory(category));
    }
  }
  if (ids.length > 0 && !ids.some((id) => byId.has(id))) {
    throw new Error('classify-batch 응답에 요청한 id 가 하나도 없습니다');
  }
  return ids.map((id) => ({ id, category: byId.get(id) ?? null }));
}

/**
 * ④ 응답 파싱(WP-1341: 요청했으면 personalCategory 도). needsReply 를 요청했는데 boolean 이 아니면 throw(→ 502 → api 는 시도 기록 안 함, 다음 백필 재시도).
 * personalSummary 는 문자열(공백이면 null)·null 이면 유효, 그 외(누락·숫자 등)는 personalSummaryValid=false 로 알려
 * api 가 needsReply 만 저장하게 한다.
 */
export function parsePersonalAnalysisJson(
  text: string,
  flags: { includeNeedsReply: boolean; includePersonalSummary: boolean; includeCategory: boolean; includePersonalCategory?: boolean },
): {
  needsReply: boolean | null;
  personalSummary: string | null;
  personalSummaryValid: boolean;
  category: string | null;
  personalCategory: string | null;
} {
  const obj = extractJsonObject(text);
  let needsReply: boolean | null = null;
  if (flags.includeNeedsReply) {
    if (typeof obj.needsReply !== 'boolean') throw new ModelOutputError(`needsReply 누락: ${text.slice(0, 120)}`);
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
    // WP-1341: 개인 분류도 같은 허용 목록·근접어 규칙. 맞출 수 없으면 null(API 는 공용 분류를 그대로 쓴다).
    personalCategory: flags.includePersonalCategory ? pickCategory(obj.personalCategory) : null,
  };
}

// ───────────────────────────── WP-1341 분류 교정 학습 ─────────────────────────────

/** 학습 판단 — 새 기억(CREATE)·기존 기억 고치기(UPDATE)·할 것 없음(NONE). */
export type LearnCategoryAction = 'CREATE' | 'UPDATE' | 'NONE';
export interface LearnCategoryResult {
  action: LearnCategoryAction;
  memoryId: number | null;
  content: string | null;
}
const LEARN_ACTIONS: readonly string[] = ['CREATE', 'UPDATE', 'NONE'];
/** 기억 한 줄 상한(코드포인트) — 프롬프트의 「120자 이내」와 같다. */
export const LEARN_CONTENT_MAX = 120;

/**
 * 학습 응답 파싱 — {"action":…,"memoryId"?:n,"content"?:"…"}.
 * 형식을 어기면 throw 한다(→ 라우트 502 → API 는 학습만 NONE 으로 돌려준다). 잘못된 기억을 저장하거나 남의 기억 id 를 고치는 것보다 아무것도 하지 않는 편이 안전하다.
 * - action 이 CREATE·UPDATE·NONE 밖이면 throw
 * - UPDATE 의 memoryId 가 요청 기억 목록(memoryIds)에 없으면 throw — 모델이 지어낸 id 로 다른 기억을 덮지 않게
 * - CREATE·UPDATE 의 content 가 (줄바꿈을 접고 trim 한 뒤) 1~120자 밖이면 throw
 */
export function parseLearnCategoryJson(text: string, memoryIds: number[]): LearnCategoryResult {
  const obj = extractJsonObject(text);
  const action = obj.action;
  if (typeof action !== 'string' || !LEARN_ACTIONS.includes(action)) {
    throw new Error(`learn-category: 알 수 없는 action: ${text.slice(0, 120)}`);
  }
  if (action === 'NONE') return { action: 'NONE', memoryId: null, content: null };
  // 기억은 한 줄로 저장·표시되므로 줄바꿈·연속 공백을 한 칸으로 접는다.
  const content = typeof obj.content === 'string' ? oneLine(obj.content) : '';
  const length = [...content].length;
  if (length < 1 || length > LEARN_CONTENT_MAX) {
    throw new Error(`learn-category: content 길이 ${length}자(1~${LEARN_CONTENT_MAX}자)`);
  }
  if (action === 'CREATE') return { action: 'CREATE', memoryId: null, content };
  const raw = obj.memoryId;
  const memoryId = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
  if (typeof memoryId !== 'number' || !memoryIds.includes(memoryId)) {
    throw new Error(`learn-category: 요청에 없는 기억 id: ${String(raw)}`);
  }
  return { action: 'UPDATE', memoryId, content };
}

/** JSON 문자열 값의 이스케이프(\n·\r·\t·\"·\\·\/)를 풀어 원문으로 되돌린다 — 느슨한 추출 전용. */
function unescapeJsonString(s: string): string {
  return s.replace(/\\([nrt"\\/])/g, (_m, c: string) =>
    c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c,
  );
}

/**
 * 깨진 JSON 에서 `"key":"…"` 문자열 값을 느슨하게 꺼낸다. 모델이 본문 안 큰따옴표를 이스케이프하지 않아도 값 끝을 찾도록,
 * 끝을 "다른 키가 뒤따르는 따옴표(`","other":`)" 또는 "마지막 `"}`" 로 잡는다(값 안쪽의 따옴표는 그대로 본문으로 본다).
 * 끝을 못 찾으면(출력이 잘림) null — 잘린 본문을 그대로 쓰면 사용자가 불완전한 메일을 모르고 보내기 때문에 복구하지 않는다.
 */
function looseStringValue(text: string, key: string, otherKey: string): string | null {
  const head = new RegExp(`"${key}"\\s*:\\s*"`).exec(text);
  if (!head) return null;
  const rest = text.slice(head.index + head[0].length);
  const next = new RegExp(`"\\s*,\\s*"${otherKey}"\\s*:`).exec(rest);
  let end = next ? next.index : -1;
  if (end < 0) {
    const closers = [...rest.matchAll(/"\s*\}/g)];
    if (closers.length === 0) return null;
    end = closers[closers.length - 1].index;
  }
  return unescapeJsonString(rest.slice(0, end));
}

/**
 * WP-576 새 메일 초안 출력 파싱. 모델이 JSON({subject?, body})을 주면 그 값을 쓴다.
 * - 출력이 `{` 로 시작(코드펜스 제외)하면 JSON 으로 본다. 파싱이 깨졌으면 body·subject 문자열만 느슨하게 꺼내고, body 를 못 꺼내면 throw —
 *   깨진 JSON 원문(`{"subject":…`)이 메일 본문으로 들어가는 것을 막는다(라우트가 502 로 돌려준다).
 * - `{` 로 시작하지 않는 평문이면 코드펜스를 걷은 전체를 본문으로 쓴다.
 * - 본문이 비면 throw. wantSubject=false 면 subject 는 항상 null(사용자가 이미 쓴 제목을 덮지 않는다).
 */
export function parseComposeDraft(
  text: string,
  wantSubject: boolean,
): { subject: string | null; body: string } {
  const plain = text.trim().replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim();
  let subject = '';
  let body = plain;
  if (plain.startsWith('{')) {
    let obj: Record<string, unknown> | null = null;
    try {
      obj = extractJsonObject(plain);
    } catch {
      // 깨진 JSON → 아래 느슨한 추출
    }
    if (obj && typeof obj.body === 'string') {
      body = obj.body;
      subject = typeof obj.subject === 'string' ? obj.subject : '';
    } else {
      body = looseStringValue(plain, 'body', 'subject') ?? '';
      subject = looseStringValue(plain, 'subject', 'body') ?? '';
    }
  }
  body = body.trim();
  if (!body) throw new ModelOutputError(`compose-draft: 본문을 얻지 못함: ${text.slice(0, 120)}`);
  subject = wantSubject ? subject.trim() : '';
  return { subject: subject || null, body };
}

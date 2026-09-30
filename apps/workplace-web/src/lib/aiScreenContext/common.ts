// 화면 컨텍스트 builder 공통 헬퍼(WP-54) — 서버 상한(api Bean Validation·agent zod)을 넘지 않게 자르고,
// 빈 값을 걸러 AI 에게 의미 있는 항목만 보낸다.
import type { AiScreenContext, AiScreenFact, AiScreenRefs } from '@/types/aiScreenContext';

/** 스펙의 크기 상한 — api/agent 검증과 동일 값. */
export const LIMITS = {
  view: 50,
  type: 50,
  label: 200,
  refs: 5,
  refKey: 40,
  refValue: 100,
  facts: 12,
  factLabel: 30,
  factValue: 200,
} as const;

/** 앞뒤 공백 제거 후 max 자 초과면 말줄임(…) 포함 max 자로 자른다. */
export function clip(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

export type FactValue = string | number | boolean | null | undefined;

/** [라벨, 값] 목록 → facts. 빈 값·false 는 제외(해당 필터 미적용), true 는 '예'. 모두 비면 undefined. */
export function buildFacts(pairs: Array<[string, FactValue]>): AiScreenFact[] | undefined {
  const out: AiScreenFact[] = [];
  for (const [label, raw] of pairs) {
    if (raw == null || raw === false || raw === '') continue;
    const value = raw === true ? '예' : String(raw);
    if (!value.trim()) continue;
    out.push({ label: clip(label, LIMITS.factLabel), value: clip(value, LIMITS.factValue) });
    if (out.length === LIMITS.facts) break;
  }
  return out.length ? out : undefined;
}

/** 식별자 맵 — null/undefined 제외, 값은 문자열. 최대 5개. */
export function buildRefs(obj: Record<string, string | number | null | undefined>): AiScreenRefs {
  const out: AiScreenRefs = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === '') continue;
    if (Object.keys(out).length === LIMITS.refs) break;
    out[clip(k, LIMITS.refKey)] = clip(String(v), LIMITS.refValue);
  }
  return out;
}

const KST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
const KST_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** ISO 시각 → KST 'YYYY-MM-DD HH:mm'(withTime=false 면 날짜만). AI 가 사용자와 같은 시간대로 읽게 한다. */
export function fmtKst(iso: string, withTime = true): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = KST_DATE.format(d);
  return withTime ? `${date} ${KST_TIME.format(d)}` : date;
}

/** 입력창 위 칩 표시 문자열 — 대상이 있으면 대상, 없으면 화면·범위. */
export function chipLabel(ctx: AiScreenContext): string {
  if (ctx.focus) return `${ctx.focus.type} ${ctx.focus.label}`;
  if (ctx.scope) return `${ctx.view} · ${ctx.scope.label}`;
  return ctx.view;
}

/** 컨텍스트 동일성 키 — 칩 × (1회 제외) 상태가 화면 전환 시 자동 해제되도록 비교에 쓴다. */
export function contextKey(ctx: AiScreenContext | null): string | null {
  return ctx ? JSON.stringify(ctx) : null;
}

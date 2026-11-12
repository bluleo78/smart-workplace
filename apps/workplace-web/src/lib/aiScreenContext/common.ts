// 화면 컨텍스트 builder 공통 헬퍼(WP-54) — 서버 상한(api Bean Validation·agent zod)을 넘지 않게 자르고,
// 빈 값을 걸러 AI 에게 의미 있는 항목만 보낸다.
import type { AiHelpContext, AiScreenContext, AiScreenFact, AiScreenRefs } from '@/types/aiScreenContext';

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
  // WP-1511 도움말 층 — api AiScreenContext.Help · ai-agent screenContextSchema 와 같은 값.
  helpId: 100,
  helpPath: 8,
  helpPathItem: 50,
  helpBody: 2000,
  helpFocusName: 100,
  helpFocusValue: 200,
  helpDialog: 100,
  helpQuery: 200,
  helpDialogs: 5,
  helpDialogLabel: 50,
} as const;

/** 앞뒤 공백 제거 후 max 자 초과면 말줄임(…) 포함 max 자로 자른다. */
export function clip(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

export type FactValue = string | number | boolean | null | undefined;

/**
 * [라벨, 값] 목록 → facts. 빈 값·false 는 제외(해당 필터 미적용), true 는 '예'. 모두 비면 undefined.
 * 유효 항목이 상한(LIMITS.facts)을 넘으면 앞 (상한-1)개만 남기고, 버려진 항목의 "라벨"을 모아
 * 마지막 1개 fact(라벨 overflowLabel, 기본 '기타')로 요약한다 — 조용히 잘려 AI 가 실제보다 넓은 목록으로 오해하는 것을 막는다.
 * 그래서 호출자는 영향이 큰 항목을 앞에 두어야 한다.
 */
export function buildFacts(
  pairs: Array<[string, FactValue]>,
  opts: { overflowLabel?: string } = {},
): AiScreenFact[] | undefined {
  const all: AiScreenFact[] = [];
  for (const [label, raw] of pairs) {
    if (raw == null || raw === false || raw === '') continue;
    const value = raw === true ? '예' : String(raw);
    if (!value.trim()) continue;
    all.push({ label: clip(label, LIMITS.factLabel), value: clip(value, LIMITS.factValue) });
  }
  if (!all.length) return undefined;
  if (all.length <= LIMITS.facts) return all;
  const kept = all.slice(0, LIMITS.facts - 1);
  const dropped = all.slice(LIMITS.facts - 1).map((f) => f.label).join(', ');
  kept.push({ label: clip(opts.overflowLabel ?? '기타', LIMITS.factLabel), value: clip(dropped, LIMITS.factValue) });
  return kept;
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

/**
 * 목록 상태(건수·추가 로드 여부)를 scope 에 덧붙인다 — 값이 있는(!= null) 키만 싣는다.
 * 조회 전 미로드 값(undefined)을 0건·끝으로 오인시키지 않도록 키 자체를 생략하기 위함.
 */
export function withListState<T extends object>(
  scope: T,
  s: { count?: number; hasMore?: boolean },
): T & { count?: number; hasMore?: boolean } {
  const out: T & { count?: number; hasMore?: boolean } = { ...scope };
  if (s.count != null) out.count = s.count;
  if (s.hasMore != null) out.hasMore = s.hasMore;
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

/**
 * 입력창 위 칩 표시 문자열 — 대상이 있으면 대상, 없으면 화면·범위.
 * 범위 라벨이 이미 화면 이름을 포함하면(예: '프로젝트 X 이슈 목록') 중복 표기('이슈 목록 · 프로젝트 X 이슈 목록')를 피해 범위 라벨만 쓴다.
 */
export function chipLabel(ctx: AiScreenContext): string {
  const base = baseChipLabel(ctx);
  // WP-1511: 도움말 절을 보고 있으면 경로 끝 이름만 덧붙인다 — 칩은 하나, 별도 도움말 태그는 두지 않는다.
  const leaf = ctx.help?.section?.path.at(-1);
  return leaf ? `${base} · ${leaf}` : base;
}

/** 도움말 층을 뺀 칩 표시 — 대상 > 화면·범위 > 화면. */
function baseChipLabel(ctx: AiScreenContext): string {
  if (ctx.focus) return `${ctx.focus.type} ${ctx.focus.label}`;
  if (ctx.scope) return ctx.scope.label.includes(ctx.view) ? ctx.scope.label : `${ctx.view} · ${ctx.scope.label}`;
  return ctx.view;
}

/**
 * 화면 정체성 키 — 칩 ×(1회 제외)를 "같은 화면"에 묶는 비교 키. 도움말 층(help)은 절·검색어가 수시로 바뀌므로 제외한다.
 * 건수(count)·추가 로드 여부(hasMore)·facts 처럼 같은 화면에서도 수시로 바뀌는 값은 제외한다 —
 * 이런 휘발 데이터 변화로 사용자가 누른 × 가 풀려 칩이 다시 뜨면 안 되기 때문. 화면(view)·대상/범위 식별자만 본다.
 */
export function contextIdentity(ctx: AiScreenContext | null): string | null {
  if (!ctx) return null;
  return JSON.stringify({
    view: ctx.view,
    focusType: ctx.focus?.type ?? null,
    focusRefs: ctx.focus?.refs ?? null,
    scopeLabel: ctx.scope?.label ?? null,
    scopeRefs: ctx.scope?.refs ?? null,
  });
}

/**
 * 넘겨받은 도움말(carried)을 묶어 두는 화면 정체성 — 도움말만 있는 문맥(페이지 없이 view 「도움말」)은 화면이 없는 것(null)으로 본다.
 * 도움말을 닫으면 그 문맥이 사라져 정체성이 바뀌는데, 그걸 「화면을 옮김」으로 오해해 넘겨받은 도움말을 버리지 않게 하려는 것이다.
 */
export function carriedIdentity(ctx: AiScreenContext | null): string | null {
  if (!ctx || (ctx.help && !ctx.focus && !ctx.scope && ctx.view === '도움말')) return null;
  return contextIdentity(ctx);
}

/**
 * WP-379: 서버로 보내는 화면 참고 — app 은 웹이 메모리 범위를 고르는 데만 쓰는 값이라 뺀다(API·ai-agent screenContext 계약에 없다).
 * 원본(스토어의 컨텍스트)은 바꾸지 않는다.
 */
export function screenContextPayload(ctx: AiScreenContext): Omit<AiScreenContext, 'app'> {
  const out = { ...ctx };
  delete out.app;
  return out;
}

/**
 * WP-1261: 페이지 컨텍스트 위에 미리 보기(overlay)를 얹는다 — 미리 보는 파일이 대상(focus)이 되고,
 * 페이지가 보던 대상(메일·이슈·스레드)은 범위(scope)로 내려 「이 메일의 이 첨부」처럼 원래 맥락을 잃지 않는다.
 * 페이지에 대상이 없으면(드라이브 폴더 목록 등) 페이지 범위를 그대로 둔다. 화면 이름·앱은 페이지 것을 쓴다.
 * 파일 식별자에 issueKey 가 빠진 이슈 채팅 첨부는 페이지 식별자의 issueKey 로 채운다 — read_file 이 바로 읽을 수 있게.
 * 채울 issueKey 가 없으면 읽을 수 없는 식별자라 파일 식별자를 비운다(AI 가 빠진 인자로 read_file 을 부르지 않게).
 */
export function overlayScreenContext(base: AiScreenContext | null, overlay: AiScreenContext): AiScreenContext {
  const baseRefs: AiScreenRefs = { ...base?.scope?.refs, ...base?.focus?.refs };
  let focus = overlay.focus;
  // 이슈 채팅 묶음은 스레드 id 만 알아 issueKey 가 빠진다.
  if (focus && focus.refs.source === 'issue_chat' && !focus.refs.issueKey) {
    focus = { ...focus, refs: baseRefs.issueKey ? buildRefs({ ...focus.refs, issueKey: baseRefs.issueKey }) : {} };
  }
  if (!base) return { ...overlay, ...(focus ? { focus } : {}) };
  let scope = base.scope;
  if (base.focus) {
    // 대상 식별자를 앞에 — 상한(5개)에 걸리면 범위 쪽(계정·폴더 등)이 먼저 빠진다.
    const refs = buildRefs({ ...base.focus.refs, ...base.scope?.refs, ...base.focus.refs });
    scope = {
      label: clip(`${base.focus.type} ${base.focus.label}`, LIMITS.label),
      ...(Object.keys(refs).length ? { refs } : {}),
      ...(base.focus.facts ? { facts: base.focus.facts } : {}),
    };
  }
  return {
    view: base.view,
    ...((base.app ?? overlay.app) ? { app: base.app ?? overlay.app } : {}),
    ...(focus ? { focus } : {}),
    ...(scope ? { scope } : {}),
  };
}

/**
 * WP-1511: 도움말 층 등록자들의 값을 하나로 합친다(등록 순서대로 넘긴다).
 * dialogs 는 id 로 중복 없이 이어 붙여 상한(LIMITS.helpDialogs)까지, 나머지 키는 값이 있는 뒤 등록이 이긴다.
 * 결과가 비면 null — 도움말 패널과 창 등록자가 각자 일부만 등록해도 한 값으로 합쳐 AI 에게 보낸다.
 */
export function mergeHelp(parts: AiHelpContext[]): AiHelpContext | null {
  const out: AiHelpContext = {};
  const dialogs = new Map<string, { id: string; label: string }>();
  for (const part of parts) {
    const { dialogs: ds, ...rest } = part;
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined) (out as Record<string, unknown>)[k] = v;
    }
    for (const d of ds ?? []) if (!dialogs.has(d.id)) dialogs.set(d.id, d);
  }
  if (dialogs.size) out.dialogs = [...dialogs.values()].slice(0, LIMITS.helpDialogs);
  return Object.keys(out).length ? out : null;
}

/**
 * WP-1511: 화면 참고(base)에 도움말(help)을 얹는다 — 스토어(recompute)와 입력창 씨앗(withCarriedHelp)이 같은 규칙을 쓰도록 한 곳에 둔다.
 * help 가 없으면 base 그대로. base 가 없으면(도움말만 열린 화면 등) 절·검색어가 있을 때만 「도움말」 문맥을 만든다 — 창 목록(dialogs)만으로는 보낼 화면이 아니다.
 */
export function attachHelp(base: AiScreenContext | null, help: AiHelpContext | null | undefined): AiScreenContext | null {
  if (!help) return base;
  if (base) return { ...base, help };
  return help.section || help.query ? { view: '도움말', help } : null;
}

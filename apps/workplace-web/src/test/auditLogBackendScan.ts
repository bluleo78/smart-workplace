// 백엔드 자바 소스에서 감사 로그(AuditLogService.log·logInTenant·logInTenantOrGlobal)로 넘어가는 액션·리소스 값을 정적으로 모으는 테스트용 스캐너(WP-1560).
// auditLogLabels.backend.test.ts 가 이 값들에 프론트 라벨이 있는지 대조한다. 파일 시스템에 의존하지 않아 인라인 자바 조각으로 단위 테스트한다.
// 구조 판독(괄호·중괄호·쉼표·삼항)은 문자열 속을 공백으로 가린 사본(mask)에서 하고, 값은 같은 위치의 원문에서 읽는다 — 따옴표 처리를 한 곳(mask)에 모으려는 것이다.

/** 감사 기록 메서드별 액션·리소스 인자 위치(AuditLogService 시그니처 기준). */
const CALL_SHAPES: Record<string, { action: number; resource: number }> = {
  log: { action: 2, resource: 3 },
  logInTenant: { action: 3, resource: 4 },
  logInTenantOrGlobal: { action: 3, resource: 4 },
};

/** 도우미 파라미터를 따라 올라가는 최대 단계(audit → logAudit → log 같은 2단 위임까지). */
const MAX_HOPS = 2;

/** 메서드 선언으로 오인하면 안 되는 예약어. */
const NOT_METHODS = new Set(['if', 'for', 'while', 'switch', 'catch', 'synchronized']);

/** 원문 조각과, 같은 길이로 문자열 속을 가린 사본. 두 문자열은 항상 같은 위치끼리 대응한다. */
interface Piece {
  text: string;
  mask: string;
}

/** 문자열(") 또는 문자(') 리터럴이 시작되는 위치에서 끝 다음 위치를 돌려준다(이스케이프 처리). */
function skipQuoted(src: string, i: number): number {
  const q = src[i];
  let j = i + 1;
  while (j < src.length && src[j] !== q) j += src[j] === '\\' ? 2 : 1;
  return j + 1;
}

/**
 * 주석(//, 블록)과 텍스트 블록(삼중 따옴표)을 걷어 낸다 — 주석 속 괄호·쉼표·예시 호출이 인자 자르기를 흩뜨리지 않게.
 * 문자열·문자 리터럴 안의 // 는 건드리지 않는다.
 */
export function stripComments(src: string): string {
  const TRIPLE = '"'.repeat(3);
  let out = '';
  let i = 0;
  while (i < src.length) {
    if (src.startsWith(TRIPLE, i)) {
      const end = src.indexOf(TRIPLE, i + 3);
      out += '""';
      i = end < 0 ? src.length : end + 3;
    } else if (src[i] === '"' || src[i] === "'") {
      const next = skipQuoted(src, i);
      out += src.slice(i, next);
      i = next;
    } else if (src.startsWith('//', i)) {
      const end = src.indexOf('\n', i);
      i = end < 0 ? src.length : end;
    } else if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
    } else out += src[i++];
  }
  return out;
}

/** 문자열·문자 리터럴 속을 같은 길이의 공백으로 가린 사본(따옴표는 남김). */
function maskLiterals(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    if (src[i] === '"' || src[i] === "'") {
      const next = Math.min(skipQuoted(src, i), src.length);
      out += src[i] + ' '.repeat(Math.max(next - i - 2, 0)) + src.slice(next - 1, next);
      i = next;
    } else out += src[i++];
  }
  return out;
}

/** 여는 괄호 바로 뒤 위치에서 짝이 맞는 닫는 괄호의 위치. */
function argsEnd(mask: string, start: number): number {
  let depth = 1;
  let i = start;
  for (; i < mask.length; i++) {
    if (mask[i] === '(') depth++;
    else if (mask[i] === ')' && --depth === 0) break;
  }
  return i;
}

/** 여는 중괄호 위치에서 짝이 맞는 닫는 중괄호 다음 위치. */
function matchBrace(mask: string, open: number): number {
  let depth = 0;
  for (let i = open; i < mask.length; i++) {
    if (mask[i] === '{') depth++;
    else if (mask[i] === '}' && --depth === 0) return i + 1;
  }
  return mask.length;
}

/** 조각의 [from, to) 부분(원문·사본 같은 위치). */
function slicePiece(p: Piece, from: number, to?: number): Piece {
  return { text: p.text.slice(from, to), mask: p.mask.slice(from, to) };
}

/** 조각의 앞뒤 공백을 걷어 낸다(원문·사본을 같은 만큼). */
function trimPiece(p: Piece): Piece {
  const lead = p.text.length - p.text.trimStart().length;
  const text = p.text.trim();
  return { text, mask: p.mask.slice(lead, lead + text.length) };
}

/**
 * 최상위 쉼표(괄호 밖)로 조각을 나눈다. angle 이 true 면 제네릭 꺾쇠(< >)도 깊이로 센다 —
 * 파라미터 선언(Map<String, Object> m)을 자를 때만 쓴다(호출 인자의 비교 연산자와 헷갈리지 않게).
 */
export function splitTopLevel(piece: Piece, angle = false): Piece[] {
  const parts: Piece[] = [];
  let depth = 0;
  let from = 0;
  const push = (to: number) => parts.push(trimPiece(slicePiece(piece, from, to)));
  for (let i = 0; i < piece.mask.length; i++) {
    const c = piece.mask[i];
    if ('([{'.includes(c) || (angle && c === '<')) depth++;
    else if (')]}'.includes(c) || (angle && c === '>')) depth--;
    else if (c === ',' && depth === 0) {
      push(i);
      from = i + 1;
    }
  }
  push(piece.mask.length);
  return parts;
}

/** 최상위 삼항(`조건 ? 참 : 거짓`)을 참·거짓 두 갈래로 나눈다. 삼항이 아니면 null. */
function splitTernary(p: Piece): [Piece, Piece] | null {
  let depth = 0;
  let q = -1;
  for (let i = 0; i < p.mask.length; i++) {
    const c = p.mask[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (depth === 0 && c === '?' && q < 0) q = i;
    else if (depth === 0 && c === ':' && q >= 0) {
      return [trimPiece(slicePiece(p, q + 1, i)), trimPiece(slicePiece(p, i + 1))];
    }
  }
  return null;
}

interface Method {
  name: string;
  params: string[];
  nameIdx: number;
  bodyStart: number;
  bodyEnd: number;
}

/** 소스의 메서드(·생성자) 선언을 모은다 — 이름, 파라미터 이름 목록, 본문 범위. */
function findMethods(src: Piece): Method[] {
  const methods: Method[] = [];
  const re = /(?<![\w.])(\w+)\s*\(((?:[^;{}()]|\([^()]*\))*)\)\s*(?:throws\s+[\w.,\s]+)?\{/g;
  for (const m of src.mask.matchAll(re)) {
    if (NOT_METHODS.has(m[1])) continue;
    const bodyStart = m.index + m[0].length - 1;
    const paramsMask = m[2];
    const params = paramsMask.trim()
      ? splitTopLevel({ text: paramsMask, mask: paramsMask }, true).map((p) => /(\w+)\s*$/.exec(p.mask)?.[1] ?? '')
      : [];
    methods.push({ name: m[1], params, nameIdx: m.index, bodyStart, bodyEnd: matchBrace(src.mask, bodyStart) });
  }
  return methods;
}

/** 위치를 감싸는 가장 안쪽 메서드. */
function enclosing(methods: Method[], pos: number): Method | undefined {
  let best: Method | undefined;
  for (const m of methods) if (m.bodyStart <= pos && pos < m.bodyEnd && (!best || m.bodyStart > best.bodyStart)) best = m;
  return best;
}

/** 같은 파일의 상수 선언(static final / final static String NAME = "값";)을 이름→값으로 모은다. */
function collectConstants(src: string): Map<string, string> {
  const constants = new Map<string, string>();
  const re = /(?:static\s+final|final\s+static)\s+String\s+(\w+)\s*=\s*"([^"]*)"\s*;/g;
  for (const m of src.matchAll(re)) constants.set(m[1], m[2]);
  return constants;
}

/** 소스에서 AuditLogService 타입으로 선언된 필드·파라미터 이름(기본 auditLogService 포함). */
function collectReceivers(src: string): string[] {
  const names = new Set<string>(['auditLogService']);
  for (const m of src.matchAll(/\bAuditLogService\s+(\w+)\b/g)) names.add(m[1]);
  return [...names];
}

export interface ScanResult {
  /** 발견한 감사 기록 호출부 수. */
  calls: number;
  /** 풀어 낸 값. */
  values: { action: string[]; resource: string[] };
  /** 풀 수 없는 자리 — `<kind> <인자 텍스트>` (파일명은 호출자가 앞에 붙인다). */
  unresolved: string[];
}

interface Resolved {
  values: string[];
  ok: boolean;
}

/** 항목마다 풀어 값은 모으고, 항목이 없거나 하나라도 못 풀면 ok=false(풀린 값은 그대로 돌려준다). */
function resolveAll<T>(items: T[], resolve: (item: T) => Resolved): Resolved {
  const subs = items.map(resolve);
  return { values: subs.flatMap((r) => r.values), ok: items.length > 0 && subs.every((r) => r.ok) };
}

/** 호출부 하나의 인자 표현식을 값 목록으로 푼다. */
function resolveExpr(src: Piece, methods: Method[], constants: Map<string, string>, expr: Piece, pos: number, hops: number): Resolved {
  const lit = /^"([^"]*)"$/.exec(expr.text);
  if (lit) return { values: [lit[1]], ok: true };
  const constant = constants.get(expr.text);
  if (constant !== undefined) return { values: [constant], ok: true };
  const again = (e: Piece, p = pos, h = hops) => resolveExpr(src, methods, constants, e, p, h);

  const branches = splitTernary(expr);
  // 삼항 — 두 갈래를 모두 푼다(예: active ? "MEMBER_REACTIVATED" : "MEMBER_SUSPENDED").
  if (branches) return resolveAll(branches, (e) => again(e));

  const accessor = /^[\w.]+\.(\w+)\(\)$/.exec(expr.mask);
  if (accessor) {
    // 접근자 메서드(enum 상수별 구현 등) — 「name() { return "값"; }」 형태의 반환 리터럴을 모두 모은다.
    const re = new RegExp(String.raw`\b${accessor[1]}\(\)\s*\{\s*return\s+"([^"]*)"\s*;`, 'g');
    const values = [...src.text.matchAll(re)].map((m) => m[1]);
    return { values, ok: values.length > 0 };
  }

  if (!/^\w+$/.test(expr.mask)) return { values: [], ok: false };
  const method = enclosing(methods, pos);
  if (!method) return { values: [], ok: false };

  const idx = method.params.indexOf(expr.text);
  if (idx >= 0) {
    // 도우미 메서드의 파라미터 — 같은 파일의 호출부(인자 수가 같은 것)를 따라가 그 자리의 값을 푼다.
    if (hops >= MAX_HOPS) return { values: [], ok: false };
    const callRe = new RegExp(String.raw`(?<![\w.])${method.name}\s*\(`, 'g');
    const sites: { arg: Piece; pos: number }[] = [];
    for (const c of src.mask.matchAll(callRe)) {
      if (c.index === method.nameIdx) continue;
      const open = c.index + c[0].length;
      const args = splitTopLevel(slicePiece(src, open, argsEnd(src.mask, open)));
      if (args.length === method.params.length) sites.push({ arg: args[idx], pos: c.index });
    }
    return resolveAll(sites, (s) => again(s.arg, s.pos, hops + 1));
  }

  // 지역 변수 — 메서드 본문의 대입(`name = 값;`·`String name = 값;`)을 모두 푼다.
  const assignRe = new RegExp(String.raw`(?<![\w.])${expr.text}\s*=(?!=)\s*([^;]+);`, 'g');
  const assigns: { expr: Piece; pos: number }[] = [];
  for (const a of src.mask.slice(method.bodyStart, method.bodyEnd).matchAll(assignRe)) {
    const pos = method.bodyStart + a.index;
    const from = pos + a[0].length - 1 - a[1].length; // 대입 우변의 시작(끝의 ';' 직전에서 거꾸로)
    assigns.push({ expr: trimPiece(slicePiece(src, from, from + a[1].length)), pos });
  }
  return resolveAll(assigns, (a) => again(a.expr, a.pos));
}

/** 소스 한 파일에서 감사 기록 호출부의 액션·리소스 값을 모은다. */
export function scanSource(rawSrc: string): ScanResult {
  const text = stripComments(rawSrc);
  const src: Piece = { text, mask: maskLiterals(text) };
  const result: ScanResult = { calls: 0, values: { action: [], resource: [] }, unresolved: [] };
  const constants = collectConstants(text);
  const methods = findMethods(src);
  const callRe = new RegExp(String.raw`\b(?:${collectReceivers(text).join('|')})\.(log|logInTenant|logInTenantOrGlobal)\(`, 'g');
  for (const m of src.mask.matchAll(callRe)) {
    const open = m.index + m[0].length;
    const parts = splitTopLevel(slicePiece(src, open, argsEnd(src.mask, open)));
    const shape = CALL_SHAPES[m[1]];
    result.calls++;
    for (const kind of ['action', 'resource'] as const) {
      const expr = parts[shape[kind]];
      if (expr === undefined) {
        // 인자 수가 모자란 호출 — 오류로 죽지 않고 풀 수 없는 자리로 보고한다.
        result.unresolved.push(`${kind} <인자 없음: ${parts.length}개만 있음>`);
        continue;
      }
      const r = resolveExpr(src, methods, constants, expr, m.index, 0);
      result.values[kind].push(...r.values);
      if (!r.ok) result.unresolved.push(`${kind} ${expr.text.replace(/\s+/g, ' ')}`);
    }
  }
  return result;
}

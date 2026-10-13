// src/tool-definitions.ts — 외부 MCP(workplace-mcp)가 tools/list 로 내보내는 도구 정의와 그 크기(WP-340 웨이브 5).
// 외부 MCP 클라이언트(Claude.ai·ChatGPT)는 연결한 서버의 도구 정의를 매 대화 컨텍스트에 전부 싣는다. 그래서 정의 크기를 재고(상한 테스트),
// 의미 없는 반복(도구마다 붙는 `$schema`, `.int()` 가 만드는 안전 정수 상한 같은 정보 없는 제약, null 허용 표시)을 걷어낸 모양을 서버가 그대로 내보낸다.
// workplace-mcp 는 tools/list 응답을 이 함수의 출력으로 바꿔 끼운다 — 측정값과 실제로 나가는 값이 같은 코드에서 나온다(server.ts, 왕복 테스트가 고정).
// 입력 검증은 바꾸지 않는다: SDK 는 여전히 registerTool 에 넘긴 zod shape 로 인자를 검증하므로, 여기서 줄인 표시와 무관하게 null 허용 등 동작은 그대로다.
import { z } from 'zod';

import type { McpToolAnnotations, SharedTool } from './mcp-tool.js';
import { toolAnnotations } from './tool-annotations.js';

/** `z.number().int()` 가 JSON Schema 에 싣는 안전 정수 경계(±2^53−1). 모델에 주는 정보가 없어 내보내지 않는다(검증은 zod 가 그대로 한다). */
const SAFE_INT = Number.MAX_SAFE_INTEGER;

/**
 * "null = 생략" 으로 받는 선택 입력의 표식. 모델은 쓰지 않는 인자를 null 로 채워 보내기도 해서(WP-346 read_attachment 사례 — 지금 read_file) 이런 입력은
 * `.nullish()` 로 받는다. 그런데 JSON Schema 에는 `anyOf:[T,{type:'null'}]` 로 두 겹이 돼 토큰만 늘고, 모델에게 null 을 보내라는 신호도 된다.
 * 이 표식이 붙은 입력은 내보낼 때 null 갈래를 지워 평범한 선택 입력으로 보여 준다(검증은 nullish 그대로 — null 이 와도 통과한다).
 * null 에 뜻이 있는 입력(update_issue 의 parent=null 해제처럼 "비우기")에는 붙이지 않는다 — 그 null 갈래는 모델이 알아야 한다.
 */
const NULL_AS_OMITTED = new WeakSet<z.ZodType>();

/** 선택 입력을 "null 도 생략으로 받는" 입력으로 만든다. 결과에 `.describe()` 를 다시 붙여도 복제본이 부모를 따라 표식을 찾으므로(isNullAsOmitted) 유지된다. */
export function nullAsOmitted<T extends z.ZodType>(schema: T) {
  const wrapped = schema.nullish();
  NULL_AS_OMITTED.add(wrapped);
  return wrapped;
}

/** 표식 여부 — `.describe()`·`.meta()` 복제본은 부모(_zod.parent)를 따라 올라가 원본 표식을 찾는다. */
function isNullAsOmitted(schema: z.ZodType): boolean {
  for (let s: z.ZodType | undefined = schema; s; s = (s as { _zod: { parent?: z.ZodType } })._zod.parent) {
    if (NULL_AS_OMITTED.has(s)) return true;
  }
  return false;
}

type JsonSchema = Record<string, unknown>;

/**
 * 모델에 주는 정보가 없는 제약인지 — 내보내지 않는다(검증은 zod 가 그대로 하므로 어겨도 서버 쪽에서 오류가 난다).
 * - 안전 정수 경계 ±2^53−1(`.int()` 가 붙인다). 일부러 건 상한(예: limit 100)은 값이 달라 남는다.
 * - 식별자의 `exclusiveMinimum: 0`(`.positive()`)과 문자열의 `minLength: 1`(`.min(1)`) — id 는 원래 양수이고 빈 문자열을 보낼 일이 없다.
 */
function isTrivialConstraint(key: string, value: unknown): boolean {
  return (
    (key === 'maximum' && value === SAFE_INT) ||
    (key === 'minimum' && value === -SAFE_INT) ||
    (key === 'exclusiveMinimum' && value === 0) ||
    (key === 'minLength' && value === 1)
  );
}

/** 날짜(yyyy-MM-dd) 정규식 — zod `.regex(/^\d{4}-\d{2}-\d{2}$/)` 가 내보내는 pattern 문자열과 같다. */
const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';

/**
 * JSON Schema 노드를 재귀로 정리한다(직렬화만 — 검증은 zod 그대로).
 * - 정보 없는 제약(isTrivialConstraint)을 지운다.
 * - `propertyNames: {type:"string"}`(`z.record(z.string(), …)`) — JSON 객체 키는 늘 문자열이라 정보가 없다(WP-340 웨이브 5).
 * - 날짜 정규식 pattern 은 같은 뜻의 짧은 `format: "date"`(JSON Schema 의 RFC 3339 full-date = yyyy-MM-dd)로 바꾼다(WP-340 웨이브 5).
 */
function stripTrivialConstraints(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripTrivialConstraints);
  if (!node || typeof node !== 'object') return node;
  const out: JsonSchema = {};
  for (const [k, v] of Object.entries(node)) {
    if (isTrivialConstraint(k, v)) continue;
    if (k === 'propertyNames' && isPlainStringSchema(v)) continue;
    if (k === 'pattern' && v === DATE_PATTERN) {
      out.format = 'date';
      continue;
    }
    out[k] = stripTrivialConstraints(v);
  }
  return out;
}

/** `{type:"string"}` 하나뿐인 스키마인지 — 제약이 붙은 propertyNames(예: pattern)는 정보가 있으니 남긴다. */
function isPlainStringSchema(v: unknown): boolean {
  return !!v && typeof v === 'object' && Object.keys(v).length === 1 && (v as JsonSchema).type === 'string';
}

/** `anyOf:[T,{type:'null'}]` → T(바깥 키 — description 등 — 는 T 위에 합친다). null 갈래가 아니면 그대로. */
function dropNullBranch(prop: JsonSchema): JsonSchema {
  const anyOf = prop.anyOf;
  if (!Array.isArray(anyOf) || anyOf.length !== 2) return prop;
  const isNull = (b: unknown) => typeof b === 'object' && b !== null && (b as JsonSchema).type === 'null' && Object.keys(b).length === 1;
  const i = anyOf.findIndex(isNull);
  if (i < 0) return prop;
  const { anyOf: _anyOf, ...outer } = prop;
  return { ...(anyOf[1 - i] as JsonSchema), ...outer };
}

/**
 * 도구 입력 스키마 → 내보낼 JSON Schema. 변환 옵션은 MCP SDK(McpServer 의 tools/list)와 같다: registerTool 이 받은 shape 로 객체를 다시 만들고
 * draft-07·입력 기준(io:'input')으로 바꾼다. 그 위에서 도구마다 반복되는 `$schema`, 정보 없는 제약, 표식이 붙은 입력의 null 갈래를 지운다.
 */
export function wireInputSchema(schema: z.ZodType): JsonSchema {
  const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
  const { $schema: _draft, ...json } = z.toJSONSchema(z.object(shape), { target: 'draft-07', io: 'input' }) as JsonSchema;
  const properties = (json.properties ?? {}) as Record<string, JsonSchema>;
  const props = Object.fromEntries(
    Object.entries(properties).map(([key, prop]) => [key, isNullAsOmitted(shape[key] as z.ZodType) ? dropNullBranch(prop) : prop]),
  );
  return stripTrivialConstraints({ ...json, properties: props }) as JsonSchema;
}

/** tools/list 의 도구 한 건 — MCP Tool 모양 중 이 서버가 쓰는 키만. */
export interface ToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: McpToolAnnotations;
}

/**
 * MCP 스펙의 annotations 기본값(클라이언트가 힌트를 못 받았을 때 가정하는 값). 정의에 같은 값을 또 적어도 정보가 없어 직렬화에서 뺀다.
 * destructiveHint:true 도 뺀다(WP-340 웨이브 5, 컨트롤러 결정) — 빠진 힌트는 스펙상 true 와 같고, 힌트를 못 받은 클라이언트는 도구를
 * "파괴적일 수 있음"으로 다룬다(보수적인 쪽). 그래서 어떤 도구도 덜 보호되지 않는다. 기본값과 다른 destructiveHint:false·openWorldHint:false 는 남는다.
 * openWorldHint(기본 true)는 우리 값(false)과 달라 항상 남는다.
 */
const SPEC_DEFAULT_ANNOTATIONS = { readOnlyHint: false, idempotentHint: false, destructiveHint: true } as const satisfies McpToolAnnotations;

/** annotations 에서 스펙 기본값과 같은 값만 뺀다. 의미 원본은 toolAnnotations() 이고, 이 함수는 직렬화 단계에서만 쓴다(정의를 기본값으로 채우면 원본과 같다 — 테스트가 고정). */
function omitSpecDefaults(annotations: McpToolAnnotations): McpToolAnnotations {
  const out: McpToolAnnotations = { ...annotations };
  for (const key of ['readOnlyHint', 'idempotentHint', 'destructiveHint'] as const) {
    if (out[key] === SPEC_DEFAULT_ANNOTATIONS[key]) delete out[key];
  }
  return out;
}

/**
 * 공유 도구 → tools/list 항목. 표시 이름은 최상위 title 하나로 둔다 — annotations.title 은 title 이 생기기 전(MCP 2025-03-26) 클라이언트용 중복이라 뺀다.
 * `execution`(작업 지원 여부)은 싣지 않는다 — 스펙 기본값이 "forbidden" 으로 SDK 가 붙이던 값과 같다.
 * annotations 는 스펙 기본값과 같은 값(readOnlyHint:false·idempotentHint:false·destructiveHint:true)을 뺀다 — 기본값과 다른 값(destructiveHint:false·openWorldHint:false 등)은 남긴다.
 */
export function toolDefinition(tool: SharedTool): ToolDefinition {
  const { title, ...annotations } = toolAnnotations(tool);
  return {
    name: tool.name,
    ...(title !== undefined && { title }),
    description: tool.description,
    inputSchema: wireInputSchema(tool.inputSchema),
    annotations: omitSpecDefaults(annotations),
  };
}

/** 한글 음절·자모 — 토큰 근사에서 따로 센다. */
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/g;

/**
 * 토큰 수 근사(README "도구 정의 크기"). 토크나이저 없이 테스트에서 쓰려고 단순한 식을 고정한다:
 * 한글 글자는 1자 = 1토큰, 나머지(영문·숫자·JSON 구두점)는 3.5자 = 1토큰. 소수점은 올린다.
 */
export function estimateTokens(text: string): number {
  const hangul = text.match(HANGUL)?.length ?? 0;
  return Math.ceil(hangul + (text.length - hangul) / 3.5);
}

/** 도구 정의 크기 — 직렬화한 JSON 의 글자 수·한글 수·근사 토큰, 그리고 도구별 근사 토큰(큰 순). */
export interface ToolDefinitionSize {
  tools: number;
  chars: number;
  hangul: number;
  tokens: number;
  perTool: { name: string; tokens: number }[];
}

/** tools/list 로 나가는 도구 정의 배열의 크기를 잰다(JSON.stringify 기준 — 전송 본문과 같은 직렬화). */
export function toolDefinitionsSize(tools: readonly SharedTool[]): ToolDefinitionSize {
  const defs = tools.map(toolDefinition);
  const text = JSON.stringify(defs);
  return {
    tools: defs.length,
    chars: text.length,
    hangul: text.match(HANGUL)?.length ?? 0,
    tokens: estimateTokens(text),
    perTool: defs.map((d) => ({ name: d.name, tokens: estimateTokens(JSON.stringify(d)) })).sort((a, b) => b.tokens - a.tokens),
  };
}

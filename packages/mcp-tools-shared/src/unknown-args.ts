// src/unknown-args.ts — 도구 호출의 「모르는 인자 이름」 판정(WP-1568). workplace-mcp·workplace-ai-agent 가 함께 쓴다.
// 두 서버는 도구 입력 스키마를 SDK 에 넘겨 검증받는데, 기본 z.object 는 모르는 키를 오류 없이 지운다(strip). 그래서 모델·사용자가
// create_issue 에 description·parentKey 처럼 틀린 이름을 보내면 그 값만 조용히 사라진 채 호출이 성공했다. 여기서는
// (1) SDK 가 모르는 키를 지우지 않고 핸들러까지 넘기게 하는 스키마와 (2) 그 키를 찾아 오류 문구를 만드는 판정을 둔다.
import { z } from 'zod';

/**
 * 입력 스키마가 객체 스키마인지 — instanceof 대신 zod 4 내부 def 의 type 으로 본다. 앱과 이 패키지가 서로 다른 zod 사본을 들고 있어도
 * (pnpm 해석이 갈리면) 판정이 흔들리지 않게 하려는 것이다. 객체가 아니면(유니온 등) 판정하지 않는다(지금 도구는 모두 객체다).
 */
function isObjectSchema(schema: z.ZodType): schema is z.ZodObject<z.ZodRawShape> {
  return (schema as { _zod?: { def?: { type?: string } } })._zod?.def?.type === 'object';
}

/**
 * SDK 에 넘길 입력 스키마 — 원래 객체 스키마에 모르는 키를 남기는 catchall(`.loose()`)을 건다. 그래야 SDK 검증을 거친 args 에
 * 모르는 키가 남아 핸들러가 `unknownArgsMessage` 로 판정할 수 있다(shape 를 넘기면 SDK 가 기본 z.object 로 다시 만들어 지워 버린다).
 *
 * 모델에 보이는 도구 정의는 바꾸지 않는다: `.loose()` 는 JSON Schema 에 `additionalProperties: {}` 를 더하는데(뜻은 생략과 같지만
 * 도구마다 글자가 늘어난다), zod 의 toJSONSchema 는 처리 뒤 메타데이터를 덮어쓰므로 `additionalProperties: undefined` 메타로 그 키를
 * 지운다(JSON 직렬화에서 빠진다). 객체 자체에 붙어 있던 메타(description 등)는 이어 붙인다. 테스트가 원래 스키마와 같은 JSON 을 고정한다.
 * 메타는 스키마 자신의 `.meta()` 로 읽고 쓴다 — 이 패키지의 z.globalRegistry 를 쓰면 앱의 zod 사본과 레지스트리가 갈릴 수 있다.
 * 객체가 아니거나 이미 catchall 을 정한 객체(.strict()·.loose())는 그대로 돌려준다 — 그 스키마가 정한 모르는 키 정책을 바꾸지 않는다.
 */
export function inputSchemaKeepingUnknownArgs(schema: z.ZodType): z.ZodType {
  if (!isObjectSchema(schema) || schema._zod.def.catchall) return schema;
  return schema.loose().meta({ ...(schema.meta() ?? {}), additionalProperties: undefined });
}

/**
 * 인자 객체에 스키마가 모르는 이름이 있으면 오류 문구를, 없으면 null 을 돌려준다.
 * - 문구: `알 수 없는 인자: description, parentKey — 쓸 수 있는 인자: projectKey, title, …` — 모델이 이름을 고쳐 다시 부를 수 있게
 *   스키마의 인자 이름을 모두 알려 준다.
 * - 아는 인자의 값이 null 인 것은 막지 않는다(WP-346 — 모델이 안 쓰는 인자를 null 로 채워 보낸다). 막는 것은 이름뿐이고 값 검증은 스키마가 한다.
 * - 스키마가 객체가 아니거나 인자가 객체가 아니면(undefined 등) 판정하지 않는다(null).
 */
export function unknownArgsMessage(schema: z.ZodType, args: unknown): string | null {
  if (!isObjectSchema(schema) || !args || typeof args !== 'object' || Array.isArray(args)) return null;
  const shape = schema.shape;
  const known = Object.keys(shape);
  const unknown = Object.keys(args).filter((k) => !Object.hasOwn(shape, k));
  if (unknown.length === 0) return null;
  return `알 수 없는 인자: ${unknown.join(', ')} — 쓸 수 있는 인자: ${known.length > 0 ? known.join(', ') : '없음'}`;
}

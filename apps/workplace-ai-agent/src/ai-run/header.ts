import { z } from 'zod';
import type { AiRunContext } from './types.js';

/** 맥락 헤더 이름 (Express 는 소문자로 읽는다). */
export const AI_RUN_HEADER = 'x-ai-run';

/** 필드별 검사기. 틀린 필드는 그 필드만 버리기 위해 하나씩 safeParse 한다. */
const FIELD_SCHEMAS = {
  runId: z.string().uuid(),
  kind: z.string().min(1),
  targetType: z.string(),
  targetId: z.string(),
  targetLabel: z.string(),
  actorType: z.enum(['AUTO', 'USER', 'AGENT']),
  // API 의 Long actorId — 숫자 또는 숫자 문자열(숫자로 바꿔 담는다). 그 밖은 버린다.
  actorId: z.union([z.number().int(), z.string().regex(/^\d+$/).transform(Number)]),
  // API 의 OffsetDateTime — 오프셋이 있는 ISO 시각만.
  sourceAt: z.string().datetime({ offset: true }),
  tenantId: z.number().int(),
  attempt: z.number().int().positive(),
} as const;

/**
 * X-AI-Run 값(base64url(JSON))을 해석한다 (WP-1828).
 * 형식 오류(base64 아님·JSON 아님·객체 아님)는 null — 호출부는 헤더 없음처럼 다룬다.
 * 필드 타입·형식(runId UUID, sourceAt ISO)이 틀리면 그 필드만 빠지고 나머지는 유지한다. 패딩 유무 모두 허용.
 */
export function parseAiRunHeader(raw: string | undefined): AiRunContext | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const src = parsed as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(FIELD_SCHEMAS)) {
    if (!(key in src)) continue;
    const r = schema.safeParse(src[key]);
    if (r.success) out[key] = r.data;
  }
  return out as AiRunContext;
}

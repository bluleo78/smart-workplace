// 생각의 깊이(thinking depth, WP-1322) — 비서 설정 값을 모델이 실제로 받는 추론 노력 단계로 옮긴다.
// 예전(NONE/NORMAL/DEEP)엔 시스템 프롬프트에 문장 하나를 덧붙였을 뿐이라 모델의 추론량은 바뀌지 않았다.
// 이제 Claude 는 Agent SDK `Options.effort`, OpenAI 호환(opencode)은 모델 variant(`variant: 'high'` 등)로 그대로 넘긴다.
//   DEFAULT(설정 안 함) → 아무것도 싣지 않는다(모델 기본값). LOW·MEDIUM·HIGH·XHIGH·MAX → 소문자 단계.
import type { EffortLevel } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

/** 추론 노력 단계 — Agent SDK EffortLevel 그대로(Anthropic Models API capabilities.effort·opencode variant 키도 같은 이름). */
export type { EffortLevel };

/** 낮은 순 단계 — 모델 목록의 지원 단계 순서도 이 순서를 따른다. */
export const EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** 비서 설정의 생각의 깊이(workplace-api assistant_config.thinking_depth). */
export type ThinkingDepth = 'DEFAULT' | 'LOW' | 'MEDIUM' | 'HIGH' | 'XHIGH' | 'MAX';

const DEPTHS = ['DEFAULT', 'LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'MAX'] as const;
// 옛 값 — 롤링 배포 중 구 api 가 보내거나 이관 전 행이 남아 있을 수 있어 받되 DEFAULT 로 다룬다(400 으로 거절하면 대화가 끊긴다).
const LEGACY_DEPTHS = ['NONE', 'NORMAL', 'DEEP'] as const;

/** 요청 본문 검증 — 새 값은 그대로, 옛 값은 DEFAULT 로 바꿔 돌려준다(routes/home.ts·wiki.ts 공용). */
export const thinkingDepthSchema = z
  .enum([...DEPTHS, ...LEGACY_DEPTHS])
  .transform((v): ThinkingDepth => ((LEGACY_DEPTHS as readonly string[]).includes(v) ? 'DEFAULT' : (v as ThinkingDepth)));

/** 생각의 깊이 → 러너에 넘길 추론 노력 단계. DEFAULT(와 모르는 값)는 undefined — 아무것도 싣지 않아 모델 기본값으로 돈다. */
export function effortFor(depth: ThinkingDepth | string | undefined): EffortLevel | undefined {
  if (!depth || depth === 'DEFAULT') return undefined;
  const level = depth.toLowerCase() as EffortLevel;
  return EFFORT_LEVELS.includes(level) ? level : undefined;
}

/** 모델이 지원하는 단계 키 → 단계 목록(소문자, 낮은 순). 단계가 아닌 키(minimal·none 등)는 버린다. 대문자로는 HTTP 경계(routes/models.ts)에서만 바꾼다. */
export function effortsList(supported: Iterable<string>): EffortLevel[] {
  const set = new Set(supported);
  return EFFORT_LEVELS.filter((l) => set.has(l));
}

/** 고른 단계를 받는 단계로 맞춘다 — 받으면 그대로, 아니면 그보다 낮은 단계 중 가장 높은 것, 없으면 undefined(설정 안 함). */
export function clampEffort(level: EffortLevel, supported: readonly EffortLevel[]): EffortLevel | undefined {
  return EFFORT_LEVELS.slice(0, EFFORT_LEVELS.indexOf(level) + 1)
    .reverse()
    .find((l) => supported.includes(l));
}

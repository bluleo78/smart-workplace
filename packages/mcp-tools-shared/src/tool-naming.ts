// src/tool-naming.ts — 도구 이름 규칙 검사(WP-347). 규칙의 근거와 설명은 패키지 README "도구 명명 규칙" 절.
// 공유 도구(이 패키지 tool-naming.test.ts)와 ai-agent 전용 도구(ai-agent tools.test.ts)가 같은 판정을 쓰도록 한 곳에 둔다.

/** 이름 길이 상한 — Anthropic API 의 도구 이름 64자 − 외부 MCP 접두 `mcp__genia-works__`(18자). */
export const TOOL_NAME_MAX_LENGTH = 46;

/** snake_case: 소문자로 시작하고, `_` 로 이은 토큰은 소문자·숫자(`동사_명사[_한정어]`). */
const TOOL_NAME_PATTERN = /^[a-z]+(_[a-z0-9]+)*$/;

/** 새로 쓰지 않는 동사 접두. 쓰기는 `create_`/`update_`(독립 리소스)·`add_`/`remove_`(관계·하위 항목)로 표현한다. */
const FORBIDDEN_VERB_PREFIXES = ['edit_', 'save_', 'set_'] as const;

/** ai-agent 전용 접두 — 확인 카드 `propose_<원 도구명>`. 뒤에 오는 원 도구명에도 같은 금지 접두 규칙을 적용한다(`propose_set_*` 위반). */
const AGENT_ONLY_PREFIX = 'propose_';

/**
 * 이름이 기계적으로 검사 가능한 규칙을 어기는 부분을 사유 목록으로 돌려준다(위반 없으면 빈 배열).
 * `get_` 이 여러 건을 돌려주는지 같은 의미 규칙은 기계로 가릴 수 없어 여기서 다루지 않는다(각 테스트의 예외 배열에서 손으로 관리).
 */
export function toolNameViolations(name: string): string[] {
  const violations: string[] = [];
  if (!TOOL_NAME_PATTERN.test(name)) violations.push('snake_case(`^[a-z]+(_[a-z0-9]+)*$`) 가 아님');
  if (name.length > TOOL_NAME_MAX_LENGTH) violations.push(`${TOOL_NAME_MAX_LENGTH}자 초과(${name.length}자)`);
  const verbPart = name.startsWith(AGENT_ONLY_PREFIX) ? name.slice(AGENT_ONLY_PREFIX.length) : name;
  const forbidden = FORBIDDEN_VERB_PREFIXES.find((p) => verbPart.startsWith(p));
  if (forbidden) violations.push(`금지 접두 \`${forbidden}\``);
  return violations;
}

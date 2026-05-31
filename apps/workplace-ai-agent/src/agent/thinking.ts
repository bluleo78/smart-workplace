// 생각의 깊이(thinking depth) → system-prompt 지시문 매핑.
// CLI 에 thinking 예산 플래그가 없어 프롬프트 지시로 근사한다. NONE/NORMAL/DEEP.

export type ThinkingDepth = 'NONE' | 'NORMAL' | 'DEEP';

const DIRECTIVES: Record<ThinkingDepth, string> = {
  NONE: '',
  NORMAL: '\n\n답하기 전에 필요한 만큼 단계적으로 생각하세요.',
  DEEP: '\n\n답하기 전에 충분히 깊게, 여러 가능성을 단계적으로 따져 추론한 뒤 신중하게 답하세요.',
};

/** depth 에 해당하는 system-prompt 접미 지시문. 알 수 없으면 NORMAL. */
export function thinkingDirective(depth: ThinkingDepth): string {
  return DIRECTIVES[depth] ?? DIRECTIVES.NORMAL;
}

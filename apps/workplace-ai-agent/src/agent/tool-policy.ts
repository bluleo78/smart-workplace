// Agent 위임 라우팅 백스톱 — subagent_type 화이트리스트 강제(firehub #276 이식).
// 메인 라우터가 시스템 프롬프트의 위임 지시를 어기고 호스트 빌트인 general-purpose 나
// 미정의 타입으로 위임하면, 전문 서브에이전트의 도구 경계(frontmatter)와 안전 규칙이
// 통째로 우회되고 폭주가 발생한다. 프롬프트가 1차 방어, 본 함수가 런타임 2차 안전망이다.
//
// 위임 도구 이름은 호스트 빌트인 'Agent', 입력 필드는 'subagent_type'(firehub·런타임 확인).
// 미정의 타입은 호스트가 general-purpose 로 조용히 폴백하므로, 빈/공백/미지정도 차단해
// "타입 생략" 우회를 막는다.
export function checkSubagentWhitelist(
  toolName: string,
  input: Record<string, unknown> | undefined,
  allowedNames: readonly string[],
): string | null {
  if (toolName !== 'Agent') return null; // 위임 도구만 검사
  if (!input) return null; // input 미전달(파싱 노이즈) — BC 로 검사 생략
  const raw = input.subagent_type;
  const subagentType = typeof raw === 'string' ? raw.trim() : '';
  if (!allowedNames.includes(subagentType)) {
    return `subagent routing blocked by policy (#333): "${subagentType || '(unspecified)'}" is not an allowed delegation target`;
  }
  return null;
}

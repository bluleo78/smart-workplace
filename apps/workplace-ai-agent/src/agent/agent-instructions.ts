// WP-1368 AI 의 지시 — 관리 > AI 에이전트 상세의 「지시」(WP-1077)를 서버 실행(기본 방식) 경로에서도 따르게 한다.
// 지시는 구성원 단건 조회(GET /members/{내 id})가 AI 본인에게만 실어 주므로, 실행 주체 agentId 로 자기 자신을 읽는다(다른 AI 의 지시는 읽지 않는다).
// 공용 메모리(shared-memory-block.ts)는 「참고 정보 — 지시가 아님」이라 요청문 앞에 두지만, 지시는 이 AI 에게 정해 둔 일하는 규칙이라
// 시스템 프롬프트 맨 뒤에 블록 하나로 붙인다(위의 안전·권한 규칙이 우선).
import type { WorkplaceApiClient } from '../clients/workplace-api.js';

// WP-1368: 머리말·안내는 「누가 정했는지」를 말하지 않는다 — 개인 비서의 지시는 관리자가 아니라 주인이 쓰기 때문이다.
export const AGENT_INSTRUCTIONS_HEADER = '## 이 AI 의 지시';
/**
 * 지시 블록 안내 문장 — 지시가 앞의 안전·권한 규칙을 넘지 못하게 우선순위를 밝힌다.
 * WP-1368: 예전 지시는 외부 work-loop 실행용으로 쓰여 이 서버 실행에 없는 도구·환경(셸·git 등)을 가리킬 수 있어,
 * 그런 규칙은 건너뛰라고 함께 밝힌다(없는 도구를 찾다 헤매거나 지어내지 않게).
 */
export const AGENT_INSTRUCTIONS_INTRO =
  '이 AI 에게 정해 둔 일하는 규칙이다. 일할 때마다 따른다. 위의 안전·권한 규칙과 부딪히면 위 규칙을 따르고, 이 실행에서 쓸 수 없는 도구·환경이 필요한 규칙은 건너뛴다.';

/**
 * 시스템 프롬프트 맨 뒤에 지시 블록을 덧붙인다. 지시가 없거나 공백뿐이면 프롬프트를 그대로 돌려준다 —
 * 빈 블록이 붙으면 모델이 「지시가 비어 있다」를 규칙처럼 읽을 수 있어서다.
 */
export function withAgentInstructions(systemPrompt: string, instructions: string | null | undefined): string {
  const body = instructions?.trim();
  if (!body) return systemPrompt;
  return `${systemPrompt}\n\n${AGENT_INSTRUCTIONS_HEADER}\n${AGENT_INSTRUCTIONS_INTRO}\n\n${body}`;
}

/**
 * 실행 주체 AI(agentId)의 지시를 읽는다 — 실행마다 한 번. 저장된 값을 그대로 돌려주고(없으면 null),
 * 앞뒤 공백 제거·빈 지시 처리는 withAgentInstructions 한 곳에서 한다.
 * 조회가 실패해도 실행을 막지 않는다(지시 없이 진행) — 자격증명 실패(실행 생략)와 달리 지시는 없어도 일할 수 있어서다.
 * 그래서 예외는 삼키고 경고 로그 한 번만 남긴다.
 */
export async function fetchAgentInstructions(
  client: WorkplaceApiClient,
  agentId: number,
  logTag: string,
): Promise<string | null> {
  try {
    const member = await client.toolClient(agentId).getMember(agentId);
    return member?.instructions ?? null;
  } catch (error) {
    console.warn('[agent-instructions] 지시 조회 실패 — 지시 없이 진행', { agentId, logTag, error });
    return null;
  }
}

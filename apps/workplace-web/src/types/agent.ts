// 에이전트 관리 목록 항목 — 백엔드 AgentResponse 와 1:1 매칭.
// type: PERSONAL=개인 비서(소유자 있음) · WORKSPACE=공통 비서(테넌트 지정) · REGULAR=일반.
// runtime/lastKeyUsedAt 은 WP-371 추가. ownerName 은 PERSONAL 일 때 소유자(사람) 이름, 그 외 null.

export type AgentType = 'PERSONAL' | 'WORKSPACE' | 'REGULAR';

// 실행 방식: INTERNAL=서버의 AI 가 이슈·멘션 처리 · EXTERNAL=사용자 키로 접속한 외부 에이전트가 처리(서버 이벤트 제외).
export type AgentRuntime = 'INTERNAL' | 'EXTERNAL';

export interface AgentResponse {
  id: number;
  username: string;
  email: string | null;
  name: string;
  isActive: boolean;
  createdAt: string;
  type: AgentType;
  ownerName: string | null;
  runtime: AgentRuntime;
  // 설명 — 다른 AI 가 일을 맡길 상대를 고를 때 읽는다(WP-455). 비어 있으면 null.
  description: string | null;
  // 지시 — 이 AI 가 일할 때마다 따르는 규칙(WP-1077). 다른 AI 는 보지 않는다. 비어 있으면 null.
  instructions: string | null;
  // 비회수 키의 마지막 사용 시각(ISO). 한 번도 안 썼으면 null.
  lastKeyUsedAt: string | null;
}

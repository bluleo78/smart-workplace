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
  // 비회수 키의 마지막 사용 시각(ISO). 한 번도 안 썼으면 null.
  lastKeyUsedAt: string | null;
}

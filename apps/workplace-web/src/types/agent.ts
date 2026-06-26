// 에이전트 관리 목록 항목 — 백엔드 AgentResponse 와 1:1 매칭.
// type: PERSONAL=개인 비서(소유자 있음) · WORKSPACE=공통 비서(테넌트 지정) · REGULAR=일반.
// ownerName 은 PERSONAL 일 때 소유자(사람) 이름, 그 외 null.

export type AgentType = 'PERSONAL' | 'WORKSPACE' | 'REGULAR';

export interface AgentResponse {
  id: number;
  username: string;
  email: string | null;
  name: string;
  isActive: boolean;
  createdAt: string;
  type: AgentType;
  ownerName: string | null;
}

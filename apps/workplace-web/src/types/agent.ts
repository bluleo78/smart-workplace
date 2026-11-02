// 에이전트 관리 목록 항목 — 백엔드 AgentResponse 와 1:1 매칭.
// type: PERSONAL=개인 비서(소유자 있음) · WORKSPACE=공통 비서(테넌트 지정) · REGULAR=일반.
// runtime/lastKeyUsedAt 은 WP-371 추가. ownerName 은 PERSONAL 일 때 소유자(사람) 이름, 그 외 null.

export type AgentType = 'PERSONAL' | 'WORKSPACE' | 'REGULAR';

// 실행 방식: INTERNAL=서버의 AI 가 이슈·멘션 처리 · EXTERNAL=사용자 키로 접속한 외부 에이전트가 처리(서버 이벤트 제외).
export type AgentRuntime = 'INTERNAL' | 'EXTERNAL';

// 서버가 판정한 실제 실행 방식(WP-1273) — SERVER=「기본」(서버가 이슈·멘션에 바로 답함) · WORKSPACE=Works 가 작업 공간을 띄워 실행(Claude Code 등)
// · EXTERNAL=직접 띄운 도구가 키로 접속. runtime(DB 값)만으로는 작업 공간 AI 와 외부 AI 가 구분되지 않아 화면은 이 값으로 판정한다.
export type AgentRunMode = 'SERVER' | 'WORKSPACE' | 'EXTERNAL';

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
  runMode: AgentRunMode;
  // 설명 — 다른 AI 가 일을 맡길 상대를 고를 때 읽는다(WP-455). 비어 있으면 null.
  description: string | null;
  // 지시 — 이 AI 가 일할 때마다 따르는 규칙(WP-1077). 다른 AI 는 보지 않는다. 비어 있으면 null.
  instructions: string | null;
  // 비회수 키의 마지막 사용 시각(ISO). 한 번도 안 썼으면 null.
  lastKeyUsedAt: string | null;
}

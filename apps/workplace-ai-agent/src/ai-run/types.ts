/**
 * AI 처리 한 건 기록의 공용 타입 (WP-1828).
 * API 의 AiRunRecord 와 필드 이름을 맞춘다 — 값이 없으면 생략하지 않고 null 로 보낸다.
 */

/** 처리 주체 종류 — AUTO(반복 실행 등 자동), USER(사람), AGENT(AI). */
export type AiRunActorType = 'AUTO' | 'USER' | 'AGENT';

/** X-AI-Run 헤더에 실리는 맥락. 모든 필드가 선택이다. */
export interface AiRunContext {
  runId?: string;
  kind?: string;
  targetType?: string;
  targetId?: string;
  targetLabel?: string;
  actorType?: AiRunActorType;
  actorId?: number;
  sourceAt?: string;
  tenantId?: number;
  attempt?: number;
}

/** API 로 보내는 기록 한 건. 값이 없는 필드는 null. 시각은 ISO-8601 문자열. */
export interface AiRunRecord {
  runId: string;
  tenantId: number | null;
  kind: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  actorType: AiRunActorType | null;
  actorId: number | null;
  sourceAt: string | null;
  startedAt: string;
  endedAt: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  model: string | null;
  credentialLabel: string | null;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  errorReason: string | null;
  errorDetail: string | null;
  attempt: number;
}

/** 기록을 받아 가는 곳(묶음 전송기). enqueue 는 응답 경로를 막지 않아야 한다. */
export interface AiRunSink {
  enqueue(record: AiRunRecord): void;
}

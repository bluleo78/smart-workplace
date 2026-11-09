// AI 계정 목록(WP-1451) 화면 테스트 도구 — 계정·사용량 팩토리. 계정 탭·계정 창·AI 상세의 계정 고르기 테스트가 같은 데이터 모양을 쓴다.
import type { AccountUsage, AgentAccountResponse } from '@/types/agentAccount';

/** 사용량 블록 — 기본은 조회 전(UNKNOWN, 창 없음). */
export function createUsage(over: Partial<AccountUsage> = {}): AccountUsage {
  return {
    status: 'UNKNOWN',
    fiveHour: null,
    weekly: null,
    checkedAt: null,
    succeededAt: null,
    errorCode: null,
    errorMessage: null,
    lastUsedAt: null,
    ...over,
  };
}

/** 계정 하나 — 기본은 AI 하나가 쓰는 정상 Claude 구독 계정(사용량 조회 전). */
export function createAccount(over: Partial<AgentAccountResponse> = {}): AgentAccountResponse {
  return {
    id: 1,
    provider: 'anthropic',
    label: 'Claude 팀 계정',
    accountEmail: null,
    lastRefreshedAt: null,
    status: 'ACTIVE',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    agents: [{ userId: 11, username: 'dev-ai', name: '개발 AI' }],
    usage: createUsage(),
    ...over,
  };
}

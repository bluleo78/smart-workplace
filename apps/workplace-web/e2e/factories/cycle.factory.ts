import type { CycleResponse } from '../../src/types/cycle';

// 사이클 응답 팩토리 — E2E 와 페이지 테스트(MSW)가 같은 모양을 쓴다.
export function createCycle(overrides: Partial<CycleResponse> = {}): CycleResponse {
  const now = new Date().toISOString();
  return {
    id: 1,
    projectId: 1,
    name: '스프린트 1',
    goal: null,
    startDate: null,
    endDate: null,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

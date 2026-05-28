import type { MemberResponse, ProjectResponse } from '../../src/types/project';

// 테스트용 프로젝트 객체 팩토리.
export function createProject(overrides: Partial<ProjectResponse> = {}): ProjectResponse {
  const now = new Date().toISOString();
  return {
    id: 1,
    key: 'WP',
    name: 'Workplace',
    description: 'v1',
    ownerId: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// 테스트용 프로젝트 멤버 객체 팩토리.
export function createMember(overrides: Partial<MemberResponse> = {}): MemberResponse {
  const now = new Date().toISOString();
  return {
    userId: 1,
    username: 'tester@example.com',
    name: 'Tester',
    kind: 'HUMAN',
    role: 'OWNER',
    createdAt: now,
    ...overrides,
  };
}

// AGENT 멤버 팩토리 — 픽커 시각 구분 테스트용.
export function createAgentMember(overrides: Partial<MemberResponse> = {}): MemberResponse {
  return createMember({
    userId: 99,
    username: 'ai-agent',
    name: 'AI Agent',
    kind: 'AGENT',
    role: 'MEMBER',
    ...overrides,
  });
}

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
    role: 'OWNER',
    createdAt: now,
    ...overrides,
  };
}

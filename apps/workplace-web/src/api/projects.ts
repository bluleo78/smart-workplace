// 프로젝트 / 멤버 API 클라이언트.

import type { PageResponse } from '../types/common';
import type {
  AddMemberRequest,
  CreateProjectRequest,
  MemberResponse,
  ProjectMemberGroup,
  ProjectResponse,
  UpdateMemberRoleRequest,
  UpdateProjectRequest,
} from '../types/project';
import { client } from './client';

export const projectsApi = {
  list: (params: { page?: number; size?: number } = {}) =>
    client.get<PageResponse<ProjectResponse>>('/projects', { params }),
  get: (key: string) => client.get<ProjectResponse>(`/projects/${key}`),
  create: (data: CreateProjectRequest) => client.post<ProjectResponse>('/projects', data),
  update: (key: string, data: UpdateProjectRequest) =>
    client.patch<ProjectResponse>(`/projects/${key}`, data),
  remove: (key: string) => client.delete<void>(`/projects/${key}`),

  listMembers: (key: string) => client.get<MemberResponse[]>(`/projects/${key}/members`),
  addMember: (key: string, data: AddMemberRequest) =>
    client.post<MemberResponse>(`/projects/${key}/members`, data),
  updateMemberRole: (key: string, userId: number, data: UpdateMemberRoleRequest) =>
    client.patch<void>(`/projects/${key}/members/${userId}`, data),
  removeMember: (key: string, userId: number) =>
    client.delete<void>(`/projects/${key}/members/${userId}`),
  // 멤버가 담당 중인 이슈 수 — 제거 확인창의 영향 안내(WP-488).
  memberAssignedIssueCount: (key: string, userId: number) =>
    client.get<{ count: number }>(`/projects/${key}/members/${userId}/assigned-issue-count`).then((r) => r.data.count),

  // 멤버로 둔 조직도 부서(WP-1057) — 팀 프로젝트(TEAM·OPEN)만. 역할은 MEMBER 고정이라 역할 변경 API 는 없다.
  listMemberGroups: (key: string) => client.get<ProjectMemberGroup[]>(`/projects/${key}/member-groups`),
  addMemberGroup: (key: string, groupId: number) =>
    client.post<ProjectMemberGroup>(`/projects/${key}/member-groups`, { groupId, role: 'MEMBER' }),
  removeMemberGroup: (key: string, groupId: number) =>
    client.delete<void>(`/projects/${key}/member-groups/${groupId}`),

  // 내 프로젝트 즐겨찾기(WP-1001) — 서버에 사용자·워크스페이스별로 저장. 추가·해제는 key 하나씩(멱등).
  listFavorites: () =>
    client.get<{ projectKeys: string[] }>('/me/project-favorites').then((r) => r.data.projectKeys),
  addFavorite: (key: string) => client.put<void>(`/me/project-favorites/${encodeURIComponent(key)}`),
  removeFavorite: (key: string) => client.delete<void>(`/me/project-favorites/${encodeURIComponent(key)}`),
  // 브라우저에만 있던 즐겨찾기를 한 번 올린다 — 서버가 없는·볼 수 없는 key 는 건너뛰고 올린 뒤 목록을 돌려준다.
  importFavorites: (projectKeys: string[]) =>
    client
      .post<{ projectKeys: string[] }>('/me/project-favorites/import', { projectKeys })
      .then((r) => r.data.projectKeys),
};

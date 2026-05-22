// 프로젝트 / 멤버 API 클라이언트.

import type { PageResponse } from '../types/common';
import type {
  AddMemberRequest,
  CreateProjectRequest,
  MemberResponse,
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
};

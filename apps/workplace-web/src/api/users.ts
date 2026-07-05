import type { UserResponse } from '../types/auth';
import type { PageResponse } from '../types/common';
import type { ChangePasswordRequest, CreateMemberRequest, MemberResponse, SetActiveRequest,SetRolesRequest, UpdateProfileRequest, UserDetailResponse } from '../types/user';
import { client } from './client';

export const usersApi = {
  getMe: () => client.get<UserDetailResponse>('/users/me'),
  updateMe: (data: UpdateProfileRequest) => client.put('/users/me', data),
  changePassword: (data: ChangePasswordRequest) => client.put('/users/me/password', data),
  // kind 미지정 시 백엔드 기본값(HUMAN)만 노출. DM 수신자 검색 등 에이전트 포함이 필요한 호출부만 'AGENT'|'ALL' 명시(#691).
  getUsers: (params: { search?: string; page?: number; size?: number; kind?: 'HUMAN' | 'AGENT' | 'ALL' }) =>
    client.get<PageResponse<UserResponse>>('/users', { params }),
  getUserById: (id: number) => client.get<UserDetailResponse>(`/users/${id}`),
  setUserRoles: (id: number, data: SetRolesRequest) => client.put(`/users/${id}/roles`, data),
  setUserActive: (id: number, data: SetActiveRequest) => client.put(`/users/${id}/active`, data),
  createMember: (data: CreateMemberRequest) => client.post<MemberResponse>('/users', data),
};

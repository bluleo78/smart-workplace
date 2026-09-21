// 계정(사용자) 관리 API — 생성·역할변경·활성토글·내 프로필. 구성원 목록/검색은 계정 관리가 아니라
// 디렉터리 조회이므로 api/members.ts 를 쓴다 (#833).
import type { ChangePasswordRequest, CreateMemberRequest, MemberResponse, SetActiveRequest,SetRolesRequest, UpdateProfileRequest, UserDetailResponse } from '../types/user';
import { client } from './client';

export const usersApi = {
  getMe: () => client.get<UserDetailResponse>('/users/me'),
  updateMe: (data: UpdateProfileRequest) => client.put('/users/me', data),
  changePassword: (data: ChangePasswordRequest) => client.put('/users/me/password', data),
  getUserById: (id: number) => client.get<UserDetailResponse>(`/users/${id}`),
  setUserRoles: (id: number, data: SetRolesRequest) => client.put(`/users/${id}/roles`, data),
  setUserActive: (id: number, data: SetActiveRequest) => client.put(`/users/${id}/active`, data),
  createMember: (data: CreateMemberRequest) => client.post<MemberResponse>('/users', data),
};

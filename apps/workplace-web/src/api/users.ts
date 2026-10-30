// 계정(사용자) 관리 API — 생성·역할변경·활성토글·내 프로필. 구성원 목록/검색은 계정 관리가 아니라
// 디렉터리 조회이므로 api/members.ts 를 쓴다 (#833).
import type { AvatarCrop, AvatarEntry, AvatarUploadResponse } from '../types/avatar';
import type { ChangePasswordRequest, CreateMemberRequest, MemberResponse, SetActiveRequest,SetRolesRequest, UpdateProfileRequest, UserDetailResponse } from '../types/user';
import { client } from './client';

/**
 * 아바타 업로드 본문(WP-1222) — multipart `file` + 선택 `cropX`·`cropY`·`cropSize`(원본 픽셀 정수).
 * 원본 파일을 그대로 보내고 자르기·다시 인코딩은 서버가 한다(EXIF 제거·여러 크기). AI 관리 화면의 업로드와 같이 쓴다.
 */
export function avatarFormData(file: File, crop?: AvatarCrop): FormData {
  const fd = new FormData();
  fd.append('file', file);
  if (crop) {
    fd.append('cropX', String(crop.cropX));
    fd.append('cropY', String(crop.cropY));
    fd.append('cropSize', String(crop.cropSize));
  }
  return fd;
}

/**
 * 아바타 업로드 요청 설정 — client 기본 헤더(application/json)를 multipart 로 덮는다(boundary 는 axios 가 채운다).
 * 내 아바타·AI 아바타 업로드가 같이 쓴다.
 */
export const MULTIPART = { headers: { 'Content-Type': 'multipart/form-data' } };

export const usersApi = {
  getMe: () => client.get<UserDetailResponse>('/users/me'),
  updateMe: (data: UpdateProfileRequest) => client.put('/users/me', data),
  changePassword: (data: ChangePasswordRequest) => client.put('/users/me/password', data),
  getUserById: (id: number) => client.get<UserDetailResponse>(`/users/${id}`),
  setUserRoles: (id: number, data: SetRolesRequest) => client.put(`/users/${id}/roles`, data),
  setUserActive: (id: number, data: SetActiveRequest) => client.put(`/users/${id}/active`, data),
  createMember: (data: CreateMemberRequest) => client.post<MemberResponse>('/users', data),
  /** 내 아바타 바꾸기(WP-1222) — 사람·AI(에이전트 토큰) 모두 자기 아바타를 바꾼다. 응답은 새 주소. */
  uploadMyAvatar: (file: File, crop?: AvatarCrop) =>
    client.put<AvatarUploadResponse>('/users/me/avatar', avatarFormData(file, crop), MULTIPART),
  /** 내 아바타를 기본(이니셜·색)으로 되돌린다. */
  deleteMyAvatar: () => client.delete<void>('/users/me/avatar'),
  /** 지금 워크스페이스에서 아바타가 있는 구성원 목록 — 화면은 한 번 받아 캐시하고 userId 로 찾는다(DTO 마다 필드를 더하지 않으려는 결정). */
  listAvatars: () => client.get<AvatarEntry[]>('/users/avatars'),
};

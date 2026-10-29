/** 사용자 그룹·조직도 API. 각 함수는 raw AxiosResponse 반환(호출부에서 .data). */
import type {
  AddMemberRequest,
  CreateUserGroupRequest,
  GroupMemberType,
  UpdateUserGroupRequest,
  UserGroupDetail,
  UserGroupMemberCount,
  UserGroupMemberHit,
  UserGroupTree,
} from '../types/userGroup'
import { client } from './client'

export const userGroupsApi = {
  tree: () => client.get<UserGroupTree>('/user-groups'),
  detail: (id: number) => client.get<UserGroupDetail>(`/user-groups/${id}`),
  /** 그룹과 하위 조직 전체에서 구성원 찾기(WP-1000). */
  searchMembers: (id: number, q: string) =>
    client.get<UserGroupMemberHit[]>(`/user-groups/${id}/members/search`, { params: { q } }),
  /** 그룹마다 하위 조직 포함 구성원 수(WP-1135) — 구성원 목록 없이 수만. ids 는 1~10개. */
  countMembers: (ids: number[]) =>
    client.get<UserGroupMemberCount[]>('/user-groups/member-counts', { params: { ids: ids.join(',') } }),
  create: (body: CreateUserGroupRequest) => client.post<UserGroupDetail>('/user-groups', body),
  update: (id: number, body: UpdateUserGroupRequest) =>
    client.patch<UserGroupDetail>(`/user-groups/${id}`, body),
  remove: (id: number) => client.delete<void>(`/user-groups/${id}`),
  addMember: (id: number, body: AddMemberRequest) =>
    client.post<UserGroupDetail>(`/user-groups/${id}/members`, body),
  removeMember: (id: number, targetType: GroupMemberType, targetId: number) =>
    client.delete<void>(`/user-groups/${id}/members/${targetType}/${targetId}`),
}

/** 사용자 그룹·조직도 API. 각 함수는 raw AxiosResponse 반환(호출부에서 .data). */
import type {
  AddMemberRequest,
  CreateUserGroupRequest,
  GroupMemberType,
  UpdateUserGroupRequest,
  UserGroupDetail,
  UserGroupTree,
} from '../types/userGroup'
import { client } from './client'

export const userGroupsApi = {
  tree: () => client.get<UserGroupTree>('/user-groups'),
  detail: (id: number) => client.get<UserGroupDetail>(`/user-groups/${id}`),
  create: (body: CreateUserGroupRequest) => client.post<UserGroupDetail>('/user-groups', body),
  update: (id: number, body: UpdateUserGroupRequest) =>
    client.patch<UserGroupDetail>(`/user-groups/${id}`, body),
  remove: (id: number) => client.delete<void>(`/user-groups/${id}`),
  addMember: (id: number, body: AddMemberRequest) =>
    client.post<UserGroupDetail>(`/user-groups/${id}/members`, body),
  removeMember: (id: number, targetType: GroupMemberType, targetId: number) =>
    client.delete<void>(`/user-groups/${id}/members/${targetType}/${targetId}`),
}

// 연락처 REST API client. 모든 함수는 AxiosResponse 반환 — 호출처에서 .data unwrap.

import type {
  ContactPage,
  ContactTypeFilter,
  ExternalContactDetail,
  MemberDetail,
} from '../types/contact'
import { client } from './client'

export const contactsApi = {
  // 멤버+외부 통합 목록/검색. cursor 없으면 첫 페이지.
  list: (params: { search?: string; type?: ContactTypeFilter; cursor?: string }) =>
    client.get<ContactPage>('/contacts', { params }),

  getMember: (userId: number) => client.get<MemberDetail>(`/contacts/members/${userId}`),

  getExternal: (id: number) => client.get<ExternalContactDetail>(`/contacts/external/${id}`),
}

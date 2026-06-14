import type {
  CreateTenantRequest,
  TenantDetail,
  TenantMember,
  TenantSummary,
} from '../types/platform'
import { client } from './client'

// 플랫폼(운영자) 테넌트 API.
// 백엔드 P5-A `/api/platform/tenants` 와 1:1 대응. baseURL 이 `/api/platform` 이므로 경로는 `/tenants` 부터.
export const platformTenants = {
  /** 테넌트 목록 조회 → TenantSummary[]. */
  list: () => client.get<TenantSummary[]>('/tenants').then((res) => res.data),
  /** 테넌트 단건 조회. */
  get: (id: number) => client.get<TenantDetail>(`/tenants/${id}`).then((res) => res.data),
  /** 테넌트 생성(201) → TenantDetail. */
  create: (req: CreateTenantRequest) =>
    client.post<TenantDetail>('/tenants', req).then((res) => res.data),
  /** 테넌트 멤버 목록(상세·Task 4). */
  members: (id: number) =>
    client.get<TenantMember[]>(`/tenants/${id}/members`).then((res) => res.data),
  /** 테넌트 정지. 백엔드는 204 No Content(바디 없음). */
  suspend: (id: number) => client.post<void>(`/tenants/${id}/suspend`).then(() => undefined),
  /** 테넌트 활성화. 백엔드는 204 No Content(바디 없음). */
  activate: (id: number) => client.post<void>(`/tenants/${id}/activate`).then(() => undefined),
}

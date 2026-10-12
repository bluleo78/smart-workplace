import type {
  AddExistingTenantMemberRequest,
  AddTenantMemberRequest,
  CreateTenantRequest,
  TenantDetail,
  TenantMember,
  TenantSummary,
  UpdateTenantRequest,
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
  /** 테넌트 이름·slug 수정(WP-336) → 갱신된 TenantDetail. slug 중복·형식 오류는 400. */
  update: (id: number, req: UpdateTenantRequest) =>
    client.patch<TenantDetail>(`/tenants/${id}`, req).then((res) => res.data),
  /** 테넌트 멤버 목록(상세·Task 4). */
  members: (id: number) =>
    client.get<TenantMember[]>(`/tenants/${id}/members`).then((res) => res.data),
  /** 테넌트 멤버(계정) 추가(#497·201) → 생성된 TenantMember. */
  addMember: (id: number, req: AddTenantMemberRequest) =>
    client.post<TenantMember>(`/tenants/${id}/members`, req).then((res) => res.data),
  /** 기존(전역) 사용자를 테넌트 멤버로 추가(201) → TenantMember. 계정 생성 없이 membership만 부여. */
  addExistingMember: (id: number, req: AddExistingTenantMemberRequest) =>
    client.post<TenantMember>(`/tenants/${id}/members/existing`, req).then((res) => res.data),
  /** 테넌트 정지. 백엔드는 204 No Content(바디 없음). */
  suspend: (id: number) => client.post<void>(`/tenants/${id}/suspend`).then(() => undefined),
  /** 테넌트 활성화. 백엔드는 204 No Content(바디 없음). */
  activate: (id: number) => client.post<void>(`/tenants/${id}/activate`).then(() => undefined),
  /** 테넌트 삭제(DELETED, 복원 가능). 204. `delete` 는 예약어라 remove. */
  remove: (id: number) => client.post<void>(`/tenants/${id}/delete`).then(() => undefined),
  /** 삭제된 테넌트 복원(ACTIVE). 204. */
  restore: (id: number) => client.post<void>(`/tenants/${id}/restore`).then(() => undefined),
  /** 영구 삭제 요청 — 이름 확인. 202(백그라운드 처리). */
  purge: (id: number, confirmName: string) =>
    client.post<void>(`/tenants/${id}/purge`, { confirmName }).then(() => undefined),
  // 테넌트 드라이브 한도 변경.
  updateQuota: (id: number, quotaBytes: number) =>
    client.patch<TenantDetail>(`/tenants/${id}/quota`, { quotaBytes }).then((res) => res.data),
}

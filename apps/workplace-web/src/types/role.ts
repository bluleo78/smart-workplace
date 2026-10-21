export interface PermissionResponse {
  id: number;
  code: string;
  description: string | null;
  category: string;
}

export interface RoleResponse {
  id: number;
  name: string;
  description: string | null;
  isSystem: boolean;
  /** ADMIN 이거나 관리 권한(구성원·역할·SSO·감사)이 든 역할 — AI 에이전트에게는 줄 수 없다(WP-728). 역할 목록에만 실린다. */
  grantsAdmin?: boolean;
}

export interface RoleDetailResponse {
  id: number;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: PermissionResponse[];
}

export interface CreateRoleRequest {
  name: string;
  description?: string;
}

export interface UpdateRoleRequest {
  name: string;
  description?: string;
}

export interface SetPermissionsRequest {
  permissionIds: number[];
}

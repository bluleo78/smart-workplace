// 역할 할당 화면에 보일 역할(WP-728) — 대상 종류(사람·AI)에 맞는 역할만 보인다. 서버도 같은 기준으로 새로 주는 것을 거절한다.
import type { RoleResponse } from '../types/role';

/**
 * - AI 에이전트: ADMIN 과 관리 권한이 든 역할은 숨긴다.
 * - 사람: AGENT 시스템 역할은 숨긴다.
 * - 이미 가진 역할은 기준과 상관없이 보인다 — 정책 전에 받은 역할을 관리자가 화면에서 뺄 수 있게.
 */
export function assignableRoles(
  roles: RoleResponse[],
  targetKind: string | null | undefined,
  heldRoleIds: number[],
): RoleResponse[] {
  const agent = targetKind === 'AGENT';
  return roles.filter((r) => {
    if (heldRoleIds.includes(r.id)) return true;
    if (agent) return !(r.grantsAdmin || (r.isSystem && r.name === 'ADMIN'));
    return !(r.isSystem && r.name === 'AGENT');
  });
}

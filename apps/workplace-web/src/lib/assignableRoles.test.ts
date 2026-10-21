import { describe, expect, it } from 'vitest';

import type { RoleResponse } from '../types/role';
import { assignableRoles } from './assignableRoles';

const role = (id: number, name: string, isSystem: boolean, grantsAdmin = false): RoleResponse => ({
  id,
  name,
  description: null,
  isSystem,
  grantsAdmin,
});
const ROLES = [role(1, 'ADMIN', true, true), role(2, 'USER', true), role(3, 'AGENT', true), role(4, 'HR', false, true), role(5, 'VIEWER', false)];
const names = (rs: RoleResponse[]) => rs.map((r) => r.name);

describe('assignableRoles', () => {
  it('AI 에게는 ADMIN·관리 권한 역할을 숨긴다', () => {
    expect(names(assignableRoles(ROLES, 'AGENT', [3]))).toEqual(['USER', 'AGENT', 'VIEWER']);
  });
  it('사람에게는 AGENT 시스템 역할을 숨긴다', () => {
    expect(names(assignableRoles(ROLES, 'HUMAN', [2]))).toEqual(['ADMIN', 'USER', 'HR', 'VIEWER']);
  });
  it('이미 가진 역할은 기준과 상관없이 보인다', () => {
    expect(names(assignableRoles(ROLES, 'AGENT', [1, 3]))).toEqual(['ADMIN', 'USER', 'AGENT', 'VIEWER']);
  });
  it('grantsAdmin 이 없는 응답이어도 AI 에게 ADMIN 은 숨긴다', () => {
    expect(names(assignableRoles([{ id: 1, name: 'ADMIN', description: null, isSystem: true }], 'AGENT', []))).toEqual([]);
  });
});

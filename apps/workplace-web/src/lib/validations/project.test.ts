// createProjectSchema(WP-412) — 프로젝트 생성 폼 검증 규칙 단위 테스트.
// 생성 다이얼로그 E2E 가 화면으로 확인하던 규칙(이름 120자 경계·OPEN/TEAM key 정규식)을 여기로 옮겼다.
// 에러가 실제 UI 에 뜨는지는 project-create-validation(이름)·personal-projects(key) E2E 가 맡는다.
import { describe, expect, it } from 'vitest';

import { createProjectSchema } from './project';

const KEY_ERR = '대문자/숫자 2~10자, 첫 글자는 대문자여야 합니다';

function errorOf(input: unknown, field: string): string | null {
  const r = createProjectSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues.find((i) => i.path[0] === field)?.message ?? null;
}

describe('createProjectSchema — 이름', () => {
  it('120자는 통과, 121자는 한국어 오류', () => {
    expect(createProjectSchema.safeParse({ key: 'TEST', name: '가'.repeat(120) }).success).toBe(true);
    expect(errorOf({ key: 'TEST', name: '가'.repeat(121) }, 'name')).toBe('이름은 120자 이하여야 합니다');
  });

  // WP-465: 공백만이면 필수 오류, 앞뒤 공백은 빼고 보낸다.
  it('공백뿐인 이름은 필수 오류이고, 앞뒤 공백은 잘라서 넘긴다', () => {
    expect(errorOf({ key: 'TEST', name: '   ' }, 'name')).toBe('이름은 필수입니다');
    expect(createProjectSchema.parse({ key: 'TEST', name: '  플랫폼  ' }).name).toBe('플랫폼');
  });
});

describe('createProjectSchema — key', () => {
  it('TEAM(기본)·OPEN 은 소문자 key 를 한국어 오류로 막는다', () => {
    expect(errorOf({ name: 'n', key: 'abc' }, 'key')).toBe(KEY_ERR);
    expect(errorOf({ type: 'OPEN', name: 'n', key: 'opnqa' }, 'key')).toBe(KEY_ERR);
    expect(errorOf({ type: 'OPEN', name: 'n' }, 'key')).toBe(KEY_ERR);
  });

  it('대문자 시작 2~10자는 통과하고, type 기본값은 TEAM 이다', () => {
    const r = createProjectSchema.safeParse({ name: 'n', key: 'OPNQA' });
    expect(r.success && r.data.type).toBe('TEAM');
    expect(createProjectSchema.safeParse({ type: 'OPEN', name: 'n', key: 'W1' }).success).toBe(true);
    expect(errorOf({ name: 'n', key: 'W' }, 'key')).toBe(KEY_ERR);
    expect(errorOf({ name: 'n', key: 'ABCDEFGHIJK' }, 'key')).toBe(KEY_ERR);
  });

  it('PERSONAL 은 key 가 없어도 통과한다', () => {
    expect(createProjectSchema.safeParse({ type: 'PERSONAL', name: 'n' }).success).toBe(true);
  });
});

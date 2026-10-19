import { describe, expect, it } from 'vitest';

import { assigneeCandidates, isInactiveMember } from './assigneeCandidates';

describe('assigneeCandidates (WP-487)', () => {
  const members = [
    { userId: 1, active: true },
    { userId: 2, active: false },
    { userId: 3 },
  ];

  it('비활성 구성원은 후보에서 뺀다(active 가 없으면 활성으로 본다)', () => {
    expect(assigneeCandidates(members).map((m) => m.userId)).toEqual([1, 3]);
  });

  it('이미 담당 중인 비활성 구성원은 해제할 수 있게 남긴다', () => {
    expect(assigneeCandidates(members, [2]).map((m) => m.userId)).toEqual([1, 2, 3]);
  });

  it('로딩 중이면 빈 목록', () => {
    expect(assigneeCandidates(undefined)).toEqual([]);
  });

  it('isInactiveMember 는 active=false 일 때만 true', () => {
    expect(isInactiveMember({ userId: 1, active: false })).toBe(true);
    expect(isInactiveMember({ userId: 1 })).toBe(false);
  });
});

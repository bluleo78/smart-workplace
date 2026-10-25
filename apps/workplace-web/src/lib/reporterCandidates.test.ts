import { describe, expect, it } from 'vitest';

import { reporterCandidates } from './reporterCandidates';

describe('reporterCandidates', () => {
  const members = [
    { userId: 1, kind: 'HUMAN', active: true },
    { userId: 2, kind: 'AGENT', active: true },
    { userId: 3, kind: 'HUMAN', active: false },
    { userId: 4, kind: 'HUMAN' },
  ];

  it('AI·비활성·지금 보고자를 빼고 순서를 지킨다', () => {
    expect(reporterCandidates(members, 1).map((m) => m.userId)).toEqual([4]);
    expect(reporterCandidates(members, null).map((m) => m.userId)).toEqual([1, 4]);
  });

  it('로딩 중이면 빈 목록', () => {
    expect(reporterCandidates(undefined, 1)).toEqual([]);
  });
});

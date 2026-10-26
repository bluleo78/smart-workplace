import { describe, expect, it } from 'vitest';

import type { MemberSummary } from '../types/member';
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

  it('오픈 프로젝트의 워크스페이스 디렉터리 결과(MemberSummary)에도 같은 규칙 — AI·비활성·지금 보고자를 뺀다(WP-967)', () => {
    const directory: MemberSummary[] = [
      { userId: 10, username: 'park', name: '박외부', email: null, title: null, kind: 'HUMAN', active: true, membershipRole: null, membershipStatus: null },
      { userId: 11, username: 'bot', name: 'AI', email: null, title: null, kind: 'AGENT', active: true, membershipRole: null, membershipStatus: null },
      { userId: 12, username: 'gone', name: '퇴사자', email: null, title: null, kind: 'HUMAN', active: false, membershipRole: null, membershipStatus: null },
      { userId: 5, username: 'kim', name: '김보고', email: null, title: null, kind: 'HUMAN', active: true, membershipRole: null, membershipStatus: null },
    ];
    expect(reporterCandidates(directory, 5).map((m) => m.userId)).toEqual([10]);
  });
});

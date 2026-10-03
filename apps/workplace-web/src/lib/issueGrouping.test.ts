import { describe, expect, it } from 'vitest';

import type { IssueResponse } from '../types/issue';
import { groupIssues } from './issueGrouping';

// 필수 필드가 많은 IssueResponse 를 최소 오버라이드로 생성하는 테스트 팩토리.
function mk(over: Partial<IssueResponse>): IssueResponse {
  return {
    id: 0,
    projectKey: 'P',
    number: 0,
    title: 't',
    status: 'TODO',
    priority: 'MID',
    dueDate: null,
    startDate: null,
    milestoneId: null,
    reporterId: 1,
    createdAt: '',
    updatedAt: '',
    labels: [],
    attachmentCount: 0,
    type: null,
    assignees: [],
    parent: null,
    childCount: 0,
    childDoneCount: 0,
    blockedBy: [],
    blocks: [],
    blocked: false,
    customFields: [],
    ...over,
  };
}

function user(id: number, name: string) {
  return { id, username: `u${id}`, name, kind: 'HUMAN' as const };
}

describe('groupIssues - status', () => {
  it('네 상태 버킷을 enum 순서로, 빈 버킷도 포함해 반환한다', () => {
    const issues = [
      mk({ id: 1, status: 'DONE' }),
      mk({ id: 2, status: 'TODO' }),
      mk({ id: 3, status: 'TODO' }),
    ];
    const groups = groupIssues(issues, 'status');
    expect(groups.map((g) => g.key)).toEqual([
      'TODO',
      'IN_PROGRESS',
      'DONE',
      'CANCELED',
    ]);
    expect(groups.map((g) => g.label)).toEqual(['할 일', '진행 중', '완료', '취소']);
    expect(groups[0].issues.map((i) => i.id)).toEqual([2, 3]);
    expect(groups[1].issues).toHaveLength(0); // IN_PROGRESS 빈 버킷 유지
    expect(groups[2].issues.map((i) => i.id)).toEqual([1]);
  });
});

describe('groupIssues - priority', () => {
  it('우선순위 버킷을 HIGH→MID→LOW 순서로 반환한다', () => {
    const issues = [
      mk({ id: 1, priority: 'LOW' }),
      mk({ id: 2, priority: 'HIGH' }),
      mk({ id: 3, priority: 'MID' }),
    ];
    const groups = groupIssues(issues, 'priority');
    expect(groups.map((g) => g.key)).toEqual(['HIGH', 'MID', 'LOW']);
    expect(groups.map((g) => g.label)).toEqual(['높음', '보통', '낮음']);
    expect(groups[0].issues.map((i) => i.id)).toEqual([2]);
  });
});

describe('groupIssues - assignee', () => {
  it('존재하는 담당자 버킷만 이름순으로, 미지정은 마지막에 둔다', () => {
    const issues = [
      mk({ id: 1, assignees: [user(10, '나래')] }),
      mk({ id: 2, assignees: [user(11, '가람')] }),
      mk({ id: 3, assignees: [] }), // 미지정
    ];
    const groups = groupIssues(issues, 'assignee');
    expect(groups.map((g) => g.label)).toEqual(['가람', '나래', '미지정']);
    expect(groups.map((g) => g.key)).toEqual(['u-11', 'u-10', 'unassigned']);
    expect(groups[2].issues.map((i) => i.id)).toEqual([3]);
  });

  it('다중 담당자 이슈는 각 담당자 그룹에 모두 등장한다', () => {
    const issues = [mk({ id: 1, assignees: [user(10, '가람'), user(11, '나래')] })];
    const groups = groupIssues(issues, 'assignee');
    expect(groups.map((g) => g.label)).toEqual(['가람', '나래']);
    expect(groups[0].issues.map((i) => i.id)).toEqual([1]);
    expect(groups[1].issues.map((i) => i.id)).toEqual([1]);
  });

  it('미지정만 있으면 미지정 버킷 하나만 반환한다', () => {
    const groups = groupIssues([mk({ id: 1 })], 'assignee');
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('unassigned');
  });
});

describe('groupIssues - epic', () => {
  const EPIC_TYPE = { id: 6, name: 'EPIC', colorToken: 'INDIGO', icon: 'Flag' } as const;
  const STORY_TYPE = { id: 2, name: 'STORY', colorToken: 'BLUE', icon: 'Flag' } as const;
  const ep = (number: number, title: string) => ({ number, title, type: EPIC_TYPE });

  it('에픽 번호 오름차순 버킷 + 마지막에 「에픽 없음」', () => {
    const groups = groupIssues(
      [
        mk({ id: 1, number: 1, parent: ep(30, '결제 안정화') }),
        mk({ id: 2, number: 2, parent: null }),
        mk({ id: 3, number: 3, parent: ep(12, '모바일 UX') }),
        mk({ id: 4, number: 4, parent: ep(30, '결제 안정화') }),
      ],
      'epic',
    );
    expect(groups.map((g) => [g.key, g.label, g.issues.map((i) => i.number)])).toEqual([
      ['epic-12', '모바일 UX', [3]],
      ['epic-30', '결제 안정화', [1, 4]],
      ['no-epic', '에픽 없음', [2]],
    ]);
  });

  it('에픽이 아닌 부모(STORY)는 「에픽 없음」으로 간다', () => {
    const groups = groupIssues([mk({ id: 5, number: 5, parent: { number: 7, title: '스토리', type: STORY_TYPE } })], 'epic');
    expect(groups).toEqual([{ key: 'no-epic', label: '에픽 없음', issues: [expect.objectContaining({ number: 5 })] }]);
  });

  it('에픽 없는 이슈가 없으면 「에픽 없음」 버킷을 만들지 않는다', () => {
    const groups = groupIssues([mk({ id: 1, number: 1, parent: ep(3, 'A') })], 'epic');
    expect(groups.map((g) => g.key)).toEqual(['epic-3']);
  });
});

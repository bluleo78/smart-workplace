import { describe, expect, it } from 'vitest';

import { ISSUE_PRIORITIES, type IssueResponse } from '../types/issue';
import type { ProjectStatus } from '../types/projectStatus';
import {
  groupCountsByKey, groupIssues, ISSUE_PRIORITY_LABEL, ISSUE_PRIORITY_OPTIONS, priorityLabel, priorityRank, statusLabel, toIssuePriority,
} from './issueGrouping';

// 필수 필드가 많은 IssueResponse 를 최소 오버라이드로 생성하는 테스트 팩토리.
function mk(over: Partial<IssueResponse>): IssueResponse {
  return {
    id: 0,
    projectKey: 'P',
    number: 0,
    title: 't',
    status: 'TODO',
    statusId: 1,
    statusName: '할 일',
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

describe('groupIssues - status (프로젝트 상태, WP-808)', () => {
  // 시드 4상태 + 진행 중 범주의 「검토 중」(id 12). position 은 프로젝트 안 순번이라 섞어 넣어도 범주 → position 순으로 묶인다.
  // 서버가 주는 표시 순서(범주 → position) 그대로 — 그룹은 이 순서를 따르고 다시 정렬하지 않는다.
  const statuses: ProjectStatus[] = [
    { id: 1, name: '할 일', category: 'TODO', position: 0 },
    { id: 2, name: '진행 중', category: 'IN_PROGRESS', position: 1 },
    { id: 12, name: '검토 중', category: 'IN_PROGRESS', position: 2 },
    { id: 3, name: '완료', category: 'DONE', position: 3 },
    { id: 4, name: '취소', category: 'CANCELED', position: 4 },
  ];

  it('statuses 를 주면 statusId 별로 묶고 빈 상태도 버킷을 만든다', () => {
    const issues = [
      mk({ id: 1, status: 'IN_PROGRESS', statusId: 12, statusName: '검토 중' }),
      mk({ id: 2, status: 'IN_PROGRESS', statusId: 2, statusName: '진행 중' }),
      mk({ id: 3, status: 'TODO', statusId: 1, statusName: '할 일' }),
    ];
    const groups = groupIssues(issues, 'status', statuses);
    expect(groups.map((g) => g.label)).toEqual(['할 일', '진행 중', '검토 중', '완료', '취소']);
    // 키는 statusId 문자열 — 서버 그룹 총계(groupBy=statusId)의 key 와 같다.
    expect(groups.map((g) => g.key)).toEqual(['1', '2', '12', '3', '4']);
    expect(groups[2].issues.map((i) => i.id)).toEqual([1]);
    expect(groups[1].issues.map((i) => i.id)).toEqual([2]);
    expect(groups[3].issues).toHaveLength(0); // 완료 빈 버킷 유지
  });

  it('목록에 없는 statusId(방금 추가된 상태 등)는 이슈의 statusName 으로 버킷을 덧붙여 행을 잃지 않는다', () => {
    const issues = [mk({ id: 9, status: 'IN_PROGRESS', statusId: 77, statusName: '새 상태' })];
    const groups = groupIssues(issues, 'status', statuses);
    expect(groups.at(-1)).toMatchObject({ key: '77', label: '새 상태' });
    expect(groups.at(-1)!.issues.map((i) => i.id)).toEqual([9]);
  });

  it('statuses 가 없으면(프로젝트 횡단·로딩 중) 범주 버킷으로 묶는다', () => {
    const groups = groupIssues([mk({ id: 1, status: 'IN_PROGRESS', statusId: 12 })], 'status', undefined);
    expect(groups.map((g) => g.key)).toEqual(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED']);
  });
});

describe('groupIssues - priority', () => {
  // WP-886: 5단계 — 매우 높음→높음→보통→낮음→매우 낮음, 빈 버킷도 고정 순서로 노출한다.
  it('우선순위 버킷을 HIGHEST→HIGH→MID→LOW→LOWEST 순서로 반환한다', () => {
    const issues = [
      mk({ id: 1, priority: 'LOW' }),
      mk({ id: 2, priority: 'HIGH' }),
      mk({ id: 3, priority: 'MID' }),
      mk({ id: 4, priority: 'LOWEST' }),
      mk({ id: 5, priority: 'HIGHEST' }),
    ];
    const groups = groupIssues(issues, 'priority');
    expect(groups.map((g) => g.key)).toEqual(['HIGHEST', 'HIGH', 'MID', 'LOW', 'LOWEST']);
    expect(groups.map((g) => g.label)).toEqual(['매우 높음', '높음', '보통', '낮음', '매우 낮음']);
    expect(groups.map((g) => g.issues.map((i) => i.id))).toEqual([[5], [2], [3], [1], [4]]);
  });
});

// WP-886: 선택지·정렬 순위는 한 목록(ISSUE_PRIORITIES)에서 파생 — 화면마다 따로 적던 목록이 어긋나지 않게 지킨다.
describe('우선순위 5단계 공용 목록', () => {
  it('ISSUE_PRIORITY_LABEL 키 순서·선택지가 ISSUE_PRIORITIES(표시 순서)와 같다', () => {
    expect(Object.keys(ISSUE_PRIORITY_LABEL)).toEqual([...ISSUE_PRIORITIES]);
    expect(ISSUE_PRIORITY_OPTIONS).toEqual([
      { value: 'HIGHEST', label: '매우 높음' },
      { value: 'HIGH', label: '높음' },
      { value: 'MID', label: '보통' },
      { value: 'LOW', label: '낮음' },
      { value: 'LOWEST', label: '매우 낮음' },
    ]);
  });

  it('priorityRank 는 매우 높음 0 … 매우 낮음 4, 모르는 값은 보통 순위다', () => {
    expect(ISSUE_PRIORITIES.map(priorityRank)).toEqual([0, 1, 2, 3, 4]);
    expect(priorityRank('URGENT')).toBe(priorityRank('MID'));
  });
});

describe('toIssuePriority (WP-886)', () => {
  it('5단계는 그대로, 모르는 값·비문자열·누락은 보통(MID)', () => {
    for (const p of ISSUE_PRIORITIES) expect(toIssuePriority(p)).toBe(p);
    expect(toIssuePriority('URGENT')).toBe('MID');
    expect(toIssuePriority('')).toBe('MID');
    expect(toIssuePriority(undefined)).toBe('MID');
    expect(toIssuePriority(null)).toBe('MID');
    expect(toIssuePriority(2)).toBe('MID');
    // 프로토타입 키(constructor 등)도 5단계가 아니므로 MID
    expect(toIssuePriority('constructor')).toBe('MID');
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

  // WP-1038 에픽은 다른 프로젝트에 있을 수 있다 — 번호가 같아도(PLAN-3 / WP-3) 다른 묶음, 가려진 에픽은 「볼 수 없는 에픽」 한 묶음.
  it('다른 프로젝트 에픽은 (키, 번호)로 따로 묶고, 가려진 에픽은 마지막 에픽 묶음으로', () => {
    const groups = groupIssues(
      [
        mk({ id: 1, number: 1, projectKey: 'WP', parent: { ...ep(3, 'WP 에픽'), projectKey: 'WP' } }),
        mk({ id: 2, number: 2, projectKey: 'WP', parent: { ...ep(3, '기획 에픽'), projectKey: 'PLAN' } }),
        mk({ id: 3, number: 3, projectKey: 'WP', parent: { number: 0, title: '', type: null, hidden: true } as never }),
        mk({ id: 4, number: 4, projectKey: 'WP', parent: null }),
      ],
      'epic',
    );
    expect(groups.map((g) => [g.key, g.label, g.issues.map((i) => i.number)])).toEqual([
      ['epic-3', 'WP 에픽', [1]],
      ['epic-PLAN-3', '기획 에픽', [2]],
      ['epic-hidden', '볼 수 없는 에픽', [3]],
      ['no-epic', '에픽 없음', [4]],
    ]);
  });

  it('에픽 없는 이슈가 없으면 「에픽 없음」 버킷을 만들지 않는다', () => {
    const groups = groupIssues([mk({ id: 1, number: 1, parent: ep(3, 'A') })], 'epic');
    expect(groups.map((g) => g.key)).toEqual(['epic-3']);
  });
});

// statusLabel/priorityLabel — 그룹 헤더·이력 등 버킷 밖 표시명. 모르는 값·프로토타입 키는 원문 그대로여야 한다.
describe('statusLabel / priorityLabel', () => {
  it('enum 을 한국어로 바꾼다', () => {
    expect(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED'].map((s) => statusLabel(s))).toEqual(['할 일', '진행 중', '완료', '취소']);
    // 프로젝트 상태 이름(statusName)이 있으면 그것을 쓴다(WP-808).
    expect(statusLabel('IN_PROGRESS', '검토 중')).toBe('검토 중');
    expect(['HIGHEST', 'HIGH', 'MID', 'LOW', 'LOWEST'].map(priorityLabel)).toEqual(['매우 높음', '높음', '보통', '낮음', '매우 낮음']);
  });

  it('매핑 없는 값과 프로토타입 키는 원문 그대로다', () => {
    expect(statusLabel('UNKNOWN_STATUS')).toBe('UNKNOWN_STATUS');
    expect(statusLabel('toString')).toBe('toString');
    expect(priorityLabel('URGENT')).toBe('URGENT');
    expect(priorityLabel('constructor')).toBe('constructor');
  });
});

describe('groupCountsByKey (WP-472)', () => {
  it('상태·우선순위 총계는 값 그대로 그룹 key 가 된다', () => {
    const m = groupCountsByKey({ groupBy: 'status', groups: [{ key: 'TODO', count: 32 }, { key: 'DONE', count: 3 }] });
    expect(m.get('TODO')).toBe(32);
    expect(m.get('DONE')).toBe(3);
    expect(m.get('IN_PROGRESS')).toBeUndefined();
  });

  it('담당자 총계는 u-{id}, 담당자 없음은 unassigned 로 옮긴다', () => {
    const m = groupCountsByKey({ groupBy: 'assignee', groups: [{ key: '7', count: 2 }, { key: null, count: 5 }] });
    expect(m.get('u-7')).toBe(2);
    expect(m.get('unassigned')).toBe(5);
  });

  it('응답이 없으면 빈 맵', () => {
    expect(groupCountsByKey(undefined).size).toBe(0);
  });
});

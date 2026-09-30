import { describe, expect, it } from 'vitest';

import type { IssueFilters, IssueResponse } from '@/types/issue';

import { buildAiTasksContext, buildIssueDetailContext, buildIssueListContext, buildMyTasksContext } from './issue';

const issue = {
  projectKey: 'WP',
  number: 12,
  title: '로그인 버그 수정',
  status: 'IN_PROGRESS',
  priority: 'HIGH',
  dueDate: '2026-10-03',
  assignees: [{ id: 1, username: 'dh', name: '양동희', kind: 'HUMAN' }],
  type: { id: 1, name: '버그', colorToken: 'red', icon: 'bug' },
  parent: { number: 3, title: '로그인 개편', type: { id: 2, name: '에픽', colorToken: 'x', icon: 'x' } },
  blocked: true,
} as unknown as IssueResponse;

const emptyFilters: IssueFilters = {
  q: '', statuses: [], priorities: [], assigneeIds: [], includeUnassigned: false, dueFrom: null, dueTo: null,
  labelIds: [], cycleIds: [], milestoneIds: [], typeIds: [], parentNumber: null, topLevel: false, blocked: false,
  excludeSubtasks: false, showAllClosed: false,
};

describe('buildIssueDetailContext', () => {
  it('issueKey·라벨·핵심 속성을 담는다', () => {
    const ctx = buildIssueDetailContext({ projectKey: 'WP', issue });
    expect(ctx.view).toBe('이슈 상세');
    expect(ctx.focus).toEqual({
      type: '이슈',
      label: 'WP-12 로그인 버그 수정',
      refs: { issueKey: 'WP-12' },
      facts: [
        { label: '상태', value: '진행 중' },
        { label: '우선순위', value: '높음' },
        { label: '담당', value: '양동희' },
        { label: '유형', value: '버그' },
        { label: '마감', value: '2026-10-03' },
        { label: '상위 이슈', value: 'WP-3 로그인 개편' },
        { label: '차단됨', value: '예' },
      ],
    });
    expect(ctx.scope).toEqual({ label: '프로젝트 WP', refs: { projectKey: 'WP' } });
  });

  it('담당 없음은 미할당, 긴 제목은 200자로 자른다', () => {
    const ctx = buildIssueDetailContext({ projectKey: 'WP', issue: { ...issue, assignees: [], title: 'x'.repeat(400) } });
    expect(ctx.focus!.label.length).toBe(200);
    expect(ctx.focus!.facts).toContainEqual({ label: '담당', value: '미할당' });
  });
});

describe('buildIssueListContext', () => {
  it('필터 id 를 이름으로 해석하고 모르는 id 는 #id', () => {
    const ctx = buildIssueListContext({
      projectKey: 'WP',
      projectName: 'Workplace',
      view: 'list',
      groupBy: 'status',
      filters: { ...emptyFilters, q: '로그인', statuses: ['TODO', 'IN_PROGRESS'], assigneeIds: [1, 99], includeUnassigned: true, labelIds: [5] },
      lookups: { members: [{ userId: 1, name: '양동희' }], labels: [{ id: 5, name: '버그' }], types: [], cycles: [], milestones: [] },
      count: 23,
      hasMore: true,
    });
    expect(ctx.view).toBe('이슈 목록');
    expect(ctx.focus).toBeUndefined();
    expect(ctx.scope).toEqual({
      label: '프로젝트 Workplace 이슈 목록',
      refs: { projectKey: 'WP' },
      facts: [
        { label: '검색어', value: '로그인' },
        { label: '상태', value: '할 일, 진행 중' },
        { label: '담당', value: '양동희, #99, 미할당' },
        { label: '라벨', value: '버그' },
        { label: '보기', value: '리스트' },
        { label: '그룹', value: '상태' },
      ],
      count: 23,
      hasMore: true,
    });
  });

  it('필터가 없으면 보기만', () => {
    const ctx = buildIssueListContext({
      projectKey: 'WP', projectName: 'Workplace', view: 'board', groupBy: null, filters: emptyFilters,
      lookups: { members: [], labels: [], types: [], cycles: [], milestones: [] },
    });
    expect(ctx.scope!.facts).toEqual([{ label: '보기', value: '보드' }]);
    expect(ctx.scope!.count).toBeUndefined();
  });
});

describe('buildIssueListContext 상한 초과', () => {
  it('모든 필터가 켜지면 12개로 자르되 밀린 필터 이름을 "기타 필터"로 요약', () => {
    const ctx = buildIssueListContext({
      projectKey: 'WP', projectName: 'Workplace', view: 'board', groupBy: 'status',
      filters: {
        ...emptyFilters, q: 'a', statuses: ['TODO'], priorities: ['HIGH'], assigneeIds: [1], labelIds: [5], typeIds: [2],
        dueFrom: '2026-10-01', dueTo: null, blocked: true, parentNumber: 3, topLevel: true, cycleIds: [7], milestoneIds: [8], showAllClosed: true,
      },
      lookups: {
        members: [{ userId: 1, name: '양' }], labels: [{ id: 5, name: 'L' }], types: [{ id: 2, name: 'T' }],
        cycles: [{ id: 7, name: 'C' }], milestones: [{ id: 8, name: 'M' }],
      },
    });
    const facts = ctx.scope!.facts!;
    expect(facts).toHaveLength(12);
    expect(facts.map((f) => f.label)).toContain('차단됨');
    expect(facts[11]).toEqual({ label: '기타 필터', value: '마일스톤, 종료 모두 보기, 보기, 그룹' });
  });
});

describe('buildMyTasksContext / buildAiTasksContext', () => {
  it('탭·facet 을 표시 문자열로', () => {
    const ctx = buildMyTasksContext({ tab: 'assigned', facets: { status: 'TODO', priority: 'HIGH,MID', dueTo: '2026-10-01', blocked: 'true' }, count: 4, hasMore: false });
    expect(ctx).toEqual({
      view: '내 작업',
      scope: {
        label: '내 작업 · 내가 담당',
        facts: [
          { label: '상태', value: '할 일' },
          { label: '우선순위', value: '높음, 보통' },
          { label: '마감', value: '~ 2026-10-01' },
          { label: '차단됨', value: '예' },
        ],
        count: 4,
        hasMore: false,
      },
    });
  });
  it('AI 위임 작업', () => {
    expect(buildAiTasksContext({ facets: {}, count: 2 })).toEqual({ view: 'AI 위임 작업', scope: { label: 'AI 위임 작업', count: 2 } });
  });
});

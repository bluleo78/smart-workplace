// 이슈 영역 화면 컨텍스트 builder(WP-54) — 이슈 상세·프로젝트 이슈 목록·내 작업·AI 위임 작업.
// 필터 id 는 이미 로드된 라벨/멤버/유형/사이클/마일스톤 목록으로 이름 해석(AI 도구가 이름을 받음). 모르는 id 는 #id.
import type { AiScreenContext } from '@/types/aiScreenContext';
import type { IssueFilters, IssueGroupBy, IssueResponse, IssueView } from '@/types/issue';

import { buildFacts, buildRefs, clip, LIMITS } from '../common';

const STATUS_LABEL: Record<string, string> = { TODO: '할 일', IN_PROGRESS: '진행 중', DONE: '완료', CANCELED: '취소' };
const PRIORITY_LABEL: Record<string, string> = { HIGH: '높음', MID: '보통', LOW: '낮음' };
const GROUP_LABEL: Record<string, string> = { status: '상태', assignee: '담당자', priority: '우선순위' };
const TAB_LABEL = { assigned: '내가 담당', reported: '내가 보고', watched: '관찰 중' } as const;

const joinMapped = (vals: string[], map: Record<string, string>) => vals.map((v) => map[v] ?? v).join(', ');
const csv = (s: string | undefined) => (s ? s.split(',').filter(Boolean) : []);

/** 마감 범위 표시 — 'from ~ to' / '~ to' / 'from ~'. */
function dueRange(from: string | null | undefined, to: string | null | undefined): string | null {
  if (!from && !to) return null;
  return `${from ?? ''} ~ ${to ?? ''}`.trim();
}

export function buildIssueDetailContext({ projectKey, issue }: { projectKey: string; issue: IssueResponse }): AiScreenContext {
  const issueKey = `${projectKey}-${issue.number}`;
  return {
    view: '이슈 상세',
    focus: {
      type: '이슈',
      label: clip(`${issueKey} ${issue.title}`, LIMITS.label),
      refs: buildRefs({ issueKey }),
      facts: buildFacts([
        ['상태', STATUS_LABEL[issue.status] ?? issue.status],
        ['우선순위', PRIORITY_LABEL[issue.priority] ?? issue.priority],
        ['담당', issue.assignees.length ? issue.assignees.map((a) => a.name).join(', ') : '미할당'],
        ['유형', issue.type?.name],
        ['마감', issue.dueDate],
        ['상위 이슈', issue.parent ? `${projectKey}-${issue.parent.number} ${issue.parent.title}` : null],
        ['차단됨', issue.blocked],
      ]),
    },
    scope: { label: `프로젝트 ${projectKey}`, refs: buildRefs({ projectKey }) },
  };
}

export interface IssueListContextInput {
  projectKey: string;
  projectName: string;
  view: IssueView;
  groupBy: IssueGroupBy | null;
  filters: IssueFilters;
  lookups: {
    members: { userId: number; name: string }[];
    labels: { id: number; name: string }[];
    types: { id: number; name: string }[];
    cycles: { id: number; name: string }[];
    milestones: { id: number; name: string }[];
  };
  count?: number;
  hasMore?: boolean;
}

// id 목록 → 이름 목록(모르는 id 는 #id).
function names(ids: number[], list: { id: number; name: string }[]): string {
  return ids.map((id) => list.find((x) => x.id === id)?.name ?? `#${id}`).join(', ');
}

export function buildIssueListContext(input: IssueListContextInput): AiScreenContext {
  const { filters: f, lookups } = input;
  const memberList = lookups.members.map((m) => ({ id: m.userId, name: m.name }));
  const assignee = [names(f.assigneeIds, memberList), f.includeUnassigned ? '미할당' : ''].filter(Boolean).join(', ');
  const scope: NonNullable<AiScreenContext['scope']> = {
    label: clip(`프로젝트 ${input.projectName} 이슈 목록`, LIMITS.label),
    refs: buildRefs({ projectKey: input.projectKey }),
    facts: buildFacts([
      ['보기', input.view === 'board' ? '보드' : '리스트'],
      ['그룹', input.groupBy ? GROUP_LABEL[input.groupBy] : null],
      ['검색어', f.q],
      ['상태', joinMapped(f.statuses, STATUS_LABEL)],
      ['우선순위', joinMapped(f.priorities, PRIORITY_LABEL)],
      ['담당', assignee],
      ['라벨', names(f.labelIds, lookups.labels)],
      ['유형', names(f.typeIds, lookups.types)],
      ['사이클', names(f.cycleIds, lookups.cycles)],
      ['마일스톤', names(f.milestoneIds, lookups.milestones)],
      ['마감', dueRange(f.dueFrom, f.dueTo)],
      ['상위 이슈', f.parentNumber != null ? `${input.projectKey}-${f.parentNumber}` : null],
      ['최상위만', f.topLevel],
      ['차단됨', f.blocked],
      ['종료 모두 보기', f.showAllClosed],
    ]),
  };
  if (input.count != null) scope.count = input.count;
  if (input.hasMore != null) scope.hasMore = input.hasMore;
  return { view: '이슈 목록', scope };
}

// meFacetParams() 결과(status/priority CSV, dueFrom/dueTo, blocked='true') → facts.
function facetFacts(facets: Record<string, string>) {
  return buildFacts([
    ['상태', joinMapped(csv(facets.status), STATUS_LABEL)],
    ['우선순위', joinMapped(csv(facets.priority), PRIORITY_LABEL)],
    ['마감', dueRange(facets.dueFrom, facets.dueTo)],
    ['차단됨', facets.blocked === 'true'],
  ]);
}

export function buildMyTasksContext(input: {
  tab: keyof typeof TAB_LABEL;
  facets: Record<string, string>;
  count?: number;
  hasMore?: boolean;
}): AiScreenContext {
  const scope: NonNullable<AiScreenContext['scope']> = { label: `내 작업 · ${TAB_LABEL[input.tab]}` };
  const facts = facetFacts(input.facets);
  if (facts) scope.facts = facts;
  if (input.count != null) scope.count = input.count;
  if (input.hasMore != null) scope.hasMore = input.hasMore;
  return { view: '내 작업', scope };
}

export function buildAiTasksContext(input: { facets: Record<string, string>; count?: number }): AiScreenContext {
  const scope: NonNullable<AiScreenContext['scope']> = { label: 'AI 에게 위임한 작업' };
  const facts = facetFacts(input.facets);
  if (facts) scope.facts = facts;
  if (input.count != null) scope.count = input.count;
  return { view: 'AI 위임 작업', scope };
}

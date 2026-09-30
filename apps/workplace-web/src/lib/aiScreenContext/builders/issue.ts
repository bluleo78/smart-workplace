// 이슈 영역 화면 컨텍스트 builder(WP-54) — 이슈 상세·프로젝트 이슈 목록·내 작업·AI 위임 작업.
// 필터 id 는 이미 로드된 라벨/멤버/유형/사이클/마일스톤 목록으로 이름 해석(AI 도구가 이름을 받음). 모르는 id 는 #id.
// 상태·우선순위·그룹 라벨은 화면(보드 헤더·필터 바)과 같은 공용 맵을 쓴다 — 사용자와 AI 가 같은 단어로 말하게.
import { ISSUE_GROUP_BY_LABEL, ISSUE_PRIORITY_LABEL, ISSUE_STATUS_LABEL } from '@/lib/issueGrouping';
import type { AiScreenContext } from '@/types/aiScreenContext';
import type { IssueFilters, IssueGroupBy, IssueResponse, IssueView } from '@/types/issue';

import { buildFacts, buildRefs, clip, LIMITS, withListState } from '../common';

const TAB_LABEL = { assigned: '내가 담당', reported: '내가 보고', watched: '관찰 중' } as const;

// enum 밖 값(facet CSV 의 오타 등)은 원문 그대로 표시한다.
const joinMapped = (vals: string[], map: Readonly<Record<string, string>>) => vals.map((v) => map[v] ?? v).join(', ');
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
        ['상태', ISSUE_STATUS_LABEL[issue.status] ?? issue.status],
        ['우선순위', ISSUE_PRIORITY_LABEL[issue.priority] ?? issue.priority],
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
  const scope = withListState({
    label: clip(`프로젝트 ${input.projectName} 이슈 목록`, LIMITS.label),
    refs: buildRefs({ projectKey: input.projectKey }),
    // 결과 집합에 미치는 영향 순 — 상한(12) 초과 시 뒤쪽(표시 전용 보기·그룹 등)이 '기타 필터' 요약으로 밀려난다.
    facts: buildFacts(
      [
        ['검색어', f.q],
        ['상태', joinMapped(f.statuses, ISSUE_STATUS_LABEL)],
        ['담당', assignee],
        ['우선순위', joinMapped(f.priorities, ISSUE_PRIORITY_LABEL)],
        ['라벨', names(f.labelIds, lookups.labels)],
        ['유형', names(f.typeIds, lookups.types)],
        ['마감', dueRange(f.dueFrom, f.dueTo)],
        ['차단됨', f.blocked],
        ['상위 이슈', f.parentNumber != null ? `${input.projectKey}-${f.parentNumber}` : null],
        ['최상위만', f.topLevel],
        ['사이클', names(f.cycleIds, lookups.cycles)],
        ['마일스톤', names(f.milestoneIds, lookups.milestones)],
        ['종료 모두 보기', f.showAllClosed],
        ['보기', input.view === 'board' ? '보드' : '리스트'],
        ['그룹', input.groupBy ? ISSUE_GROUP_BY_LABEL[input.groupBy] : null],
      ],
      { overflowLabel: '기타 필터' },
    ),
  }, input);
  return { view: '이슈 목록', scope };
}

// meFacetParams() 결과(status/priority CSV, dueFrom/dueTo, blocked='true') → facts.
function facetFacts(facets: Record<string, string>) {
  return buildFacts([
    ['상태', joinMapped(csv(facets.status), ISSUE_STATUS_LABEL)],
    ['우선순위', joinMapped(csv(facets.priority), ISSUE_PRIORITY_LABEL)],
    ['마감', dueRange(facets.dueFrom, facets.dueTo)],
    ['차단됨', facets.blocked === 'true'],
  ]);
}

// 내 작업·AI 위임 작업 공통 — 범위 라벨 + facet facts + 목록 상태.
function facetListContext(
  view: string,
  label: string,
  input: { facets: Record<string, string>; count?: number; hasMore?: boolean },
): AiScreenContext {
  return { view, scope: withListState({ label, facts: facetFacts(input.facets) }, input) };
}

export function buildMyTasksContext(input: {
  tab: keyof typeof TAB_LABEL;
  facets: Record<string, string>;
  count?: number;
  hasMore?: boolean;
}): AiScreenContext {
  return facetListContext('내 작업', `내 작업 · ${TAB_LABEL[input.tab]}`, input);
}

export function buildAiTasksContext(input: { facets: Record<string, string>; count?: number }): AiScreenContext {
  // 칩은 scope.label 이 view 를 포함하면 범위 라벨만 보여 준다 → 'AI 위임 작업' 한 번만 표시.
  return facetListContext('AI 위임 작업', 'AI 위임 작업', input);
}

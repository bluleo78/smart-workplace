// 이슈 영역 화면 컨텍스트 builder(WP-54) — 이슈 상세·프로젝트 이슈 목록·내 작업·AI 위임 작업.
// 필터 id 는 이미 로드된 라벨/멤버/유형/사이클/마일스톤/구성요소 목록으로 이름 해석(AI 도구가 이름을 받음). 모르는 id 는 #id.
// 상태·우선순위·그룹 라벨은 화면(보드 헤더·필터 바)과 같은 공용 맵을 쓴다 — 사용자와 AI 가 같은 단어로 말하게.
// WP-379: app 은 홈 채팅 메모리 범위 선택용(서버로 보내는 screenContext 에선 빠진다).
import { closedRangeLabel } from '@/lib/closedRange';
import { ISSUE_GROUP_BY_LABEL, ISSUE_PRIORITY_LABEL, ISSUE_STATUS_LABEL, priorityLabel, statusLabel } from '@/lib/issueGrouping';
import { ownLookup } from '@/lib/ownLookup';
import { MY_TASKS_TAB_LABEL } from '@/pages/me/myTasksTabs';
import type { AiScreenContext } from '@/types/aiScreenContext';
import type { IssueFilters, IssueGroupBy, IssueResponse, IssueView } from '@/types/issue';

import { buildFacts, buildRefs, clip, LIMITS, withListState } from '../common';


// enum 밖 값(facet CSV 의 오타 등)은 원문 그대로 표시한다.
const joinMapped = (vals: string[], map: Readonly<Record<string, string>>) =>
  vals.map((v) => ownLookup(map, v) ?? v).join(', ');
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
    app: 'ISSUE',
    focus: {
      type: '이슈',
      label: clip(`${issueKey} ${issue.title}`, LIMITS.label),
      refs: buildRefs({ issueKey }),
      facts: buildFacts([
        ['상태', statusLabel(issue.status, issue.statusName)],
        ['우선순위', priorityLabel(issue.priority)],
        ['담당', issue.assignees.length ? issue.assignees.map((a) => a.name).join(', ') : '미할당'],
        ['유형', issue.type?.name],
        // 구성요소(WP-933) — 붙은 것이 있을 때만(빈 문자열은 buildFacts 가 뺀다).
        ['구성요소', (issue.components ?? []).map((c) => c.name).join(', ')],
        // 수정 버전·영향 버전(WP-888) — 붙은 것이 있을 때만.
        ['수정 버전', (issue.fixVersions ?? []).map((v) => v.name).join(', ')],
        ['영향 버전', (issue.affectsVersions ?? []).map((v) => v.name).join(', ')],
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
    // 프로젝트 상태(WP-808) — 「상태」 필터(statusIds)를 이름으로 풀 때 쓴다.
    statuses: { id: number; name: string }[];
    // 프로젝트 구성요소(WP-933) — 「구성요소」 필터를 이름으로 푼다(AI 도구 component 인자도 이름을 받는다).
    components?: { id: number; name: string }[];
    // 프로젝트 버전(WP-888) — 「수정 버전」·「영향 버전」 필터를 이름으로 푼다(AI 도구 fixVersion·affectsVersion 인자도 이름을 받는다).
    versions?: { id: number; name: string }[];
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
  // 구성요소 — 이름 + 「구성요소 없음」(필터 바 문구 그대로).
  const component = [names(f.componentIds, lookups.components ?? []), f.componentNone ? '구성요소 없음' : ''].filter(Boolean).join(', ');
  // 수정 버전·영향 버전 — 이름 + 「… 버전 없음」(필터 바 문구 그대로).
  const fixVersion = [names(f.fixVersionIds, lookups.versions ?? []), f.fixVersionNone ? '수정 버전 없음' : ''].filter(Boolean).join(', ');
  const affectsVersion = [names(f.affectsVersionIds, lookups.versions ?? []), f.affectsVersionNone ? '영향 버전 없음' : ''].filter(Boolean).join(', ');
  const scope = withListState({
    label: clip(`프로젝트 ${input.projectName} 이슈 목록`, LIMITS.label),
    refs: buildRefs({ projectKey: input.projectKey }),
    // 결과 집합에 미치는 영향 순 — 상한(12) 초과 시 뒤쪽(표시 전용 보기·그룹 등)이 '기타 필터' 요약으로 밀려난다.
    facts: buildFacts(
      [
        ['검색어', f.q],
        // 개별 상태(프로젝트 상태 이름)와 상태 범주는 필터 바처럼 따로 싣는다(WP-808).
        ['상태', names(f.statusIds, lookups.statuses)],
        ['상태 범주', joinMapped(f.statuses, ISSUE_STATUS_LABEL)],
        ['담당', assignee],
        ['우선순위', joinMapped(f.priorities, ISSUE_PRIORITY_LABEL)],
        ['라벨', names(f.labelIds, lookups.labels)],
        ['구성요소', component],
        ['수정 버전', fixVersion],
        ['영향 버전', affectsVersion],
        ['유형', names(f.typeIds, lookups.types)],
        ['마감', dueRange(f.dueFrom, f.dueTo)],
        // 완료일 기간(WP-873) — 화면 칩과 같은 문구(프리셋은 이름+기간)로 AI 가 「지난 주 완료한 것」을 같은 범위로 안다.
        ['완료일', f.closedIn ? closedRangeLabel(f.closedIn) : null],
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
  return { view: '이슈 목록', app: 'ISSUE', scope };
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

// 내 작업 — 범위 라벨 + facet facts + 목록 상태.
function facetListContext(
  view: string,
  label: string,
  input: { facets: Record<string, string>; count?: number; hasMore?: boolean },
): AiScreenContext {
  return { view, app: 'ISSUE', scope: withListState({ label, facts: facetFacts(input.facets) }, input) };
}

export function buildMyTasksContext(input: {
  tab: keyof typeof MY_TASKS_TAB_LABEL;
  facets: Record<string, string>;
  count?: number;
  hasMore?: boolean;
}): AiScreenContext {
  return facetListContext('내 작업', `내 작업 · ${MY_TASKS_TAB_LABEL[input.tab]}`, input);
}

/** AI 위임 작업(WP-377) — count 는 보이는 집합의 서버 건수(/me/ai-tasks/counts — 칩이 켜졌으면 그 칩 건수, 아니면 all).
 *  무한 스크롤로 받은 행 수가 아니므로 hasMore 는 싣지 않는다. facts 는 범위 「전체」·켜진 AI 진행 칩(기본값이면 생략) + 상태·우선순위.
 *  마감·차단됨은 /me/ai-tasks 가 무시하는 facet 이라 URL 에 남아 있어도 싣지 않는다(결과에 반영되지 않는 조건을 AI 에 알리지 않게). */
export function buildAiTasksContext(input: {
  facets: Record<string, string>;
  count?: number;
  scope?: 'mine' | 'all';
  /** 켜진 빠른 필터 칩 라벨(답변 필요·완료 등) — 미완료(기본) 칩이면 없음. */
  stateLabel?: string | null;
}): AiScreenContext {
  const facts = buildFacts([
    ['범위', input.scope === 'all' ? '전체' : null],
    ['AI 진행', input.stateLabel],
    ['상태', joinMapped(csv(input.facets.status), ISSUE_STATUS_LABEL)],
    ['우선순위', joinMapped(csv(input.facets.priority), ISSUE_PRIORITY_LABEL)],
  ]);
  // 칩은 scope.label 이 view 를 포함하면 범위 라벨만 보여 준다 → 'AI 위임 작업' 한 번만 표시.
  return { view: 'AI 위임 작업', app: 'ISSUE', scope: withListState({ label: 'AI 위임 작업', facts }, input) };
}

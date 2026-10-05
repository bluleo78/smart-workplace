// 이슈/사이클/마일스톤 응답을 TimelineGantt 가 소비하는 모델로 변환하는 순수 함수 모음.
// 네트워크/상태와 분리해 vitest 로 검증한다.

import { addDays, addMonths, differenceInCalendarDays, endOfQuarter, format, getDaysInMonth, isValid, parseISO, startOfQuarter, subMonths } from 'date-fns';

import type { CycleResponse } from '@/types/cycle';
import type { IssueResponse, IssueStatus } from '@/types/issue';
import type { MilestoneResponse } from '@/types/milestone';

import type {
  DateSpan,
  PeriodParam,
  TimelineBar,
  TimelineCycleBand,
  TimelineDependencyEdge,
  TimelineEpicGroup,
  TimelineMilestoneMarker,
  TimelinePeriod,
  TimelineViewOptions,
} from './timelineTypes';

/** 시작/종료 날짜가 모두 있는 사이클만 밴드로 변환. */
export function cyclesToBands(cycles: CycleResponse[]): TimelineCycleBand[] {
  return cycles
    .filter((c): c is CycleResponse & { startDate: string; endDate: string } =>
      Boolean(c.startDate && c.endDate),
    )
    .map((c) => ({ id: c.id, name: c.name, startDate: c.startDate, endDate: c.endDate }));
}

/** 마일스톤 목록을 간트 마커로 변환. */
export function milestonesToMarkers(milestones: MilestoneResponse[]): TimelineMilestoneMarker[] {
  return milestones.map((m) => ({ id: m.id, name: m.name, dueDate: m.dueDate }));
}

/**
 * 의존 엣지 중 양끝 이슈가 모두 타임라인 막대(bars)에 존재하는 것만 남긴다 —
 * 일정 미정/CANCELED 이슈로의 화살표는 SVAR 가 렌더할 노드가 없어 제외해야 한다.
 */
export function filterRenderableDependencies(
  edges: TimelineDependencyEdge[],
  bars: TimelineBar[],
): TimelineDependencyEdge[] {
  const barIssueNumbers = new Set(bars.map((b) => b.issueNumber));
  return edges.filter(
    (e) => barIssueNumbers.has(e.fromIssueNumber) && barIssueNumbers.has(e.toIssueNumber),
  );
}

/** 일정 미정 이슈를 타임라인에 배치할 때 쓸 기본 기간 — 오늘부터 7일. */
export function defaultScheduleRange(today: Date): { startDate: string; dueDate: string } {
  return {
    startDate: format(today, 'yyyy-MM-dd'),
    dueDate: format(addDays(today, 7), 'yyyy-MM-dd'),
  };
}

/** yyyy-MM-dd 두 날짜의 일수 차(b - a). */
const dayDiff = (a: string, b: string) => differenceInCalendarDays(parseISO(b), parseISO(a));

/**
 * 에픽 막대(range) 기준 얇은 막대(rollup)의 기하 — 모두 % (WP-249).
 * - left/width: 에픽 막대 폭 대비 얇은 막대의 위치·폭. 앞으로 넘치면 left 가 음수, 뒤로 넘치면 left+width > 100.
 * - inStart/inEnd: 얇은 막대 폭 대비 에픽 기간 안쪽 구간. 이 밖은 초과 구간(빨강). 겹침이 없으면 inStart = inEnd.
 * 막대는 마감일 당일을 포함하므로(끝 = due + 1일) 일수에 1 을 더한다.
 */
export function rollupOverlay(
  range: DateSpan,
  rollup: DateSpan,
): { left: number; width: number; inStart: number; inEnd: number } {
  // 최소 1일 — 하위 롤업은 이슈별 start/due 를 따로 모아(min/max) 뒤집힐 수 있어 0·음수 나눗셈을 막는다.
  const epicDays = Math.max(1, dayDiff(range.start, range.due) + 1);
  const rollupDays = Math.max(1, dayDiff(rollup.start, rollup.due) + 1);
  const offset = dayDiff(range.start, rollup.start); // 에픽 시작 → 얇은 막대 시작
  const pct = (days: number, of: number) => (days / of) * 100;
  const clamp = (v: number) => Math.min(rollupDays, Math.max(0, v));
  const inStart = clamp(-offset); // 얇은 막대 안에서 에픽 시작 위치
  const inEnd = Math.max(inStart, clamp(epicDays - offset)); // 얇은 막대 안에서 에픽 끝 위치
  return {
    left: pct(offset, epicDays),
    width: pct(rollupDays, epicDays),
    inStart: pct(inStart, rollupDays),
    inEnd: pct(inEnd, rollupDays),
  };
}

const NO_EPIC_KEY = 'no-epic';

/** 에픽 그룹 키 — 간트 그룹(TimelineEpicGroup.key)과 펼침 상태 저장(useTimelineExpanded)이 같은 형식을 쓴다. */
export const epicGroupKey = (epicNumber: number) => `epic-${epicNumber}`;

/** IssueResponse → TimelineBar 변환 (dueDate 필수 — 호출부가 사전에 필터링). */
function toBar(issue: TimelineIssue): TimelineBar {
  return {
    issueNumber: issue.number,
    issueKey: `${issue.projectKey}-${issue.number}`,
    title: issue.title,
    start: issue.startDate,
    due: issue.dueDate!,
    status: issue.status,
    ...(issue.formerEpicTitle ? { formerEpicTitle: issue.formerEpicTitle } : {}),
  };
}

/**
 * 막대 목록의 min-start(없으면 due) ~ max-due 롤업 range 계산 (#662).
 * 에픽 그룹과 no-epic 그룹이 동일한 규칙을 쓴다 — bars 가 비어 있으면 null.
 */
function rollupRange(bars: TimelineBar[]): DateSpan | null {
  if (bars.length === 0) return null;
  const starts = bars.map((b) => b.start ?? b.due);
  const dues = bars.map((b) => b.due);
  return { start: starts.reduce((a, b) => (a < b ? a : b)), due: dues.reduce((a, b) => (a > b ? a : b)) };
}

/** 화면 거름을 거친 이슈 — 취소된 에픽에서 「에픽 없음」으로 옮겨진 이슈는 원래 에픽 제목을 싣는다(WP-247). */
export type TimelineIssue = IssueResponse & { formerEpicTitle?: string };

/** 이슈의 날짜 구간 — 한쪽만 있으면 그날 하루, 뒤집혀 있으면 바로잡는다. 둘 다 없으면 null. */
function spanOf(start: string | null, due: string | null): DateSpan | null {
  const s = start ?? due;
  const e = due ?? start;
  if (!s || !e) return null;
  return s <= e ? { start: s, due: e } : { start: e, due: s };
}
const overlaps = (span: DateSpan, p: { from: string; to: string }) => span.start <= p.to && span.due >= p.from;

/** 에픽 자체 기간 — 마감일이 있을 때만(시작일이 없거나 마감일보다 늦으면 마감일 하루), 없으면 null(WP-248). 간트·아젠다 공용. */
function epicOwnRange(epic: Pick<IssueResponse, 'startDate' | 'dueDate'>): DateSpan | null {
  if (!epic.dueDate) return null;
  return { start: epic.startDate && epic.startDate <= epic.dueDate ? epic.startDate : epic.dueDate, due: epic.dueDate };
}

/** 에픽 진행률 — 응답에 에픽이 있으면 서버 집계, 필터로 빠져 합성한 에픽이면 보이는 하위 기준. 간트·아젠다 공용. */
function epicProgress(epic: IssueResponse | null | undefined, kids: IssueResponse[]): { done: number; total: number } {
  return epic
    ? { done: epic.childDoneCount, total: epic.childCount }
    : { done: kids.filter((k) => k.status === 'DONE').length, total: kids.length };
}

/**
 * 하위 실제 범위 — 하위 날짜(시작·마감) 전체의 최소 ~ 최대. 날짜 있는 하위가 없으면 null.
 * 시작 > 마감인 잘못된 데이터도 뒤집히지 않는다. 아젠다 얇은 막대·머리 행 날짜(WP-251)용.
 * 조회 기간 거름은 간트 막대와 맞추려고 이것 대신 마감일 있는 하위만의 rollupRange 를 쓴다(WP-247).
 */
function childDateSpan(kids: Pick<IssueResponse, 'startDate' | 'dueDate'>[]): DateSpan | null {
  const dates = kids.flatMap((k) => [k.startDate, k.dueDate]).filter((d): d is string => d != null).sort();
  return dates.length > 0 ? { start: dates[0], due: dates[dates.length - 1] } : null;
}

/** 두 날짜 구간의 겹침 — 없으면 null. */
function intersectSpan(a: DateSpan, b: DateSpan): DateSpan | null {
  const start = a.start > b.start ? a.start : b.start;
  const due = a.due < b.due ? a.due : b.due;
  return start <= due ? { start, due } : null;
}

/**
 * 타임라인에 올릴 이슈 — 간트(groupTimelineIssues)와 모바일 아젠다(buildAgendaSections)가 같은 규칙을 쓴다.
 * 1) 상태: SUBTASK 제외. 취소 이슈·취소 에픽은 「취소」 상태 필터(includeCanceled)일 때만 남긴다.
 *    취소된 에픽의 할 일·진행 중 하위는 부모를 떼어 「에픽 없음」으로 옮기고(formerEpicTitle), 완료·취소 하위는
 *    「취소」 필터면 (보이는) 취소 에픽 아래 그대로 두고, 아니면 숨긴다. 필터로 취소 에픽 행이 응답에 없어도 하위의
 *    parent.status 가 CANCELED 면 같은 규칙을 적용한다(「취소」 필터의 완료·취소 하위는 부모 요약으로 합성한 묶음 아래 남는다).
 * 2) 기간(period): 에픽은 간트 막대와 같은 정의로 판단한다 — 자체 기간(epicOwnRange) 또는 마감일 있는 하위 롤업
 *    (rollupRange — 간트 range/얇은 막대와 같은 min(start ?? due) ~ max(due))이 겹치면 하위 전부와 함께 보인다(일정 초과 하위도 보이게).
 *    에픽 없는 이슈는 자기 구간으로. 마감일이 없는 이슈(간트에선 막대 없이 「일정 미정」)와 막대가 없는 에픽은 거르지 않는다.
 */
export function prepareTimelineIssues(
  issues: IssueResponse[],
  { includeCanceled = false, period = null }: TimelineViewOptions = {},
): TimelineIssue[] {
  const canceledEpics = new Map(
    issues.filter((i) => i.type?.name === 'EPIC' && i.status === 'CANCELED').map((i) => [i.number, i.title]),
  );
  const byStatus: TimelineIssue[] = [];
  for (const i of issues) {
    if (i.type?.name === 'SUBTASK') continue;
    // 취소 에픽 하위 판정 — 응답의 취소 에픽 우선, 필터로 에픽 행이 빠졌으면 하위의 parent.status 로 판단한다(WP-247).
    const canceledParent =
      i.parent?.type.name === 'EPIC'
        ? (canceledEpics.get(i.parent.number) ?? (i.parent.status === 'CANCELED' ? i.parent.title : undefined))
        : undefined;
    if (canceledParent !== undefined) {
      if (i.status === 'TODO' || i.status === 'IN_PROGRESS') byStatus.push({ ...i, parent: null, formerEpicTitle: canceledParent });
      // 완료·취소 하위 — 「취소」 필터로 취소 에픽이 보일 때는 그 아래 하위로 둔다.
      else if (includeCanceled) byStatus.push(i);
      continue;
    }
    if (i.status === 'CANCELED' && !includeCanceled) continue;
    byStatus.push(i);
  }
  if (!period) return byStatus;

  // 에픽 번호 → 하위(응답에 에픽이 없는 합성 묶음 포함).
  const kidsOf = new Map<number, TimelineIssue[]>();
  for (const i of byStatus) {
    if (i.type?.name !== 'EPIC' && i.parent?.type.name === 'EPIC') {
      const list = kidsOf.get(i.parent.number) ?? [];
      list.push(i);
      kidsOf.set(i.parent.number, list);
    }
  }
  const epicByNumber = new Map(byStatus.filter((i) => i.type?.name === 'EPIC').map((e) => [e.number, e]));
  const visibleEpics = new Set<number>();
  for (const num of new Set([...epicByNumber.keys(), ...kidsOf.keys()])) {
    const epic = epicByNumber.get(num);
    // 에픽 기간 = 간트 막대(groupTimelineIssues 의 range)와 같은 정의 — 막대는 기간 안인데 거름에서 빠지는 어긋남을 막는다(WP-247 코멘트, WP-248).
    // 여기에 마감일 있는 하위 롤업(간트 rollupRange — WP-249 얇은 막대와 같은 정의)을 더해 range ∪ rollup 과 겹치면 보인다 —
    // 에픽 기간이 지났어도 남은 하위가 조회 기간에 걸치면 보이게. 마감일 없는 하위는 간트에 막대가 없어 판단에 넣지 않는다.
    const own = epic ? epicOwnRange(epic) : null;
    const rollup = rollupRange((kidsOf.get(num) ?? []).filter((k) => k.dueDate).map(toBar));
    // 마감일도 마감일 있는 하위도 없으면(시작일만 있는 에픽 포함) 간트에 막대가 없다 — 「일정 미정」처럼 기간과 무관하게 남긴다.
    const undated = !own && !rollup;
    if (undated || (own && overlaps(own, period)) || (rollup && overlaps(rollup, period))) visibleEpics.add(num);
  }
  return byStatus.filter((i) => {
    if (i.type?.name === 'EPIC') return visibleEpics.has(i.number);
    if (i.parent?.type.name === 'EPIC') return visibleEpics.has(i.parent.number);
    // 마감일 없는 이슈는 간트에서 「일정 미정」(막대는 dueDate 필수) — 기간과 무관하게 남긴다.
    if (!i.dueDate) return true;
    return overlaps(spanOf(i.startDate, i.dueDate)!, period);
  });
}

/**
 * 이슈를 에픽 트리 구조로 그룹핑 (#649).
 * - EPIC 유형 → 그룹 행, 하위 이슈는 parent(EPIC) 기준으로 소속. 에픽 없는 이슈는 no-epic 가상 그룹(맨 뒤).
 * - SUBTASK 는 계획 단위가 아니므로 전면 제외. 상태·기간 거름은 prepareTimelineIssues(WP-247).
 * - range: 에픽 자체 기간(마감일이 있을 때, 시작일 없으면 마감일 하루) 우선, 없으면 하위 막대 min start(없으면 due) ~ max due 롤업(WP-248).
 * - rollup: range 가 에픽 자체 기간일 때의 하위 롤업 — 에픽 막대 아래 얇은 막대로 그린다(WP-249).
 *   범위를 계산할 수 없는 그룹은 간트에 그릴 것이 없으므로 groups 에서 제외한다(하위 미정 이슈는 unscheduled 로).
 * - 에픽이 필터로 응답에 없어도 하위의 parent 요약으로 그룹을 합성한다(제목/진행률은 보이는 하위 기준).
 */
export function groupTimelineIssues(issues: IssueResponse[], opts: TimelineViewOptions = {}): {
  groups: TimelineEpicGroup[];
  unscheduled: IssueResponse[];
} {
  const active = prepareTimelineIssues(issues, opts);

  const epics = active.filter((i) => i.type?.name === 'EPIC');
  const epicByNumber = new Map(epics.map((e) => [e.number, e]));
  const children = new Map<number, TimelineIssue[]>(); // epicNumber → 하위
  const looseIssues: TimelineIssue[] = [];
  for (const issue of active) {
    if (issue.type?.name === 'EPIC') continue;
    if (issue.parent?.type.name === 'EPIC') {
      const list = children.get(issue.parent.number) ?? [];
      list.push(issue);
      children.set(issue.parent.number, list);
    } else {
      looseIssues.push(issue);
    }
  }

  const groups: TimelineEpicGroup[] = [];
  const unscheduled: IssueResponse[] = [];

  // 에픽 그룹 — 응답에 있는 에픽 + 하위만 보이는 합성 에픽을 번호 오름차순으로.
  const epicNumbers = [...new Set([...epicByNumber.keys(), ...children.keys()])].sort((a, b) => a - b);
  for (const num of epicNumbers) {
    const epic = epicByNumber.get(num) ?? null;
    const kids = children.get(num) ?? [];
    const bars = kids.filter((k) => k.dueDate).map(toBar);
    // 미정 하위는 "일정 미정" 섹션이 아니라 소속 에픽 아래 행으로 노출한다(중복 없음).
    const undatedChildren = kids.filter((k) => !k.dueDate);

    // range(에픽 막대): 에픽 자체 기간(마감일 기준) 우선 → 없으면 날짜 있는 자식 롤업 → 그것도 없으면 null (WP-248).
    // null 이어도 그룹은 만든다 — 에픽 막대는 안 그리지만 그룹 행/펼침·미정 자식 노출은 유지한다.
    // rollup(얇은 막대, WP-249): 에픽 기간으로 막대를 그릴 때만 하위 실제 범위를 따로 둔다 —
    // 막대가 이미 하위 롤업이면 같은 내용이라 생략한다.
    const childRange = rollupRange(bars);
    const ownRange = epic ? epicOwnRange(epic) : null;
    const range: TimelineEpicGroup['range'] = ownRange ?? childRange;
    const rollup: TimelineEpicGroup['rollup'] = ownRange ? childRange : null;
    // 합성 그룹(응답에 에픽 객체 없음)인데 자식도 전혀 없으면 무의미 — 스킵(실제로는 발생 안 함).
    if (!epic && kids.length === 0) continue;

    groups.push({
      key: epicGroupKey(num),
      epicNumber: num,
      title: epic?.title ?? kids[0]?.parent?.title ?? `#${num}`,
      // 합성 그룹(응답에 에픽 없음)은 하위가 실어 온 부모 상태로 — 「취소」 필터로 남은 취소 에픽 하위 묶음도 취소 표시가 되게(WP-247).
      status: epic?.status ?? kids[0]?.parent?.status ?? null,
      ...epicProgress(epic, kids),
      range,
      rollup,
      bars,
      undatedChildren,
    });
  }

  // no-epic 그룹 — 막대 있는 이슈만, 맨 뒤에.
  const looseBars = looseIssues.filter((i) => i.dueDate).map(toBar);
  for (const issue of looseIssues) if (!issue.dueDate) unscheduled.push(issue);
  if (looseBars.length > 0) {
    groups.push({
      key: NO_EPIC_KEY,
      epicNumber: null,
      title: '에픽 없음',
      status: null,
      done: 0,
      total: 0,
      // 그리드의 시작일/기간 컬럼에 의미 있는 값을 보이기 위해 에픽 그룹과 동일하게 롤업(#662).
      // 간트 영역의 막대는 range 여부와 무관하게 group id 기준 CSS 로 항상 숨긴다(timeline-gantt.css) —
      // "no-epic 은 롤업 막대를 그리지 않는다" 는 시각적 불변식은 그대로 유지된다.
      range: rollupRange(looseBars),
      rollup: null, // no-epic 은 막대 자체를 그리지 않는다.
      bars: looseBars,
      undatedChildren: [], // no-epic 그룹은 미정 자식 개념이 없다(미정 loose 는 unscheduled 로).
    });
  }

  return { groups, unscheduled };
}

// ─── 모바일 타임라인 아젠다(WP-197) ───────────────────────────────────────────────
// 간트 대신 월별 세로 목록. 기준일 = 시작일(없으면 마감일). 에픽은 자기 기준일의 월에 두고 하위를 바로 아래에 묶는다
// (하위의 월이 달라도 — 시안 기준). 날짜 계산은 yyyy-MM-dd 문자열로만 해 타임존과 무관하게 한다.

/** 아젠다 행 1개. */
export interface AgendaRow {
  issueNumber: number;
  title: string;
  /** epic = 에픽 머리 행(굵게·보라), child = 에픽 하위(들여쓰기), issue = 에픽 없는 이슈. */
  kind: 'epic' | 'child' | 'issue';
  /** 표시 날짜(yyyy-MM-dd). 자기 날짜가 없는 에픽 머리 행은 하위 롤업(가장 이른 기준일 ~ 가장 늦은 끝). */
  start: string | null;
  due: string | null;
  /** 이슈 상태 — 완료·취소 에픽 행 표시용(WP-247). 합성 에픽 머리 행은 TODO 로 둔다. */
  status: IssueStatus;
  /** 취소된 에픽에서 옮겨진 단독 행의 원래 에픽 제목(WP-247). */
  formerEpicTitle?: string;
  /** 섹션 월 안 막대 위치(0~1 비율, 월 밖은 0/1 로 잘림). 날짜가 하나도 없으면 null. */
  bar: { left: number; right: number } | null;
  /** 소속 에픽 번호 — epic 행은 자기 번호, child 는 부모 에픽, issue 는 null. 접기(WP-251)에 쓴다. */
  epicNumber: number | null;
  /** 에픽 행 진행률(완료/전체, epicProgress). 그 밖의 행은 null. */
  progress: { done: number; total: number } | null;
  /** 에픽 행에 하위 행이 있는지 — 펼침 버튼 표시 여부. 그 밖의 행은 false. */
  hasChildren: boolean;
  /**
   * 에픽 행 아래 얇은 막대(WP-251, 데스크톱 WP-249 와 같은 규칙) — 날짜 있는 하위의 실제 범위(bar)와
   * 그중 에픽 기간 안쪽 구간(inside, 겹침 없으면 null). bar 중 inside 밖은 초과 구간이다.
   * 에픽 자체 기간(epicOwnRange — 데스크톱과 같은 기준)이 없거나 날짜 있는 하위가 없으면 null.
   */
  rollup: {
    bar: { left: number; right: number };
    inside: { left: number; right: number } | null;
    /** 하위 실제 범위 날짜와 에픽 기간 초과 여부 — 색 외 수단(스크린리더 문구)용. */
    span: DateSpan;
    overflow: boolean;
  } | null;
}

/** 아젠다 섹션 1개 — 월 또는 「일정 미정」. */
export interface AgendaSection {
  /** 'yyyy-MM' 또는 'undated' — testid 접미사(agenda-month-{key}). */
  key: string;
  /** 「2026년 10월」 / 「일정 미정」. */
  label: string;
  /** 오늘이 이 월이면 오늘 선 위치(0~1, 그날의 가운데), 아니면 null. 미정 섹션은 항상 null. */
  todayRatio: number | null;
  rows: AgendaRow[];
}

const UNDATED_KEY = 'undated';
const basisOf = (i: { startDate: string | null; dueDate: string | null }) => i.startDate ?? i.dueDate;
const monthKeyOf = (date: string) => date.slice(0, 7);
// 'YYYY-MM' 월의 일수 — m 은 1-based 라 Date 월 인덱스(0-based)로 바꿔 넘긴다.
const daysInMonth = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return getDaysInMonth(new Date(y, m - 1, 1));
};

/** 날짜의 월 안 위치 — 이전 달이면 0, 다음 달이면 1(잘림). end=true 면 그날의 끝. */
function ratioInMonth(key: string, date: string, end: boolean): number {
  const dk = monthKeyOf(date);
  if (dk < key) return 0;
  if (dk > key) return 1;
  return (Number(date.slice(8, 10)) - (end ? 0 : 1)) / daysInMonth(key);
}

/** 섹션 월 기준 막대 — 한쪽 날짜만 있으면 그날 하루, 시작 > 마감(잘못된 데이터)이면 뒤집는다. */
function barIn(key: string, start: string | null, due: string | null): AgendaRow['bar'] {
  const s = start ?? due;
  const e = due ?? start;
  if (!s || !e) return null;
  const [a, b] = s <= e ? [s, e] : [e, s];
  return { left: ratioInMonth(key, a, false), right: ratioInMonth(key, b, true) };
}

/** 기준일 오름차순(없으면 뒤), 같으면 번호 오름차순. */
function byBasis(a: { basis: string | null; number: number }, b: { basis: string | null; number: number }): number {
  if (a.basis !== b.basis) {
    if (a.basis == null) return 1;
    if (b.basis == null) return -1;
    return a.basis < b.basis ? -1 : 1;
  }
  return a.number - b.number;
}

/** 이슈 → 모바일 아젠다 섹션(월 오름차순, 「일정 미정」 맨 뒤). today 는 오늘 선 위치에만 쓴다. */
export function buildAgendaSections(issues: IssueResponse[], today: Date, opts: TimelineViewOptions = {}): AgendaSection[] {
  const active = prepareTimelineIssues(issues, opts);
  const epicByNumber = new Map(active.filter((i) => i.type?.name === 'EPIC').map((e) => [e.number, e]));
  const children = new Map<number, TimelineIssue[]>();
  const loose: TimelineIssue[] = [];
  for (const i of active) {
    if (i.type?.name === 'EPIC') continue;
    if (i.parent?.type.name === 'EPIC') {
      // 매번 배열을 복사하지 않고 같은 배열에 push(groupTimelineIssues 와 같은 방식).
      const list = children.get(i.parent.number) ?? [];
      list.push(i);
      children.set(i.parent.number, list);
    } else {
      loose.push(i);
    }
  }

  // 막대는 섹션 월이 정해진 뒤 계산하므로, 그 전엔 날짜 구간만 들고 있는다(rollupSpan/insideSpan).
  type Item = Omit<AgendaRow, 'bar' | 'rollup'> & { rollupSpan?: DateSpan; insideSpan?: DateSpan | null };
  // 블록 = 섹션에 함께 들어가는 행 묶음(에픽 머리 + 하위, 또는 단독 이슈). 블록 기준일로 섹션·순서를 정한다.
  const blocks: { basis: string | null; number: number; items: Item[] }[] = [];
  const toItem = (i: TimelineIssue, kind: AgendaRow['kind'], epicNumber: number | null): Item => ({
    issueNumber: i.number,
    title: i.title,
    kind,
    start: i.startDate,
    due: i.dueDate,
    epicNumber,
    progress: null,
    hasChildren: false,
    status: i.status,
    ...(i.formerEpicTitle ? { formerEpicTitle: i.formerEpicTitle } : {}),
  });

  for (const num of new Set([...epicByNumber.keys(), ...children.keys()])) {
    const epic = epicByNumber.get(num);
    const kids = (children.get(num) ?? []).map((k) => ({ basis: basisOf(k), number: k.number, k })).sort(byBasis);
    const kidBases = kids.map((x) => x.basis).filter((b): b is string => b != null); // byBasis 정렬이라 이미 오름차순
    // 하위 실제 범위 = 하위 날짜 전체의 최소 ~ 최대(시작 > 마감인 잘못된 데이터도 뒤집히지 않는다).
    const kidSpan = childDateSpan(kids.map((x) => x.k));
    const own = epic ? basisOf(epic) : null;
    const epicRow = { epicNumber: num, progress: epicProgress(epic, kids.map((x) => x.k)), hasChildren: kids.length > 0 };
    // 에픽 자기 날짜가 있으면 그대로, 없으면(또는 응답에 에픽이 없으면) 하위 롤업으로 머리 행 날짜·막대를 만든다.
    let head: Item;
    if (epic && own) {
      head = { ...toItem(epic, 'epic', num), ...epicRow };
      // 에픽 자체 기간 vs 하위 실제 범위 — 얇은 막대와 기간 안쪽 구간(WP-251). 기준은 데스크톱 간트와 같다.
      const ownRange = epicOwnRange(epic);
      if (ownRange && kidSpan) {
        head.rollupSpan = kidSpan;
        head.insideSpan = intersectSpan(ownRange, kidSpan);
      }
    } else {
      head = {
        issueNumber: num,
        title: epic?.title ?? kids[0]?.k.parent?.title ?? `#${num}`,
        kind: 'epic',
        // 합성 머리 행은 하위가 실어 온 부모 상태(없으면 TODO) — 간트 합성 그룹과 같은 규칙.
        status: epic?.status ?? kids[0]?.k.parent?.status ?? 'TODO',
        start: kidSpan?.start ?? null,
        due: kidSpan?.due ?? null,
        ...epicRow,
      };
    }
    blocks.push({ basis: own ?? kidBases[0] ?? null, number: num, items: [head, ...kids.map((x) => toItem(x.k, 'child', num))] });
  }
  for (const i of loose) blocks.push({ basis: basisOf(i), number: i.number, items: [toItem(i, 'issue', null)] });
  blocks.sort(byBasis);

  const todayStr = format(today, 'yyyy-MM-dd');
  const sections = new Map<string, AgendaSection>();
  for (const b of blocks) {
    const key = b.basis ? monthKeyOf(b.basis) : UNDATED_KEY;
    let sec = sections.get(key);
    if (!sec) {
      const [y, m] = key.split('-');
      sec =
        key === UNDATED_KEY
          ? { key, label: '일정 미정', todayRatio: null, rows: [] }
          : {
              key,
              label: `${y}년 ${Number(m)}월`,
              todayRatio:
                monthKeyOf(todayStr) === key ? (Number(todayStr.slice(8, 10)) - 0.5) / daysInMonth(key) : null,
              rows: [],
            };
      sections.set(key, sec);
    }
    for (const { rollupSpan, insideSpan, ...it } of b.items) {
      const dated = key !== UNDATED_KEY;
      sec.rows.push({
        ...it,
        bar: dated ? barIn(key, it.start, it.due) : null,
        rollup:
          dated && rollupSpan
            ? {
                bar: barIn(key, rollupSpan.start, rollupSpan.due)!,
                inside: insideSpan ? barIn(key, insideSpan.start, insideSpan.due) : null,
                span: rollupSpan,
                overflow: insideSpan?.start !== rollupSpan.start || insideSpan?.due !== rollupSpan.due,
              }
            : null,
      });
    }
  }
  // blocks 가 기준일 오름차순(미정 맨 뒤)이라 Map 삽입 순서 = 섹션 순서.
  return [...sections.values()];
}

// ─── 조회 기간(WP-247) ────────────────────────────────────────────────────────────
// URL `period` 값 ↔ PeriodParam, 그리고 사이클·오늘 기준으로 실제 기간(양끝 포함)을 푼다. 화면 거름은 prepareTimelineIssues.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const validIso = (s: string) => ISO_DATE.test(s) && isValid(parseISO(s));
const iso = (d: Date) => format(d, 'yyyy-MM-dd');

/** URL 값 → PeriodParam. 비었거나 알 수 없거나 형식이 틀리면 active(기본). range 가 뒤집혀 있으면 바로잡는다. */
export function parsePeriodParam(raw: string | null): PeriodParam {
  if (raw === 'all' || raw === 'quarter' || raw === 'rolling') return { kind: raw };
  const cycleMatch = raw?.match(/^cycle-(\d+)$/);
  if (cycleMatch) return { kind: 'cycle', id: Number(cycleMatch[1]) };
  const rangeMatch = raw?.match(/^range:(.+)~(.+)$/);
  if (rangeMatch && validIso(rangeMatch[1]) && validIso(rangeMatch[2])) {
    const [from, to] = rangeMatch[1] <= rangeMatch[2] ? [rangeMatch[1], rangeMatch[2]] : [rangeMatch[2], rangeMatch[1]];
    return { kind: 'range', from, to };
  }
  return { kind: 'active' };
}

/** PeriodParam → URL 값. 기본(active)은 null 을 돌려 URL 에서 뺀다. */
export function periodParamToString(p: PeriodParam): string | null {
  switch (p.kind) {
    case 'active':
      return null;
    case 'cycle':
      return `cycle-${p.id}`;
    case 'range':
      return `range:${p.from}~${p.to}`;
    default:
      return p.kind;
  }
}

/** 기간 문구 "10/1–10/14" — 어느 한쪽이라도 연도가 오늘과 다르면 양쪽에 연도를 붙인다("2025/12/1–2026/1/14"). */
export function formatPeriodSpan(from: string, to: string, today: Date): string {
  const year = String(today.getFullYear());
  const withYear = from.slice(0, 4) !== year || to.slice(0, 4) !== year;
  const md = (d: string) => `${withYear ? `${d.slice(0, 4)}/` : ''}${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return `${md(from)}–${md(to)}`;
}

type DatedCycle = CycleResponse & { startDate: string; endDate: string };
const isDated = (c: CycleResponse): c is DatedCycle => Boolean(c.startDate && c.endDate);
const ROLLING_LABEL = '최근 3개월 ~ 향후 6개월';

function rollingPeriod(today: Date, fallbackNote: string | null): TimelinePeriod {
  return { from: iso(subMonths(today, 3)), to: iso(addMonths(today, 6)), label: ROLLING_LABEL, fallbackNote };
}

/** 활성 사이클 규칙 — 날짜 있는 ACTIVE 합집합 → 가장 가까운 PLANNED → rolling. note 는 대체 시 덧씌울 안내(지정 사이클 대체용). */
function activePeriod(cycles: CycleResponse[], today: Date, note: string | null): TimelinePeriod {
  const active = cycles.filter((c) => c.status === 'ACTIVE').filter(isDated);
  if (active.length > 0) {
    const from = active.map((c) => c.startDate).reduce((a, b) => (a < b ? a : b));
    const to = active.map((c) => c.endDate).reduce((a, b) => (a > b ? a : b));
    const name = active.length === 1 ? active[0].name : `활성 사이클 ${active.length}개`;
    return { from, to, label: `${name} · ${formatPeriodSpan(from, to, today)}`, fallbackNote: note };
  }
  const todayStr = iso(today);
  const planned = cycles.filter((c) => c.status === 'PLANNED').filter(isDated);
  if (planned.length > 0) {
    // 오늘 이후 가장 먼저 시작하는 것, 없으면 시작일이 오늘에 가장 가까운 것.
    const upcoming = planned.filter((c) => c.startDate >= todayStr).sort((a, b) => a.startDate.localeCompare(b.startDate));
    const distance = (c: DatedCycle) => Math.abs(differenceInCalendarDays(parseISO(c.startDate), today));
    const pick = upcoming[0] ?? [...planned].sort((a, b) => distance(a) - distance(b))[0];
    return {
      from: pick.startDate,
      to: pick.endDate,
      label: `${pick.name} (예정) · ${formatPeriodSpan(pick.startDate, pick.endDate, today)}`,
      fallbackNote: note ?? '활성 사이클이 없어 가장 가까운 예정 사이클로 봅니다',
    };
  }
  return rollingPeriod(today, note ?? '활성·예정 사이클이 없어 최근 3개월 ~ 향후 6개월로 봅니다');
}

/**
 * PeriodParam → 실제 조회 기간. all 이면 null(거르지 않음).
 * cyclesFailed: 사이클 조회 실패 — 사이클이 필요한 active·cycle 은 rolling 으로 대체하고 이유를 안내한다.
 */
export function resolvePeriod(
  param: PeriodParam,
  cycles: CycleResponse[],
  today: Date,
  { cyclesFailed = false }: { cyclesFailed?: boolean } = {},
): TimelinePeriod | null {
  if (cyclesFailed && (param.kind === 'active' || param.kind === 'cycle')) {
    return rollingPeriod(today, '사이클을 불러오지 못해 최근 3개월 ~ 향후 6개월로 봅니다');
  }
  switch (param.kind) {
    case 'all':
      return null;
    case 'rolling':
      return rollingPeriod(today, null);
    case 'quarter': {
      const from = iso(startOfQuarter(today));
      const to = iso(endOfQuarter(today));
      return { from, to, label: `이번 분기 · ${formatPeriodSpan(from, to, today)}`, fallbackNote: null };
    }
    case 'range':
      return { from: param.from, to: param.to, label: formatPeriodSpan(param.from, param.to, today), fallbackNote: null };
    case 'cycle': {
      const c = cycles.find((x) => x.id === param.id);
      if (c && isDated(c)) {
        return { from: c.startDate, to: c.endDate, label: `${c.name} · ${formatPeriodSpan(c.startDate, c.endDate, today)}`, fallbackNote: null };
      }
      return activePeriod(cycles, today, '선택한 사이클을 찾을 수 없거나 날짜가 없어 활성 사이클 기준으로 봅니다');
    }
    case 'active':
      return activePeriod(cycles, today, null);
  }
}

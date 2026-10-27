// 이슈/사이클/마일스톤 응답을 TimelineGantt 가 소비하는 모델로 변환하는 순수 함수 모음.
// 네트워크/상태와 분리해 vitest 로 검증한다.

import { addDays, addMonths, differenceInCalendarDays, differenceInCalendarMonths, endOfQuarter, format, getDaysInMonth, isValid, parseISO, startOfMonth, startOfQuarter, startOfWeek, subMonths } from 'date-fns';

import { CLOSED_ISSUE_STATUSES } from '@/lib/closedHiding';
import type { CycleResponse } from '@/types/cycle';
import type { IssueResponse, IssueStatus } from '@/types/issue';
import type { MilestoneResponse } from '@/types/milestone';
import type { VersionResponse } from '@/types/version';

import type {
  DateSpan,
  PeriodParam,
  TimelineBar,
  TimelineCycleBand,
  TimelineDependencyEdge,
  TimelineEpicGroup,
  TimelineMilestoneMarker,
  TimelinePeriod,
  TimelineVersionMarker,
  TimelineViewOptions,
  TimelineZoom,
} from './timelineTypes';

/** 시작/종료 날짜가 모두 있는 사이클만 밴드로 변환. */
export function cyclesToBands(cycles: CycleResponse[]): TimelineCycleBand[] {
  return cycles
    .filter((c): c is CycleResponse & { startDate: string; endDate: string } =>
      Boolean(c.startDate && c.endDate),
    )
    .map((c) => ({ id: c.id, name: c.name, startDate: c.startDate, endDate: c.endDate }));
}

/**
 * 이름 순서(WP-1027) — 숫자를 값으로 비교해 v0.9.9 < v0.9.10. 같은 날짜 묶음 칩이 마지막 이름을 대표로 보이므로
 * 버전·마일스톤 레인이 같은 규칙을 쓴다.
 */
function compareLaneName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

/** 마일스톤 목록을 간트 마커로 변환 — 마감일 오름차순(같은 날은 이름·id)으로 돌려 레인 배치·묶음이 결정적이게 한다(WP-1027). */
export function milestonesToMarkers(milestones: MilestoneResponse[]): TimelineMilestoneMarker[] {
  return milestones
    .map((m) => ({ id: m.id, name: m.name, dueDate: m.dueDate }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || compareLaneName(a.name, b.name) || a.id - b.id);
}

/**
 * 버전 목록을 간트 ▲ 마커로 변환(WP-888) — 출시일이 있는 미출시·출시됨만(날짜 없음·보관은 그리지 않는다).
 * 날짜 오름차순(같은 날은 이름·id)으로 돌려 겹침 배치가 마일스톤처럼 결정적이게 한다.
 */
export function versionsToMarkers(
  versions: Pick<VersionResponse, 'id' | 'name' | 'releaseDate' | 'status'>[],
): TimelineVersionMarker[] {
  const out: TimelineVersionMarker[] = [];
  for (const v of versions) {
    if (!v.releaseDate || v.status === 'ARCHIVED') continue;
    out.push({ id: v.id, name: v.name, date: v.releaseDate, status: v.status });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || compareLaneName(a.name, b.name) || a.id - b.id);
}

/** 레인 칩 묶음(WP-1027) — 같은 날짜의 마일스톤·버전을 칩 하나로 그리기 위한 단위. */
export interface LaneChipGroup<T> {
  /** 묶음 날짜 yyyy-MM-dd — 칩·점선의 X 와 키. */
  date: string;
  /** 그 날짜의 항목들(입력 순서 유지). */
  items: T[];
}

/**
 * 날짜가 같은 항목을 하나로 묶는다(WP-1027) — 같은 날짜 칩을 겹침 피하기로 옆으로 밀면 뒤 칩이 다른 날짜에 있는 것처럼
 * 읽히므로, 같은 날짜는 칩 하나(그 날짜 점선 위)로 그린다. 입력이 날짜순이면 묶음도 날짜순이다.
 */
export function groupLaneChipsByDate<T>(items: T[], dateOf: (item: T) => string): LaneChipGroup<T>[] {
  const groups: LaneChipGroup<T>[] = [];
  const byDate = new Map<string, LaneChipGroup<T>>();
  for (const item of items) {
    const date = dateOf(item);
    let group = byDate.get(date);
    if (!group) {
      group = { date, items: [] };
      byDate.set(date, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

/**
 * 묶음 칩 문구(WP-1027) — 하나면 그 이름, 여럿이면 마지막 이름에 나머지 개수(「v0.9.25 +1」, 「v0.9.25 +2」).
 * 대표 이름과 「+N」을 나눠 돌려 칩이 이름만 말줄임하고 「+N」은 늘 보이게 한다.
 * 칩 폭이 항목 수와 상관없이 짧게 유지되도록 늘 이름 하나만 보인다(사용자 결정). 마지막을 보이는 것은 같은 날 이름순
 * (숫자 값 비교 — compareLaneName)으로 가장 뒤(대개 가장 새 버전)가 대표이기 때문이다. 전체 이름은 칩을 누른 목록에 있다.
 */
export function laneGroupLabelParts(names: string[]): { name: string; rest: string } {
  if (names.length <= 1) return { name: names[0] ?? '', rest: '' };
  return { name: names[names.length - 1], rest: `+${names.length - 1}` };
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

/**
 * 일정 미정 이슈를 타임라인에 배치할 때 보낼 날짜 — 기본은 오늘부터 7일.
 * 시작일이 이미 있으면(마감만 비어 미정) 그 시작일은 건드리지 않고 시작일 +7일을 마감으로만 채운다
 * (WP-483 — 전에는 기존 시작일을 오늘로 말없이 덮어썼다). 이때는 startDate 를 보내지 않아 이력에도 남지 않는다.
 */
export function defaultScheduleRange(
  today: Date,
  existingStart?: string | null,
): { startDate?: string; dueDate: string } {
  if (existingStart) {
    return { dueDate: format(addDays(parseISO(existingStart), 7), 'yyyy-MM-dd') };
  }
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

/**
 * 에픽 진행률 — 응답에 에픽이 있으면 서버 집계, 필터로 빠져 합성한 에픽이면 보이는 하위 기준. 간트·아젠다 공용.
 * 합성 쪽도 서버 집계(WP-243)처럼 완료·취소 하위를 완료로 센다 — DONE 만 세면 같은 에픽이 이슈 상세 2/2, 타임라인 1/2 로 갈렸다(WP-688).
 */
function epicProgress(epic: IssueResponse | null | undefined, kids: IssueResponse[]): { done: number; total: number } {
  return epic
    ? { done: epic.childDoneCount, total: epic.childCount }
    : { done: kids.filter((k) => CLOSED_ISSUE_STATUSES.has(k.status)).length, total: kids.length };
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
  /** 선행 이슈가 끝나지 않아 차단됐는지 — 이슈 카드와 같은 ⛔ 표시용(WP-646). 합성 에픽 머리 행은 false. */
  blocked: boolean;
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
// 일정 기준일 — 마감일이 있어야 일정이 정해진 것으로 본다(간트와 같은 정의, WP-484). 시작일만 있으면 null(「일정 미정」).
const basisOf = (i: { startDate: string | null; dueDate: string | null }) => (i.dueDate ? (i.startDate ?? i.dueDate) : null);
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
    blocked: i.blocked,
    ...(i.formerEpicTitle ? { formerEpicTitle: i.formerEpicTitle } : {}),
  });

  for (const num of new Set([...epicByNumber.keys(), ...children.keys()])) {
    const epic = epicByNumber.get(num);
    const kids = (children.get(num) ?? []).map((k) => ({ basis: basisOf(k), number: k.number, k })).sort(byBasis);
    const kidBases = kids.map((x) => x.basis).filter((b): b is string => b != null); // byBasis 정렬이라 이미 오름차순
    // 하위 실제 범위 = 마감일 있는 하위 날짜 전체의 최소 ~ 최대(시작 > 마감인 잘못된 데이터도 뒤집히지 않는다).
    // 시작일만 있는 하위는 간트처럼 에픽 기간에 넣지 않는다(WP-484).
    const kidSpan = childDateSpan(kids.filter((x) => x.k.dueDate).map((x) => x.k));
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
        blocked: false,
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
        // 마감일 없는 행(일정 있는 에픽 아래 시작일만 있는 하위)은 막대를 그리지 않는다 — 간트도 막대가 없다(WP-484).
        bar: dated && it.due ? barIn(key, it.start, it.due) : null,
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

/** 처음 열 때 오늘을 차트 왼쪽 끝에서 이만큼 띄운다 — 오늘선 앞 맥락(지난주)이 보이게. */
const INITIAL_SCROLL_LEAD_DAYS = 7;

/**
 * 간트를 처음 열 때 스크롤할 날짜(WP-486) — 차트는 가장 이른 막대부터 그려져, 1024 처럼 좁은 폭에선 오늘·조회 기간이 화면 밖이었다.
 * 오늘이 조회 기간 안이거나 기간이 없으면(전체) 오늘 −7일, 기간이 오늘을 포함하지 않으면 그 기간 시작.
 * 기간 시작이 그보다 늦으면(오늘 직전에 시작한 사이클) 기간 시작으로 — 기간 앞의 빈 구간을 보이지 않게.
 */
export function initialScrollDate(period: TimelinePeriod | null, today: Date): string {
  const lead = format(addDays(today, -INITIAL_SCROLL_LEAD_DAYS), 'yyyy-MM-dd');
  if (!period) return lead;
  const todayStr = format(today, 'yyyy-MM-dd');
  if (todayStr < period.from || todayStr > period.to) return period.from;
  return period.from > lead ? period.from : lead;
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

/** 간트 축을 조회 기간 앞뒤로 넓혀 둘 여유(개월) — 기간을 걸치는 이슈 막대가 축 끝에서 바로 잘리지 않게. */
const GANTT_AXIS_MARGIN_MONTHS = 12;
/** 기간 「전체」일 때 오늘 앞뒤로 둘 축 범위(개월). */
const GANTT_AXIS_ALL_MONTHS = 60;

/**
 * 간트 축 범위 상한(WP-595). SVAR 는 기본으로 모든 막대를 덮게 축을 넓히는데, 1900~2099 같은 이슈 하나가 축을 200년(약 100만 px)으로
 * 늘리면 처음 열 때도 「오늘」을 눌러도 엉뚱한 해(2005년 근처)가 보였다. 막대 범위가 조회 기간 앞뒤 12개월(전체면 오늘 앞뒤 5년)을 넘을
 * 때만 그 안으로 자른 범위를 돌려주고, 넘지 않으면 null — SVAR 자동 범위를 그대로 쓴다. 넘는 막대는 축 끝에서 잘려 보인다.
 */
export function ganttAxisBounds(
  dataStart: Date | null,
  dataEnd: Date | null,
  period: Pick<TimelinePeriod, 'from' | 'to'> | null | undefined,
  today: Date,
): { start: Date; end: Date } | null {
  if (!dataStart || !dataEnd) return null;
  const margin = period ? GANTT_AXIS_MARGIN_MONTHS : GANTT_AXIS_ALL_MONTHS;
  const lo = subMonths(period ? parseISO(period.from) : today, margin);
  const hi = addMonths(period ? parseISO(period.to) : today, margin);
  if (dataStart >= lo && dataEnd <= hi) return null;
  // 축 끝은 월 경계에 맞춘다 — 월 중간에서 시작하면 SVAR 의 월 칸이 어긋나 오늘(10월) 위에 「8월」이 적혔다.
  return {
    start: startOfMonth(dataStart < lo ? lo : dataStart),
    end: startOfMonth(addMonths(dataEnd > hi ? hi : dataEnd, 1)),
  };
}

// ── 주 보기 위쪽 월 칸(WP-605) ─────────────────────────────────────────────
// SVAR 는 월 칸 폭을 「그 달이 걸친 주 수(앞뒤 주 올림)」로 재서 달 경계 주를 양쪽 달에 두 번 센다 — 축이 길수록
// 위쪽 월 칸이 아래쪽 주 칸보다 밀린다(21개월에 3달). 주 보기에서는 달을 주 경계에 맞춘 「주 단위 달」로 그린다.
// 한 주는 그 달이 4일 이상 차지하는 달(= 주 시작 + 3일이 든 달) 소속이다. 아래쪽 주 칸('W'w)과 같은 일요일 시작.

/** 타임라인 간트의 주 시작 요일 — SVAR 기본 로케일·date-fns 'w' 와 같은 일요일. */
export const TIMELINE_WEEK_STARTS_ON = 0;

/** date 가 든 주가 속한 달의 1일. */
export function weekMonthOf(date: Date): Date {
  return startOfMonth(addDays(startOfWeek(date, { weekStartsOn: TIMELINE_WEEK_STARTS_ON }), 3));
}

/** month(그 달 1일)의 주 단위 달이 시작하는 주의 첫날 — 그 달 4일이 든 주. */
function weekMonthBoundary(month: Date): Date {
  return startOfWeek(addDays(startOfMonth(month), 3), { weekStartsOn: TIMELINE_WEEK_STARTS_ON });
}

/** date 가 든 주 단위 달의 시작(주 첫날). */
export function weekMonthStart(date: Date): Date {
  return weekMonthBoundary(weekMonthOf(date));
}

/**
 * date 에서 주 단위 달 n 개 뒤 — 달 시작에서 떨어진 거리는 그대로 둔다(달 시작이면 n 달 뒤 달 시작).
 * SVAR 는 단위들의 add(오늘, 1) 을 견줘 가장 작은 단위를 고르므로, 경계로 붙이면 월말에 주보다 작아 보인다.
 */
export function weekMonthAdd(date: Date, n: number): Date {
  const offset = date.getTime() - weekMonthStart(date).getTime();
  return new Date(weekMonthBoundary(addMonths(weekMonthOf(date), n)).getTime() + offset);
}

/** date 가 든 주 단위 달의 마지막 순간(다음 달 시작 1ms 전) — SVAR 단위 end 규약. */
export function weekMonthEnd(date: Date): Date {
  return new Date(weekMonthAdd(weekMonthStart(date), 1).getTime() - 1);
}

/** a 가 b 보다 몇 주 단위 달 뒤인지. */
export function weekMonthDiff(a: Date, b: Date): number {
  return differenceInCalendarMonths(weekMonthOf(a), weekMonthOf(b));
}

/** date 가 든 주 단위 달의 주 수(4 또는 5). */
export function weeksInWeekMonth(date: Date): number {
  return differenceInCalendarDays(weekMonthAdd(weekMonthStart(date), 1), weekMonthStart(date)) / 7;
}

// ── 일 보기(WP-889) ─────────────────────────────────────────────

const TIMELINE_ZOOMS: readonly TimelineZoom[] = ['day', 'week', 'month'];

/** 저장해 둔 보기 단위 문자열 → 보기 단위. 없거나 모르는 값이면 주 보기(예전 기본값). */
export function parseTimelineZoom(raw: string | null | undefined): TimelineZoom {
  return TIMELINE_ZOOMS.includes(raw as TimelineZoom) ? (raw as TimelineZoom) : 'week';
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** 일 보기 아래 행 칸 라벨 — 「25 토」(날짜·요일). 칸이 좁아 요일은 한 글자다. */
export function dayCellLabel(date: Date): string {
  return `${date.getDate()} ${WEEKDAY_KO[date.getDay()]}`;
}

/** 토·일요일인지 — 일 보기 주말 음영. */
export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

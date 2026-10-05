// 이슈/사이클/마일스톤 응답을 TimelineGantt 가 소비하는 모델로 변환하는 순수 함수 모음.
// 네트워크/상태와 분리해 vitest 로 검증한다.

import { addDays, differenceInCalendarDays, format, getDaysInMonth, parseISO } from 'date-fns';

import type { CycleResponse } from '@/types/cycle';
import type { IssueResponse } from '@/types/issue';
import type { MilestoneResponse } from '@/types/milestone';

import type {
  DateSpan,
  TimelineBar,
  TimelineCycleBand,
  TimelineDependencyEdge,
  TimelineEpicGroup,
  TimelineMilestoneMarker,
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
function toBar(issue: IssueResponse): TimelineBar {
  return {
    issueNumber: issue.number,
    issueKey: `${issue.projectKey}-${issue.number}`,
    title: issue.title,
    start: issue.startDate,
    due: issue.dueDate!,
    status: issue.status,
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

/** 두 날짜 구간의 겹침 — 없으면 null. */
function intersectSpan(a: DateSpan, b: DateSpan): DateSpan | null {
  const start = a.start > b.start ? a.start : b.start;
  const due = a.due < b.due ? a.due : b.due;
  return start <= due ? { start, due } : null;
}

/** 타임라인에 올릴 이슈 — SUBTASK(계획 단위 아님)·CANCELED·취소된 에픽의 하위 제외. 간트(groupTimelineIssues)와 모바일 아젠다가 같은 규칙을 쓴다. */
function activeTimelineIssues(issues: IssueResponse[]): IssueResponse[] {
  const canceledEpics = new Set(
    issues.filter((i) => i.type?.name === 'EPIC' && i.status === 'CANCELED').map((i) => i.number),
  );
  return issues.filter((i) => {
    if (i.type?.name === 'SUBTASK') return false;
    if (i.status === 'CANCELED') return false;
    if (i.parent?.type.name === 'EPIC' && canceledEpics.has(i.parent.number)) return false;
    return true;
  });
}

/**
 * 이슈를 에픽 트리 구조로 그룹핑 (#649).
 * - EPIC 유형 → 그룹 행, 하위 이슈는 parent(EPIC) 기준으로 소속. 에픽 없는 이슈는 no-epic 가상 그룹(맨 뒤).
 * - SUBTASK 는 계획 단위가 아니므로 전면 제외. CANCELED 는 자신 제외 + (에픽이면) 하위 전체 제외.
 * - range: 에픽 자체 기간(마감일이 있을 때, 시작일 없으면 마감일 하루) 우선, 없으면 하위 막대 min start(없으면 due) ~ max due 롤업(WP-248).
 * - rollup: range 가 에픽 자체 기간일 때의 하위 롤업 — 에픽 막대 아래 얇은 막대로 그린다(WP-249).
 *   범위를 계산할 수 없는 그룹은 간트에 그릴 것이 없으므로 groups 에서 제외한다(하위 미정 이슈는 unscheduled 로).
 * - 에픽이 필터로 응답에 없어도 하위의 parent 요약으로 그룹을 합성한다(제목/진행률은 보이는 하위 기준).
 */
export function groupTimelineIssues(issues: IssueResponse[]): {
  groups: TimelineEpicGroup[];
  unscheduled: IssueResponse[];
} {
  const active = activeTimelineIssues(issues);

  const epics = active.filter((i) => i.type?.name === 'EPIC');
  const epicByNumber = new Map(epics.map((e) => [e.number, e]));
  const children = new Map<number, IssueResponse[]>(); // epicNumber → 하위
  const looseIssues: IssueResponse[] = [];
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
export function buildAgendaSections(issues: IssueResponse[], today: Date): AgendaSection[] {
  const active = activeTimelineIssues(issues);
  const epicByNumber = new Map(active.filter((i) => i.type?.name === 'EPIC').map((e) => [e.number, e]));
  const children = new Map<number, IssueResponse[]>();
  const loose: IssueResponse[] = [];
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
  const toItem = (i: IssueResponse, kind: AgendaRow['kind'], epicNumber: number | null): Item => ({
    issueNumber: i.number,
    title: i.title,
    kind,
    start: i.startDate,
    due: i.dueDate,
    epicNumber,
    progress: null,
    hasChildren: false,
  });

  for (const num of new Set([...epicByNumber.keys(), ...children.keys()])) {
    const epic = epicByNumber.get(num);
    const kids = (children.get(num) ?? []).map((k) => ({ basis: basisOf(k), number: k.number, k })).sort(byBasis);
    const kidBases = kids.map((x) => x.basis).filter((b): b is string => b != null); // byBasis 정렬이라 이미 오름차순
    // 하위 실제 범위 = 하위 날짜 전체의 최소 ~ 최대(시작 > 마감인 잘못된 데이터도 뒤집히지 않는다).
    const kidDates = kids.flatMap((x) => [x.k.startDate, x.k.dueDate]).filter((d): d is string => d != null).sort();
    const kidSpan: DateSpan | null = kidDates.length > 0 ? { start: kidDates[0], due: kidDates[kidDates.length - 1] } : null;
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

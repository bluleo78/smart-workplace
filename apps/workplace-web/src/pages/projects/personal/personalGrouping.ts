// 개인 체크리스트 그룹화 — 마감(due) 버킷 + 상태/우선순위 평탄 섹션.
// 활성(미완료·미취소)만 섹션화하고 완료는 따로 반환(due 모드). 정렬은 우선순위→마감 공유.
import type { IssueClientGroupBy, IssueResponse } from '@/types/issue';

export type PersonalBucketKey = 'overdue' | 'today' | 'thisWeek' | 'upcoming' | 'noDue';
export interface PersonalGroup {
  key: string; // 섹션 식별(due 버킷 키 | 상태 | 우선순위). data-testid 에 사용.
  label: string;
  items: IssueResponse[];
}

const PRIORITY_ORDER: Record<string, number> = { HIGH: 0, MID: 1, LOW: 2 };
const LABELS: Record<PersonalBucketKey, string> = {
  overdue: '지남',
  today: '오늘',
  thisWeek: '이번 주',
  upcoming: '예정',
  noDue: '기한 없음',
};
const ORDER: PersonalBucketKey[] = ['overdue', 'today', 'thisWeek', 'upcoming', 'noDue'];

// 상태/우선순위 그룹 정의 — 평탄 섹션(CANCELED 제외).
const STATUS_GROUPS: { status: string; label: string }[] = [
  { status: 'TODO', label: '할 일' },
  { status: 'IN_PROGRESS', label: '진행 중' },
  { status: 'DONE', label: '완료' },
];
const PRIORITY_GROUPS: { priority: string; label: string }[] = [
  { priority: 'HIGH', label: '높음' },
  { priority: 'MID', label: '보통' },
  { priority: 'LOW', label: '낮음' },
];

// 우선순위(높음→낮음) 후 마감일 오름차순(마감 없음은 앞), 동률이면 id 오름차순. groupByDue 내부 정렬과 동일 규칙을 공유.
// id 동률 규칙은 서버 checklist 정렬(WP-918)과 완전히 같게 하려고 둔다 — 다르면 페이지를 이어 붙일 때 같은 섹션 안 순서가 흔들린다.
export function sortByPriorityThenDue(a: IssueResponse, b: IssueResponse): number {
  const p = (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1);
  if (p !== 0) return p;
  const d = (a.dueDate ?? '').localeCompare(b.dueDate ?? '');
  if (d !== 0) return d;
  return a.id - b.id;
}

// 로컬 오늘 0시와 이번 주 마지막 날(일요일) 0시 — groupByDue 와 서버 파라미터(dueBucketBounds)가 같은 경계를 쓰게 한 곳에서 계산한다.
function weekBounds(now: Date): { startOfToday: Date; endOfWeek: Date } {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysUntilSunday = (7 - startOfToday.getDay()) % 7; // 오늘이 일요일이면 0
  const endOfWeek = new Date(startOfToday);
  endOfWeek.setDate(startOfToday.getDate() + daysUntilSunday);
  return { startOfToday, endOfWeek };
}

// 로컬 날짜 YYYY-MM-DD — toISOString 은 UTC 라 자정 근처에 하루가 어긋난다.
function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 마감 버킷 경계 — groupByDue 와 서버 checklist 정렬이 같은 값을 쓴다(로컬 날짜 YYYY-MM-DD). */
export function dueBucketBounds(now: Date = new Date()): { today: string; weekEnd: string } {
  const { startOfToday, endOfWeek } = weekBounds(now);
  return { today: localYmd(startOfToday), weekEnd: localYmd(endOfWeek) };
}

/**
 * 서버 checklist 정렬 파라미터 — groupBy null=due, 'status', 'priority'(그 밖은 화면처럼 due).
 * 서버가 화면 섹션 순서로 내려줘야 페이지를 이어 붙여도 위 섹션이 되돌아가지 않는다(WP-918).
 * 이 값은 그대로 쿼리 키에 들어간다 — 커서(c1)에 모드·날짜가 없으므로, 자정을 넘기거나 모드가 바뀌면 키가 바뀌어 1페이지부터 다시 받는다.
 */
export function checklistOrderParams(groupBy: IssueClientGroupBy | null, now: Date = new Date()): Record<string, string> {
  if (groupBy === 'status' || groupBy === 'priority') return { order: 'checklist', mode: groupBy };
  return { order: 'checklist', mode: 'due', ...dueBucketBounds(now) };
}

// now 는 테스트 주입용(기본 현재 시각). CANCELED 는 체크리스트에서 제외(보드와 동일), DONE 은 done 으로 분리.
export function groupByDue(
  items: IssueResponse[],
  now: Date = new Date(),
): { active: PersonalGroup[]; done: IssueResponse[] } {
  const { startOfToday, endOfWeek } = weekBounds(now);

  const done: IssueResponse[] = [];
  const buckets: Record<PersonalBucketKey, IssueResponse[]> = {
    overdue: [], today: [], thisWeek: [], upcoming: [], noDue: [],
  };

  for (const it of items) {
    if (it.status === 'CANCELED') continue;
    if (it.status === 'DONE') { done.push(it); continue; }
    if (!it.dueDate) { buckets.noDue.push(it); continue; }
    const d = new Date(it.dueDate + 'T00:00:00');
    if (d < startOfToday) buckets.overdue.push(it);
    else if (d.getTime() === startOfToday.getTime()) buckets.today.push(it);
    else if (d <= endOfWeek) buckets.thisWeek.push(it);
    else buckets.upcoming.push(it);
  }

  const active = ORDER.map((k) => ({ key: k, label: LABELS[k], items: buckets[k].sort(sortByPriorityThenDue) }))
    .filter((g) => g.items.length > 0);
  done.sort(sortByPriorityThenDue);
  return { active, done };
}

// 체크리스트 그룹핑 결과. due 모드는 collapsedDone(완료 접힘) 사용, status/priority 모드는 평탄 섹션.
export interface ChecklistGrouping {
  sections: PersonalGroup[];
  collapsedDone: IssueResponse[];
}

// groupBy=null → 마감 버킷(+완료 접힘). status/priority → 평탄 섹션(CANCELED 제외).
export function groupChecklist(
  items: IssueResponse[],
  groupBy: IssueClientGroupBy | null,
  now: Date = new Date(),
): ChecklistGrouping {
  if (groupBy === 'status') {
    const active = STATUS_GROUPS.map((g) => ({
      key: g.status, // 섹션 key 재사용(테스트 testid 용)
      label: g.label,
      items: items.filter((it) => it.status === g.status).sort(sortByPriorityThenDue),
    })).filter((g) => g.items.length > 0);
    return { sections: active, collapsedDone: [] };
  }
  if (groupBy === 'priority') {
    const active = PRIORITY_GROUPS.map((g) => ({
      key: g.priority,
      label: g.label,
      items: items
        .filter((it) => it.status !== 'CANCELED' && it.priority === g.priority)
        .sort(sortByPriorityThenDue),
    })).filter((g) => g.items.length > 0);
    return { sections: active, collapsedDone: [] };
  }
  const { active, done } = groupByDue(items, now);
  return { sections: active, collapsedDone: done };
}

// 개인 체크리스트 그룹화 — 마감(due) 버킷 + 상태/우선순위 평탄 섹션.
// 활성(미완료·미취소)만 섹션화하고 완료는 따로 반환(due 모드). 정렬은 우선순위→마감 공유.
import type { IssueGroupBy, IssueResponse } from '@/types/issue';

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

// 우선순위(높음→낮음) 후 마감일 오름차순. groupByDue 내부 정렬과 동일 규칙을 공유.
export function sortByPriorityThenDue(a: IssueResponse, b: IssueResponse): number {
  const p = (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1);
  if (p !== 0) return p;
  return (a.dueDate ?? '').localeCompare(b.dueDate ?? '');
}

// now 는 테스트 주입용(기본 현재 시각). CANCELED 는 체크리스트에서 제외(보드와 동일), DONE 은 done 으로 분리.
export function groupByDue(
  items: IssueResponse[],
  now: Date = new Date(),
): { active: PersonalGroup[]; done: IssueResponse[] } {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysUntilSunday = (7 - startOfToday.getDay()) % 7; // 오늘이 일요일이면 0
  const endOfWeek = new Date(startOfToday);
  endOfWeek.setDate(startOfToday.getDate() + daysUntilSunday);

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
  groupBy: IssueGroupBy | null,
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

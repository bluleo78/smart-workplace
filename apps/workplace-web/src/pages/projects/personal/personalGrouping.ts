// 개인 체크리스트 — 마감 기준 버킷 그룹화. 활성(미완료·미취소)만 섹션화하고 완료는 따로 반환.
import type { IssueResponse } from '@/types/issue';

export type PersonalBucketKey = 'overdue' | 'today' | 'thisWeek' | 'upcoming' | 'noDue';
export interface PersonalGroup {
  key: PersonalBucketKey;
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

  const sortFn = (a: IssueResponse, b: IssueResponse) => {
    const p = (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1);
    if (p !== 0) return p;
    return (a.dueDate ?? '').localeCompare(b.dueDate ?? '');
  };

  const active = ORDER.map((k) => ({ key: k, label: LABELS[k], items: buckets[k].sort(sortFn) }))
    .filter((g) => g.items.length > 0);
  done.sort(sortFn);
  return { active, done };
}

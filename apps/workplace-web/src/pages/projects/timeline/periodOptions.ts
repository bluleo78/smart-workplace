// 조회 기간 선택지(WP-247) — 데스크톱 드롭다운과 모바일 시트가 같은 목록을 쓴다.
// 사이클은 상태(진행 중 → 계획됨 → 완료됨) 순, 같은 상태 안에서는 시작일이 늦은 것부터(최근 것이 위). 날짜 없는 사이클은 고를 수 없어 뺀다.
import type { CycleResponse, CycleStatus } from '@/types/cycle';
import { CYCLE_STATUS_LABEL } from '@/types/cycle';

import { formatPeriodSpan } from './timelineData';
import type { PeriodParam } from './timelineTypes';

export interface PeriodOption {
  value: string;
  label: string;
  hint: string | null;
  group: 'cycle' | 'preset' | 'all';
}

const STATUS_ORDER: Record<CycleStatus, number> = { ACTIVE: 0, PLANNED: 1, COMPLETED: 2 };

export function periodOptions(cycles: CycleResponse[], today: Date): PeriodOption[] {
  const dated = cycles
    .filter((c): c is CycleResponse & { startDate: string; endDate: string } => Boolean(c.startDate && c.endDate))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.startDate.localeCompare(a.startDate));
  return [
    { value: 'active', label: '활성 사이클', hint: '기본', group: 'cycle' },
    ...dated.map((c) => ({
      value: `cycle-${c.id}`,
      label: `${c.name} (${CYCLE_STATUS_LABEL[c.status]})`,
      hint: formatPeriodSpan(c.startDate, c.endDate, today),
      group: 'cycle' as const,
    })),
    { value: 'quarter', label: '이번 분기', hint: null, group: 'preset' },
    { value: 'rolling', label: '최근 3개월 ~ 향후 6개월', hint: null, group: 'preset' },
    { value: 'all', label: '전체 (기간 제한 없음)', hint: null, group: 'all' },
  ];
}

/** 현재 PeriodParam 을 선택지 값으로 — 체크 표시용. range 는 「직접 지정」 폼이 맡아 'range'. */
export function periodOptionValue(p: PeriodParam): string {
  return p.kind === 'cycle' ? `cycle-${p.id}` : p.kind;
}

/** 선택지 값 → PeriodParam. */
export function periodOptionToParam(value: string): PeriodParam {
  if (value.startsWith('cycle-')) return { kind: 'cycle', id: Number(value.slice('cycle-'.length)) };
  if (value === 'quarter' || value === 'rolling' || value === 'all') return { kind: value };
  return { kind: 'active' };
}

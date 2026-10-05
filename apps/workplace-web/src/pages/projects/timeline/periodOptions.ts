// 조회 기간 선택지(WP-247) — 데스크톱 드롭다운과 모바일 시트가 같은 목록을 쓴다.
// 사이클은 상태(진행 중 → 예정 → 완료됨) 순, 같은 상태 안에서는 시작일이 늦은 것부터(최근 것이 위). 날짜 없는 사이클은 고를 수 없어 뺀다.
import type { CycleResponse, CycleStatus } from '@/types/cycle';

import { formatPeriodSpan, parsePeriodParam, periodParamToString } from './timelineData';
import type { PeriodParam } from './timelineTypes';

export interface PeriodOption {
  value: string;
  label: string;
  hint: string | null;
  group: 'cycle' | 'preset' | 'all';
}

const STATUS_ORDER: Record<CycleStatus, number> = { ACTIVE: 0, PLANNED: 1, COMPLETED: 2 };
// 타임라인 기간 UI 용어 — 트리거·대체 안내가 PLANNED 를 「예정」이라 부르므로 선택지도 맞춘다(공용 CYCLE_STATUS_LABEL 은 「계획됨」).
const STATUS_LABEL: Record<CycleStatus, string> = { ACTIVE: '진행 중', PLANNED: '예정', COMPLETED: '완료됨' };

export function periodOptions(cycles: CycleResponse[], today: Date): PeriodOption[] {
  const dated = cycles
    .filter((c): c is CycleResponse & { startDate: string; endDate: string } => Boolean(c.startDate && c.endDate))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.startDate.localeCompare(a.startDate));
  return [
    { value: 'active', label: '활성 사이클', hint: '기본', group: 'cycle' },
    ...dated.map((c) => ({
      value: `cycle-${c.id}`,
      label: `${c.name} (${STATUS_LABEL[c.status]})`,
      hint: formatPeriodSpan(c.startDate, c.endDate, today),
      group: 'cycle' as const,
    })),
    { value: 'quarter', label: '이번 분기', hint: null, group: 'preset' },
    { value: 'rolling', label: '최근 3개월 ~ 향후 6개월', hint: null, group: 'preset' },
    { value: 'all', label: '전체 (기간 제한 없음)', hint: null, group: 'all' },
  ];
}

/**
 * 현재 PeriodParam 을 선택지 값으로 — 체크 표시용. 선택지 값은 URL 값과 같은 형식이라 URL 직렬화를 그대로 쓴다
 * (기본 active 만 URL 에서 빠지므로 'active'). range 는 「range:…」 값이라 어떤 선택지와도 맞지 않는다 — 「직접 지정」 폼이 맡는다.
 */
export const periodOptionValue = (p: PeriodParam): string => periodParamToString(p) ?? 'active';

/** 선택지 값 → PeriodParam — URL 값 해석과 같다. */
export const periodOptionToParam = parsePeriodParam;

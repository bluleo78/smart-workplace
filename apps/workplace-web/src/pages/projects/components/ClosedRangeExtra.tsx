// 「완료일」 facet 의 옵션 목록 아래 영역 — 「기간 직접 지정」 버튼과 그 달력 패널(WP-873).
// 버튼을 누르면 같은 팝오버 안에서 프리셋 목록을 접고 그 자리에 달력을 펼친다(펼침 상태는 FacetValueList 가 쥔다 —
// 목록을 접어야 팝오버가 화면 높이 안에 든다). 「적용」 하면 'from~to' 토큰을 단일 값으로 고르고, 「취소」면 목록으로 돌아간다.
import { Check } from 'lucide-react';

import { DateRangePickerPanel } from '@/components/filter/DateRangePickerPanel';
import type { FacetValue } from '@/components/filter/types';
import { resolveClosedRange } from '@/lib/closedRange';

export function ClosedRangeExtra({
  selected,
  select,
  expanded,
  setExpanded,
}: {
  selected: FacetValue[];
  select: (v: FacetValue) => void;
  /** 달력을 펼쳤는가 — FacetValueList 가 이 동안 프리셋 목록을 접는다. */
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
}) {
  // 프리셋이 아닌 직접 지정 토큰('~' 포함)이 골라져 있으면 그 범위로 달력을 연다.
  const current = typeof selected[0] === 'string' && selected[0].includes('~') ? selected[0] : null;

  if (expanded) {
    return (
      <DateRangePickerPanel
        initial={current ? resolveClosedRange(current) : null}
        onCancel={() => setExpanded(false)}
        onApply={(from, to) => {
          select(`${from}~${to}`);
          setExpanded(false);
        }}
      />
    );
  }
  return (
    <div className="mt-1 border-t pt-1">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded p-1 text-left text-sm hover:bg-accent"
        data-testid="closed-range-open"
        onClick={() => setExpanded(true)}
      >
        기간 직접 지정
        {current && <Check className="ml-auto h-4 w-4" />}
      </button>
    </div>
  );
}

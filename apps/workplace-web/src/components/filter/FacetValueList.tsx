// src/components/filter/FacetValueList.tsx
// facet 옵션 체크리스트(멀티셀렉트, single facet 은 하나만 체크). AddFilterButton 2-step 과 FilterChip 편집 팝오버가 공유.
import { Fragment, useState } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

import type { FacetDef, FacetValue } from './types';

export function FacetValueList({
  facet,
  selected,
  onToggle,
  query = '',
  variant = 'popover',
}: {
  facet: FacetDef;
  selected: FacetValue[];
  onToggle: (value: FacetValue) => void;
  /** 옵션 이름 검색어(빠른 필터 칩 팝오버·시트의 검색칸) — 대소문자 무시 부분 일치. 비면 전체. */
  query?: string;
  /** popover = 데스크톱 팝오버(목록 상자 max-h-64 안 스크롤), sheet = 모바일 바텀시트(행 48px 이상, 시트가 스크롤). */
  variant?: 'popover' | 'sheet';
}) {
  // 추가 영역(renderExtra)이 펼쳐졌는가 — 「기간 직접 지정」 달력처럼 큰 영역을 펼친 동안엔 옵션 목록을 접는다.
  // 펼친 영역을 옵션 스크롤 상자(max-h-64) 안에 두면 달력(약 300px)이 상자보다 커 취소·적용이 잘렸고(WP-873),
  // 상자 밖에 두고 옵션도 그대로 두면 팝오버가 화면 높이를 넘었다. 팝오버가 닫히면 이 컴포넌트가 내려가 접힘이 풀린다.
  const [extraExpanded, setExtraExpanded] = useState(false);
  const keyword = query.trim().toLowerCase();
  const options = keyword ? facet.options.filter((o) => o.label.toLowerCase().includes(keyword)) : facet.options;
  const sheet = variant === 'sheet';
  return (
    <div className="space-y-1">
      {!extraExpanded && (
        <div className={cn(sheet ? 'divide-y' : 'max-h-64 space-y-1 overflow-y-auto')}>
          {/* AND 결합 facet(라벨) 전용 안내 — 다른 facet(OR)과 시맨틱이 다름을 선택 전에 미리 알림 (#626) */}
          {facet.combineMode === 'and' && (
            <p
              className="px-1 pb-1 text-xs text-muted-foreground"
              data-testid={`facet-value-${facet.key}-and-hint`}
            >
              선택한 {facet.label}을(를) 모두 가진 이슈만 표시됩니다
            </p>
          )}
          {options.map((opt, i) => (
            <Fragment key={String(opt.value)}>
            {/* 묶음 머리글 — 앞 옵션과 group 이 달라지는 첫 옵션 위에(예: 구성요소 「보관됨」). */}
            {opt.group && opt.group !== options[i - 1]?.group && (
              <p className="px-1 pt-1 text-xs text-muted-foreground" data-testid={`facet-group-${facet.key}-${opt.group}`}>
                {opt.group}
              </p>
            )}
            <label
              className={cn(
                'flex cursor-pointer items-center gap-2',
                // 시트 행은 터치 영역 48px 이상(WP-1020) — 체크박스만이 아니라 행 전체가 누르는 자리다.
                sheet ? 'min-h-12 gap-3 px-1 text-base active:bg-accent' : 'rounded p-1 hover:bg-accent',
              )}
              data-testid={`facet-value-${facet.key}-${opt.value}`}
            >
              <Checkbox
                checked={selected.includes(opt.value)}
                onCheckedChange={() => onToggle(opt.value)}
                aria-label={opt.label}
              />
              {opt.render ?? <span className="text-sm">{opt.label}</span>}
            </label>
            </Fragment>
          ))}
          {facet.options.length === 0 && !facet.renderExtra && (
            <p className="text-xs text-muted-foreground py-2 text-center">옵션이 없습니다</p>
          )}
          {facet.options.length > 0 && options.length === 0 && (
            <p className="py-2 text-center text-xs text-muted-foreground" data-testid={`facet-value-${facet.key}-no-match`}>
              일치하는 항목이 없습니다
            </p>
          )}
        </div>
      )}
      {/* 옵션 아래 추가 영역(단일 선택 facet 의 직접 지정 등) — 옵션 스크롤 상자 밖에 둬 펼쳐도 잘리지 않는다.
          이미 골라진 값을 다시 select 해도 해제되지 않게 막는다. */}
      {facet.renderExtra?.({
        selected,
        select: (v) => {
          if (!selected.includes(v)) onToggle(v);
        },
        expanded: extraExpanded,
        setExpanded: setExtraExpanded,
      })}
    </div>
  );
}

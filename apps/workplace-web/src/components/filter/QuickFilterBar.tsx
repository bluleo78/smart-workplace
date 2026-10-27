// src/components/filter/QuickFilterBar.tsx
// 빠른 필터 칩 줄(WP-1020, Jira 식) — 자주 쓰는 facet 을 칩으로 바로 보이고, 칩을 한 번 누르면 값 목록 팝오버가 열린다.
// 예전 「＋ 필터 → 항목 → 값」 3단계를 「칩 → 값」 1단계로 줄였다. 체크는 바로 적용되고 팝오버는 열린 채 남아 여러 값을 연달아 고른다.
// 걸린 칩은 파란색 + 값 요약(「담당자: 김서준 +1 ×」), × 는 그 칩만 비운다. 덜 쓰는 facet 은 「더 보기 ＋」 안에 있고,
// 거기서 칩을 고정·숨길 수 있다(화면별 localStorage). controlled(facets/value/onChange) — 검색·그룹·뷰는 호출부가 옆에 조합한다.
import { ArrowLeft, ChevronDown, Plus, Search, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { ASSIGNEE_NONE } from '@/pages/projects/hooks/assigneeFacet';

import { facetSearchable, summarizeFacet } from './facetSummary';
import { FacetValueList } from './FacetValueList';
import type { FacetDef, FacetValue } from './types';
import { type QuickFilterInput, useQuickFilter } from './useQuickFilter';

/** 걸린 칩의 값 요약 — 「담당자: 김서준 +1」. 라벨처럼 AND 로 묶이는 facet 은 「외 N (모두 포함)」. 옵션에 없는 값은 흐리게 「(알 수 없음)」. */
export function QuickChipLabel({ facet, selected }: { facet: FacetDef; selected: FacetValue[] }) {
  if (selected.length === 0) return <>{facet.label}</>;
  const s = summarizeFacet(facet, selected);
  return (
    <>
      {facet.label}:{' '}
      <span className={cn('max-w-40 truncate', s.isUnresolved && 'italic opacity-70')}>{s.text}</span>
      {s.extra > 0 && (s.isAndCombine ? <span>외 {s.extra} (모두 포함)</span> : <span>+{s.extra}</span>)}
    </>
  );
}

/** 선택 개수 문구 — 담당자 「미지정」은 사람이 아니므로 사람 수에서 빼고 「1명 · 미지정」처럼 나눠 보인다. */
function selectedCountText(facet: FacetDef, selected: FacetValue[]): string {
  const unit = facet.countUnit ?? '개';
  if (facet.key !== 'assignee' || !selected.includes(ASSIGNEE_NONE)) return `${selected.length}${unit}`;
  const people = selected.length - 1;
  return people > 0 ? `${people}${unit} · 미지정` : '미지정';
}

/** 칩 팝오버 본문 — 검색칸 + 체크 목록 + 「N개 선택 · 고르는 즉시 적용 / 선택 해제」. 「더 보기」에서 고른 facet 도 같은 본문을 쓴다. */
function QuickFacetPanel({
  facet,
  selected,
  onToggle,
  onClear,
}: {
  facet: FacetDef;
  selected: FacetValue[];
  onToggle: (v: FacetValue) => void;
  onClear: () => void;
}) {
  // 팝오버가 닫히면 이 본문이 내려가 검색어도 비워진다.
  const [query, setQuery] = useState('');
  return (
    <div className="space-y-2" data-testid={`quick-filter-panel-${facet.key}`}>
      {facetSearchable(facet) && (
        <label className="flex h-8 items-center gap-2 rounded-md border px-2">
          <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`${facet.label} 검색`}
            aria-label={`${facet.label} 검색`}
            data-testid={`quick-filter-search-${facet.key}`}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>
      )}
      <FacetValueList facet={facet} selected={selected} onToggle={onToggle} query={query} />
      <div className="flex items-center justify-between gap-2 border-t pt-2 text-xs text-muted-foreground">
        <span>{selected.length > 0 ? `${selectedCountText(facet, selected)} 선택 · 고르는 즉시 적용` : '고르는 즉시 적용'}</span>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            data-testid={`quick-filter-clear-${facet.key}`}
            className="font-medium text-primary hover:underline"
          >
            선택 해제
          </button>
        )}
      </div>
    </div>
  );
}

/** 칩 하나 — 틀(Popover·트리거)은 값이 걸려도 그대로 둔다. 틀이 바뀌면 트리거가 다시 마운트돼 고르는 도중 팝오버가 닫힌다. */
function QuickChip({
  facet,
  selected,
  onToggle,
  onClear,
  onOpenChange,
}: {
  facet: FacetDef;
  selected: FacetValue[];
  onToggle: (v: FacetValue) => void;
  onClear: () => void;
  /** 팝오버 열림 변화 — 값 때문에만 보이던 칩이 열린 동안 빠지지 않게 호출부가 기억한다. */
  onOpenChange?: (open: boolean) => void;
}) {
  const active = selected.length > 0;
  const s = active ? summarizeFacet(facet, selected) : null;
  return (
    <Popover onOpenChange={onOpenChange}>
      <div
        className={cn(
          'inline-flex h-8 items-center rounded-md border text-sm',
          active ? 'border-primary/40 bg-primary/10 font-medium text-primary' : 'bg-background',
        )}
        data-testid={`quick-filter-${facet.key}`}
        data-active={active || undefined}
        title={s?.isAndCombine ? `선택한 ${facet.label}을(를) 모두 가진 항목만 표시` : undefined}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex h-full items-center gap-1 rounded-md px-2.5 whitespace-nowrap',
              active ? 'pr-1' : 'hover:bg-accent',
            )}
            data-testid={`quick-filter-${facet.key}-trigger`}
          >
            <QuickChipLabel facet={facet} selected={selected} />
            {!active && <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />}
          </button>
        </PopoverTrigger>
        {active && (
          <button
            type="button"
            aria-label={`${facet.label} 필터 제거`}
            data-testid={`quick-filter-${facet.key}-remove`}
            className="inline-flex h-full items-center rounded-md px-1.5 hover:bg-primary/15"
            onClick={onClear}
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <PopoverContent className="w-64 p-2" align="start">
        <QuickFacetPanel facet={facet} selected={selected} onToggle={onToggle} onClear={onClear} />
      </PopoverContent>
    </Popover>
  );
}

/** 「더 보기 ＋」 — 칩으로 안 보이는 facet 목록(고르면 같은 팝오버 안에서 값 목록으로) + 칩 고정·숨김. */
function MoreButton({ q, value }: { q: ReturnType<typeof useQuickFilter>; value: Record<string, FacetValue[]> }) {
  const [open, setOpen] = useState(false);
  // 고른 facet key — null 이면 facet 목록 단계. Radix 중첩 Popover 를 피해 한 팝오버 안에서 내용만 바꾼다.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // 고른 facet 은 값이 걸리는 순간 칩으로 나가 「더 보기」 목록에서 빠지므로, 전체 facet 에서 찾는다(팝오버는 열린 채 남는다).
  const active = [...q.chips, ...q.more].find((f) => f.key === activeKey) ?? null;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setActiveKey(null);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1 rounded-md border border-dashed px-2.5 text-sm whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-foreground"
          data-testid="quick-filter-more"
        >
          더 보기
          <Plus className="size-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        {active ? (
          <div className="space-y-1">
            <button
              type="button"
              className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setActiveKey(null)}
            >
              <ArrowLeft className="size-3" aria-hidden />
              {active.label}
            </button>
            <QuickFacetPanel
              facet={active}
              selected={value[active.key] ?? []}
              onToggle={(v) => q.toggle(active.key, v)}
              onClear={() => q.clear(active.key)}
            />
          </div>
        ) : (
          <div className="space-y-2">
            {/* 칩 고정·숨김 — 체크한 facet 은 칩 줄에 바로 보인다. 값이 걸린 facet 은 숨겨도 걸려 있는 동안 칩으로 남는다.
                고정 목록을 위에 둔다 — 고정할 때마다 아래 「다른 필터」 목록이 줄어도 체크박스 자리가 밀리지 않게. */}
            {q.customizable && (
              <div className="space-y-0.5 border-b pb-2" data-testid="quick-filter-pins">
                <p className="px-1.5 pb-1 text-xs text-muted-foreground">칩으로 보이기</p>
                {q.all.map((f) => (
                  <label
                    key={f.key}
                    className="flex cursor-pointer items-center gap-2 rounded p-1.5 text-sm hover:bg-accent"
                    data-testid={`quick-filter-pin-${f.key}`}
                  >
                    <Checkbox
                      checked={q.isPinned(f.key)}
                      onCheckedChange={() => q.togglePin(f.key)}
                      aria-label={`${f.label} 칩으로 보이기`}
                    />
                    {f.label}
                  </label>
                ))}
              </div>
            )}
            {q.more.length > 0 ? (
              <div className="space-y-0.5">
                {q.customizable && <p className="px-1.5 pb-1 text-xs text-muted-foreground">다른 필터</p>}
                {q.more.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    className="flex w-full items-center rounded p-1.5 text-left text-sm hover:bg-accent"
                    data-testid={`quick-filter-more-facet-${f.key}`}
                    onClick={() => setActiveKey(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="px-1.5 py-1 text-xs text-muted-foreground">모든 필터가 칩으로 보입니다</p>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function QuickFilterBar({
  trailing,
  ...input
}: QuickFilterInput & {
  /** 칩 줄 끝에 한 덩어리로 붙일 요소(예: 「필터 지우기」) — 줄이 넘쳐도 「더 보기」와 함께 내려간다. */
  trailing?: ReactNode;
}) {
  // 열린 칩의 key — 값을 모두 풀어도 닫힐 때까지 칩으로 남긴다.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const q = useQuickFilter(input, openKey);
  const { value } = input;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="quick-filter-bar">
      {q.chips.map((f) => (
        <QuickChip
          key={f.key}
          facet={f}
          selected={value[f.key] ?? []}
          onToggle={(v) => q.toggle(f.key, v)}
          onClear={() => q.clear(f.key)}
          onOpenChange={(open) => setOpenKey((cur) => (open ? f.key : cur === f.key ? null : cur))}
        />
      ))}
      {/* 「더 보기」·trailing 은 한 덩어리 — 고를 facet 도 고정 메뉴도 없으면(내 작업처럼 칩이 전부) 「더 보기」를 두지 않는다. */}
      <div className="flex items-center gap-1.5">
        {(q.more.length > 0 || q.customizable) && <MoreButton q={q} value={value} />}
        {trailing}
      </div>
    </div>
  );
}

// WP-386 공용 메모리 공간 고르기 — 데스크톱은 왼쪽 목록(조직 지침 · 프로젝트 · 노트 스페이스 묶음 + 개수, 10개 넘으면 공간 검색칸),
// 좁은 탭(모바일 포함)은 위쪽 선택 상자(묶음 라벨 + 이름 · 개수). 둘 다 그리고 탭의 @container 폭(640px)으로 하나만 보인다(숨긴 쪽은 display:none 이라
// 접근성 트리에도 없다). 고른 값은 부르는 쪽이 쿼리(?space=)로 들고 있다.
import { useState } from 'react';

import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { filterSpaces, parseSpaceParam, refOf, sameSpace, SPACE_GROUPS, SPACE_SEARCH_OVER, spaceLabel, spaceParam } from '@/lib/sharedAiMemory';
import { andParticle, cn } from '@/lib/utils';
import type { SharedMemorySpace, SharedSpaceRef } from '@/types/sharedAiMemory';

export function SharedSpacePicker({
  spaces,
  selected,
  onSelect,
}: {
  spaces: readonly SharedMemorySpace[];
  selected: SharedSpaceRef;
  onSelect: (ref: SharedSpaceRef) => void;
}) {
  const [q, setQ] = useState('');
  const searchable = spaces.length > SPACE_SEARCH_OVER;
  const shown = searchable ? filterSpaces(spaces, q) : spaces;
  return (
    <>
      <div className="@min-[640px]:hidden">
        <Select
          value={spaceParam(selected)}
          onValueChange={(v) => {
            const r = parseSpaceParam(v);
            if (r) onSelect(r);
          }}
        >
          <SelectTrigger data-testid="shared-space-select" className="w-full text-base data-[size=default]:h-11" aria-label="공간">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SPACE_GROUPS.map((g) => {
              const list = spaces.filter((s) => s.type === g.type);
              return list.length === 0 ? null : (
                <SelectGroup key={g.type}>
                  <SelectLabel>{g.label}</SelectLabel>
                  {list.map((s) => (
                    <SelectItem key={spaceParam(refOf(s))} value={spaceParam(refOf(s))}>
                      {spaceLabel(s)} · {s.count}
                    </SelectItem>
                  ))}
                </SelectGroup>
              );
            })}
          </SelectContent>
        </Select>
      </div>
      <nav aria-label="공간" data-testid="shared-space-list" className="hidden space-y-3 @min-[640px]:block">
        {searchable && <SearchInput value={q} onChange={setQ} placeholder="공간 검색" className="max-w-none" inputTestId="shared-space-search" />}
        {SPACE_GROUPS.map((g) => {
          const list = shown.filter((s) => s.type === g.type);
          return list.length === 0 ? null : (
            <div key={g.type} className="space-y-0.5">
              <p className="px-2 text-xs font-medium text-muted-foreground">{g.label}</p>
              {list.map((s) => {
                const ref = refOf(s);
                const current = sameSpace(ref, selected);
                return (
                  <button
                    key={spaceParam(ref)}
                    type="button"
                    data-testid="shared-space-item"
                    data-space={spaceParam(ref)}
                    aria-current={current ? 'true' : undefined}
                    onClick={() => onSelect(ref)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/60',
                      current && 'bg-accent font-medium text-accent-foreground',
                    )}
                  >
                    <span className="min-w-0 truncate" title={spaceLabel(s)}>
                      {spaceLabel(s)}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{s.count}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
        {searchable && shown.length === 0 && <p className="px-2 text-xs text-muted-foreground">'{q.trim()}'{andParticle(q.trim())} 맞는 공간이 없어요.</p>}
      </nav>
    </>
  );
}

// 구성요소 피커(WP-933) — 여러 개 선택 + 이름 검색. 이슈 상세 속성 행과 데스크톱 만들기 창이 같이 쓴다.
// 값은 밖에서 쥐고(value) 팝오버가 닫힐 때 바뀐 경우에만 onCommit 을 부른다 — 상세는 그때 한 번 저장(PUT)하고, 만들기 창은 폼 값만 바꾼다.
// 선택지는 사용 중 구성요소 + 이 이슈에 이미 붙은 보관 구성요소(pickerComponentOptions) — 보관된 것을 빼면 교체 요청에서 조용히 떨어진다.

import { useMemo, useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover';
import { Input } from '@/components/ui/input';

import { pickerComponentOptions } from '../../lib/issueComponents';
import type { ComponentResponse } from '../../types/component';
import { PickerAddTrigger, type PickerTriggerVariant } from '../issue/PropertyChipRow';
import { filterLabelsByName } from '../labels/labelSearch';
import { ComponentChip } from './ComponentChip';

/** 정렬한 id 목록 문자열 — 열 때와 닫을 때 집합이 같은지 비교한다(순서 무관). */
const idsKey = (ids: number[]) => [...ids].sort((a, b) => a - b).join(',');

export function ComponentPickerPopover({
  components,
  value,
  onCommit,
  trigger = 'button',
}: {
  /** 프로젝트 구성요소 전체(보관 포함, 목록 순서). */
  components: ComponentResponse[];
  /** 지금 붙은(고른) 구성요소 id. */
  value: number[];
  /** 닫힐 때 집합이 바뀌었으면 새 id 목록(목록 순서). */
  onCommit: (ids: number[]) => void;
  /** 트리거 모양(PickerAddTrigger) — button: 테두리 「＋」 상자, row·icon: 속성 레일 칩 줄(WP-1079). */
  trigger?: PickerTriggerVariant;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number[]>(value);

  const options = useMemo(() => pickerComponentOptions(components, value), [components, value]);
  const filtered = useMemo(() => filterLabelsByName(options, search), [options, search]);

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  // 열 때: 지금 값으로 초기화(외부 갱신 반영). 닫을 때: 바뀐 경우만 목록 순서로 정리해 넘긴다 — 같으면 저장 요청을 보내지 않는다.
  function onOpenChange(next: boolean) {
    if (next) {
      setSelected(value);
      setSearch('');
    } else if (idsKey(selected) !== idsKey(value)) {
      const chosen = new Set(selected);
      onCommit(options.filter((c) => chosen.has(c.id)).map((c) => c.id));
    }
    setOpen(next);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        {/* 속성 레일(row·icon)은 보이는 글자 「추가」와 읽히는 이름을 맞춘다(음성 조작이 「추가」로 찾는다). */}
        <PickerAddTrigger variant={trigger} aria-label={trigger === 'button' ? '구성요소 편집' : '구성요소 추가'} data-testid="component-picker-trigger" />
      </PopoverTrigger>
      {/* 트리거가 속성 레일 오른쪽 끝이라 가운데 정렬이면 화면 가장자리에 붙는다 — 오른쪽 끝을 트리거에 맞추고 가장자리 16px 를 띄운다. */}
      <PopoverContent align="end" collisionPadding={16} className="w-72 p-2" data-testid="component-picker">
        <Input
          placeholder="구성요소 검색"
          aria-label="구성요소 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-2"
        />
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {filtered.map((c) => (
            <label
              key={c.id}
              className="flex cursor-pointer items-center gap-2 rounded p-1 hover:bg-accent"
              data-testid={`component-option-${c.id}`}
            >
              <input
                type="checkbox"
                checked={selected.includes(c.id)}
                onChange={() => toggle(c.id)}
                aria-label={c.name}
              />
              <ComponentChip component={c} />
              {c.archived && <span className="ml-auto text-xs text-muted-foreground">보관됨</span>}
            </label>
          ))}
          {filtered.length === 0 && <p className="py-2 text-center text-xs text-muted-foreground">결과 없음</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

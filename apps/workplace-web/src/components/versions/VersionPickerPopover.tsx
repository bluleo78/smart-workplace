// 버전 피커(WP-888) — 여러 개 선택 + 이름 검색. 이슈 상세의 「수정 버전」·「영향 버전」 줄이 같이 쓴다.
// 값은 밖에서 쥐고(value) 팝오버가 닫힐 때 바뀐 경우에만 onCommit 을 부른다 — 그때 한 번 저장(PUT)한다.
// 선택지는 보관 안 된 버전(미출시 먼저) + 이 이슈에 이미 붙은 보관 버전(pickerVersionOptions) — 보관된 것을 빼면 교체 요청에서 조용히 떨어진다.

import { useMemo, useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover';
import { Input } from '@/components/ui/input';

import { isArchived, pickerVersionOptions } from '../../lib/issueVersions';
import type { VersionResponse } from '../../types/version';
import { PickerAddTrigger, type PickerTriggerVariant } from '../issue/PropertyChipRow';
import { filterLabelsByName } from '../labels/labelSearch';
import { VersionChip } from './VersionChip';

/** 정렬한 id 목록 문자열 — 열 때와 닫을 때 집합이 같은지 비교한다(순서 무관). */
const idsKey = (ids: number[]) => [...ids].sort((a, b) => a - b).join(',');

export function VersionPickerPopover({
  versions,
  value,
  onCommit,
  ariaLabel,
  testIdPrefix,
  trigger,
}: {
  /** 프로젝트 버전 전체(보관 포함, 목록 순서). */
  versions: VersionResponse[];
  /** 지금 붙은(고른) 버전 id. */
  value: number[];
  /** 닫힐 때 집합이 바뀌었으면 새 id 목록(피커 선택지 순서). */
  onCommit: (ids: number[]) => void;
  /** 트리거·검색창의 접근성 이름 — 「수정 버전」/「영향 버전」. */
  ariaLabel: string;
  /** 테스트 식별자 접두사 — fix/affects 두 줄을 구분한다. */
  testIdPrefix: string;
  /** 트리거 모양(PickerAddTrigger, WP-1079) — row: 값이 없을 때 줄 전체 「＋ 추가」, icon: 칩 뒤 작은 「＋」. */
  trigger: Exclude<PickerTriggerVariant, 'button'>;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number[]>(value);

  const options = useMemo(() => pickerVersionOptions(versions, value), [versions, value]);
  const filtered = useMemo(() => filterLabelsByName(options, search), [options, search]);

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  // 열 때: 지금 값으로 초기화(외부 갱신 반영). 닫을 때: 바뀐 경우만 선택지 순서로 정리해 넘긴다 — 같으면 저장 요청을 보내지 않는다.
  function onOpenChange(next: boolean) {
    if (next) {
      setSelected(value);
      setSearch('');
    } else if (idsKey(selected) !== idsKey(value)) {
      const chosen = new Set(selected);
      onCommit(options.filter((v) => chosen.has(v.id)).map((v) => v.id));
    }
    setOpen(next);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        {/* 보이는 글자 「추가」와 읽히는 이름을 맞춘다(음성 조작이 「추가」로 찾는다). */}
        <PickerAddTrigger variant={trigger} aria-label={`${ariaLabel} 추가`} data-testid={`${testIdPrefix}-picker-trigger`} />
      </PopoverTrigger>
      {/* 레일 오른쪽 끝 가까이에서 열려 가운데 정렬이면 화면 가장자리에 붙는다 — 오른쪽 끝을 트리거에 맞추고 가장자리 16px 를 띄운다. */}
      <PopoverContent align="end" collisionPadding={16} className="w-72 p-2" data-testid={`${testIdPrefix}-picker`}>
        <Input
          placeholder={`${ariaLabel} 검색`}
          aria-label={`${ariaLabel} 검색`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-2"
        />
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {filtered.map((v) => (
            <label
              key={v.id}
              className="flex cursor-pointer items-center gap-2 rounded p-1 hover:bg-accent"
              data-testid={`${testIdPrefix}-option-${v.id}`}
            >
              <input type="checkbox" checked={selected.includes(v.id)} onChange={() => toggle(v.id)} aria-label={v.name} />
              <VersionChip version={v} />
              {isArchived(v) && <span className="ml-auto text-xs text-muted-foreground">보관됨</span>}
              {v.status === 'RELEASED' && <span className="ml-auto text-xs text-muted-foreground">출시됨</span>}
            </label>
          ))}
          {filtered.length === 0 && <p className="py-2 text-center text-xs text-muted-foreground">결과 없음</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

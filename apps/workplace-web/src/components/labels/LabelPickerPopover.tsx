// 이슈 상세에서 라벨을 부착/해제하는 픽커.
// 팝오버가 열릴 때 current 를 selected 로 reset, 닫힐 때 변경된 집합만 PUT 호출.

import { Tag } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { useLabels } from '../../hooks/queries/useLabels';
import { useUpdateIssueLabels } from '../../hooks/queries/useUpdateIssueLabels';
import type { LabelSummary } from '../../types/label';
import { LabelChip } from './LabelChip';

export function LabelPickerPopover({
  projectKey,
  issueNumber,
  current,
}: {
  projectKey: string;
  issueNumber: number;
  current: LabelSummary[];
}) {
  const labels = useLabels(projectKey);
  const update = useUpdateIssueLabels(projectKey, issueNumber);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number[]>(() => current.map((l) => l.id));

  const filtered = useMemo(
    () =>
      (labels.data ?? []).filter((l) =>
        l.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [labels.data, search],
  );

  function toggle(id: number) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  // 열릴 때: 현재 부착 집합을 selected 로 초기화 (외부 갱신 반영).
  // 닫힐 때: 정렬 후 비교해 변경된 경우만 mutate — 동일하면 네트워크 호출 X.
  function onOpenChange(next: boolean) {
    if (next) {
      setSelected(current.map((l) => l.id));
      setSearch('');
    } else {
      const before = current
        .map((l) => l.id)
        .sort((a, b) => a - b)
        .join(',');
      const after = [...selected].sort((a, b) => a - b).join(',');
      if (before !== after) update.mutate(selected);
    }
    setOpen(next);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label="라벨 편집" data-testid="label-picker-trigger">
          <Tag className="h-4 w-4 mr-1" /> 라벨
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" data-testid="label-picker">
        <Input
          placeholder="라벨 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-2"
          aria-label="라벨 검색"
        />
        <div className="max-h-64 overflow-y-auto space-y-1">
          {filtered.map((l) => (
            <label
              key={l.id}
              className="flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-accent"
              data-testid={`label-option-${l.id}`}
            >
              <input
                type="checkbox"
                checked={selected.includes(l.id)}
                onChange={() => toggle(l.id)}
                aria-label={l.name}
              />
              <LabelChip label={{ id: l.id, name: l.name, colorToken: l.colorToken }} />
            </label>
          ))}
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground py-2 text-center">결과 없음</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
